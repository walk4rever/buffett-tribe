#!/usr/bin/env python3

"""Fetch A-share/HK-share financial statements via akshare and optionally
import them into the database.

Usage:
  .venv/bin/python scripts/fetch-cn-hk-financials-ak.py --code 09992 --market hk --import-db
  .venv/bin/python scripts/fetch-cn-hk-financials-ak.py --code 09992 --market hk --out-dir /tmp/foo

Mirrors the two-stage shape of fetch-stock-prices-yf.py: this script does the
akshare fetch + line-item mapping and writes a normalized JSON file, then
(with --import-db) shells out to scripts/import-cn-hk-financials-from-file.ts
to do the actual Prisma write. No separate checkpoint file here — this script
is invoked once per company via onboard-company.ts, which already
checkpoints at the orchestration level (.cache/onboard-company/<TICKER>.json).

HK mapping is via akshare's stock_financial_hk_report_em(). It returns a
numeric STD_ITEM_CODE per line item, but those codes are NOT stable across
industry templates: industrial companies (Pop Mart 09992, Tencent 00700)
use "004xxx" codes, while insurers (PICC P&C 02328) and banks use "002xxx"
codes — a code-keyed insurer import silently produced nothing but
OperatingCashFlow. So mapping is keyed on STD_ITEM_NAME (the Chinese line
item name) instead — see HK_ITEM_NAME_MAP below. After the fetch,
REQUIRED_LINE_ITEMS coverage is checked per fiscal year: an item missing
from EVERY year means a template mismatch (fail loudly); missing from some
years only is a data gap (warn).

CN mapping is via akshare's stock_financial_report_sina(), which returns a
wide table with Chinese column headers and mixed quarterly+annual rows (no
"indicator=年度" filter like the HK endpoint) — annual rows are isolated by
filtering 报告日 ending in "1231". Column names verified against Moutai
(600519) real public FY2024 figures — see CN_COLUMN_MAP below. The bank
template (e.g. CMB 600036) names the same concepts differently (归属于母
公司的净利润, 归属于母公司股东的权益) — both variants are mapped. No
dedicated buyback column exists in either template, so ShareRepurchaseAmt
is left unmapped for CN rather than guessed. Dividend rows are mapped only
when the source names dividends separately; the combined “dividends, profits
and interest paid” line is not used. GrossProfit is derived as 营业收入 -
营业成本 (a standard identity, not a raw column; skipped for banks, which
have no 营业成本).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import akshare as ak
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from cn_dividend_akshare import fetch_cn_dividend_records as fetch_akshare_cn_dividends

# STD_ITEM_NAME -> Financial.lineItem, verified against scripts/lib/
# annual-report-import-core.ts's LINE_ITEMS (the same canonical keys the US SEC
# import pipeline writes). Names, not STD_ITEM_CODEs: codes differ across
# industry templates (industrial "004xxx" vs insurer/bank "002xxx"), while
# the core names are shared or aliased per template. Names verified against
# Tencent 00700 (industrial template) and PICC P&C 02328 (insurer
# template). Aliases for the same lineItem must not co-occur in one
# template; "first hit wins" per (period, lineItem) resolves any overlap.
HK_ITEM_NAME_MAP: dict[str, str] = {
    # 利润表 (income statement)
    "营业额": "Revenue",  # industrial template (004001001)
    "经营收入总额": "Revenue",  # insurer template (002003999, incl. investment income)
    "毛利": "GrossProfit",  # industrial only; insurers/banks have none
    "经营溢利": "OperatingIncome",  # same name in both templates
    "除税前溢利": "TotalProfit",  # pretax profit
    "税项": "IncomeTaxExpense",  # income tax
    "股东应占溢利": "NetIncome",  # attributable to shareholders, matches US convention
    "每股基本盈利": "EPSBasic",
    "每股摊薄盈利": "EPSDiluted",
    # 保险与金融专属利润表
    "净已赚保费": "NetPremiumsEarned",
    "投资收益": "NetInvestmentIncome",
    "赔付支出": "PolicyClaimsAndBenefits",
    "利息收入": "InterestIncome",
    "利息支出": "InterestExpenseBank",
    # 资产负债表 (balance sheet)
    "总资产": "TotalAssets",
    "总负债": "TotalLiabilities",
    "股东权益": "ShareholdersEquity",  # industrial: attributable (excl. 少数股东权益)
    "股东权益合计": "TotalEquity",
    "归属于母公司股东权益": "ShareholdersEquity",  # insurer template
    # 保险与金融专属资产负债表
    "指定以公允价值记账之金融资产": "TotalInvestments",
    "可供出售证券": "TotalInvestments",
    "其他投资": "TotalInvestments",
    "投资物业": "InvestmentProperty",
    "保险合同负债": "InsuranceContractLiabilities",
    "保险准备金": "InsuranceContractLiabilities",
    "合约负债": "ContractLiabilities",
    "再保险资产": "ReinsuranceAssets",
    "客户贷款及垫款净额": "NetLoans",
    # 现金流量表 (cash flow statement)
    "经营业务现金净额": "OperatingCashFlow",
    "投资业务现金净额": "InvestingCashFlow",
    "现金净额": "FinancingCashFlow",
    "购建固定资产": "CapEx",
    "回购股份": "ShareRepurchaseAmt",  # see suspicious-repurchase check in check-all-company-financials.ts
    "支付股息": "DividendsPaid",
    "已付股息": "DividendsPaid",
    "已付股息(融资)": "DividendsPaid",
    "股息支付": "DividendsPaid",
    "研发开支": "RnDExpense",
}

HK_STATEMENTS = ["资产负债表", "利润表", "现金流量表"]

# Line items every FY must have; Revenue, GrossProfit, CapEx,
# ShareRepurchaseAmt and EPS* can be legitimately absent for pre-revenue,
# financial and other industry-specific templates.
REQUIRED_LINE_ITEMS = [
    "NetIncome",
    "TotalAssets",
    "TotalLiabilities",
    "ShareholdersEquity",
    "OperatingCashFlow",
]

# Sina column name -> Financial.lineItem, verified against Moutai (600519)
# FY2024 figures matching public filings (营业收入 ¥170.9B, 归属于母公司所有者
# 的净利润 ¥86.2B, 基本每股收益 ¥68.64, 资产总计 ¥298.9B). The bank template
# (verified against CMB 600036 FY2025) names net income and equity
# differently — both variants are mapped.
CN_COLUMN_MAP: dict[str, str] = {
    # 利润表 (income statement)
    "营业收入": "Revenue",
    "营业利润": "OperatingIncome",
    "归属于母公司所有者的净利润": "NetIncome",
    "归属于母公司的净利润": "NetIncome",  # bank & insurance template
    "基本每股收益": "EPSBasic",
    "稀释每股收益": "EPSDiluted",
    # 资产负债表 (balance sheet)
    "资产总计": "TotalAssets",
    "负债合计": "TotalLiabilities",
    "实收资本(或股本)": "ShareCapital",
    "实收资本（或股本）": "ShareCapital",
    "股本": "ShareCapital",
    "实收资本": "ShareCapital",
    "实收资本净额": "ShareCapital",
    "所有者权益(或股东权益)合计": "TotalEquity",
    "所有者权益合计": "TotalEquity",  # total equity (parent + minority)
    "归属于母公司股东权益合计": "ShareholdersEquity",
    "归属于母公司的股东权益合计": "ShareholdersEquity",  # insurance variant
    "归属于母公司所有者权益合计": "ShareholdersEquity",
    # 银行与金融专属科目
    "利息净收入": "NetInterestIncome",
    "净利息收入": "NetInterestIncome",
    "减:所得税": "IncomeTaxExpense",
    "所得税费用": "IncomeTaxExpense",
    "非利息净收入": "NonInterestIncome",
    "业务及管理费": "NonInterestExpense",
    "信用减值损失": "ProvisionForCreditLosses",
    "资产减值损失": "ProvisionForCreditLosses",
    "发放贷款及垫款净额": "NetLoans",
    "发放贷款及垫款": "GrossLoans",
    "减:贷款损失准备": "LoanLossAllowance",
    "客户存款(吸收存款)": "TotalDeposits",
    "吸收存款及同业存放": "TotalDeposits",
    # 现金流量表 (cash flow statement)
    "经营活动产生的现金流量净额": "OperatingCashFlow",
    "购建固定资产、无形资产和其他长期资产所支付的现金": "CapEx",
    "购建固定资产、无形资产和其他长期资产支付的现金": "CapEx",
    "分配股利、利润支付的现金": "DividendsPaid",
    "分配股利、利润所支付的现金": "DividendsPaid",
}

CN_STATEMENTS = ["资产负债表", "利润表", "现金流量表"]

BALANCE_LINE_ITEMS = {
    "TotalAssets",
    "TotalLiabilities",
    "ShareholdersEquity",
    "ShareCapital",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch CN/HK financial statements via akshare and optionally import into the database."
    )
    parser.add_argument("--code", required=True, help="Exchange code, e.g. 09992 (hk) or 600519 (cn)")
    parser.add_argument("--market", required=True, choices=["cn", "hk"], help="cn or hk")
    parser.add_argument("--ticker", default=None, help="Entity.ticker to resolve, e.g. 9992.HK (defaults to derived from --code/--market)")
    parser.add_argument("--currency", required=True, choices=["CNY", "HKD", "USD"], help="Verified reporting currency (not derived — see scripts/lib/cn-hk-company-seeds.ts)")
    parser.add_argument("--data-currency", choices=["CNY", "HKD", "USD"], help="Currency used by returned AkShare values when it differs from the company's reporting currency")
    parser.add_argument("--from-year", type=int, default=2020, help="Earliest fiscal year to include (default 2020)")
    parser.add_argument("--out-dir", default="/tmp/cn-hk-financials-ak", help="Directory for the generated JSON fixture")
    parser.add_argument("--import-db", action="store_true", help="Import the generated JSON into the database after fetching")
    parser.add_argument("--keep-file", action="store_true", help="Keep the generated JSON instead of deleting it after import")
    parser.add_argument(
        "--line-items",
        default=None,
        help="Optional comma-separated canonical line items to import",
    )
    parser.add_argument(
        "--dividends-only",
        action="store_true",
        help="Fetch only implemented A-share cash dividends; requires --market cn",
    )
    return parser.parse_args()


def to_scalar(value: object) -> float | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if pd.notna(f) else None


FLOW_LINE_ITEMS = {
    "Revenue",
    "GrossProfit",
    "OperatingIncome",
    "NetIncome",
    "EPSBasic",
    "EPSDiluted",
    "OperatingCashFlow",
    "CapEx",
    "ShareRepurchaseAmt",
    "DividendsPaid",
}

CANONICAL_DICT_PATH = Path(__file__).resolve().parent / "lib" / "canonical-financial-dictionary.json"
if CANONICAL_DICT_PATH.exists():
    try:
        with open(CANONICAL_DICT_PATH, "r", encoding="utf-8") as f:
            _canon = json.load(f)
        if isinstance(_canon, list):
            for item in _canon:
                k = item.get("key")
                pt = item.get("periodType")
                if pt == "instant":
                    BALANCE_LINE_ITEMS.add(k)
                else:
                    FLOW_LINE_ITEMS.add(k)
                for alias in item.get("cnAliases", []):
                    if alias not in CN_COLUMN_MAP:
                        CN_COLUMN_MAP[alias] = k
                for alias in item.get("hkAliases", []):
                    if alias not in HK_ITEM_NAME_MAP:
                        HK_ITEM_NAME_MAP[alias] = k
        elif isinstance(_canon, dict):
            if "cnAliases" in _canon:
                CN_COLUMN_MAP.update(_canon["cnAliases"])
            if "hkAliases" in _canon:
                HK_ITEM_NAME_MAP.update(_canon["hkAliases"])
            if "instantItems" in _canon:
                BALANCE_LINE_ITEMS.update(_canon["instantItems"])
            if "durationItems" in _canon:
                FLOW_LINE_ITEMS.update(_canon["durationItems"])
    except Exception as e:
        print(f"Warning: failed to load canonical financial dictionary: {e}", file=sys.stderr)




def fetch_hk_records(code: str, from_year: int = 2020) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    # (period_end, date_type_code) -> { line_item: value }
    raw_hk: dict[tuple[str, str], dict[str, float]] = {}

    for statement in HK_STATEMENTS:
        df = ak.stock_financial_hk_report_em(stock=code, symbol=statement, indicator="报告期")
        for _, row in df.iterrows():
            item_name = str(row.get("STD_ITEM_NAME", "")).strip()
            line_item = HK_ITEM_NAME_MAP.get(item_name)
            if not line_item:
                continue
            report_date = row.get("REPORT_DATE")
            if pd.isna(report_date):
                continue
            period_end = pd.Timestamp(report_date).strftime("%Y-%m-%d")
            year = int(period_end[:4])
            if year < from_year:
                continue
            date_type_code = str(row.get("DATE_TYPE_CODE", "")).strip()
            amount = to_scalar(row.get("AMOUNT"))
            if amount is None:
                continue
            bucket = raw_hk.setdefault((period_end, date_type_code), {})
            if line_item == "TotalInvestments":
                bucket[line_item] = bucket.get(line_item, 0.0) + amount
            elif line_item not in bucket:
                bucket[line_item] = amount

    # Group available periods by year
    by_year_periods: dict[int, dict[str, tuple[str, dict[str, float]]]] = {}
    for (period_end, dtc), items in raw_hk.items():
        year = int(period_end[:4])
        by_year_periods.setdefault(year, {})[dtc] = (period_end, items)

    seen_keys: set[tuple[str, str, str]] = set()

    def add_rec(period_end: str, period_type: str, line_item: str, val: float | None, unit: str | None = None) -> None:
        if val is None:
            return
        key = (period_end, period_type, line_item)
        if key in seen_keys:
            return
        seen_keys.add(key)
        rec: dict[str, object] = {
            "periodEnd": period_end,
            "periodType": period_type,
            "lineItem": line_item,
            "value": val,
        }
        if unit:
            rec["unit"] = unit
        records.append(rec)

    for year in sorted(by_year_periods.keys()):
        periods = by_year_periods[year]
        # dtc mappings: 001=Annual(FY), 002=Interim(H1/Q2), 003=Q1, 004=Q3
        has_q1 = "003" in periods

        # 1. FY full year records (from 001)
        if "001" in periods:
            fy_date, fy_items = periods["001"]
            if "Revenue" in fy_items and "GrossProfit" in fy_items and "CostOfRevenue" not in fy_items:
                fy_items["CostOfRevenue"] = fy_items["Revenue"] - fy_items["GrossProfit"]
            if "TotalAssets" in fy_items and "ShareholdersEquity" in fy_items and "TotalLiabilities" not in fy_items:
                fy_items["TotalLiabilities"] = fy_items["TotalAssets"] - fy_items["ShareholdersEquity"]
            if "InterestIncome" in fy_items and "InterestExpense" in fy_items and "NetInterestIncome" not in fy_items:
                fy_items["NetInterestIncome"] = fy_items["InterestIncome"] - fy_items["InterestExpense"]
            if "Revenue" in fy_items and "NetInterestIncome" in fy_items and "NonInterestIncome" not in fy_items:
                if fy_items["Revenue"] > fy_items["NetInterestIncome"]:
                    fy_items["NonInterestIncome"] = fy_items["Revenue"] - fy_items["NetInterestIncome"]
            if "TotalProfit" in fy_items and "NetIncome" in fy_items and "IncomeTaxExpense" not in fy_items:
                fy_items["IncomeTaxExpense"] = abs(fy_items["TotalProfit"] - fy_items["NetIncome"])
            for item, val in fy_items.items():
                add_rec(fy_date, "FY", item, val)

        else:
            # Uncompleted year (no FY yet): preserve latest available native interim period without difference tampering
            interim_candidates = [("004", "Q3"), ("002", "H1" if not has_q1 else "Q2"), ("003", "Q1")]
            for dtc, ptype in interim_candidates:
                if dtc in periods:
                    p_date, p_items = periods[dtc]
                    for item in BALANCE_LINE_ITEMS:
                        if item in p_items:
                            add_rec(p_date, ptype, item, p_items[item])
                    for item in FLOW_LINE_ITEMS:
                        if item in p_items:
                            add_rec(p_date, ptype, item, p_items[item])
                    break

    # Fetch latest issued shares (CommonStockSharesOutstanding) via HK financial indicator
    try:
        ind_df = ak.stock_hk_financial_indicator_em(symbol=code)
        if ind_df is not None and not ind_df.empty and "已发行股本(股)" in ind_df.columns:
            raw_shs = to_scalar(ind_df["已发行股本(股)"].iloc[0])
            if raw_shs is not None and raw_shs > 0:
                fy_years = [y for y, p in by_year_periods.items() if "001" in p]
                if fy_years:
                    max_fy_year = max(fy_years)
                    fy_date = by_year_periods[max_fy_year]["001"][0]
                    add_rec(fy_date, "FY", "CommonStockSharesOutstanding", raw_shs, unit="shares")
    except Exception as e:
        print(f"  warning: failed to fetch HK financial indicator for {code}: {e}", file=sys.stderr)

    return records


def check_completeness(records: list[dict[str, object]], code: str) -> None:
    """Fail loudly on template mismatch (a required line item missing from
    EVERY fiscal year), warn on partial gaps."""
    by_year: dict[str, set[str]] = {}
    for r in records:
        if r.get("periodType") == "FY":
            by_year.setdefault(str(r["periodEnd"])[:4], set()).add(str(r["lineItem"]))

    missing_every_year = [
        item
        for item in REQUIRED_LINE_ITEMS
        if all(item not in items for items in by_year.values())
    ]
    if missing_every_year:
        print(
            f"ERROR: {code}: required line items missing from every fiscal year: "
            f"{missing_every_year} — the source template for this industry is not "
            f"covered by the item map. Do NOT import; extend the map first.",
            file=sys.stderr,
        )
        sys.exit(1)

    for year in sorted(by_year):
        missing = [item for item in REQUIRED_LINE_ITEMS if item not in by_year[year]]
        if missing:
            print(f"  warning: {code} FY{year} missing {missing}", file=sys.stderr)


REPURCHASE_CACHE_PATH = Path("/tmp/ak_stock_repurchase_cache.json")


def get_cn_repurchases_df() -> pd.DataFrame:
    """Fetch all A-share repurchase records from East Money with local 24h caching."""
    import time
    if REPURCHASE_CACHE_PATH.exists():
        try:
            mtime = REPURCHASE_CACHE_PATH.stat().st_mtime
            if time.time() - mtime < 86400:
                return pd.read_json(REPURCHASE_CACHE_PATH)
        except Exception:
            pass

    try:
        df = ak.stock_repurchase_em()
        if df is not None and not df.empty:
            df.to_json(REPURCHASE_CACHE_PATH, orient="records", date_format="iso")
            return df
    except Exception as e:
        print(f"  warning: failed to fetch ak.stock_repurchase_em(): {e}", file=sys.stderr)
    return pd.DataFrame()


def fetch_cn_records(code: str, from_year: int) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    # "YYYY-MM-DD" -> { line_item: value }
    raw_by_date: dict[str, dict[str, float]] = {}
    stock = f"sh{code}" if code.startswith("6") else f"sz{code}"

    for statement in CN_STATEMENTS:
        df = ak.stock_financial_report_sina(stock=stock, symbol=statement)
        for _, row in df.iterrows():
            raw_date = str(row.get("报告日", "")).strip()
            if len(raw_date) != 8:
                continue
            year = int(raw_date[:4])
            if year < from_year:
                continue
            month_day = raw_date[4:]
            if month_day not in ("0331", "0630", "0930", "1231"):
                continue
            period_end = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:]}"
            bucket = raw_by_date.setdefault(period_end, {})

            for column, line_item in CN_COLUMN_MAP.items():
                if column in row.index and line_item not in bucket:
                    val = to_scalar(row[column])
                    if val is not None:
                        bucket[line_item] = val

            # GrossProfit is derived (营业收入 - 营业成本), not a raw Sina column.
            if statement == "利润表" and "GrossProfit" not in bucket:
                revenue = to_scalar(row.get("营业收入"))
                cogs = to_scalar(row.get("营业成本"))
                if revenue is not None and cogs is not None:
                    bucket["GrossProfit"] = revenue - cogs

    seen_keys: set[tuple[str, str, str]] = set()

    def add_rec(period_end: str, period_type: str, line_item: str, val: float | None) -> None:
        if val is None:
            return
        key = (period_end, period_type, line_item)
        if key in seen_keys:
            return
        seen_keys.add(key)
        records.append({
            "periodEnd": period_end,
            "periodType": period_type,
            "lineItem": line_item,
            "value": val,
        })

    # Generate records per year
    unique_years = sorted({int(d[:4]) for d in raw_by_date.keys()})
    for year in unique_years:
        d_q1 = f"{year}-03-31"
        d_q2 = f"{year}-06-30"
        d_q3 = f"{year}-09-30"
        d_fy = f"{year}-12-31"

        # 1. FY records (full year cumulative from 12-31)
        if d_fy in raw_by_date:
            for item, val in raw_by_date[d_fy].items():
                add_rec(d_fy, "FY", item, val)
        else:
            # Uncompleted year (no FY yet): preserve latest available native interim period without difference tampering
            for p_date, ptype in [(d_q3, "Q3"), (d_q2, "Q2"), (d_q1, "Q1")]:
                if p_date in raw_by_date:
                    for item in BALANCE_LINE_ITEMS:
                        if item in raw_by_date[p_date]:
                            add_rec(p_date, ptype, item, raw_by_date[p_date][item])
                    for item in FLOW_LINE_ITEMS:
                        if item in raw_by_date[p_date]:
                            add_rec(p_date, ptype, item, raw_by_date[p_date][item])
                    break

    # Incorporate share repurchases (ShareRepurchaseAmt) from East Money repurchase disclosures
    completed_fy_years = sorted({int(d[:4]) for d in raw_by_date.keys() if d.endswith("-12-31")})
    try:
        rep_df = get_cn_repurchases_df()
        if not rep_df.empty and "股票代码" in rep_df.columns:
            matched_rep = rep_df[rep_df["股票代码"].astype(str).str.zfill(6) == code.zfill(6)]
            rep_by_year: dict[int, float] = {}
            for _, rrow in matched_rep.iterrows():
                amt = to_scalar(rrow.get("已回购金额"))
                if amt is not None and amt > 0:
                    pub_date = rrow.get("最新公告日期") or rrow.get("回购起始时间")
                    if pub_date is not None and not pd.isna(pub_date):
                        p_ts = pd.Timestamp(pub_date)
                        r_year = p_ts.year
                        if r_year >= from_year:
                            rep_by_year[r_year] = rep_by_year.get(r_year, 0.0) + amt

            for r_year, total_amt in rep_by_year.items():
                if r_year in completed_fy_years:
                    fy_date = f"{r_year}-12-31"
                    add_rec(fy_date, "FY", "ShareRepurchaseAmt", total_amt)
    except Exception as e:
        print(f"  warning: error processing CN share repurchases for {code}: {e}", file=sys.stderr)

    try:
        for record in fetch_cn_dividend_records(code, from_year):
            key = (str(record["periodEnd"]), "FY", "DividendsPaid")
            if key not in seen_keys:
                records.append(record)
                seen_keys.add(key)
    except Exception as e:
        print(f"  warning: failed to fetch AkShare CN dividends for {code}: {e}", file=sys.stderr)

    return records


def fetch_cn_dividend_records(code: str, from_year: int) -> list[dict[str, object]]:
    records = fetch_akshare_cn_dividends(
        code,
        from_year,
        ak.stock_dividend_cninfo,
        ak.stock_fhps_detail_ths,
    )
    print(
        f"  matched {len(records)} CN dividend payment year(s) "
        f"from CNINFO + THS (source totals may be rounded)",
        file=sys.stderr,
    )
    return records


def write_output(out_dir: Path, code: str, records: list[dict[str, object]]) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / f"{code}.json"
    json_path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    return json_path


def import_into_db(
    json_path: Path,
    ticker: str,
    code: str,
    market: str,
    currency: str,
    data_currency: str | None = None,
) -> None:
    cmd = [
        "node",
        "--env-file=.env.local",
        "./node_modules/.bin/tsx",
        "scripts/import-cn-hk-financials-from-file.ts",
        str(json_path),
        "--ticker", ticker,
        "--code", code,
        "--market", market,
        "--currency", currency,
    ]
    if data_currency:
        cmd.extend(["--data-currency", data_currency])
    subprocess.run(cmd, check=True)


def main() -> int:
    args = parse_args()

    if args.dividends_only and args.market != "cn":
        print("--dividends-only is only supported for --market cn", file=sys.stderr)
        return 2

    if args.dividends_only:
        ticker = args.ticker or f"{args.code}.SS"
        print(f"Fetching implemented CN dividends for {args.code} from {args.from_year}...")
        try:
            records = fetch_cn_dividend_records(args.code, args.from_year)
        except Exception as e:
            print(f"Failed to fetch AkShare CN dividends for {args.code}: {e}", file=sys.stderr)
            return 1
    elif args.market == "cn":
        ticker = args.ticker or f"{args.code}.SS"
        print(f"Fetching CN financials for {args.code} ({ticker}) from {args.from_year}...")
        records = fetch_cn_records(args.code, args.from_year)
    else:
        ticker = args.ticker or f"{args.code.lstrip('0') or '0'}.HK"
        print(f"Fetching HK financials for {args.code} ({ticker})...")
        records = fetch_hk_records(args.code, args.from_year)

    if not records and not args.dividends_only:
        print(f"No mapped line items returned for {args.code}", file=sys.stderr)
        return 1

    if not args.dividends_only:
        check_completeness(records, args.code)
        if args.line_items:
            requested = {
                item.strip()
                for item in args.line_items.split(",")
                if item.strip()
            }
            records = [
                record
                for record in records
                if record.get("lineItem") in requested
            ]
            if not records:
                print(
                    f"No requested line items returned for {args.code}: "
                    f"{sorted(requested)}",
                    file=sys.stderr,
                )
                return 1

    out_dir = Path(args.out_dir)
    json_path = write_output(out_dir, args.code, records)
    print(f"  wrote {json_path} ({len(records)} records)")

    if args.import_db:
        print(f"  importing into database...")
        import_into_db(
            json_path,
            ticker,
            args.code,
            args.market,
            args.currency,
            args.data_currency,
        )
        if not args.keep_file:
            json_path.unlink(missing_ok=True)
            try:
                out_dir.rmdir()
            except OSError:
                pass

    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

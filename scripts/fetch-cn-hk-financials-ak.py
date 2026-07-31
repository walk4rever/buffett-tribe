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
is left unmapped for CN rather than guessed; GrossProfit is derived as
营业收入 - 营业成本 (a standard identity, not a raw column; skipped for
banks, which have no 营业成本).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import akshare as ak
import pandas as pd

# STD_ITEM_NAME -> Financial.lineItem, verified against scripts/lib/
# annual-report-import-core.ts's LINE_ITEMS (the same 12 keys the US SEC
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
    "股东应占溢利": "NetIncome",  # attributable to shareholders, matches US convention
    "每股基本盈利": "EPSBasic",
    "每股摊薄盈利": "EPSDiluted",
    # 资产负债表 (balance sheet)
    "总资产": "TotalAssets",
    "总负债": "TotalLiabilities",
    "股东权益": "ShareholdersEquity",  # industrial: attributable (excl. 少数股东权益)
    "归属于母公司股东权益": "ShareholdersEquity",  # insurer template
    # 现金流量表 (cash flow statement)
    "经营业务现金净额": "OperatingCashFlow",
    "购建固定资产": "CapEx",
    "回购股份": "ShareRepurchaseAmt",  # see suspicious-repurchase check in check-all-company-financials.ts
}

HK_STATEMENTS = ["资产负债表", "利润表", "现金流量表"]

# Line items every FY must have; anything else (GrossProfit, CapEx,
# ShareRepurchaseAmt, EPS*) is legitimately absent for some industries.
REQUIRED_LINE_ITEMS = [
    "Revenue",
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
    "归属于母公司的净利润": "NetIncome",  # bank template
    "基本每股收益": "EPSBasic",
    "稀释每股收益": "EPSDiluted",
    # 资产负债表 (balance sheet)
    "资产总计": "TotalAssets",
    "负债合计": "TotalLiabilities",
    "所有者权益(或股东权益)合计": "ShareholdersEquity",
    "归属于母公司股东的权益": "ShareholdersEquity",  # bank template
    # 现金流量表 (cash flow statement)
    "经营活动产生的现金流量净额": "OperatingCashFlow",
    "购建固定资产、无形资产和其他长期资产所支付的现金": "CapEx",
}

CN_STATEMENTS = ["资产负债表", "利润表", "现金流量表"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch CN/HK financial statements via akshare and optionally import into the database."
    )
    parser.add_argument("--code", required=True, help="Exchange code, e.g. 09992 (hk) or 600519 (cn)")
    parser.add_argument("--market", required=True, choices=["cn", "hk"], help="cn or hk")
    parser.add_argument("--ticker", default=None, help="Entity.ticker to resolve, e.g. 9992.HK (defaults to derived from --code/--market)")
    parser.add_argument("--currency", required=True, choices=["CNY", "HKD", "USD"], help="Verified reporting currency (not derived — see scripts/lib/cn-hk-company-seeds.ts)")
    parser.add_argument("--from-year", type=int, default=2020, help="Earliest fiscal year to include (default 2020)")
    parser.add_argument("--out-dir", default="/tmp/cn-hk-financials-ak", help="Directory for the generated JSON fixture")
    parser.add_argument("--import-db", action="store_true", help="Import the generated JSON into the database after fetching")
    parser.add_argument("--keep-file", action="store_true", help="Keep the generated JSON instead of deleting it after import")
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


def fetch_hk_records(code: str) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    seen: set[tuple[str, str]] = set()  # (period_end, line_item) — first hit wins, matches DB upsert intent

    for statement in HK_STATEMENTS:
        df = ak.stock_financial_hk_report_em(stock=code, symbol=statement, indicator="年度")
        for _, row in df.iterrows():
            item_name = str(row.get("STD_ITEM_NAME", "")).strip()
            line_item = HK_ITEM_NAME_MAP.get(item_name)
            if not line_item:
                continue
            report_date = row.get("REPORT_DATE")
            if pd.isna(report_date):
                continue
            period_end = pd.Timestamp(report_date).strftime("%Y-%m-%d")
            key = (period_end, line_item)
            if key in seen:
                continue
            amount = to_scalar(row.get("AMOUNT"))
            if amount is None:
                continue
            seen.add(key)
            records.append({"periodEnd": period_end, "lineItem": line_item, "value": amount})

    return records


def check_completeness(records: list[dict[str, object]], code: str) -> None:
    """Fail loudly on template mismatch (a required line item missing from
    EVERY fiscal year), warn on partial gaps."""
    by_year: dict[str, set[str]] = {}
    for r in records:
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


def fetch_cn_records(code: str, from_year: int) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    seen: set[tuple[str, str]] = set()  # (period_end, line_item) — first hit wins, matches DB upsert intent
    stock = f"sh{code}" if code.startswith("6") else f"sz{code}"

    for statement in CN_STATEMENTS:
        df = ak.stock_financial_report_sina(stock=stock, symbol=statement)
        annual = df[df["报告日"].astype(str).str.endswith("1231")]
        for _, row in annual.iterrows():
            period_year = int(str(row["报告日"])[:4])
            if period_year < from_year:
                continue
            period_end = f"{period_year}-12-31"

            for column, line_item in CN_COLUMN_MAP.items():
                if column not in row.index:
                    continue
                key = (period_end, line_item)
                if key in seen:
                    continue
                amount = to_scalar(row[column])
                if amount is None:
                    continue
                seen.add(key)
                records.append({"periodEnd": period_end, "lineItem": line_item, "value": amount})

            # GrossProfit is derived (营业收入 - 营业成本), not a raw Sina column.
            if statement == "利润表":
                key = (period_end, "GrossProfit")
                revenue = to_scalar(row.get("营业收入"))
                cogs = to_scalar(row.get("营业成本"))
                if key not in seen and revenue is not None and cogs is not None:
                    seen.add(key)
                    records.append({"periodEnd": period_end, "lineItem": "GrossProfit", "value": revenue - cogs})

    return records


def write_output(out_dir: Path, code: str, records: list[dict[str, object]]) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / f"{code}.json"
    json_path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    return json_path


def import_into_db(json_path: Path, ticker: str, code: str, market: str, currency: str) -> None:
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
    subprocess.run(cmd, check=True)


def main() -> int:
    args = parse_args()

    if args.market == "cn":
        ticker = args.ticker or f"{args.code}.SS"
        print(f"Fetching CN financials for {args.code} ({ticker}) from {args.from_year}...")
        records = fetch_cn_records(args.code, args.from_year)
    else:
        ticker = args.ticker or f"{args.code.lstrip('0') or '0'}.HK"
        print(f"Fetching HK financials for {args.code} ({ticker})...")
        records = fetch_hk_records(args.code)

    if not records:
        print(f"No mapped line items returned for {args.code}", file=sys.stderr)
        return 1

    check_completeness(records, args.code)

    out_dir = Path(args.out_dir)
    json_path = write_output(out_dir, args.code, records)
    print(f"  wrote {json_path} ({len(records)} records)")

    if args.import_db:
        print(f"  importing into database...")
        import_into_db(json_path, ticker, args.code, args.market, args.currency)
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

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

HK mapping is via akshare's stock_financial_hk_report_em(), which returns a
stable numeric STD_ITEM_CODE per line item (verified identical across HK
filers, e.g. "004001001" = revenue for both Pop Mart 09992 and Tencent
00700) — see HK_ITEM_CODE_MAP below.

CN mapping is via akshare's stock_financial_report_sina(), which returns a
wide table with Chinese column headers and mixed quarterly+annual rows (no
"indicator=年度" filter like the HK endpoint) — annual rows are isolated by
filtering 报告日 ending in "1231". Column names verified against Moutai
(600519) real public FY2024 figures — see CN_COLUMN_MAP below. No dedicated
buyback column exists in this template, so ShareRepurchaseAmt is left
unmapped for CN rather than guessed; GrossProfit is derived as 营业收入 -
营业成本 (a standard identity, not a raw column).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import akshare as ak
import pandas as pd

# STD_ITEM_CODE -> Financial.lineItem, verified against scripts/lib/
# annual-report-import-core.ts's LINE_ITEMS (the same 12 keys the US SEC
# import pipeline writes). Codes confirmed stable across HK filers.
HK_ITEM_CODE_MAP: dict[str, str] = {
    # 利润表 (income statement)
    "004001001": "Revenue",
    "004007999": "GrossProfit",
    "004010999": "OperatingIncome",
    "004025002": "NetIncome",  # attributable to shareholders, matches US convention
    "004027002": "EPSBasic",
    "004027003": "EPSDiluted",
    # 资产负债表 (balance sheet)
    "004009999": "TotalAssets",
    "004025999": "TotalLiabilities",
    "004030999": "ShareholdersEquity",
    # 现金流量表 (cash flow statement)
    "003999": "OperatingCashFlow",
    "005005": "CapEx",  # 购建固定资产
    "007008": "ShareRepurchaseAmt",  # 回购股份
}

HK_STATEMENTS = ["资产负债表", "利润表", "现金流量表"]

# Sina column name -> Financial.lineItem, verified against Moutai (600519)
# FY2024 figures matching public filings (营业收入 ¥170.9B, 归属于母公司所有者
# 的净利润 ¥86.2B, 基本每股收益 ¥68.64, 资产总计 ¥298.9B).
CN_COLUMN_MAP: dict[str, str] = {
    # 利润表 (income statement)
    "营业收入": "Revenue",
    "营业利润": "OperatingIncome",
    "归属于母公司所有者的净利润": "NetIncome",
    "基本每股收益": "EPSBasic",
    "稀释每股收益": "EPSDiluted",
    # 资产负债表 (balance sheet)
    "资产总计": "TotalAssets",
    "负债合计": "TotalLiabilities",
    "所有者权益(或股东权益)合计": "ShareholdersEquity",
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
            item_code = str(row.get("STD_ITEM_CODE", "")).strip()
            line_item = HK_ITEM_CODE_MAP.get(item_code)
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

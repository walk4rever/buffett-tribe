#!/usr/bin/env python3
"""
Extract CommonStockSharesOutstanding for CN A-share companies from Sina balance sheet.
Designed for high-speed batch backfilling.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

import akshare as ak
import pandas as pd

SHARE_COLS = [
    "实收资本(或股本)",
    "实收资本（或股本）",
    "股本",
    "实收资本",
    "实收资本净额",
]


def to_scalar(val: Any) -> float | None:
    if val is None or pd.isna(val):
        return None
    try:
        f = float(val)
        return None if pd.isna(f) else f
    except (ValueError, TypeError):
        return None


def fetch_shares_for_code(code: str, from_year: int = 2015) -> list[dict[str, Any]]:
    try:
        df = ak.stock_financial_report_sina(stock=code, symbol="资产负债表")
    except Exception as e:
        print(f"  warning: failed to fetch balance sheet for {code}: {e}", file=sys.stderr)
        return []

    if df is None or df.empty:
        return []

    target_col = None
    for c in SHARE_COLS:
        if c in df.columns:
            target_col = c
            break

    if not target_col:
        print(f"  warning: no shares column found for {code} in {list(df.columns[:10])}", file=sys.stderr)
        return []

    raw_by_date: dict[str, float] = {}
    for _, row in df.iterrows():
        raw_date = row.get("报告日")
        if pd.isna(raw_date):
            continue
        s_date = str(raw_date).strip()
        m = re.match(r"^(\d{4})(\d{2})(\d{2})", s_date)
        if not m:
            continue
        period_end = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
        year = int(m.group(1))
        if year < from_year:
            continue
        val = to_scalar(row.get(target_col))
        if val is not None and val > 0 and period_end not in raw_by_date:
            raw_by_date[period_end] = val

    records: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    def add(p_end: str, p_type: str, v: float) -> None:
        key = (p_end, p_type)
        if key in seen:
            return
        seen.add(key)
        records.append({
            "periodEnd": p_end,
            "periodType": p_type,
            "lineItem": "CommonStockSharesOutstanding",
            "value": v,
        })

    unique_years = sorted({int(d[:4]) for d in raw_by_date.keys()})
    for yr in unique_years:
        d_q1 = f"{yr}-03-31"
        d_q2 = f"{yr}-06-30"
        d_q3 = f"{yr}-09-30"
        d_fy = f"{yr}-12-31"

        if d_fy in raw_by_date:
            add(d_fy, "FY", raw_by_date[d_fy])
            add(d_fy, "Q4", raw_by_date[d_fy])
        if d_q1 in raw_by_date:
            add(d_q1, "Q1", raw_by_date[d_q1])
        if d_q2 in raw_by_date:
            add(d_q2, "Q2", raw_by_date[d_q2])
        if d_q3 in raw_by_date:
            add(d_q3, "Q3", raw_by_date[d_q3])

    return records


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract CN shares outstanding for multiple codes")
    parser.add_argument("--codes", required=True, help="Comma-separated codes or path to JSON file with code array")
    parser.add_argument("--out", default="/tmp/cn_shares_extracted.json", help="Path to write JSON output")
    parser.add_argument("--from-year", type=int, default=2015, help="Earliest year")
    args = parser.parse_args()

    codes_input = args.codes.strip()
    if codes_input.endswith(".json") and Path(codes_input).exists():
        with open(codes_input, "r", encoding="utf-8") as f:
            codes = json.load(f)
    else:
        codes = [c.strip() for c in codes_input.split(",") if c.strip()]

    print(f"Extracting shares outstanding for {len(codes)} companies...", file=sys.stderr)
    result: dict[str, list[dict[str, Any]]] = {}

    for i, code in enumerate(codes):
        print(f"[{i + 1}/{len(codes)}] {code}...", file=sys.stderr, end=" ", flush=True)
        recs = fetch_shares_for_code(code, from_year=args.from_year)
        result[code] = recs
        print(f"got {len(recs)} records", file=sys.stderr)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote extracted records to {out_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Extract explicit CN A-share period-end shares from Sina daily trading data."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any

import akshare as ak
import pandas as pd

QUARTER_ENDS = ((3, 31, "Q1"), (6, 30, "Q2"), (9, 30, "Q3"), (12, 31, "Q4"))


def records_from_daily_frame(
    df: pd.DataFrame,
    from_year: int,
) -> list[dict[str, Any]]:
    """Build period-end share records from an explicit outstanding_share series.

    Sina's balance-sheet ``实收资本`` is a currency amount, not a share count.
    This extractor only accepts the ``outstanding_share`` column supplied by
    ``stock_zh_a_daily``. Missing columns return no records so callers keep an
    explicit gap instead of writing a unit-mismatched fact.
    """
    if df is None or df.empty or "date" not in df.columns:
        return []
    if "outstanding_share" not in df.columns:
        return []

    frame = df[["date", "outstanding_share"]].copy()
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame["outstanding_share"] = pd.to_numeric(
        frame["outstanding_share"], errors="coerce"
    )
    frame = frame.dropna()
    frame = frame[frame["outstanding_share"] > 0]
    frame = frame[frame["date"].dt.year >= from_year]
    frame = frame.sort_values("date")
    if frame.empty:
        return []

    records: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    years = sorted({int(year) for year in frame["date"].dt.year.unique()})
    today = date.today()
    for year in years:
        for month, day, period_type in QUARTER_ENDS:
            period_end = date(year, month, day)
            if period_end > today:
                continue
            eligible = frame[frame["date"].dt.date <= period_end]
            if eligible.empty:
                continue
            row = eligible.iloc[-1]
            value = float(row["outstanding_share"])
            period_end_text = period_end.isoformat()
            for record_type in (
                ["FY", "Q4"] if period_type == "Q4" else [period_type]
            ):
                key = (period_end_text, record_type)
                if key in seen:
                    continue
                seen.add(key)
                records.append({
                    "periodEnd": period_end_text,
                    "periodType": record_type,
                    "lineItem": "CommonStockSharesOutstanding",
                    "value": value,
                })

    return records


def market_symbol(code: str) -> str:
    if code.startswith(("5", "6", "9")):
        return f"sh{code}"
    return f"sz{code}"


def fetch_shares_for_code(code: str, from_year: int = 2020) -> list[dict[str, Any]]:
    try:
        df = ak.stock_zh_a_daily(
            symbol=market_symbol(code),
            start_date=f"{from_year}0101",
            end_date=datetime.now().strftime("%Y%m%d"),
        )
    except Exception as e:
        print(f"  warning: failed to fetch daily shares for {code}: {e}", file=sys.stderr)
        return []

    return records_from_daily_frame(df, from_year)


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract CN shares outstanding for multiple codes")
    parser.add_argument("--codes", required=True, help="Comma-separated codes or path to JSON file with code array")
    parser.add_argument("--out", default="/tmp/cn_shares_extracted.json", help="Path to write JSON output")
    parser.add_argument("--from-year", type=int, default=2020, help="Earliest year")
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

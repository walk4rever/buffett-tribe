#!/usr/bin/env python3
"""
Fetch all listed Hong Kong stocks (2,800+) via akshare and save to JSON.

Usage:
    python scripts/fetch-all-hk-stocks.py
    python scripts/fetch-all-hk-stocks.py --out data/all-hk-stocks.json
"""

import argparse
import json
import sys
from pathlib import Path


def code_to_ticker(code: str) -> str:
    """
    Standard HK ticker convention: 4-digit zero-padded number + .HK
    e.g. 09988 -> 9988.HK, 00700 -> 0700.HK, 00005 -> 0005.HK
    """
    c = str(code).strip()
    digits = c.lstrip("0")
    if not digits:
        digits = "0"
    padded = digits.zfill(4)
    return f"{padded}.HK"


def main():
    parser = argparse.ArgumentParser(description="Fetch all HK stocks")
    parser.add_argument("--out", default="data/all-hk-stocks.json", help="Output JSON path")
    args = parser.parse_args()

    try:
        import akshare as ak
    except ImportError:
        print("Error: akshare is not installed. Run in .venv", file=sys.stderr)
        sys.exit(1)

    print("Fetching all HK listed companies via akshare (stock_hk_spot)...", file=sys.stderr)
    import time
    df = None
    last_err = None
    for attempt in range(1, 4):
        try:
            df = ak.stock_hk_spot()
            if df is not None and not df.empty:
                break
        except Exception as e:
            last_err = e
            print(f"Attempt {attempt}/3 failed ({e}), retrying in 2s...", file=sys.stderr)
            time.sleep(2)

    if df is None or df.empty:
        out_path = Path(args.out)
        if out_path.exists():
            print(f"⚠️ Warning: Failed to fetch fresh HK stocks ({last_err}), falling back to existing {args.out}", file=sys.stderr)
            sys.exit(0)
        raise RuntimeError(f"Failed to fetch HK stocks after 3 attempts: {last_err}")

    results = []
    seen_tickers = set()

    for _, row in df.iterrows():
        raw_symbol = str(row.get("代码", "")).strip()
        name = str(row.get("中文名称", "")).strip()
        eng_name = str(row.get("英文名称", "")).strip()

        if not raw_symbol or not raw_symbol.isdigit():
            continue

        code = raw_symbol.zfill(5)
        ticker = code_to_ticker(code)

        if ticker in seen_tickers:
            continue
        seen_tickers.add(ticker)

        results.append({
            "code": code,
            "name": name,
            "engName": eng_name,
            "ticker": ticker,
            "exchange": "HKEX",
        })

    # Sort stably by ticker
    results.sort(key=lambda x: x["ticker"])

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        f"✓ Successfully saved {len(results)} HK stocks to {args.out}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()

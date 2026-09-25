#!/usr/bin/env python3
"""
Fetch all listed A-share stocks (5,500+) via akshare and save to JSON.

Usage:
    python scripts/fetch-all-a-stocks.py
    python scripts/fetch-all-a-stocks.py --out data/all-a-share-stocks.json
"""

import argparse
import json
import sys
from pathlib import Path


def get_ticker(code: str) -> str:
    c = str(code).zfill(6)
    if c.startswith(("600", "601", "603", "605", "688", "689")):
        return f"{c}.SS"
    elif c.startswith(("000", "001", "002", "003", "300", "301")):
        return f"{c}.SZ"
    elif c.startswith(("43", "83", "87", "92")):
        return f"{c}.BJ"
    return f"{c}.SZ"


def main():
    parser = argparse.ArgumentParser(description="Fetch all A-share stocks")
    parser.add_argument("--out", default="data/all-a-share-stocks.json", help="Output JSON path")
    args = parser.parse_args()

    try:
        import akshare as ak
    except ImportError:
        print("Error: akshare is not installed. Run in .venv", file=sys.stderr)
        sys.exit(1)

    print("Fetching all A-share listed companies via akshare...", file=sys.stderr)
    df = ak.stock_info_a_code_name()

    results = []
    exchange_counts = {"SZ": 0, "SS": 0, "BJ": 0}

    for _, row in df.iterrows():
        code = str(row["code"]).strip().zfill(6)
        name = str(row["name"]).strip()
        ticker = get_ticker(code)
        exchange = ticker[-2:]
        exchange_counts[exchange] = exchange_counts.get(exchange, 0) + 1

        results.append({
            "code": code,
            "name": name,
            "ticker": ticker,
            "exchange": exchange,
        })

    # Sort stably by ticker
    results.sort(key=lambda x: x["ticker"])

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        f"✓ Successfully saved {len(results)} A-share stocks to {args.out}\n"
        f"  - SZ (深圳): {exchange_counts.get('SZ', 0)}\n"
        f"  - SS (上海): {exchange_counts.get('SS', 0)}\n"
        f"  - BJ (北京): {exchange_counts.get('BJ', 0)}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()

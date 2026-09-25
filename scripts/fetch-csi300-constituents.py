#!/usr/bin/env python3
"""
Fetch CSI 300 (沪深300) constituents list via akshare.
Outputs JSON to stdout.

Usage:
    python scripts/fetch-csi300-constituents.py
    python scripts/fetch-csi300-constituents.py --out cache/csi300.json
"""

import argparse
import json
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Fetch CSI 300 constituents")
    parser.add_argument("--out", help="Optional output JSON path")
    args = parser.parse_args()

    try:
        import akshare as ak
    except ImportError:
        print("Error: akshare is not installed. Run in .venv", file=sys.stderr)
        sys.exit(1)

    df = ak.index_stock_cons_csindex(symbol="000300")
    results = []
    for _, row in df.iterrows():
        code = str(row["成分券代码"]).zfill(6)
        ex = str(row.get("交易所", ""))
        suffix = "SZ" if "深圳" in ex else ("SS" if "上海" in ex else "BJ")
        results.append({
            "code": code,
            "name": str(row["成分券名称"]).strip(),
            "ticker": f"{code}.{suffix}",
            "exchange": suffix,
        })

    json_str = json.dumps(results, ensure_ascii=False, indent=2)
    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json_str, encoding="utf-8")
        print(f"Wrote {len(results)} CSI 300 constituents to {args.out}", file=sys.stderr)
    else:
        print(json_str)


if __name__ == "__main__":
    main()

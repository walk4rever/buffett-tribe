#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import yfinance as yf


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch daily stock prices with yfinance and optionally import them into the database."
    )
    parser.add_argument(
        "--ticker",
        "--tickers",
        dest="tickers",
        default="AAPL",
        help="Comma-separated ticker list, e.g. AAPL,MSFT",
    )
    parser.add_argument("--start", default="2020-01-01", help="Start date, inclusive, YYYY-MM-DD")
    parser.add_argument("--end", default=None, help="End date, exclusive, YYYY-MM-DD")
    parser.add_argument(
        "--out-dir",
        default="/tmp/stock-prices-yf",
        help="Directory for generated JSON/CSV fixtures",
    )
    parser.add_argument(
        "--import-db",
        action="store_true",
        help="Import each generated JSON file into the database after download",
    )
    parser.add_argument(
        "--keep-files",
        action="store_true",
        help="Keep generated files instead of deleting them after import",
    )
    parser.add_argument(
        "--checkpoint-file",
        default=".cache/stock-prices-yf/checkpoints.json",
        help="Path to the checkpoint file used for resume/skip behavior",
    )
    parser.add_argument(
        "--fresh",
        action="store_true",
        help="Ignore any existing checkpoint state for this run",
    )
    parser.add_argument(
        "--fail-fast",
        action="store_true",
        help="Stop the batch immediately when one ticker fails",
    )
    return parser.parse_args()


def to_scalar(value: Any) -> float | int | None:
    if value is None:
        return None
    if pd.isna(value):
        return None
    if isinstance(value, (int, float)):
        return value
    try:
        if value == "NaN":
            return None
    except Exception:
        pass
    return float(value)


def normalize_frame(df: pd.DataFrame, ticker: str) -> pd.DataFrame:
    if df.empty:
        return df
    if isinstance(df.columns, pd.MultiIndex):
        if ticker in df.columns.get_level_values(-1):
            df = df.xs(ticker, axis=1, level=-1, drop_level=True)
        elif ticker in df.columns.get_level_values(0):
            df = df.xs(ticker, axis=1, level=0, drop_level=True)
        else:
            raise ValueError("Expected a single-ticker DataFrame, got MultiIndex columns")
    expected = ["Open", "High", "Low", "Close", "Adj Close", "Volume"]
    missing = [col for col in expected if col not in df.columns]
    if missing:
        raise ValueError(f"Missing columns from yfinance response: {', '.join(missing)}")
    return df.sort_index()


def dataframe_to_chart_json(ticker: str, df: pd.DataFrame) -> dict[str, Any]:
    normalized = normalize_frame(df, ticker)
    if normalized.empty:
        raise ValueError(f"No price data returned for {ticker}")

    index = normalized.index
    if getattr(index, "tz", None) is None:
        index = index.tz_localize("UTC")
    else:
        index = index.tz_convert("UTC")

    timestamps = [int(ts.timestamp()) for ts in index.to_pydatetime()]
    closes = normalized["Close"].tolist()
    opens = normalized["Open"].tolist()
    highs = normalized["High"].tolist()
    lows = normalized["Low"].tolist()
    volumes = normalized["Volume"].tolist()
    adjclose = normalized["Adj Close"].tolist()

    quote = {
        "open": [to_scalar(v) for v in opens],
        "high": [to_scalar(v) for v in highs],
        "low": [to_scalar(v) for v in lows],
        "close": [to_scalar(v) for v in closes],
        "volume": [None if pd.isna(v) else int(v) for v in volumes],
    }
    adj = {"adjclose": [to_scalar(v) for v in adjclose]}

    return {
        "chart": {
            "result": [
                {
                    "timestamp": timestamps,
                    "indicators": {
                        "quote": [quote],
                        "adjclose": [adj],
                    },
                }
            ],
            "error": None,
        }
    }


def write_outputs(out_dir: Path, ticker: str, df: pd.DataFrame, payload: dict[str, Any]) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    base = out_dir / ticker.upper()
    json_path = base.with_suffix(".json")
    csv_path = base.with_suffix(".csv")
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    normalize_frame(df, ticker).to_csv(csv_path)
    return json_path, csv_path


def import_into_db(json_path: Path, ticker: str) -> None:
    cmd = [
        "node",
        "--env-file=.env.local",
        "./node_modules/.bin/tsx",
        "scripts/import-stock-prices-from-file.ts",
        str(json_path),
        ticker.upper(),
    ]
    subprocess.run(cmd, check=True)


def checkpoint_signature(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "start": args.start,
        "end": args.end,
        "import_db": bool(args.import_db),
    }


def load_checkpoint(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_checkpoint(path: Path, checkpoint: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(checkpoint, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    tmp_path.replace(path)


def main() -> int:
    args = parse_args()
    tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    if not tickers:
        raise ValueError("At least one ticker is required")

    out_dir = Path(args.out_dir)
    checkpoint_path = Path(args.checkpoint_file)
    checkpoint = {} if args.fresh else load_checkpoint(checkpoint_path)
    signature = checkpoint_signature(args)
    end = args.end
    summary: list[dict[str, Any]] = []
    has_failures = False
    continue_on_error = not args.fail_fast

    for ticker in tickers:
        ticker_state = checkpoint.get(ticker, {})
        if ticker_state.get("status") == "complete" and ticker_state.get("signature") == signature and not args.fresh:
            print(f"Skipping {ticker}; already completed in checkpoint.", flush=True)
            summary.append({"ticker": ticker, "status": "skipped"})
            continue

        print(f"Downloading {ticker} from yfinance...", flush=True)
        try:
            df = yf.download(
                ticker,
                start=args.start,
                end=end,
                interval="1d",
                auto_adjust=False,
                actions=False,
                progress=False,
                threads=False,
            )

            if df.empty:
                raise ValueError(f"No data returned for {ticker}")

            payload = dataframe_to_chart_json(ticker, df)
            json_path, csv_path = write_outputs(out_dir, ticker, df, payload)
            print(f"  wrote {json_path}", flush=True)
            print(f"  wrote {csv_path}", flush=True)

            if args.import_db:
                print(f"  importing {ticker} into database...", flush=True)
                import_into_db(json_path, ticker)
                if not args.keep_files:
                    json_path.unlink(missing_ok=True)
                    csv_path.unlink(missing_ok=True)
                    if not any(out_dir.iterdir()):
                        out_dir.rmdir()

            first_date = str(df.index.min().date())
            last_date = str(df.index.max().date())
            rows = int(len(df))
            checkpoint[ticker] = {
                "status": "complete",
                "signature": signature,
                "start": args.start,
                "end": end,
                "rows": rows,
                "first_date": first_date,
                "last_date": last_date,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            save_checkpoint(checkpoint_path, checkpoint)
            summary.append({"ticker": ticker, "status": "complete", "rows": rows})
            print(f"  checkpoint saved ({rows} rows, {first_date} -> {last_date})", flush=True)
        except Exception as exc:
            has_failures = True
            checkpoint[ticker] = {
                "status": "failed",
                "signature": signature,
                "start": args.start,
                "end": end,
                "error": str(exc),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            save_checkpoint(checkpoint_path, checkpoint)
            summary.append({"ticker": ticker, "status": "failed", "error": str(exc)})
            print(f"  failed: {exc}", file=sys.stderr, flush=True)
            if not continue_on_error:
                break

    print("Summary:", flush=True)
    for item in summary:
        if item["status"] == "complete":
            print(f"  {item['ticker']}: complete ({item['rows']} rows)", flush=True)
        elif item["status"] == "skipped":
            print(f"  {item['ticker']}: skipped", flush=True)
        else:
            print(f"  {item['ticker']}: failed ({item['error']})", flush=True)

    return 1 if has_failures else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)

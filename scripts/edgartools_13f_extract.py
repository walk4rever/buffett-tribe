#!/usr/bin/env python3
"""Extract 13F filings and holdings with edgartools for the TypeScript importer."""

from __future__ import annotations

import argparse
import json
import math
import sys
from decimal import Decimal
from pathlib import Path
from typing import Any

from edgar import Company, set_identity


DEFAULT_IDENTITY = "buffett-tribe research walkklaw@gmail.com"


def _safe_str(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    text = str(value).strip()
    return text or None


def _int_string(value: Any) -> str:
    if value is None:
        return "0"
    if isinstance(value, float) and math.isnan(value):
        return "0"
    if isinstance(value, Decimal):
        return str(int(value))
    try:
        return str(int(value))
    except Exception:
        text = str(value).replace(",", "").strip()
        if not text:
            return "0"
        return str(int(Decimal(text)))


def _get_attr(obj: Any, name: str, default: Any = None) -> Any:
    try:
        return getattr(obj, name)
    except Exception:
        return default


def _holding_entry(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "nameOfIssuer": _safe_str(row.get("Issuer")) or "",
        "titleOfClass": _safe_str(row.get("Class")) or "",
        "cusip": _safe_str(row.get("Cusip")) or "",
        "ticker": _safe_str(row.get("Ticker")),
        "value": _int_string(row.get("Value")),
        "shares": _int_string(row.get("SharesPrnAmount")),
        "investmentDiscretion": _safe_str(row.get("InvestmentDiscretion")) or "SOLE",
        "putCall": _safe_str(row.get("PutCall")),
    }


def _filing_to_dict(filing: Any) -> dict[str, Any]:
    obj = filing.obj()
    holdings = []
    if getattr(obj, "has_infotable", False):
        frame = getattr(obj, "holdings", None)
        if frame is not None:
            for row in frame.to_dict(orient="records"):
                entry = _holding_entry(row)
                if entry["cusip"]:
                    holdings.append(entry)

    accession = _safe_str(_get_attr(filing, "accession_number") or _get_attr(filing, "accession_no")) or ""
    report_date = _safe_str(getattr(obj, "report_period", None) or _get_attr(filing, "period_of_report"))
    filed_at = _safe_str(getattr(obj, "filing_date", None) or _get_attr(filing, "filing_date"))

    return {
        "accession": accession,
        "filedAt": filed_at,
        "reportDate": report_date,
        "form": _safe_str(_get_attr(filing, "form")) or "13F-HR",
        "company": _safe_str(_get_attr(filing, "company")),
        "cik": _safe_str(_get_attr(filing, "cik")),
        "url": _safe_str(_get_attr(filing, "url") or _get_attr(filing, "filing_url")),
        "totalHoldings": int(getattr(obj, "total_holdings", len(holdings)) or len(holdings)),
        "totalValue": _int_string(getattr(obj, "total_value", 0)),
        "holdings": holdings,
    }


def extract(args: argparse.Namespace) -> dict[str, Any]:
    set_identity(args.identity)
    company = Company(args.cik)
    filings = company.get_filings(form="13F-HR")

    selected = []
    for index, filing in enumerate(filings):
        if index >= args.max_filings:
            break
        selected.append(_filing_to_dict(filing))

    return {
        "tool": "edgartools",
        "toolVersion": _get_attr(sys.modules.get("edgar"), "__version__"),
        "cik": str(args.cik),
        "filings": selected,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract 13F-HR filings with edgartools.")
    parser.add_argument("--cik", required=True)
    parser.add_argument("--max-filings", type=int, default=4)
    parser.add_argument("--identity", default=DEFAULT_IDENTITY)
    parser.add_argument("--output", help="Write JSON payload to this path instead of stdout.")
    args = parser.parse_args()

    payload = extract(args)
    encoded = json.dumps(payload, ensure_ascii=False)
    if args.output:
        Path(args.output).write_text(f"{encoded}\n", encoding="utf-8")
    else:
        print(encoded)


if __name__ == "__main__":
    main()

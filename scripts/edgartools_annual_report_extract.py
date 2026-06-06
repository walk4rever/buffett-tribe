#!/usr/bin/env python3
"""Extract annual filing payloads with edgartools for the TypeScript importer."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from edgar import Company, set_identity


ANNUAL_FORMS = ["10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"]
DEFAULT_IDENTITY = "buffett-tribe research walkklaw@gmail.com"


def _date_to_str(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)


def _safe_get(obj: Any, name: str, default: Any = None) -> Any:
    try:
        return getattr(obj, name)
    except Exception:
        return default


def _call_or_none(fn: Any) -> Any:
    if not callable(fn):
        return None
    try:
        return fn()
    except Exception as exc:  # edgartools can fail on malformed historical attachments
        return {"error": str(exc)}


def _year(value: str | None) -> int | None:
    if not value or len(value) < 4:
        return None
    try:
        return int(value[:4])
    except ValueError:
        return None


def _attachment_to_dict(attachment: Any) -> dict[str, Any]:
    document = _safe_get(attachment, "document", "") or ""
    document_type = _safe_get(attachment, "document_type", "") or ""
    description = _safe_get(attachment, "description", "") or document_type or document
    sequence = _safe_get(attachment, "sequence_number", "") or ""
    url = _safe_get(attachment, "url", "") or ""
    lowered = f"{document} {document_type} {description}".lower()
    category = "data_file" if any(
        token in lowered
        for token in ["xbrl", ".xsd", "_cal.xml", "_def.xml", "_lab.xml", "_pre.xml", "metalink", "filingsummary.xml"]
    ) else "attachment"

    return {
        "category": category,
        "sequence": str(sequence),
        "description": str(description),
        "documentName": str(document),
        "documentType": str(document_type),
        "url": str(url),
    }


def _filing_to_dict(filing: Any, include_html: bool) -> dict[str, Any]:
    accession = str(_safe_get(filing, "accession_number") or _safe_get(filing, "accession_no") or "")
    primary_document = str(_safe_get(filing, "primary_document") or "")
    cik = str(_safe_get(filing, "cik") or "")
    accno_path = accession.replace("-", "")
    filing_url_base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{accno_path}"
    primary_url = f"{filing_url_base}/{primary_document}" if primary_document else None

    html: str | None = None
    if include_html:
        extracted = _call_or_none(_safe_get(filing, "html"))
        if isinstance(extracted, str):
            html = extracted
        elif isinstance(extracted, dict):
            print(f"[edgartools-helper] html() failed for {accession}: {extracted['error']}", file=sys.stderr)

    return {
        "accession": accession,
        "form": str(_safe_get(filing, "form") or ""),
        "filedAt": _date_to_str(_safe_get(filing, "filing_date")),
        "reportDate": _date_to_str(_safe_get(filing, "report_date") or _safe_get(filing, "period_of_report")),
        "primaryDocument": primary_document,
        "primaryUrl": primary_url,
        "filingUrlBase": filing_url_base,
        "indexUrl": str(_safe_get(filing, "url") or ""),
        "isXbrl": bool(_safe_get(filing, "is_xbrl", False)),
        "isInlineXbrl": bool(_safe_get(filing, "is_inline_xbrl", False)),
        "size": _safe_get(filing, "size"),
        "attachments": [],
        "html": html,
    }


def extract(args: argparse.Namespace) -> dict[str, Any]:
    set_identity(args.identity)
    ticker = args.ticker.strip().upper()
    print(f"[edgartools-helper] {ticker}: create Company", file=sys.stderr, flush=True)
    company = Company(ticker)
    print(f"[edgartools-helper] {ticker}: get annual filings", file=sys.stderr, flush=True)
    filings = company.get_filings(form=ANNUAL_FORMS)
    print(f"[edgartools-helper] {ticker}: scan filings", file=sys.stderr, flush=True)

    selected = []
    for filing in filings:
        report_date = _date_to_str(_safe_get(filing, "report_date") or _safe_get(filing, "period_of_report"))
        report_year = _year(report_date)
        if report_year is None or report_year < args.from_year or report_year > args.to_year:
            continue
        accession = str(_safe_get(filing, "accession_number") or _safe_get(filing, "accession_no") or "")
        print(
            f"[edgartools-helper] {ticker}: selected {report_date} {accession}",
            file=sys.stderr,
            flush=True,
        )
        selected.append(_filing_to_dict(filing, include_html=not args.no_html))
    print(f"[edgartools-helper] {ticker}: selected count {len(selected)}", file=sys.stderr, flush=True)

    profile = {
        "name": _safe_get(company, "name"),
        "tickers": _safe_get(company, "tickers", []) or [],
        "exchanges": _call_or_none(_safe_get(company, "get_exchanges")) or [],
        "sic": str(_safe_get(company, "sic") or "") or None,
        "sicDescription": _safe_get(company, "industry"),
        "category": _safe_get(company, "business_category"),
        "fiscalYearEnd": _safe_get(company, "fiscal_year_end"),
        "stateOfIncorporation": None,
        "stateOfIncorporationDescription": None,
    }

    return {
        "tool": "edgartools",
        "toolVersion": _safe_get(sys.modules.get("edgar"), "__version__"),
        "ticker": ticker,
        "cik": str(_safe_get(company, "cik")),
        "title": _safe_get(company, "name") or _safe_get(company, "display_name") or ticker,
        "profile": profile,
        "filings": selected,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract annual SEC filings with edgartools.")
    parser.add_argument("--ticker", required=True)
    parser.add_argument("--from", dest="from_year", type=int, required=True)
    parser.add_argument("--to", dest="to_year", type=int, required=True)
    parser.add_argument("--identity", default=DEFAULT_IDENTITY)
    parser.add_argument("--output", help="Write JSON payload to this path instead of stdout.")
    parser.add_argument("--no-html", action="store_true", help="Only emit filing metadata; TS importer will fetch HTML.")
    args = parser.parse_args()

    payload = extract(args)
    encoded = json.dumps(payload, ensure_ascii=False)
    if args.output:
        Path(args.output).write_text(f"{encoded}\n", encoding="utf-8")
    else:
        print(encoded)


if __name__ == "__main__":
    main()

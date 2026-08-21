#!/usr/bin/env python3
"""Extract 13F filings and holdings with edgartools for the TypeScript importer."""

from __future__ import annotations

import argparse
import json
import math
import re
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


def _amendment_info(filing: Any) -> tuple[bool, str | None]:
    """(isAmendment, amendmentType) from the filing's own primary_doc.xml cover
    page. edgartools' parsed CoverPage model doesn't expose these fields, so
    this reads the raw XML directly. amendmentType is SEC's own distinction
    between an amendment that adds a previously-confidential-treatment
    position ("NEW HOLDINGS" — additive, combine with the original) and one
    that corrects/replaces the whole prior report ("RESTATEMENT" — the
    original filing's positions for this period are superseded, not
    additive). Best-effort: any failure here just means "not a restatement",
    never blocks the filing's holdings from importing.
    """
    try:
        doc = filing.attachments.get_by_sequence(1)
        text = doc.content
        text = text.decode() if isinstance(text, bytes) else text
        is_amendment = re.search(r"<isAmendment>(.*?)</isAmendment>", text)
        amendment_type = re.search(r"<amendmentType>(.*?)</amendmentType>", text)
        return (
            bool(is_amendment and is_amendment.group(1).strip().lower() == "true"),
            _safe_str(amendment_type.group(1)) if amendment_type else None,
        )
    except Exception:
        return (False, None)


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
    is_amendment, amendment_type = _amendment_info(filing)

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
        "isAmendment": is_amendment,
        "amendmentType": amendment_type,
        "holdings": holdings,
    }


def extract(args: argparse.Namespace) -> dict[str, Any]:
    set_identity(args.identity)
    company = Company(args.cik)
    filings = company.get_filings(form="13F-HR")

    # filing.report_date is metadata already present on the filing list (no
    # extra fetch) — checking it here lets us skip filing.obj() (a full
    # SGML/XML parse) for every filing that isn't a target quarter. Without
    # this, extracting one quarter meant fully parsing the filer's entire
    # 13F history, which is both slow and exposes old/malformed SGML that
    # can crash edgartools for filings we never wanted in the first place.
    target_dates: set[str] | None = None
    if args.report_dates:
        target_dates = {d.strip() for d in args.report_dates.split(",") if d.strip()}

    selected = []
    for index, filing in enumerate(filings):
        if index >= args.max_filings:
            break

        if target_dates is not None:
            report_date = _safe_str(
                _get_attr(filing, "report_date") or _get_attr(filing, "period_of_report")
            )
            if report_date not in target_dates:
                continue

        try:
            selected.append(_filing_to_dict(filing))
        except Exception as exc:  # noqa: BLE001 - edgartools can raise on malformed legacy SGML
            accession = _get_attr(filing, "accession_number") or _get_attr(filing, "accession_no") or "?"
            filed = _get_attr(filing, "filing_date") or "?"
            print(
                f"WARN: skipping filing {accession} (filed {filed}): {exc}",
                file=sys.stderr,
            )
            continue

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
    parser.add_argument(
        "--report-dates",
        default=None,
        help="Comma-separated quarter-end dates (YYYY-MM-DD) to filter to before parsing full filings.",
    )
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

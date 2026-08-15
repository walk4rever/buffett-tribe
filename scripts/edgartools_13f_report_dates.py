#!/usr/bin/env python3
"""List 13F-HR report (period-of-report) dates for a CIK, cheaply.

Reads filing.report_date off the filing list only — never calls
filing.obj() (the full SGML/XML parse) — so this is fast and can't hit
the malformed-legacy-SGML crashes that full extraction can.
"""

from __future__ import annotations

import argparse
import json

from edgar import Company, set_identity

DEFAULT_IDENTITY = "buffett-tribe research walkklaw@gmail.com"


def main() -> None:
    parser = argparse.ArgumentParser(description="List 13F-HR report dates with edgartools.")
    parser.add_argument("--cik", required=True)
    parser.add_argument("--identity", default=DEFAULT_IDENTITY)
    args = parser.parse_args()

    set_identity(args.identity)
    company = Company(args.cik)
    filings = company.get_filings(form="13F-HR")

    report_dates = sorted({
        str(getattr(f, "report_date", None) or getattr(f, "period_of_report", None))
        for f in filings
        if getattr(f, "report_date", None) or getattr(f, "period_of_report", None)
    })

    print(json.dumps({"cik": str(args.cik), "reportDates": report_dates}, ensure_ascii=False))


if __name__ == "__main__":
    main()

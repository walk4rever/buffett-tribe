#!/usr/bin/env python3
"""
Fetch US annual report filing metadata using edgartools (URLs only, no HTML download).

Usage:
    python edgartools-fetch-filings.py --ticker AAPL --cik 0000320193 --from-year 2020 --to-year 2025 --output filings.json --no-html
"""
import argparse
import json
import sys
from datetime import datetime

try:
    from edgar import Company, set_identity
    set_identity("BuffettTribe rafael@air7.fun")
except ImportError:
    print("Error: edgartools not installed. Run: pip install edgartools", file=sys.stderr)
    sys.exit(1)


def _format_date(d) -> str:
    if not d:
        return ""
    if isinstance(d, str):
        return d
    if hasattr(d, "isoformat"):
        return d.isoformat()
    return str(d)


def _get_year(d) -> int:
    if hasattr(d, "year"):
        return d.year
    try:
        return int(str(d)[:4])
    except Exception:
        return 0


def fetch_filings_metadata(ticker: str, cik: str, from_year: int, to_year: int, no_html: bool = True) -> dict:
    """
    Fetch annual report filing metadata (10-K/20-F/40-F).

    Returns:
        {
            "ticker": str,
            "cik": str,
            "title": str,
            "filings": [
                {
                    "accession": str,
                    "form": str,
                    "filedAt": str,
                    "reportDate": str,
                    "primaryDocument": str,
                    "primaryUrl": str | None,
                    "filingUrlBase": str,
                    "indexUrl": str,
                    "isXbrl": bool,
                    "isInlineXbrl": bool
                }
            ]
        }
    """
    company = Company(cik)

    # Fetch 10-K, 20-F, and 40-F filings
    forms = ["10-K", "20-F", "40-F"]
    all_filings = []

    for form in forms:
        try:
            filings = company.get_filings(form=form)
            if not filings:
                continue
            for filing in filings:
                filing_year = _get_year(filing.filing_date)
                if filing_year < from_year or filing_year > to_year:
                    continue

                # Build primary URL
                primary_url = None
                if hasattr(filing, 'primary_document') and filing.primary_document:
                    accession_path = filing.accession_number.replace("-", "")
                    primary_url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession_path}/{filing.primary_document}"

                filed_at = _format_date(filing.filing_date)
                report_date = _format_date(getattr(filing, 'report_date', None)) or filed_at

                filing_data = {
                    "accession": filing.accession_number,
                    "form": filing.form,
                    "filedAt": filed_at,
                    "reportDate": report_date,
                    "primaryDocument": filing.primary_document if hasattr(filing, 'primary_document') else "",
                    "primaryUrl": primary_url,
                    "filingUrlBase": f"https://www.sec.gov/cgi-bin/viewer?action=view&cik={cik}&accession_number={filing.accession_number}&xbrl_type=v",
                    "indexUrl": filing.url if hasattr(filing, 'url') else "",
                    "isXbrl": getattr(filing, 'is_xbrl', False),
                    "isInlineXbrl": getattr(filing, 'is_inline_xbrl', False)
                }

                # Only fetch HTML if requested
                if not no_html:
                    try:
                        filing_data["html"] = str(filing.html())
                    except:
                        filing_data["html"] = None

                all_filings.append(filing_data)
        except Exception as e:
            print(f"Warning: Could not fetch {form} filings: {e}", file=sys.stderr)

    return {
        "ticker": ticker,
        "cik": cik,
        "title": company.name if hasattr(company, 'name') else ticker,
        "filings": all_filings
    }


def main():
    parser = argparse.ArgumentParser(description="Fetch US annual report filing metadata")
    parser.add_argument("--ticker", required=True, help="Stock ticker (e.g., AAPL)")
    parser.add_argument("--cik", required=True, help="CIK (e.g., 0000320193)")
    parser.add_argument("--from-year", type=int, required=True, help="Start year")
    parser.add_argument("--to-year", type=int, required=True, help="End year")
    parser.add_argument("--output", required=True, help="Output JSON file path")
    parser.add_argument("--no-html", action="store_true", help="Skip HTML content fetching")

    args = parser.parse_args()

    data = fetch_filings_metadata(args.ticker, args.cik, args.from_year, args.to_year, args.no_html)

    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"✓ Fetched {len(data['filings'])} filing metadata records for {args.ticker}")


if __name__ == "__main__":
    main()

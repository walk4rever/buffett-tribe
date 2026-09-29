#!/usr/bin/env python3
"""
Fetch HK annual report metadata (URLs only, no PDF download) for P1 ExtSource creation.

Usage:
    python fetch-hk-annual-report-metadata.py --code 00700 --from-year 2020 --output reports.json
"""
import argparse
import json
import re
import sys
from datetime import datetime

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("Error: requests and beautifulsoup4 not installed. Run: pip install requests beautifulsoup4", file=sys.stderr)
    sys.exit(1)

BASE_URL = "https://www1.hkexnews.hk"
SEARCH_PAGE = f"{BASE_URL}/search/titlesearch.xhtml"
API_ENDPOINT = f"{BASE_URL}/search/titleSearchServlet.do"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
ANNUAL_REPORT_TITLE_RE = re.compile(r"年報|年度報告|Annual Report", re.IGNORECASE)
ANNUAL_REPORT_EXCLUDE_RE = re.compile(r"補充|補遺|澄清|企業年度報告書|ANNOUNCEMENT", re.IGNORECASE)


def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    return session


def establish_search_session(session: requests.Session, date_from: str, date_to: str) -> None:
    """Establish search session with HKEXnews by getting ViewState."""
    page_resp = session.get(
        SEARCH_PAGE,
        params={
            "sortDir": "0", "sortByRecordDate": "on", "searchType": "0", "category": "0",
            "t1code": "-2", "t2Gcode": "-2", "t2code": "-2", "documentType": "-1",
            "rowRange": "0", "lang": "EN",
        },
        timeout=30,
    )
    page_resp.raise_for_status()

    soup = BeautifulSoup(page_resp.text, "html.parser")
    vs_el = soup.find("input", {"name": "javax.faces.ViewState"})
    view_state = vs_el["value"] if vs_el else ""
    form_el = soup.find("form")
    form_action = form_el.get("action", "") if form_el else ""
    submit_url = f"{BASE_URL}{form_action}" if form_action.startswith("/") else form_action or SEARCH_PAGE

    session.post(
        submit_url,
        data={
            "j_idt10": "j_idt10",
            "j_idt10:loadMoreRange": "100",
            "javax.faces.ViewState": view_state,
            "from": date_from,
            "to": date_to,
        },
        timeout=30,
    )


def resolve_stock_id(session: requests.Session, code: str) -> int:
    """Resolve stock code to HKEX's internal stockId."""
    resp = session.get(
        f"{BASE_URL}/search/prefix.do",
        params={"callback": "callback", "lang": "ZH", "type": "A", "name": code, "market": "SEHK"},
        timeout=15,
    )
    resp.raise_for_status()

    match = re.search(r"callback\((.*)\)\s*;?\s*$", resp.text.strip())
    if not match:
        raise RuntimeError(f"Unexpected prefix.do response: {resp.text[:200]}")
    payload = json.loads(match.group(1))
    normalized_code = code.strip().zfill(5)
    for entry in payload.get("stockInfo", []):
        if str(entry.get("code", "")).strip() == normalized_code:
            return int(entry["stockId"])
    raise RuntimeError(f"No stockId match for code {code}")


def fetch_annual_reports_metadata(code: str, from_year: int) -> list[dict]:
    """
    Fetch annual report metadata from HKEXnews API.

    Returns list of:
        {
            "periodYear": int,
            "url": str,
            "form": str,
            "metadata": dict
        }
    """
    session = build_session()

    # Establish search session
    date_from = f"{from_year}0101"
    date_to = datetime.now().strftime("%Y%m%d")
    establish_search_session(session, date_from, date_to)

    # Resolve stock ID
    stock_id = resolve_stock_id(session, code)

    # Fetch filings
    resp = session.get(
        API_ENDPOINT,
        params={
            "sortDir": "0",
            "sortByRecordDate": "on",
            "category": "0",
            "market": "SEHK",
            "stockId": str(stock_id),
            "documentType": "-1",
            "fromDate": date_from,
            "toDate": date_to,
            "title": "",
            "lang": "EN",
            "searchType": "0",
        },
        timeout=60,
    )
    resp.raise_for_status()

    # Parse response
    soup = BeautifulSoup(resp.text, "html.parser")
    rows = soup.find_all("tr", class_=re.compile(r"listing-grid-(even|odd)"))

    reports_by_year = {}
    for row in rows:
        cells = row.find_all("td")
        if len(cells) < 6:
            continue

        title_cell = cells[2]
        title = title_cell.get_text(strip=True)

        if not ANNUAL_REPORT_TITLE_RE.search(title):
            continue
        if ANNUAL_REPORT_EXCLUDE_RE.search(title):
            continue

        date_cell = cells[1]
        date_str = date_cell.get_text(strip=True)
        try:
            filing_date = datetime.strptime(date_str, "%d/%m/%Y")
            period_year = filing_date.year
        except:
            continue

        if period_year < from_year:
            continue

        # Extract PDF link
        link_cell = cells[5]
        link_tag = link_cell.find("a")
        if not link_tag:
            continue

        href = link_tag.get("href", "")
        if not href:
            continue

        pdf_url = f"{BASE_URL}{href}" if href.startswith("/") else href

        # Keep newest filing per year (already sorted by date desc)
        if period_year not in reports_by_year:
            reports_by_year[period_year] = {
                "periodYear": period_year,
                "url": pdf_url,
                "form": "Annual Report",
                "metadata": {
                    "source": "hkexnews",
                    "title": title,
                    "filingDate": date_str,
                    "lang": "en",
                    "fetchedAt": datetime.now().isoformat()
                }
            }

    reports = sorted(reports_by_year.values(), key=lambda r: r["periodYear"])
    return reports


def main():
    parser = argparse.ArgumentParser(description="Fetch HK annual report metadata")
    parser.add_argument("--code", required=True, help="Stock code (e.g., 00700)")
    parser.add_argument("--from-year", type=int, default=2020, help="Start year")
    parser.add_argument("--output", required=True, help="Output JSON file path")

    args = parser.parse_args()

    try:
        reports = fetch_annual_reports_metadata(args.code, args.from_year)

        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(reports, f, ensure_ascii=False, indent=2)

        print(f"✓ Fetched {len(reports)} annual report metadata records for {args.code}")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()



if __name__ == "__main__":
    main()

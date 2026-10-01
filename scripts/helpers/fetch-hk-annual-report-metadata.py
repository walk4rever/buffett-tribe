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
ANNUAL_REPORT_EXCLUDE_RE = re.compile(
    r"補充|補遺|澄清|企業年度報告書|ANNOUNCEMENT|半年度|中期|季度|Interim|Quarterly",
    re.IGNORECASE,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch HK annual report metadata")
    parser.add_argument("--code", required=True, help="Stock code (e.g., 00700)")
    parser.add_argument("--from-year", type=int, default=2020, help="Start year")
    parser.add_argument("--output", required=True, help="Output JSON file path")
    parser.add_argument(
        "--lang",
        default="zh-first",
        choices=["zh-first", "zh", "en"],
        help="Language preference: zh-first (default), zh, or en",
    )
    return parser.parse_args()


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


def fetch_all_records(session: requests.Session, stock_id: int, date_from: str, date_to: str, lang: str) -> list[dict]:
    """
    Fetch all filings for one stockId across a date range with rowRange pagination.
    This ensures companies with high filing volumes (e.g. 0386.HK with 2000+ announcements)
    do not have their annual reports truncated off the first page.
    """
    all_records: list[dict] = []
    fetched = 0
    api_total: int | None = None
    chunk_size = 2000

    while True:
        row_range = fetched + chunk_size
        resp = session.get(
            API_ENDPOINT,
            params={
                "sortDir": "0", "sortByOptions": "DateTime", "category": "0", "market": "SEHK",
                "stockId": str(stock_id), "documentType": "-1", "fromDate": date_from, "toDate": date_to,
                "title": "", "searchType": "0", "t1code": "-2", "t2Gcode": "-2", "t2code": "-2",
                "rowRange": str(row_range), "lang": lang,
            },
            headers={
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Referer": SEARCH_PAGE,
                "X-Requested-With": "XMLHttpRequest",
            },
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()
        raw_result = data.get("result", "null")
        if not raw_result or raw_result == "null":
            break

        records = json.loads(raw_result)
        if api_total is None and records:
            api_total = int(records[0].get("TOTAL_COUNT", "0"))
        all_records.extend(records[fetched:])
        fetched = len(records)

        if not data.get("hasNextRow", False):
            break
        if api_total and fetched >= api_total:
            break

    return all_records


def pick_annual_reports_by_year(records: list[dict], from_year: int) -> dict[int, dict]:
    """Filter records down to annual reports, keyed by content year."""
    by_year: dict[int, dict] = {}
    for rec in records:
        if rec.get("FILE_TYPE", "").upper() != "PDF":
            continue
        title = rec.get("TITLE", "")
        if not ANNUAL_REPORT_TITLE_RE.search(title):
            continue
        if ANNUAL_REPORT_EXCLUDE_RE.search(title):
            continue

        date_str = rec.get("DATE_TIME", "")
        filed_year = None
        try:
            filed_year = datetime.strptime(date_str.split()[0], "%d/%m/%Y").year
        except Exception:
            pass

        # Try title pattern first (e.g. "2023年度報告" -> 2023)
        year_match = re.search(r"(20\d\d)\s*(?:年|年度)?(?:年報|年度報告|Annual Report)", title, re.IGNORECASE)
        if year_match:
            period_year = int(year_match.group(1))
        else:
            # Fallback: Annual reports are filed in spring following the fiscal year
            period_year = (filed_year - 1) if filed_year else None

        if period_year is None or period_year in by_year or period_year < from_year:
            continue

        file_link = rec.get("FILE_LINK", "")
        if not file_link:
            continue
        pdf_url = f"{BASE_URL}{file_link}" if file_link.startswith("/") else file_link

        by_year[period_year] = {
            "periodYear": period_year,
            "url": pdf_url,
            "form": "Annual Report",
            "metadata": {
                "source": "hkexnews",
                "title": title,
                "filingDate": date_str,
                "newsId": rec.get("NEWS_ID", ""),
                "fileSize": rec.get("FILE_INFO", ""),
            },
        }

    return by_year


def fetch_annual_reports_metadata(code: str, from_year: int, lang_pref: str = "zh-first") -> list[dict]:
    """
    Fetch annual report metadata from HKEXnews API with full rowRange pagination.
    """
    session = build_session()

    date_from = "19990401"
    date_to = datetime.now().strftime("%Y%m%d")
    establish_search_session(session, date_from, date_to)

    stock_id = resolve_stock_id(session, code)

    langs = {"zh": ["ZH"], "en": ["E"], "zh-first": ["ZH", "E"]}[lang_pref]
    by_year: dict[int, dict] = {}

    for lang in langs:
        records = fetch_all_records(session, stock_id, date_from, date_to, lang)
        picked = pick_annual_reports_by_year(records, from_year)
        lang_code = "zh" if lang == "ZH" else "en"
        for year, report in picked.items():
            if year not in by_year:
                report["metadata"]["lang"] = lang_code
                report["metadata"]["fetchedAt"] = datetime.now().isoformat()
                by_year[year] = report

    reports = [by_year[year] for year in sorted(by_year.keys())]
    return reports


def main():
    args = parse_args()

    try:
        reports = fetch_annual_reports_metadata(args.code, args.from_year, args.lang)

        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(reports, f, ensure_ascii=False, indent=2)

        print(f"✓ Fetched {len(reports)} annual report metadata records for {args.code}")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

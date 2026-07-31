#!/usr/bin/env python3

"""Fetch HK-listed company annual report PDFs from HKEXnews and extract text.

Usage:
  .venv/bin/python scripts/fetch-hk-annual-report.py --code 09992 --market hk --import-db
  .venv/bin/python scripts/fetch-hk-annual-report.py --code 09992 --market hk --from-year 2020

HKEXnews's title-search (https://www1.hkexnews.hk/search/titlesearch.xhtml) is a
JSF app, not a REST API — a plain requests.get() with query params returns an
empty result (this was mistaken for bot-blocking during investigation; the
Akamai-looking session cookies it sets are passive telemetry, not a hard
block). The real, verified mechanism:

  1. GET /search/prefix.do?lang=ZH&type=A&name={code}&market=SEHK — a small
     JSONP autocomplete endpoint (the same one the site's own search box
     calls while typing) that resolves a stock code to HKEX's internal
     numeric stockId, e.g. "09992" -> 1000068054. No session needed.
  2. GET the search page, extract the javax.faces.ViewState hidden field,
     POST it + a wide date range back to the same page (establishes
     server-side session state).
  3. GET titleSearchServlet.do with that real stockId. This is the part that
     matters: with a real stockId, HKEX returns only that company's filings
     (a few hundred rows, one call) across any date range. With stockId=-1
     (the "search all, filter client-side" approach some scrapers use
     because they don't resolve the ID), the same endpoint caps results to a
     1-month window and returns the *entire* HK market's filings for that
     month (~20K+ rows) — verified by testing both, not assumed; the -1
     approach took 25+ minutes scanning back 19 months to find 2 annual
     reports before being abandoned for this one.

PDF downloads from this host are consistently slow (~85KB/s observed against
a real 8.3MB annual report, completing in ~100s) — this is a real, verified
constraint to design around (generous timeouts), not a transient failure to
retry past.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from datetime import date, datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover
    fitz = None

BASE_URL = "https://www1.hkexnews.hk"
SEARCH_PAGE = f"{BASE_URL}/search/titlesearch.xhtml"
API_ENDPOINT = f"{BASE_URL}/search/titleSearchServlet.do"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
# 年報 (Tencent/Pop Mart style) and 年度報告 (Nongfu Spring style) are both
# used for the same document; 月報表/中期報告 do not match either.
ANNUAL_REPORT_TITLE_RE = re.compile(r"年報|年度報告|Annual Report", re.IGNORECASE)
# ...but these do: 企業年度報告書 is a short statutory form filed months later
# (not the annual report — Nongfu's 2022 one is ~3K chars vs ~460K for the
# real 2022年度報告), and 補充/補遺/澄清公告 are later corrections to it.
# Newest-first selection would otherwise pick these over the real report.
ANNUAL_REPORT_EXCLUDE_RE = re.compile(r"補充|補遺|澄清|企業年度報告書|ANNOUNCEMENT", re.IGNORECASE)
CHUNK_COUNT = 4


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch HK annual report PDFs from HKEXnews.")
    parser.add_argument("--code", required=True, help="Exchange code, e.g. 09992")
    parser.add_argument("--market", required=True, choices=["hk"], help="Only hk supported")
    parser.add_argument("--ticker", default=None, help="Entity.ticker, e.g. 9992.HK (defaults to derived from --code)")
    parser.add_argument("--from-year", type=int, default=2020, help="Earliest annual report content-year to fetch (default 2020, matching the US onboarding default)")
    parser.add_argument("--lang", default="zh-first", choices=["zh-first", "zh", "en"],
                        help="Report language: zh-first prefers the Chinese version per year and falls back to English for years where no Chinese filing exists (default); zh/en pin a single language")
    parser.add_argument("--out-dir", default="/tmp/hk-annual-report-ak", help="Directory for the generated JSON fixture and downloaded PDFs")
    parser.add_argument("--import-db", action="store_true", help="Import the generated JSON into the database after fetching")
    parser.add_argument("--keep-file", action="store_true", help="Keep the generated JSON and PDFs instead of deleting them after import")
    return parser.parse_args()


def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    return session


def establish_search_session(session: requests.Session, date_from: str, date_to: str) -> None:
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
    """Resolve a stock code to HKEX's internal numeric stockId via the site's
    own autocomplete endpoint (the same one the search box calls while
    typing). Without this, titleSearchServlet.do can only be queried
    unfiltered (stockId=-1), which caps results to a 1-month window and
    returns the entire HK market's filings for that month."""
    resp = session.get(
        f"{BASE_URL}/search/prefix.do",
        # callback is required — the endpoint returns an empty body without it
        # (it's JSONP; we don't execute the callback, just strip the wrapper).
        params={"callback": "callback", "lang": "ZH", "type": "A", "name": code, "market": "SEHK"},
        timeout=15,
    )
    resp.raise_for_status()
    # JSONP: "callback({...})" — strip the wrapper.
    match = re.search(r"callback\((.*)\)\s*;?\s*$", resp.text.strip())
    if not match:
        raise RuntimeError(f"Unexpected prefix.do response: {resp.text[:200]}")
    payload = json.loads(match.group(1))
    normalized_code = code.strip().zfill(5)
    for entry in payload.get("stockInfo", []):
        if str(entry.get("code", "")).strip() == normalized_code:
            return int(entry["stockId"])
    raise RuntimeError(f"No stockId match for code {code} in prefix.do response: {payload}")


def fetch_all_records(session: requests.Session, stock_id: int, date_from: str, date_to: str, lang: str) -> list[dict]:
    """Fetch all filings for one resolved stockId across a date range in one
    call (HKEX's 1-month cap only applies to the unfiltered stockId=-1 case).
    Still paginates via rowRange defensively in case a company has more than
    one page of history.

    lang selects which language version of each filing HKEX links to: with
    lang="E" every FILE_LINK points at the English PDF, with lang="ZH" at the
    Chinese one (e.g. Tencent 2025: .../2026040901231.pdf vs
    .../2026040901232_c.pdf — same filing, two documents, verified against
    the live endpoint)."""
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
    """Filter a filing list down to annual reports, keyed by content year.
    Records arrive newest-first, so the first hit per year is the most
    recently filed version (a later corrected re-filing wins)."""
    by_year: dict[int, dict] = {}
    for rec in records:
        if rec.get("FILE_TYPE", "").upper() != "PDF":
            continue
        title = rec.get("TITLE", "")
        if not ANNUAL_REPORT_TITLE_RE.search(title):
            continue
        if ANNUAL_REPORT_EXCLUDE_RE.search(title):
            continue
        date_time = rec.get("DATE_TIME", "")
        filed_year = None
        try:
            filed_year = datetime.strptime(date_time.split(" ")[0], "%d/%m/%Y").year
        except ValueError:
            pass
        # Annual reports are filed ~3-4 months after fiscal year-end; the
        # report content year is typically filedYear - 1.
        period_year = (filed_year - 1) if filed_year else None
        if period_year is None or period_year in by_year or period_year < from_year:
            continue
        link = rec.get("FILE_LINK", "")
        if link.startswith("/"):
            link = BASE_URL + link
        by_year[period_year] = {"periodYear": period_year, "title": title, "url": link}
    return by_year


def find_annual_reports(session: requests.Session, code: str, from_year: int, lang_pref: str) -> list[dict]:
    stock_id = resolve_stock_id(session, code)
    print(f"  resolved {code} -> internal stockId {stock_id}", file=sys.stderr)

    establish_search_session(session, "19990401", date.today().strftime("%Y%m%d"))
    date_from, date_to = "19990401", date.today().strftime("%Y%m%d")

    # zh-first needs both record sets so English can fill years where no
    # Chinese annual report was filed (e.g. some international issuers file
    # English only). The record list itself is one cheap JSON call per
    # language — only the PDF downloads are slow.
    langs = {"zh": ["ZH"], "en": ["E"], "zh-first": ["ZH", "E"]}[lang_pref]
    by_year: dict[int, dict] = {}
    for lang in langs:
        records = fetch_all_records(session, stock_id, date_from, date_to, lang)
        picked = pick_annual_reports_by_year(records, from_year)
        print(f"  lang={lang}: {len(records)} filings, {len(picked)} annual reports ({sorted(picked, reverse=True)})", file=sys.stderr)
        lang_code = "zh" if lang == "ZH" else "en"
        for year, report in picked.items():
            if year not in by_year:
                by_year[year] = {**report, "lang": lang_code}

    return [by_year[year] for year in sorted(by_year, reverse=True)]


def download_pdf(session: requests.Session, url: str, dest: Path) -> None:
    t0 = time.time()
    resp = session.get(url, timeout=180, stream=True)
    resp.raise_for_status()
    with open(dest, "wb") as f:
        for chunk in resp.iter_content(chunk_size=65536):
            f.write(chunk)
    print(f"  downloaded {dest.stat().st_size} bytes in {time.time() - t0:.1f}s", file=sys.stderr)


def extract_page_texts(pdf_path: Path) -> list[str]:
    """PyMuPDF first: Chinese annual-report PDFs use CID fonts whose
    ToUnicode maps pypdf mis-decodes into garbage (verified on Tencent's
    2025 年報 — pypdf produced mojibake, PyMuPDF clean Traditional Chinese).
    pypdf remains as a fallback if PyMuPDF isn't installed."""
    if fitz is not None:
        with fitz.open(str(pdf_path)) as doc:
            return [page.get_text() for page in doc]
    reader = PdfReader(str(pdf_path))
    return [page.extract_text() or "" for page in reader.pages]


def extract_chunks(pdf_path: Path, chunk_count: int) -> list[str]:
    page_texts = extract_page_texts(pdf_path)
    total_pages = len(page_texts)
    if total_pages == 0:
        return []

    chunks: list[str] = []
    per_chunk = max(1, -(-total_pages // chunk_count))  # ceil division
    for i in range(0, total_pages, per_chunk):
        chunks.append("\n\n".join(page_texts[i : i + per_chunk]).strip())
    return [c for c in chunks if c]


def main() -> int:
    args = parse_args()
    ticker = args.ticker or f"{args.code.lstrip('0') or '0'}.HK"
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    session = build_session()

    print(f"Searching HKEXnews for {args.code} annual reports since {args.from_year} (lang: {args.lang})...")
    reports = find_annual_reports(session, args.code, args.from_year, args.lang)
    if not reports:
        print(f"No annual reports found for {args.code}", file=sys.stderr)
        return 1
    print(f"Found {len(reports)} annual report(s): {[(r['periodYear'], r['lang']) for r in reports]}")

    results = []
    pdf_paths: list[Path] = []
    for report in reports:
        pdf_path = out_dir / f"{args.code}_{report['periodYear']}.pdf"
        pdf_paths.append(pdf_path)
        print(f"Downloading FY{report['periodYear']}: {report['url']}")
        download_pdf(session, report["url"], pdf_path)

        print(f"  extracting text...")
        chunks = extract_chunks(pdf_path, CHUNK_COUNT)
        total_chars = sum(len(c) for c in chunks)
        print(f"  {len(chunks)} chunks, {total_chars} total chars")
        if total_chars < 10_000:
            # A real annual report is hundreds of pages; a tiny extraction
            # means we grabbed the wrong document (e.g. a statutory form or
            # supplemental announcement) or the PDF is image-only.
            print(f"  WARNING: suspiciously small extraction for FY{report['periodYear']} — check the picked URL", file=sys.stderr)
        # pdfPath/url are kept (not just chunks) so the importer can archive
        # the original PDF to R2 — HKEXnews itself is too slow to link to
        # directly (~85KB/s observed), so the reading page needs its own copy.
        results.append({
            "periodYear": report["periodYear"],
            "url": report["url"],
            "lang": report["lang"],
            "pdfPath": str(pdf_path),
            "chunks": chunks,
        })

    json_path = out_dir / f"{args.code}.json"
    json_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {json_path}")

    if args.import_db:
        print("Importing into database...")
        cmd = [
            "node", "--env-file=.env.local", "./node_modules/.bin/tsx",
            "scripts/import-hk-annual-report-from-file.ts", str(json_path),
            "--ticker", ticker, "--code", args.code, "--market", args.market,
        ]
        subprocess.run(cmd, check=True)

    if not args.keep_file:
        json_path.unlink(missing_ok=True)
        for pdf_path in pdf_paths:
            pdf_path.unlink(missing_ok=True)

    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

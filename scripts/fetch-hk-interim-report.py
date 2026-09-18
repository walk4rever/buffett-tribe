#!/usr/bin/env python3

"""Fetch HK-listed company interim and quarterly report PDFs from HKEXnews and extract text.

Usage:
  .venv/bin/python scripts/fetch-hk-interim-report.py --code 09992 --market hk --from-year 2025 --import-db
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
except ImportError:
    fitz = None

BASE_URL = "https://www1.hkexnews.hk"
SEARCH_PAGE = f"{BASE_URL}/search/titlesearch.xhtml"
API_ENDPOINT = f"{BASE_URL}/search/titleSearchServlet.do"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

INTERIM_RE = re.compile(r"中期報告|Interim Report", re.IGNORECASE)
Q1_RE = re.compile(r"(三月三十一日|第一季度|第一季).*?(業績|业务状况|業務狀況)|First Quarter", re.IGNORECASE)
Q3_RE = re.compile(r"(九月三十日|第三季度|第三季).*?(業績|业务状况|業務狀況)|Third Quarter", re.IGNORECASE)
EXCLUDE_RE = re.compile(r"補充|補遺|澄清|股東特別大會|通函|董事會會議召開日期|股份發行人的證券變動月報表", re.IGNORECASE)

CHUNK_COUNT = 4

CHINESE_YEAR_MAP = {
    "二零二零": 2020, "二零二一": 2021, "二零二二": 2022, "二零二三": 2023,
    "二零二四": 2024, "二零二五": 2025, "二零二六": 2026, "二零二七": 2027,
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch HK interim and quarterly report PDFs from HKEXnews.")
    parser.add_argument("--code", required=True, help="Exchange code, e.g. 09992")
    parser.add_argument("--market", required=True, choices=["hk"], help="Only hk supported")
    parser.add_argument("--ticker", default=None, help="Entity.ticker, e.g. 9992.HK (defaults to derived from --code)")
    parser.add_argument("--from-year", type=int, default=2025, help="Earliest report content-year to fetch (default 2025)")
    parser.add_argument("--out-dir", default="/tmp/hk-interim-report-ak", help="Directory for generated JSON and PDFs")
    parser.add_argument("--import-db", action="store_true", help="Import the generated JSON into the database after fetching")
    parser.add_argument("--keep-file", action="store_true", help="Keep generated JSON and PDFs instead of deleting after import")
    return parser.parse_args()


def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    return session


def resolve_stock_id(session: requests.Session, code: str) -> int:
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
    raise RuntimeError(f"No stockId match for code {code} in prefix.do response: {payload}")


def establish_search_session(session: requests.Session, date_from: str, date_to: str) -> None:
    page_resp = session.get(
        SEARCH_PAGE,
        params={
            "sortDir": "0", "sortByRecordDate": "on", "searchType": "0", "category": "0",
            "t1code": "-2", "t2Gcode": "-2", "t2code": "-2", "documentType": "-1",
            "rowRange": "0", "lang": "ZH",
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


def fetch_all_records(session: requests.Session, stock_id: int, date_from: str, date_to: str, lang: str = "ZH") -> list[dict]:
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


def parse_year_from_title_or_date(title: str, date_time: str) -> int | None:
    for cn_str, y in CHINESE_YEAR_MAP.items():
        if cn_str in title:
            return y
    m = re.search(r"202\d", title)
    if m:
        return int(m.group(0))
    if date_time:
        try:
            return datetime.strptime(date_time.split(" ")[0], "%d/%m/%Y").year
        except ValueError:
            pass
    return None


def pick_periodic_reports(records: list[dict], from_year: int) -> list[dict]:
    found: list[dict] = []
    seen: set[str] = set()

    for r in records:
        if r.get("FILE_TYPE", "").upper() != "PDF":
            continue
        title = r.get("TITLE", "")
        if EXCLUDE_RE.search(title):
            continue

        date_time = r.get("DATE_TIME", "")
        period_year = parse_year_from_title_or_date(title, date_time)
        if not period_year or period_year < from_year:
            continue

        period_quarter = None
        kind = None
        form = None

        if INTERIM_RE.search(title):
            period_quarter = 2
            kind = "hk-interim-report"
            form = "中期報告"
        elif Q1_RE.search(title):
            period_quarter = 1
            kind = "hk-quarterly-report"
            form = "第一季度業績"
        elif Q3_RE.search(title):
            period_quarter = 3
            kind = "hk-quarterly-report"
            form = "第三季度業績"
        else:
            continue

        key = f"{period_year}-Q{period_quarter}"
        if key in seen:
            continue
        seen.add(key)

        link = r.get("FILE_LINK", "")
        if link.startswith("/"):
            link = BASE_URL + link

        found.append({
            "periodYear": period_year,
            "periodQuarter": period_quarter,
            "kind": kind,
            "form": form,
            "title": title,
            "url": link,
        })

    found.sort(key=lambda r: (r["periodYear"], r["periodQuarter"]))
    return found


def download_pdf(session: requests.Session, url: str, dest: Path) -> None:
    t0 = time.time()
    resp = session.get(url, timeout=180, stream=True)
    resp.raise_for_status()
    with open(dest, "wb") as f:
        for chunk in resp.iter_content(chunk_size=65536):
            f.write(chunk)
    print(f"  downloaded {dest.stat().st_size} bytes in {time.time() - t0:.1f}s", file=sys.stderr)


def extract_page_texts(pdf_path: Path) -> list[str]:
    if fitz is not None:
        with fitz.open(str(pdf_path)) as doc:
            return [page.get_text() for page in doc]
    reader = PdfReader(str(pdf_path))
    return [page.extract_text() or "" for page in reader.pages]


def extract_chunks_from_pages(page_texts: list[str], chunk_count: int) -> list[str]:
    total_pages = len(page_texts)
    if total_pages == 0:
        return []
    chunks: list[str] = []
    per_chunk = max(1, -(-total_pages // chunk_count))
    for i in range(0, total_pages, per_chunk):
        chunks.append("\n\n".join(page_texts[i : i + per_chunk]).strip())
    return [c for c in chunks if c]


def main() -> int:
    args = parse_args()
    clean_code = str(int(args.code))
    ticker = args.ticker or f"{clean_code}.HK"
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    session = build_session()
    print(f"Resolving stockId for {args.code}...")
    stock_id = resolve_stock_id(session, args.code)
    print(f"Resolved {args.code} -> stockId {stock_id}")

    date_from = f"{args.from_year}0101"
    date_to = date.today().strftime("%Y%m%d")
    establish_search_session(session, date_from, date_to)

    print(f"Searching HKEXnews for {args.code} periodic reports since {args.from_year}...")
    records = fetch_all_records(session, stock_id, date_from, date_to)
    reports = pick_periodic_reports(records, args.from_year)
    if not reports:
        print(f"No periodic reports found for {args.code} since {args.from_year}")
        return 0
    print(f"Found {len(reports)} periodic report(s): {[(r['periodYear'], f'Q{r['periodQuarter']}', r['form']) for r in reports]}")

    results = []
    pdf_paths: list[Path] = []
    for report in reports:
        period_str = f"{report['periodYear']}_Q{report['periodQuarter']}"
        pdf_path = out_dir / f"{args.code}_{period_str}.pdf"
        pdf_paths.append(pdf_path)
        print(f"Downloading {period_str} ({report['title']}): {report['url']}")
        download_pdf(session, report["url"], pdf_path)

        page_texts = extract_page_texts(pdf_path)
        chunks = extract_chunks_from_pages(page_texts, CHUNK_COUNT)
        print(f"  extracted {len(chunks)} chunks, {sum(len(c) for c in chunks)} chars from {len(page_texts)} pages")

        results.append({
            "periodYear": report["periodYear"],
            "periodQuarter": report["periodQuarter"],
            "kind": report["kind"],
            "form": report["form"],
            "title": report["title"],
            "url": report["url"],
            "pdfPath": str(pdf_path),
            "chunks": chunks,
        })

    json_path = out_dir / f"{args.code}_periodic.json"
    json_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {json_path}")

    if args.import_db:
        print("Importing into database and R2...")
        cmd = [
            "node", "--env-file=.env.local", "./node_modules/.bin/tsx",
            "scripts/import-hk-interim-report-from-file.ts", str(json_path),
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

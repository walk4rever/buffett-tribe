#!/usr/bin/env python3

"""Fetch A-share interim and quarterly report PDFs from cninfo and extract text.

Usage:
  .venv/bin/python scripts/fetch-cn-interim-report.py --code 600519 --market cn --from-year 2025 --import-db
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

import requests
from pypdf import PdfReader

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None

STATIC_BASE = "http://static.cninfo.com.cn"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

# Regex for periodic reports (excluding summaries like 摘要 and English versions)
INTERIM_RE = re.compile(r"^.*?(\d{4})年?半年度报告$")
Q1_RE = re.compile(r"^.*?(\d{4})年?第一季度报告$")
Q3_RE = re.compile(r"^.*?(\d{4})年?第三季度报告$")

CHUNK_COUNT = 4


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch A-share interim and quarterly report PDFs from cninfo.")
    parser.add_argument("--code", required=True, help="Exchange code, e.g. 600519")
    parser.add_argument("--market", required=True, choices=["cn"], help="Only cn supported")
    parser.add_argument("--ticker", default=None, help="Entity.ticker, e.g. 600519.SS (defaults to derived from --code)")
    parser.add_argument("--from-year", type=int, default=2024, help="Earliest report content-year to fetch (default 2024)")
    parser.add_argument("--out-dir", default="/tmp/cn-interim-report-ak", help="Directory for generated JSON and PDFs")
    parser.add_argument("--import-db", action="store_true", help="Import the generated JSON into the database after fetching")
    parser.add_argument("--keep-file", action="store_true", help="Keep generated JSON and PDFs instead of deleting after import")
    return parser.parse_args()


def get_org_id(code: str) -> str | None:
    url = "http://www.cninfo.com.cn/new/data/szse_stock.json"
    resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    for item in data.get("stockList", []):
        if item.get("code") == code:
            return item.get("orgId")
    return None


def find_periodic_reports(code: str, org_id: str, from_year: int) -> list[dict]:
    url = "http://www.cninfo.com.cn/new/hisAnnouncement/query"
    headers = {"User-Agent": USER_AGENT}
    start_date = f"{from_year}-01-01"
    end_date = time.strftime("%Y-%m-%d")

    payload = {
        "pageNum": "1",
        "pageSize": "50",
        "column": "szse",
        "tabName": "fulltext",
        "plate": "",
        "stock": f"{code},{org_id}",
        "searchkey": "",
        "category": "category_bndbg_szsh;category_yjdbg_szsh;category_sjdbg_szsh",
        "seDate": f"{start_date}~{end_date}",
        "isHLtitle": "false",
    }

    resp = requests.post(url, headers=headers, data=payload, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    found: list[dict] = []
    seen: set[str] = set()

    for item in data.get("announcements", []):
        title = item.get("announcementTitle", "")
        adjunct = item.get("adjunctUrl", "")
        if not adjunct:
            continue

        period_year = None
        period_quarter = None
        kind = None
        form = None

        m_interim = INTERIM_RE.match(title)
        m_q1 = Q1_RE.match(title)
        m_q3 = Q3_RE.match(title)

        if m_interim:
            period_year = int(m_interim.group(1))
            period_quarter = 2
            kind = "cn-interim-report"
            form = "半年度报告"
        elif m_q1:
            period_year = int(m_q1.group(1))
            period_quarter = 1
            kind = "cn-quarterly-report"
            form = "一季度报告"
        elif m_q3:
            period_year = int(m_q3.group(1))
            period_quarter = 3
            kind = "cn-quarterly-report"
            form = "三季度报告"
        else:
            continue

        if period_year < from_year:
            continue

        key = f"{period_year}-Q{period_quarter}"
        if key in seen:
            continue
        seen.add(key)

        pdf_url = f"{STATIC_BASE}/{adjunct}" if not adjunct.startswith("http") else adjunct
        found.append({
            "periodYear": period_year,
            "periodQuarter": period_quarter,
            "kind": kind,
            "form": form,
            "title": title,
            "url": pdf_url,
        })

    found.sort(key=lambda r: (r["periodYear"], r["periodQuarter"]))
    return found


def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({
        "User-Agent": USER_AGENT,
    })
    try:
        session.get("http://www.cninfo.com.cn/new/index", timeout=15)
    except Exception:
        pass
    return session


def download_pdf(session: requests.Session, url: str, dest: Path) -> str:
    """cninfo's static CDN serves over HTTP and requires session cookies."""
    url = url.replace("https://static.cninfo.com.cn", "http://static.cninfo.com.cn")
    candidates = [url]
    if url.endswith(".PDF"):
        candidates.append(url[:-4] + ".pdf")
    elif url.endswith(".pdf"):
        candidates.append(url[:-4] + ".PDF")

    last_err = None
    for attempt_url in candidates:
        for attempt in range(3):
            try:
                t0 = time.time()
                resp = session.get(attempt_url, timeout=60)
                if resp.status_code == 200 and len(resp.content) > 1000:
                    with open(dest, "wb") as f:
                        f.write(resp.content)
                    print(f"  downloaded {dest.stat().st_size} bytes in {time.time() - t0:.1f}s", file=sys.stderr)
                    return attempt_url
            except Exception as e:
                last_err = e
            time.sleep(1)

    raise RuntimeError(f"Failed to download {url}: {last_err}")


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
    default_exchange = "SS" if args.code.startswith(("60", "68")) else "SZ"
    ticker = args.ticker or f"{args.code}.{default_exchange}"
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Resolving orgId for {args.code}...")
    org_id = get_org_id(args.code)
    if not org_id:
        print(f"Failed to resolve orgId for {args.code}", file=sys.stderr)
        return 1
    print(f"Resolved {args.code} -> orgId {org_id}")

    print(f"Searching cninfo for {args.code} interim/quarterly reports since {args.from_year}...")
    reports = find_periodic_reports(args.code, org_id, args.from_year)
    if not reports:
        print(f"No interim or quarterly reports found for {args.code} since {args.from_year}")
        return 0
    print(f"Found {len(reports)} periodic report(s): {[(r['periodYear'], f'Q{r['periodQuarter']}', r['form']) for r in reports]}")

    session = build_session()

    results = []
    pdf_paths: list[Path] = []
    for report in reports:
        period_str = f"{report['periodYear']}_Q{report['periodQuarter']}"
        pdf_path = out_dir / f"{args.code}_{period_str}.pdf"
        pdf_paths.append(pdf_path)
        print(f"Downloading {period_str} ({report['title']}): {report['url']}")
        actual_url = download_pdf(session, report["url"], pdf_path)

        page_texts = extract_page_texts(pdf_path)
        chunks = extract_chunks_from_pages(page_texts, CHUNK_COUNT)
        print(f"  extracted {len(chunks)} chunks, {sum(len(c) for c in chunks)} chars from {len(page_texts)} pages")

        results.append({
            "periodYear": report["periodYear"],
            "periodQuarter": report["periodQuarter"],
            "kind": report["kind"],
            "form": report["form"],
            "title": report["title"],
            "url": actual_url,
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
            "scripts/import-cn-interim-report-from-file.ts", str(json_path),
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

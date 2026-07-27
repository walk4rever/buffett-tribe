#!/usr/bin/env python3

"""Fetch A-share-listed company annual report PDFs from cninfo and extract text.

Usage:
  .venv/bin/python scripts/fetch-cn-annual-report.py --code 600519 --market cn --import-db
  .venv/bin/python scripts/fetch-cn-annual-report.py --code 600519 --market cn --from-year 2020

akshare's stock_zh_a_disclosure_report_cninfo() lists cninfo disclosures for a
keyword; a plain keyword="年度报告" search also substring-matches "半年度报告"
(interim report), "...年度报告摘要" (summary) and "...年度报告（英文版）"
(English version). Titles are filtered with an anchored regex requiring the
string to *end* with "<year>年年度报告" — verified against Moutai (600519)
real search results, correctly keeps only the 6 plain Chinese annual reports
from 2020-2025 and excludes the 12 non-matching variants in the same result
set. Title strings come back with cninfo's own "<em>...</em>" search-highlight
markup around the matched keyword, stripped before the regex is applied.

The PDF itself lives at a predictable, fast static CDN URL built from the
announcement's id + date (both present in the row's own detail-page link):
https://static.cninfo.com.cn/finalpage/{announcementTime}/{announcementId}.PDF
— confirmed with a real download (3.6MB in ~0.3s). Unlike HKEXnews, no
session/ViewState dance is needed; this is a much simpler, faster pipeline.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

import akshare as ak
import requests
from pypdf import PdfReader

STATIC_BASE = "https://static.cninfo.com.cn/finalpage"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
TITLE_RE = re.compile(r"^.+?(\d{4})年年度报告$")
LINK_RE = re.compile(r"announcementId=(\d+).*?announcementTime=([\d-]+)")
CHUNK_COUNT = 4


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch A-share annual report PDFs from cninfo.")
    parser.add_argument("--code", required=True, help="Exchange code, e.g. 600519")
    parser.add_argument("--market", required=True, choices=["cn"], help="Only cn supported")
    parser.add_argument("--ticker", default=None, help="Entity.ticker, e.g. 600519.SS (defaults to derived from --code)")
    parser.add_argument("--from-year", type=int, default=2020, help="Earliest annual report content-year to fetch (default 2020)")
    parser.add_argument("--out-dir", default="/tmp/cn-annual-report-ak", help="Directory for the generated JSON fixture and downloaded PDFs")
    parser.add_argument("--import-db", action="store_true", help="Import the generated JSON into the database after fetching")
    parser.add_argument("--keep-file", action="store_true", help="Keep the generated JSON and PDFs instead of deleting them after import")
    return parser.parse_args()


def find_annual_reports(code: str, from_year: int) -> list[dict]:
    df = ak.stock_zh_a_disclosure_report_cninfo(
        symbol=code,
        market="沪深京",
        keyword="年度报告",
        category="",
        start_date=f"{from_year}0101",
        end_date=time.strftime("%Y%m%d"),
    )

    found: list[dict] = []
    seen_years: set[int] = set()
    for _, row in df.iterrows():
        title = re.sub(r"</?em>", "", str(row.get("公告标题", "")))
        match = TITLE_RE.match(title)
        if not match:
            continue
        period_year = int(match.group(1))
        if period_year in seen_years or period_year < from_year:
            continue

        link_match = LINK_RE.search(str(row.get("公告链接", "")))
        if not link_match:
            continue
        announcement_id, announcement_time = link_match.group(1), link_match.group(2)
        pdf_url = f"{STATIC_BASE}/{announcement_time}/{announcement_id}.PDF"

        seen_years.add(period_year)
        found.append({"periodYear": period_year, "title": title, "url": pdf_url})

    found.sort(key=lambda r: r["periodYear"])
    return found


def download_pdf(url: str, dest: Path) -> None:
    t0 = time.time()
    resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=60, stream=True)
    resp.raise_for_status()
    with open(dest, "wb") as f:
        for chunk in resp.iter_content(chunk_size=65536):
            f.write(chunk)
    print(f"  downloaded {dest.stat().st_size} bytes in {time.time() - t0:.1f}s", file=sys.stderr)


def extract_chunks(pdf_path: Path, chunk_count: int) -> list[str]:
    reader = PdfReader(str(pdf_path))
    page_texts = [page.extract_text() or "" for page in reader.pages]
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
    ticker = args.ticker or f"{args.code}.SS"
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Searching cninfo for {args.code} annual reports since {args.from_year}...")
    reports = find_annual_reports(args.code, args.from_year)
    if not reports:
        print(f"No annual reports found for {args.code}", file=sys.stderr)
        return 1
    print(f"Found {len(reports)} annual report(s): {[r['periodYear'] for r in reports]}")

    results = []
    pdf_paths: list[Path] = []
    for report in reports:
        pdf_path = out_dir / f"{args.code}_{report['periodYear']}.pdf"
        pdf_paths.append(pdf_path)
        print(f"Downloading FY{report['periodYear']}: {report['url']}")
        download_pdf(report["url"], pdf_path)

        print(f"  extracting text...")
        chunks = extract_chunks(pdf_path, CHUNK_COUNT)
        print(f"  {len(chunks)} chunks, {sum(len(c) for c in chunks)} total chars")
        # pdfPath/url are kept (not just chunks) so the importer can archive
        # the original PDF to R2, matching the HK annual report pipeline.
        results.append({
            "periodYear": report["periodYear"],
            "url": report["url"],
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
            "scripts/import-cn-annual-report-from-file.ts", str(json_path),
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

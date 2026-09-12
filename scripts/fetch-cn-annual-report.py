#!/usr/bin/env python3

"""Fetch A-share-listed company annual report PDFs from cninfo and extract text.

Usage:
  .venv/bin/python scripts/fetch-cn-annual-report.py --code 600519 --market cn --import-db
  .venv/bin/python scripts/fetch-cn-annual-report.py --code 600519 --market cn --from-year 2020

akshare's stock_zh_a_disclosure_report_cninfo() lists cninfo disclosures for a
keyword; a plain keyword="年度报告" search also substring-matches "半年度报告"
(interim report), "...年度报告摘要" (summary) and "...年度报告（英文版）"
(English version). Titles are filtered with an anchored regex requiring the
string to *end* with "<year>年度报告", with an optional "年" between the
digits and "年度报告", and an optional (possibly empty) company-name prefix
before the digits — companies don't share one title convention: Moutai
(600519) writes "贵州茅台2025年年度报告" (name + year + 年 + 年度报告),
Shenhua (601088) writes "中国神华2025年度报告" (name + year directly followed
by 年度报告, no separate 年), and CATL (300750) omits the name prefix
entirely — "2025年年度报告", nothing before the year. Verified against all
three companies' real search results: keeps only the plain Chinese annual
reports and excludes the half-year/summary/English/procedural-announcement
variants across all three title shapes. Title strings come back with
cninfo's own "<em>...</em>" search-highlight markup around the matched
keyword, stripped before the regex is applied.

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

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None

STATIC_BASE = "https://static.cninfo.com.cn/finalpage"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
TITLE_RE = re.compile(r"^.*?(\d{4})年?年度报告$")
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


def download_pdf(url: str, dest: Path) -> str:
    """cninfo's static CDN is inconsistent about the PDF extension's case
    per-filing (confirmed: 000568's 2024 annual report 404s as .PDF but
    serves as .pdf) — the URL built from disclosure-list metadata guesses
    uppercase, so fall back to the opposite case on 404. Returns the URL
    that actually worked."""
    t0 = time.time()
    resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=60, stream=True)
    if resp.status_code == 404 and url.endswith(".PDF"):
        url = url[:-4] + ".pdf"
        resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=60, stream=True)
    resp.raise_for_status()
    with open(dest, "wb") as f:
        for chunk in resp.iter_content(chunk_size=65536):
            f.write(chunk)
    print(f"  downloaded {dest.stat().st_size} bytes in {time.time() - t0:.1f}s", file=sys.stderr)
    return url


CHAPTER_RE = re.compile(r"^第[一二三四五六七八九十\d]+[节章]")
BUSINESS_KEYWORDS = ["营业收入", "主营业务", "毛利率", "研发", "核心竞争力", "业务", "经营"]
MIN_MDA_CHARS = 4000


def extract_page_texts(pdf_path: Path) -> tuple[list[str], list]:
    """PyMuPDF first: A-share annual-report PDFs use CID fonts whose
    ToUnicode maps pypdf mis-decodes into garbage. Returns (page_texts, toc)."""
    if fitz is not None:
        with fitz.open(str(pdf_path)) as doc:
            return [page.get_text() for page in doc], doc.get_toc()
    reader = PdfReader(str(pdf_path))
    return [page.extract_text() or "" for page in reader.pages], []


def extract_chunks_from_pages(page_texts: list[str], chunk_count: int) -> list[str]:
    total_pages = len(page_texts)
    if total_pages == 0:
        return []

    chunks: list[str] = []
    per_chunk = max(1, -(-total_pages // chunk_count))  # ceil division
    for i in range(0, total_pages, per_chunk):
        chunks.append("\n\n".join(page_texts[i : i + per_chunk]).strip())
    return [c for c in chunks if c]


def extract_semantic_sections(page_texts: list[str], toc: list) -> tuple[dict[str, str], dict]:
    """Extracts structured sections from an A-share annual report PDF using
    a 3-tier fallback algorithm:
    1. PDF outline/bookmarks (doc.get_toc())
    2. Textual TOC search within the first 12 pages
    3. Body page scan for chapter heading patterns

    Returns (sections_dict, metadata_dict).
    """
    total_pages = len(page_texts)
    if total_pages == 0:
        return {}, {}

    def find_chapter_range(target_keywords: list[str], next_chapter_keywords: list[str]):
        start_page = None
        end_page = None
        strategy = None

        # Tier 1: PDF outline
        chapter_items = []
        for item in toc:
            lvl, title, page = item[0], item[1].strip(), item[2]
            if CHAPTER_RE.match(title) or any(k in title for k in target_keywords):
                chapter_items.append((lvl, title, page))

        for i, (lvl, title, page) in enumerate(chapter_items):
            if any(k in title for k in target_keywords):
                start_page = page
                for j in range(i + 1, len(chapter_items)):
                    next_title = chapter_items[j][1]
                    next_page = chapter_items[j][2]
                    if CHAPTER_RE.match(next_title) and next_page > start_page:
                        end_page = next_page
                        break
                strategy = "pdf_outline"
                break

        # Tier 2: Text TOC in first 12 pages
        if not start_page:
            for pno in range(min(12, total_pages)):
                txt = page_texts[pno]
                if "目录" in txt and any(k in txt for k in target_keywords):
                    lines = [l.strip() for l in txt.split("\n") if l.strip()]
                    for l_idx, line in enumerate(lines):
                        if any(k in line for k in target_keywords):
                            m = re.search(r"[\.·…\s]{2,}\s*(\d+)", line)
                            if m:
                                start_page = int(m.group(1))
                            else:
                                for offset in range(1, 4):
                                    if l_idx + offset < len(lines) and lines[l_idx + offset].isdigit():
                                        start_page = int(lines[l_idx + offset])
                                        break
                        if start_page and any(k in line for k in next_chapter_keywords):
                            m = re.search(r"[\.·…\s]{2,}\s*(\d+)", line)
                            if m:
                                end_page = int(m.group(1))
                                break
                            else:
                                for offset in range(1, 4):
                                    if l_idx + offset < len(lines) and lines[l_idx + offset].isdigit():
                                        end_page = int(lines[l_idx + offset])
                                        break
                    if start_page:
                        strategy = "text_toc"
                        break

        # Tier 3: Body page heading scan
        if not start_page:
            for pno in range(min(60, total_pages)):
                txt = page_texts[pno]
                if "目录" not in txt[:100] and not re.search(r"[\.·…]{3,}", txt):
                    if any(re.search(rf"第[一二三四五六七八九十\d]+[节章]\s*{re.escape(k)}", txt) for k in target_keywords):
                        start_page = pno + 1
                        strategy = "page_scan"
                        break

        if not start_page:
            return None

        # Calibration: ensure start_page is not the TOC page and actually matches heading
        actual_start = max(0, start_page - 1)
        if not any(k in page_texts[actual_start] for k in target_keywords):
            for delta in [-2, -1, 1, 2, 3]:
                cand = actual_start + delta
                if 0 <= cand < total_pages:
                    c_txt = page_texts[cand]
                    if "目录" not in c_txt[:100] and any(k in c_txt for k in target_keywords):
                        actual_start = cand
                        break

        # Calibration for end page
        if end_page:
            actual_end = end_page - 1
            if not any(k in page_texts[actual_end] for k in next_chapter_keywords):
                for delta in [-2, -1, 1, 2, 3]:
                    cand = actual_end + delta
                    if actual_start < cand < total_pages:
                        c_txt = page_texts[cand]
                        if any(k in c_txt for k in next_chapter_keywords):
                            actual_end = cand
                            break
        else:
            actual_end = min(total_pages, actual_start + 40)

        if actual_end <= actual_start:
            actual_end = min(total_pages, actual_start + 35)

        return (actual_start, actual_end, strategy)

    # 1. Extract MD&A (Management Discussion & Analysis)
    mda_range = find_chapter_range(
        ["管理层讨论与分析"],
        ["公司治理", "环境、社会与治理", "环境和社会责任", "重要事项", "ESG"],
    )
    if not mda_range:
        return {}, {}

    mda_start, mda_end, mda_strategy = mda_range
    mda_text = "\n\n".join(page_texts[p] for p in range(mda_start, mda_end))

    # Guardrail check
    if len(mda_text) < MIN_MDA_CHARS:
        print(f"  WARNING: Extracted MD&A is shorter than expected ({len(mda_text)} chars < {MIN_MDA_CHARS})", file=sys.stderr)

    matched_kw = [kw for kw in BUSINESS_KEYWORDS if kw in mda_text]
    if len(matched_kw) < 2:
        print(f"  WARNING: Extracted MD&A lacks business keywords (only matched: {matched_kw})", file=sys.stderr)

    # 2. Sub-sections of MD&A
    sub_moat = ""
    sub_business = ""
    sub_review = ""
    sub_outlook = ""

    sections_split = re.split(r"\n(?=[一二三四五六七八九十]+、|\d+\.\d+\s+)", mda_text)
    for part in sections_split:
        h_line = part.strip().split("\n")[0]
        if "核心竞争力" in h_line or "竞争优势" in h_line:
            sub_moat = part.strip()
        elif any(k in h_line for k in ["从事的业务", "从事的主要业务", "所处行业情况", "行业情况", "业务运作", "公司业务"]):
            sub_business = (sub_business + "\n\n" + part.strip()).strip()
        elif any(k in h_line for k in ["主营业务分析", "主要经营情况", "总体经营情况", "经营情况讨论与分析", "利润表分析"]):
            sub_review = (sub_review + "\n\n" + part.strip()).strip()
        elif any(k in h_line for k in ["未来发展的展望", "前景展望", "发展战略", "经营计划"]):
            sub_outlook = part.strip()

    sections = {"cn_mda": mda_text}
    if sub_moat:
        sections["cn_mda_moat"] = sub_moat
    if sub_business:
        sections["cn_mda_business"] = sub_business
    if sub_review:
        sections["cn_mda_review"] = sub_review
    if sub_outlook:
        sections["cn_mda_outlook"] = sub_outlook

    # 3. Extract Company Profile (Chapter 2)
    profile_range = find_chapter_range(
        ["公司简介和主要财务指标", "会计数据和财务指标摘要", "公司简介"],
        ["管理层讨论与分析", "董事会致辞"],
    )
    if profile_range:
        sections["cn_company_profile"] = "\n\n".join(page_texts[p] for p in range(profile_range[0], profile_range[1]))

    # 4. Extract Governance (Chapter 4)
    gov_range = find_chapter_range(
        ["公司治理", "环境、社会与治理", "环境和社会责任"],
        ["重要事项", "股份变动及股东情况"],
    )
    if gov_range:
        sections["cn_governance"] = "\n\n".join(page_texts[p] for p in range(gov_range[0], gov_range[1]))

    metadata = {
        "mda_strategy": mda_strategy,
        "mda_pages": [mda_start + 1, mda_end],
        "mda_chars": len(mda_text),
        "sub_sections": [k for k in sections.keys() if k != "cn_mda" and k.startswith("cn_")],
    }
    return sections, metadata


def extract_chunks(pdf_path: Path, chunk_count: int) -> list[str]:
    page_texts, _ = extract_page_texts(pdf_path)
    return extract_chunks_from_pages(page_texts, chunk_count)


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
        actual_url = download_pdf(report["url"], pdf_path)

        print(f"  extracting semantic sections & fallback chunks...")
        page_texts, toc = extract_page_texts(pdf_path)
        sections, metadata = extract_semantic_sections(page_texts, toc)
        chunks = extract_chunks_from_pages(page_texts, CHUNK_COUNT)

        print(f"  extracted semantic sections: {list(sections.keys())} (MD&A {metadata.get('mda_chars', 0)} chars via {metadata.get('mda_strategy')})")
        print(f"  fallback chunks: {len(chunks)} chunks, {sum(len(c) for c in chunks)} total chars")

        results.append({
            "periodYear": report["periodYear"],
            "url": actual_url,
            "pdfPath": str(pdf_path),
            "chunks": chunks,
            "sections": sections,
            "metadata": metadata,
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

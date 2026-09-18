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


CHAPTER_KEYWORDS = [
    "管理層討論", "管理层讨论", "業務回顧", "业务回顾", "Management Discussion", "Business Review",
    "董事會報告", "董事会报告", "企業管治", "企业管治", "公司治理", "Corporate Governance",
    "主席報告", "董事長致辭", "董事长致辞", "創始人致辭", "创始人致辞", "Chairman's Statement", "Chairman’s Statement",
    "公司資料", "公司资料", "公司簡介", "公司简介", "Corporate Information", "Company Profile",
    "財務概要", "财务概要", "財務摘要", "财务摘要", "Financial Highlights", "Financial Summary",
    "獨立核數師報告", "独立核数师报告", "Independent Auditor",
    "環境、社會", "环境、社会", "Environmental, Social", "ESG",
    "討論與分析", "討論及分析", "讨论与分析", "讨论及分析", "經營業績", "经营业绩",
]
BUSINESS_KEYWORDS = [
    "收入", "營業額", "营业额", "毛利", "溢利", "利潤", "利润", "研發", "研发",
    "核心", "業務", "业务", "運營", "运营", "Revenue", "Turnover", "Profit", "Business",
]
MIN_MDA_CHARS = 4000


def extract_page_texts(pdf_path: Path) -> tuple[list[str], list]:
    """PyMuPDF first: Chinese annual-report PDFs use CID fonts whose
    ToUnicode maps pypdf mis-decodes into garbage (verified on Tencent's
    2025 年報 — pypdf produced mojibake, PyMuPDF clean Traditional Chinese).
    Returns (page_texts, toc)."""
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


def extract_chunks(pdf_path: Path, chunk_count: int) -> list[str]:
    page_texts, _ = extract_page_texts(pdf_path)
    return extract_chunks_from_pages(page_texts, chunk_count)


def extract_semantic_sections(page_texts: list[str], toc: list) -> tuple[dict[str, str], dict]:
    """Extracts structured sections from a HK annual report PDF using
    a 3-tier fallback algorithm:
    1. PDF outline/bookmarks (doc.get_toc())
    2. Textual TOC search within the first 15 pages
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
        for idx, item in enumerate(toc):
            lvl, title, page = item[0], item[1].strip(), item[2]
            if any(k.lower() in title.lower() for k in target_keywords):
                start_page = page
                for j in range(idx + 1, len(toc)):
                    next_lvl, next_title, next_page = toc[j][0], toc[j][1].strip(), toc[j][2]
                    if next_page > start_page and (
                        any(k.lower() in next_title.lower() for k in next_chapter_keywords)
                        or (next_lvl <= lvl and any(k.lower() in next_title.lower() for k in CHAPTER_KEYWORDS))
                    ):
                        end_page = next_page
                        break
                strategy = "pdf_outline"
                break

        # Tier 2: Text TOC in first 15 pages
        if not start_page:
            for pno in range(min(15, total_pages)):
                txt = page_texts[pno]
                if any(h in txt for h in ["目錄", "目录", "CONTENTS", "Contents", "目 錄", "Table of Contents"]):
                    lines = [l.strip() for l in txt.split("\n") if l.strip()]

                    def extract_page_from_context(idx: int):
                        line = lines[idx]
                        m_year = re.match(r"^(19\d\d|20\d\d)\s+[^\d]", line)
                        if not m_year:
                            m = re.match(r"^(\d{1,4})\s+", line)
                            if m and int(m.group(1)) < 1500:
                                return int(m.group(1))
                        m = re.search(r"[\.·…\s]{2,}\s*(\d{1,4})$", line)
                        if m and int(m.group(1)) < 1500:
                            return int(m.group(1))
                        if idx > 0 and lines[idx - 1].isdigit():
                            val = int(lines[idx - 1])
                            if val < 1500:
                                return val
                        if idx + 1 < len(lines) and lines[idx + 1].isdigit():
                            val = int(lines[idx + 1])
                            if val < 1500:
                                return val
                        return None

                    for idx, line in enumerate(lines):
                        if start_page is None and any(k.lower() in line.lower() for k in target_keywords):
                            p = extract_page_from_context(idx)
                            if p:
                                start_page = p
                        if start_page is not None and any(k.lower() in line.lower() for k in next_chapter_keywords):
                            p = extract_page_from_context(idx)
                            if p and p > start_page:
                                end_page = p
                                break
                    if start_page:
                        strategy = "text_toc"
                        break

        # Tier 3: Body page scan
        if not start_page:
            for pno in range(min(60, total_pages)):
                txt = page_texts[pno]
                if not any(h in txt[:100] for h in ["目錄", "目录", "CONTENTS", "目 錄"]) and not re.search(r"[\.·…]{3,}", txt[:300]):
                    top_txt = txt[:300]
                    if any(k.lower() in top_txt.lower() for k in target_keywords):
                        start_page = pno + 1
                        strategy = "page_scan"
                        break

        if not start_page:
            return None

        actual_start = max(0, start_page - 1)
        if not any(k.lower() in page_texts[actual_start].lower() for k in target_keywords):
            for delta in [-3, -2, -1, 1, 2, 3, 4, 5, 6, 7]:
                cand = actual_start + delta
                if 0 <= cand < total_pages:
                    c_txt = page_texts[cand]
                    if not any(h in c_txt[:100] for h in ["目錄", "目录", "CONTENTS", "目 錄"]) and any(k.lower() in c_txt.lower() for k in target_keywords):
                        actual_start = cand
                        break

        if end_page:
            actual_end = end_page - 1
            if not any(k.lower() in page_texts[actual_end].lower() for k in next_chapter_keywords):
                for delta in [-3, -2, -1, 1, 2, 3, 4, 5, 6, 7]:
                    cand = actual_end + delta
                    if actual_start < cand < total_pages:
                        c_txt = page_texts[cand]
                        if any(k.lower() in c_txt.lower() for k in next_chapter_keywords):
                            actual_end = cand
                            break
        else:
            actual_end = min(total_pages, actual_start + 40)

        if actual_end <= actual_start:
            actual_end = min(total_pages, actual_start + 35)

        return (actual_start, actual_end, strategy)

    # 1. Extract MD&A
    mda_range = find_chapter_range(
        [
            "管理層討論與分析", "管理層討論及分析", "管理层讨论与分析", "管理层讨论及分析",
            "經營業績和財務狀況的討論與分析", "經營業績與財務狀況的討論與分析",
            "經營業績和財務狀況之討論與分析", "經營業績與財務狀況之討論與分析",
            "討論與分析", "討論及分析", "讨论与分析", "讨论及分析",
            "業務回顧及展望", "業務回顧與展望", "業務回顧", "业务回顾",
            "Management Discussion and Analysis", "Management's Discussion and Analysis", "Business Review",
        ],
        [
            "董事會報告", "董事会报告", "企業管治報告", "企业管治报告", "公司治理",
            "環境、社會及管治", "环境、社会及管治", "環境、社會與管治", "环境、社会与管治",
            "ESG", "董事及高級管理人員", "董事及高級管理層", "董事及高级管理人员",
            "獨立核數師報告", "独立核数师报告", "綜合財務報表", "综合财务报表",
            "Report of the Directors", "Report of Directors", "Corporate Governance Report",
            "Biographies of Directors", "Directors and Senior Management",
            "Independent Auditor’s Report", "Independent Auditor's Report", "Financial Statements",
        ],
    )
    if not mda_range:
        return {}, {}

    mda_start, mda_end, mda_strategy = mda_range
    mda_text = "\n\n".join(page_texts[p] for p in range(mda_start, mda_end))

    # Guardrail check
    if len(mda_text) < MIN_MDA_CHARS:
        print(f"  WARNING: Extracted HK MD&A is shorter than expected ({len(mda_text)} chars < {MIN_MDA_CHARS})", file=sys.stderr)

    matched_kw = [kw for kw in BUSINESS_KEYWORDS if kw.lower() in mda_text.lower()]
    if len(matched_kw) < 2:
        print(f"  WARNING: Extracted HK MD&A lacks business keywords (only matched: {matched_kw})", file=sys.stderr)

    # 2. Sub-sections of MD&A
    lines = [l.strip() for l in mda_text.split("\n") if l.strip()]
    candidates = [
        ("moat", ["核心競爭力", "核心竞争力", "競爭優勢", "竞争优势", "競爭壁壘", "竞争壁垒", "核心優勢", "核心优势", "Competitive Strengths", "Competitive Advantages", "Competitive Moat"]),
        ("business", ["業務回顧", "业务回顾", "主要業務經營分析", "主要業務", "主要业务", "分部表現", "分部表现", "業務概況", "业务概况", "主營業務", "主营业务", "公司業務", "公司业务", "Business Review", "Segment Review", "Overview of Business", "Principal Activities", "Business Overview"]),
        ("review", ["財務回顧", "财务回顾", "經營情況", "经营情况", "經營業績", "经营业绩", "業績回顧", "业绩回顾", "財務狀況", "财务状况", "運營回顧", "运营回顾", "業績概覽", "业绩概览", "專項分析", "专项分析", "Financial Review", "Operating Results", "Operating Review", "Financial Performance"]),
        ("outlook", ["未來展望", "未来展望", "前景及展望", "前景与展望", "前景展望", "展望", "未來發展", "未来发展", "發展戰略", "发展战略", "未來戰略", "未来战略", "Outlook", "Prospects", "Future Prospects", "Strategy", "Future Strategy"]),
    ]

    headings_found = []
    for idx, line in enumerate(lines):
        if len(line) <= 35:
            clean = re.sub(r"^[一二三四五六七八九十\d\.\s、()（）]+", "", line).strip()
            for section_type, keywords in candidates:
                if any(k.lower() == clean.lower() or clean.lower().startswith(k.lower()) for k in keywords):
                    headings_found.append((idx, section_type, line))
                    break

    seen = set()
    unique_headings = []
    for idx, st, l in headings_found:
        if st not in seen:
            seen.add(st)
            unique_headings.append((idx, st, l))

    unique_headings.sort(key=lambda x: x[0])

    sections = {"hk_mda": mda_text}
    for i, (idx, st, l) in enumerate(unique_headings):
        next_idx = unique_headings[i + 1][0] if i + 1 < len(unique_headings) else len(lines)
        section_text = "\n".join(lines[idx:next_idx]).strip()
        if section_text:
            sections[f"hk_mda_{st}"] = section_text

    # 3. Extract Company Profile
    profile_range = find_chapter_range(
        ["公司資料", "公司资料", "公司簡介", "公司简介", "Corporate Information", "Company Profile"],
        ["財務摘要", "财务摘要", "財務概要", "财务概要", "主席報告", "董事長致辭", "董事长致辞", "創始人致辭", "创始人致辞", "管理層討論", "管理层讨论", "業務回顧", "业务回顾", "Management Discussion", "Business Review"],
    )
    if profile_range:
        sections["hk_company_profile"] = "\n\n".join(page_texts[p] for p in range(profile_range[0], profile_range[1]))

    # 4. Extract Governance
    gov_range = find_chapter_range(
        ["企業管治報告", "企业管治报告", "公司治理", "Corporate Governance Report"],
        ["環境、社會", "环境、社会", "ESG", "獨立核數師報告", "独立核数师报告", "董事會報告", "董事会报告", "Environmental, Social", "Independent Auditor", "Report of the Directors"],
    )
    if gov_range:
        sections["hk_governance"] = "\n\n".join(page_texts[p] for p in range(gov_range[0], gov_range[1]))

    # 5. Extract Chairman Statement
    chairman_range = find_chapter_range(
        ["主席報告", "董事長致辭", "董事长致辞", "創始人致辭", "创始人致辞", "Chairman's Statement", "Chairman’s Statement", "Letter from Founder", "Message from Chairman"],
        ["管理層討論", "管理层讨论", "業務回顧", "业务回顾", "討論與分析", "討論及分析", "讨论与分析", "讨论及分析", "經營業績", "经营业绩", "Management Discussion", "Business Review", "公司資料", "Corporate Information"],
    )
    if chairman_range:
        sections["hk_chairman_statement"] = "\n\n".join(page_texts[p] for p in range(chairman_range[0], chairman_range[1]))

    metadata = {
        "mda_strategy": mda_strategy,
        "mda_pages": [mda_start + 1, mda_end],
        "mda_chars": len(mda_text),
        "sub_sections": [k for k in sections.keys() if k != "hk_mda" and k.startswith("hk_")],
    }
    return sections, metadata


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
        if not pdf_path.exists() or pdf_path.stat().st_size == 0:
            print(f"Downloading FY{report['periodYear']}: {report['url']}")
            download_pdf(session, report["url"], pdf_path)
        else:
            print(f"Using cached PDF: {pdf_path} ({pdf_path.stat().st_size} bytes)")

        print(f"  extracting semantic sections & fallback chunks...")
        page_texts, toc = extract_page_texts(pdf_path)
        sections, metadata = extract_semantic_sections(page_texts, toc)
        chunks = extract_chunks_from_pages(page_texts, CHUNK_COUNT)

        print(f"  extracted semantic sections: {list(sections.keys())} (MD&A {metadata.get('mda_chars', 0)} chars via {metadata.get('mda_strategy')})")
        print(f"  fallback chunks: {len(chunks)} chunks, {sum(len(c) for c in chunks)} total chars")
        if sum(len(c) for c in chunks) < 10_000:
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

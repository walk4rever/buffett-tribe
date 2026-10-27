"""Deterministic filters for HKEX annual-report search results."""

from __future__ import annotations

import re
from datetime import datetime

HKEX_BASE_URL = "https://www1.hkexnews.hk"

ANNUAL_REPORT_TITLE_RE = re.compile(r"年報|年度報告|Annual Report", re.IGNORECASE)
ANNUAL_REPORT_EXCLUDE_RE = re.compile(
    r"補充|補遺|澄清|企業年度報告書|ANNOUNCEMENT|半年度|中期|季度|Interim|Quarterly|"
    r"通知信函|登載通知|代表委任表格|在網站登載|申請表格|致.{0,40}函件",
    re.IGNORECASE,
)


def pick_annual_reports_by_year(
    records: list[dict],
    from_year: int,
    base_url: str = HKEX_BASE_URL,
) -> dict[int, dict]:
    """Filter a filing list down to actual annual reports, keyed by year.

    Records arrive newest-first, so the first valid hit per year is the most
    recently filed version (a later corrected re-filing wins).
    """
    by_year: dict[int, dict] = {}
    for rec in records:
        title = str(rec.get("TITLE", ""))
        if not ANNUAL_REPORT_TITLE_RE.search(title):
            continue
        if ANNUAL_REPORT_EXCLUDE_RE.search(title):
            continue

        # HKEX sometimes labels shareholder notification letters as annual
        # reports because their title mentions the report. The document
        # category distinguishes the actual filing.
        long_text = str(rec.get("LONG_TEXT", ""))
        if "[年報" not in long_text and "[Annual Report" not in long_text:
            continue

        file_type = str(rec.get("FILE_TYPE", "")).upper()
        file_link = str(rec.get("FILE_LINK", ""))
        normalized_link = file_link.lower().split("?", 1)[0]
        report_format = (
            "html"
            if file_type == "HTML"
            or normalized_link.endswith((".htm", ".html", "/"))
            else "pdf"
            if file_type == "PDF" or normalized_link.endswith(".pdf")
            else None
        )
        if report_format is None:
            continue

        date_time = str(rec.get("DATE_TIME", ""))
        filed_year = None
        try:
            filed_year = datetime.strptime(date_time.split(" ")[0], "%d/%m/%Y").year
        except ValueError:
            pass

        # Annual reports are filed ~3-4 months after fiscal year-end.
        period_year = (filed_year - 1) if filed_year else None
        if period_year is None or period_year in by_year or period_year < from_year:
            continue

        link = file_link
        if link.startswith("/"):
            link = base_url + link
        by_year[period_year] = {
            "periodYear": period_year,
            "title": title,
            "url": link,
            "format": report_format,
        }
    return by_year

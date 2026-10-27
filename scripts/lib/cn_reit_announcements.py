"""Annual-report discovery for exchange-listed CN REIT funds.

CN REIT units use a fund reporting stack rather than an ordinary A-share
issuer stack.  CNINFO's stock disclosure endpoint accepts the code but returns
no annual reports for these units.  Eastmoney's fund periodic-report endpoint
does expose them, with stable announcement ids that map to downloadable PDFs.
"""

from __future__ import annotations

import re

import akshare as ak

FUND_PDF_BASE = "https://pdf.dfcfw.com/pdf/H2"
ANNUAL_TITLE_RE = re.compile(r"(\d{4})年年度报告$")


def find_cn_reit_annual_reports(code: str, from_year: int) -> list[dict]:
    df = ak.fund_announcement_report_em(symbol=code)
    reports: list[dict] = []
    seen_years: set[int] = set()

    for _, row in df.iterrows():
        title = str(row.get("公告标题", "")).strip()
        match = ANNUAL_TITLE_RE.search(title)
        if not match:
            continue
        period_year = int(match.group(1))
        if period_year < from_year or period_year in seen_years:
            continue
        report_id = str(row.get("报告ID", "")).strip()
        if not re.fullmatch(r"AN\d+", report_id):
            continue
        report_date = str(row.get("公告日期", "")).strip()
        seen_years.add(period_year)
        reports.append(
            {
                "periodYear": period_year,
                "title": title,
                "url": f"{FUND_PDF_BASE}_{report_id}_1.pdf",
                "reportId": report_id,
                "reportDate": report_date,
            }
        )

    reports.sort(key=lambda item: item["periodYear"])
    return reports

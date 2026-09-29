#!/usr/bin/env python3
"""
Fetch CN annual report metadata (URLs only, no PDF download) for P1 ExtSource creation.

Usage:
    python fetch-cn-annual-report-metadata.py --code 600519 --from-year 2020 --output reports.json
"""
import argparse
import json
import re
import sys
import time
from datetime import datetime

try:
    import akshare as ak
except ImportError:
    print("Error: akshare not installed. Run: pip install akshare", file=sys.stderr)
    sys.exit(1)

STATIC_BASE = "https://static.cninfo.com.cn/finalpage"
TITLE_RE = re.compile(r"^.*?(\d{4})年?年度报告$")
LINK_RE = re.compile(r"announcementId=(\d+).*?announcementTime=([\d-]+)")


def fetch_annual_reports_metadata(code: str, from_year: int) -> list[dict]:
    """
    Fetch annual report metadata from cninfo API.

    Returns list of:
        {
            "periodYear": int,
            "url": str,
            "filingKind": "cn-annual-report" | "cn-prospectus",
            "form": str,
            "metadata": dict
        }
    """
    reports = []

    # Fetch annual reports using akshare
    try:
        df = ak.stock_zh_a_disclosure_report_cninfo(
            symbol=code,
            market="沪深京",
            keyword="年度报告",
            category="",
            start_date=f"{from_year}0101",
            end_date=time.strftime("%Y%m%d"),
        )

        seen_years = set()
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
            reports.append({
                "periodYear": period_year,
                "url": pdf_url,
                "filingKind": "cn-annual-report",
                "form": "Annual Report",
                "metadata": {
                    "source": "cninfo",
                    "title": title,
                    "announcementId": announcement_id,
                    "announcementTime": announcement_time,
                    "fetchedAt": datetime.now().isoformat()
                }
            })

        # If no annual reports found, try fetching prospectus (IPO fallback)
        if not reports:
            prospectus = fetch_prospectus_metadata(code)
            if prospectus:
                reports.append(prospectus)

    except Exception as e:
        print(f"Warning: Could not fetch annual reports: {e}", file=sys.stderr)

    reports.sort(key=lambda r: r["periodYear"])
    return reports


def fetch_prospectus_metadata(code: str) -> dict | None:
    """Fetch IPO prospectus metadata (招股说明书) for newly listed companies."""
    try:
        df = ak.stock_zh_a_disclosure_report_cninfo(
            symbol=code,
            market="沪深京",
            keyword="招股说明书",
            category="",
            start_date="20150101",
            end_date=time.strftime("%Y%m%d"),
        )

        best = None
        for _, row in df.iterrows():
            title = re.sub(r"</?em>", "", str(row.get("公告标题", "")))
            if not title.endswith("招股说明书"):
                continue
            link_match = LINK_RE.search(str(row.get("公告链接", "")))
            if not link_match:
                continue
            announcement_id, announcement_time = link_match.group(1), link_match.group(2)
            if best is None or announcement_time > best["announcementTime"]:
                best = {"announcementId": announcement_id, "announcementTime": announcement_time, "title": title}

        if best is None:
            return None

        return {
            "periodYear": int(best["announcementTime"][:4]),
            "url": f"{STATIC_BASE}/{best['announcementTime']}/{best['announcementId']}.PDF",
            "filingKind": "cn-prospectus",
            "form": "Prospectus",
            "metadata": {
                "source": "cninfo",
                "title": best["title"],
                "announcementId": best["announcementId"],
                "announcementTime": best["announcementTime"],
                "fetchedAt": datetime.now().isoformat()
            }
        }
    except Exception as e:
        print(f"Warning: Could not fetch prospectus: {e}", file=sys.stderr)
        return None


def main():
    parser = argparse.ArgumentParser(description="Fetch CN annual report metadata")
    parser.add_argument("--code", required=True, help="Stock code (e.g., 600519)")
    parser.add_argument("--from-year", type=int, default=2020, help="Start year")
    parser.add_argument("--output", required=True, help="Output JSON file path")

    args = parser.parse_args()

    reports = fetch_annual_reports_metadata(args.code, args.from_year)

    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(reports, f, ensure_ascii=False, indent=2)

    print(f"✓ Fetched {len(reports)} annual report metadata records for {args.code}")


if __name__ == "__main__":
    main()

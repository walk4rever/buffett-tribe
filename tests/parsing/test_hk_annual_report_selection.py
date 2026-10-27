import pathlib
import sys
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.lib.hk_annual_report_selection import (  # noqa: E402
    HKEX_BASE_URL,
    pick_annual_reports_by_year,
)


class HkAnnualReportSelectionTest(unittest.TestCase):
    def test_does_not_pick_shareholder_notification_letter(self):
        records = [
            {
                "TITLE": "致非登記H股股份持有人的函件 - 在網站登載2022年年度報告的通知",
                "LONG_TEXT": "通函 - [其他]",
                "FILE_TYPE": "PDF",
                "FILE_LINK": "/notice.pdf",
                "DATE_TIME": "10/04/2023 18:25",
            },
            {
                "TITLE": "年度報告2022",
                "LONG_TEXT": "財務報表／環境、社會及管治資料 - [年報]",
                "FILE_TYPE": "PDF",
                "FILE_LINK": "/annual-report.pdf",
                "DATE_TIME": "10/04/2023 18:08",
            },
        ]

        picked = pick_annual_reports_by_year(records, 2020)

        self.assertEqual(picked[2022]["url"], f"{HKEX_BASE_URL}/annual-report.pdf")

    def test_accepts_english_annual_report_category(self):
        records = [
            {
                "TITLE": "Annual Report 2025",
                "LONG_TEXT": "Financial Statements/ESG Information - [Annual Report]",
                "FILE_TYPE": "PDF",
                "FILE_LINK": "/annual-report.pdf",
                "DATE_TIME": "01/04/2026 16:33",
            }
        ]

        picked = pick_annual_reports_by_year(records, 2020)

        self.assertEqual(picked[2025]["url"], f"{HKEX_BASE_URL}/annual-report.pdf")

    def test_accepts_annual_report_category_with_esg_suffix(self):
        records = [
            {
                "TITLE": "年報 2024/2025",
                "LONG_TEXT": "財務報表／環境、社會及管治資料 - [年報 ／ 環境、社會及管治資料／報告]",
                "FILE_TYPE": "PDF",
                "FILE_LINK": "/annual-report.pdf",
                "DATE_TIME": "16/06/2025 16:53",
            }
        ]

        picked = pick_annual_reports_by_year(records, 2020)

        self.assertEqual(picked[2024]["url"], f"{HKEX_BASE_URL}/annual-report.pdf")


if __name__ == "__main__":
    unittest.main()

import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd


ROOT = Path(__file__).resolve().parents[2]


def load_module(name: str, relative_path: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class CnReitAnnouncementTests(unittest.TestCase):
    def test_selects_annual_reports_by_title_and_year(self):
        module = load_module(
            "cn_reit_announcements",
            "scripts/lib/cn_reit_announcements.py",
        )
        frame = pd.DataFrame(
            [
                {
                    "公告标题": "某REIT 2025年年度报告",
                    "公告日期": "2026-03-27",
                    "报告ID": "AN202603270001",
                },
                {
                    "公告标题": "某REIT 2025年审计报告",
                    "公告日期": "2026-03-27",
                    "报告ID": "AN202603270002",
                },
                {
                    "公告标题": "某REIT 2024年年度报告",
                    "公告日期": "2025-03-27",
                    "报告ID": "AN202503270001",
                },
            ]
        )
        with patch.object(module.ak, "fund_announcement_report_em", return_value=frame):
            reports = module.find_cn_reit_annual_reports("508000", 2020)

        self.assertEqual([item["periodYear"] for item in reports], [2024, 2025])
        self.assertEqual(
            reports[1]["url"],
            "https://pdf.dfcfw.com/pdf/H2_AN202603270001_1.pdf",
        )


class CnReitFinancialParserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module(
            "fetch_cn_reit_financials",
            "scripts/fetch-cn-reit-financials.py",
        )

    def test_rejects_note_reference_and_reads_following_amount(self):
        text = """
        合同负债
        11.5.7.10
        1,604,972.07
        1,851,430.40
        """
        self.assertEqual(
            self.module.amount_from_following_lines(text, ["合同负债"]),
            1604972.07,
        )

    def test_reads_comma_formatted_summary_amount(self):
        text = """
        本期收入
        142,324,217.65
        162,730,347.50
        """
        self.assertEqual(self.module.first_number(text, ["本期收入"]), 142324217.65)

    def test_reads_investment_property_and_explicit_zero_debt(self):
        text = """
        短期借款 -
        衍生金融负债 -
        应付账款 3,536,462.26
        投资性房地产 11.5.7.3 1,441,575,967.61
        长期借款 496,790,000.00
        """
        self.assertEqual(
            self.module.balance_sheet_amount(text, ["短期借款"]),
            0.0,
        )
        self.assertEqual(
            self.module.note_referenced_amount(
                text,
                "投资性房地产",
                "11.5.7.3",
            ),
            1441575967.61,
        )
        self.assertEqual(
            self.module.balance_sheet_amount(text, ["长期借款"]),
            496790000.0,
        )


class HkAnnualReportSelectionTests(unittest.TestCase):
    def test_rejects_notification_letter_with_annual_report_in_title(self):
        module = load_module(
            "fetch_hk_annual_report",
            "scripts/fetch-hk-annual-report.py",
        )
        title = (
            "致非登記基金單位持有人之通知信函 – "
            "(1) 年報2025/2026、(2) 週年大會通告"
        )
        self.assertIsNotNone(module.ANNUAL_REPORT_TITLE_RE.search(title))
        self.assertIsNotNone(module.ANNUAL_REPORT_EXCLUDE_RE.search(title))


if __name__ == "__main__":
    unittest.main()

import importlib.util
import unittest
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "extract_cn_shares",
    ROOT / "scripts" / "extract-cn-shares.py",
)
assert SPEC and SPEC.loader
extract_cn_shares = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(extract_cn_shares)


class CnSharesExtractionTests(unittest.TestCase):
    def test_uses_explicit_outstanding_share_field(self):
        frame = pd.DataFrame(
            {
                "date": [
                    "2023-12-28",
                    "2023-12-29",
                    "2024-03-28",
                    "2024-03-29",
                    "2024-06-28",
                ],
                "outstanding_share": [
                    1_000_000_000,
                    1_010_000_000,
                    1_020_000_000,
                    1_030_000_000,
                    1_040_000_000,
                ],
            }
        )

        records = extract_cn_shares.records_from_daily_frame(frame, 2023)
        by_period = {record["periodEnd"]: record["value"] for record in records}

        self.assertEqual(by_period["2023-12-31"], 1_010_000_000)
        self.assertEqual(by_period["2024-03-31"], 1_030_000_000)
        self.assertEqual(by_period["2024-06-30"], 1_040_000_000)
        self.assertIn(
            ("2023-12-31", "FY"),
            {(record["periodEnd"], record["periodType"]) for record in records},
        )
        self.assertFalse(any(record["periodEnd"].startswith("2099") for record in records))

    def test_rejects_balance_sheet_currency_amounts(self):
        frame = pd.DataFrame(
            {
                "报告日": ["20241231"],
                "实收资本(或股本)": [100_000_000_000],
            }
        )

        self.assertEqual(
            extract_cn_shares.records_from_daily_frame(frame, 2020),
            [],
        )


if __name__ == "__main__":
    unittest.main()

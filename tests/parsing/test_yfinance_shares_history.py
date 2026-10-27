import importlib.util
import unittest
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "fetch_us_financials_yf",
    ROOT / "scripts" / "fetch-us-financials-yf.py",
)
assert SPEC and SPEC.loader
fetch_us_financials_yf = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fetch_us_financials_yf)


class FakeTicker:
    def __init__(self, values: dict[str, float]):
        self.values = values

    def get_shares_full(self, **_kwargs):
        return pd.Series(self.values)


class YfinanceSharesHistoryTests(unittest.TestCase):
    def test_fills_missing_fiscal_year_end_from_explicit_share_series(self):
        items = []
        ticker = FakeTicker(
            {
                "2024-12-20 00:00:00": 1_000_000_000,
                "2025-12-18 00:00:00": 990_000_000,
            }
        )

        fetch_us_financials_yf.add_shares_history(
            ticker,
            items,
            ["2024-12-31", "2025-12-31"],
            1.0,
        )

        self.assertEqual(
            {
                (item["periodEnd"], item["value"], item["unit"])
                for item in items
            },
            {
                ("2024-12-31", 1_000_000_000, "shares"),
                ("2025-12-31", 990_000_000, "shares"),
            },
        )

    def test_does_not_use_stale_share_sample(self):
        items = []
        ticker = FakeTicker({"2024-01-15 00:00:00": 1_000_000_000})

        fetch_us_financials_yf.add_shares_history(
            ticker,
            items,
            ["2025-12-31"],
            1.0,
        )

        self.assertEqual(items, [])


if __name__ == "__main__":
    unittest.main()

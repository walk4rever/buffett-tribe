import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "lib"))

from cn_dividend_akshare import (
    build_cn_dividend_records,
    fetch_cn_dividend_records,
    parse_reported_dividend_total,
)


def cninfo_event(
    announcement_date: str,
    payment_date: str | None,
    per_ten_shares: float,
) -> dict[str, object]:
    return {
        "实施方案公告日期": announcement_date,
        "派息日": payment_date,
        "派息比例": per_ten_shares,
    }


def ths_event(
    announcement_date: str,
    per_ten_shares: float,
    total: str,
    status: str = "实施方案",
) -> dict[str, object]:
    return {
        "实施公告日": announcement_date,
        "分红方案说明": f"10派{per_ten_shares}元(含税)",
        "分红总额": total,
        "方案进度": status,
    }


class ReportedTotalParsingTests(unittest.TestCase):
    def test_parses_common_reported_units_without_inventing_precision(self):
        self.assertEqual(parse_reported_dividend_total("346.71亿"), 34_671_000_000)
        self.assertEqual(parse_reported_dividend_total("0.85亿元"), 85_000_000)
        self.assertEqual(parse_reported_dividend_total("34,671,299,522.40元"), 34_671_299_522.4)
        self.assertIsNone(parse_reported_dividend_total("--"))


class AkShareDividendRecordTests(unittest.TestCase):
    def test_fetch_propagates_provider_errors_instead_of_returning_no_dividends(self):
        def failed_provider(**_kwargs):
            raise TimeoutError("AkShare request timed out")

        with self.assertRaisesRegex(TimeoutError, "timed out"):
            fetch_cn_dividend_records(
                "600519",
                2020,
                failed_provider,
                lambda **_kwargs: [],
            )

    def test_fetch_accepts_successful_empty_provider_responses(self):
        class EmptyFrame:
            def to_dict(self, orient: str) -> list[dict[str, object]]:
                if orient != "records":
                    raise AssertionError("expected records orientation")
                return []

        records = fetch_cn_dividend_records(
            "600519",
            2020,
            lambda **_kwargs: EmptyFrame(),
            lambda **_kwargs: EmptyFrame(),
        )

        self.assertEqual(records, [])

    def test_reads_ah_total_column_and_matches_multiple_same_day_dividends(self):
        records = build_cn_dividend_records(
            [
                cninfo_event("2024-04-23", "2024-04-30", 20.11),
                cninfo_event("2024-04-23", "2024-04-30", 30.17),
            ],
            [
                {
                    **ths_event("2024-04-23", 20.11, "--"),
                    "AH分红总额": "88.23亿",
                },
                {
                    **ths_event("2024-04-23", 30.17, "--"),
                    "AH分红总额": "132.37亿",
                },
            ],
            from_year=2020,
            through_year=2024,
        )

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["periodEnd"], "2024-12-31")
        self.assertEqual(records[0]["value"], 22_060_000_000)
        self.assertEqual(records[0]["sourcePrecision"], 2_000_000)

    def test_matches_dividend_rate_after_bonus_share_scheme(self):
        records = build_cn_dividend_records(
            [cninfo_event("2023-04-18", "2023-04-26", 25.2)],
            [
                {
                    "实施公告日": "2023-04-18",
                    "分红方案说明": "10转8股派25.2元(含税)",
                    "方案进度": "实施方案",
                    "AH分红总额": "61.55亿",
                }
            ],
            from_year=2020,
            through_year=2023,
        )

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["periodEnd"], "2023-12-31")
        self.assertEqual(records[0]["value"], 6_155_000_000)

    def test_matches_implemented_events_and_sums_by_actual_payment_year(self):
        records = build_cn_dividend_records(
            [
                cninfo_event("2025-06-20", "2025-06-26", 276.73),
                cninfo_event("2025-12-11", "2025-12-19", 239.57),
            ],
            [
                ths_event("2025-06-20", 276.73, "346.71亿"),
                ths_event("2025-12-11", 239.57, "300.01亿"),
            ],
            from_year=2020,
        )

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["periodEnd"], "2025-12-31")
        self.assertEqual(records[0]["value"], 64_672_000_000)
        self.assertEqual(records[0]["sourcePrecision"], 2_000_000)
        self.assertEqual(records[0]["unit"], "CNY")
        self.assertIn("rounded", records[0]["mappingRule"])

    def test_excludes_unimplemented_proposals(self):
        records = build_cn_dividend_records(
            [cninfo_event("2026-04-17", None, 280.2423)],
            [ths_event("2026-04-17", 280.2423, "--", status="董事会预案")],
            from_year=2020,
        )

        self.assertEqual(records, [])

    def test_keeps_amount_unknown_when_implemented_event_has_no_matching_total(self):
        records = build_cn_dividend_records(
            [cninfo_event("2025-06-20", "2025-06-26", 276.73)],
            [],
            from_year=2020,
        )

        self.assertEqual(len(records), 1)
        self.assertIsNone(records[0]["value"])

    def test_keeps_amount_unknown_when_matching_total_is_ambiguous(self):
        records = build_cn_dividend_records(
            [cninfo_event("2025-06-20", "2025-06-26", 276.73)],
            [
                ths_event("2025-06-20", 276.73, "346.71亿"),
                ths_event("2025-06-20", 276.73, "346.72亿"),
            ],
            from_year=2020,
        )

        self.assertEqual(len(records), 1)
        self.assertIsNone(records[0]["value"])

    def test_deduplicates_repeated_implementation_rows(self):
        event = cninfo_event("2025-06-20", "2025-06-26", 276.73)
        records = build_cn_dividend_records(
            [event, event.copy()],
            [ths_event("2025-06-20", 276.73, "346.71亿")],
            from_year=2020,
        )

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["value"], 34_671_000_000)
        self.assertEqual(records[0]["sourcePrecision"], 1_000_000)

    def test_filters_using_payment_year(self):
        records = build_cn_dividend_records(
            [cninfo_event("2019-12-12", "2019-12-31", 2.0)],
            [ths_event("2019-12-12", 2.0, "0.2亿")],
            from_year=2020,
        )

        self.assertEqual(records, [])

    def test_excludes_incomplete_current_calendar_year(self):
        records = build_cn_dividend_records(
            [cninfo_event("2026-06-20", "2026-06-26", 276.73)],
            [ths_event("2026-06-20", 276.73, "350.33亿")],
            from_year=2020,
            through_year=2025,
        )

        self.assertEqual(records, [])


if __name__ == "__main__":
    unittest.main()

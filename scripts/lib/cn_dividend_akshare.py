"""Normalize implemented A-share dividend events from AkShare datasets."""

from __future__ import annotations

import re
from collections.abc import Callable
from collections import defaultdict
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any


_NUMBER_RE = re.compile(r"[-+]?\d[\d,]*(?:\.\d+)?")
_RATE_RE = re.compile(
    r"(?:每\s*)?10\s*(?:股\s*)?"
    r"(?:(?:送|转(?:增)?)\s*[-+]?\d[\d,]*(?:\.\d+)?\s*股[\s,，]*)*"
    r"派(?:发)?\s*([-+]?\d[\d,]*(?:\.\d+)?)"
)
_MISSING = {"", "--", "-", "nan", "nat", "none", "null"}


def _as_decimal(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        text = str(value).strip().replace(",", "")
        if text.lower() in _MISSING:
            return None
        number = Decimal(text)
    except (InvalidOperation, ValueError):
        return None
    return number if number.is_finite() else None


def _as_date(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if text.lower() in _MISSING:
        return None
    match = re.match(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", text)
    if not match:
        return None
    year, month, day = (int(part) for part in match.groups())
    if not 1 <= month <= 12 or not 1 <= day <= 31:
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


def parse_reported_dividend_total(value: Any) -> int | float | None:
    """Parse AkShare total fields while preserving their displayed precision."""
    parsed = _parse_reported_total(value)
    return parsed[0] if parsed else None


def _parse_reported_total(value: Any) -> tuple[int | float, int | float] | None:
    if isinstance(value, (int, float, Decimal)) and not isinstance(value, bool):
        amount = _as_decimal(value)
        if amount is None or amount < 0:
            return None
        precision = Decimal(1).scaleb(amount.as_tuple().exponent)
        return _to_number(amount), _to_number(precision)
    if value is None:
        return None

    text = str(value).strip().replace(",", "")
    if text.lower() in _MISSING:
        return None
    match = _NUMBER_RE.search(text)
    if not match:
        return None
    amount = _as_decimal(match.group())
    if amount is None or amount < 0:
        return None
    displayed_precision = Decimal(1).scaleb(
        -len(match.group().partition(".")[2]) if "." in match.group() else 0
    )

    unit = text[match.end() :].strip()
    if unit.startswith("亿"):
        multiplier = Decimal(100_000_000)
    elif unit.startswith("万"):
        multiplier = Decimal(10_000)
    elif unit.startswith("元") or not unit:
        multiplier = Decimal(1)
    else:
        return None
    amount *= multiplier
    precision = displayed_precision * multiplier
    return _to_number(amount), _to_number(precision)


def _to_number(value: Decimal | None) -> int | float | None:
    if value is None:
        return None
    if value == value.to_integral_value():
        return int(value)
    return float(value)


def _event_rate(value: Any) -> Decimal | None:
    rate = _as_decimal(value)
    if rate is None:
        return None
    return rate.normalize()


def _scheme_rate(value: Any) -> Decimal | None:
    if value is None:
        return None
    match = _RATE_RE.search(str(value).replace(",", ""))
    return _event_rate(match.group(1)) if match else None


def _implemented_status(value: Any) -> bool:
    status = str(value or "").strip()
    return "实施" in status and "预案" not in status


def _event_total(
    announcement_date: str | None,
    rate: Decimal | None,
    ths_rows: list[dict[str, Any]],
) -> tuple[int | float, int | float] | None:
    if announcement_date is None or rate is None:
        return None
    matches = [
        row
        for row in ths_rows
        if _implemented_status(row.get("方案进度"))
        and _as_date(row.get("实施公告日")) == announcement_date
        and _scheme_rate(row.get("分红方案说明")) == rate
    ]
    if len(matches) != 1:
        return None
    for field in ("分红总额", "AH分红总额"):
        total = _parse_reported_total(matches[0].get(field))
        if total is not None:
            return total
    return None


def build_cn_dividend_records(
    cninfo_rows: list[dict[str, Any]],
    ths_rows: list[dict[str, Any]],
    from_year: int = 2020,
    through_year: int | None = None,
) -> list[dict[str, Any]]:
    """Aggregate matched completed cash dividends by their actual payment year."""
    last_complete_year = through_year if through_year is not None else date.today().year - 1
    unique_events: dict[tuple[str, str, Decimal], dict[str, Any]] = {}
    for row in cninfo_rows:
        payment_date = _as_date(row.get("派息日"))
        announcement_date = _as_date(row.get("实施方案公告日期"))
        rate = _event_rate(row.get("派息比例"))
        if not payment_date or not announcement_date or rate is None or rate <= 0:
            continue
        year = int(payment_date[:4])
        if year < from_year or year > last_complete_year:
            continue
        unique_events[(announcement_date, payment_date, rate)] = row

    by_year: dict[int, list[tuple[int | float, int | float] | None]] = defaultdict(list)
    for (announcement_date, payment_date, rate) in unique_events:
        year = int(payment_date[:4])
        by_year[year].append(_event_total(announcement_date, rate, ths_rows))

    records: list[dict[str, Any]] = []
    for year, totals in sorted(by_year.items()):
        complete = all(total is not None for total in totals)
        source_precision = (
            sum(total[1] for total in totals if total is not None) if complete else None
        )
        records.append(
            {
                "periodEnd": f"{year}-12-31",
                "periodType": "FY",
                "lineItem": "DividendsPaid",
                "value": sum(total[0] for total in totals if total is not None)
                if complete
                else None,
                "unit": "CNY",
                "mappingRule": "akshare:cninfo-payment-date+ths-implemented-total-rounded",
                "confidence": 0.8,
                "sourcePrecision": source_precision,
            }
        )
    return records


def fetch_cn_dividend_records(
    code: str,
    from_year: int,
    cninfo_fetcher: Callable[..., Any],
    ths_fetcher: Callable[..., Any],
) -> list[dict[str, Any]]:
    """Fetch both AkShare sources and normalize their dividend records.

    Provider errors deliberately propagate so callers cannot mistake a failed
    request for a company with no dividends.
    """
    cninfo_df = cninfo_fetcher(symbol=code)
    ths_df = ths_fetcher(symbol=code)
    return build_cn_dividend_records(
        cninfo_df.to_dict(orient="records"),
        ths_df.to_dict(orient="records"),
        from_year=from_year,
    )

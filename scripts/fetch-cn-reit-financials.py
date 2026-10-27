#!/usr/bin/env python3
"""Fetch core annual financial facts for CN exchange-listed REIT funds.

The regular A-share statement endpoint does not cover these units.  Their
annual reports still contain a stable set of fund-level summary rows, so this
adapter extracts only values that can be identified directly from the report.
Unknown or ambiguous values are omitted instead of inferred.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

import fitz
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from cn_reit_announcements import find_cn_reit_annual_reports

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
NUMBER = r"[-−]?[\d,]+(?:\.\d+)?"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch and import CN REIT annual financials")
    parser.add_argument("--code", required=True)
    parser.add_argument("--ticker", required=True)
    parser.add_argument("--market", default="cn", choices=["cn"])
    parser.add_argument("--currency", default="CNY", choices=["CNY"])
    parser.add_argument("--from-year", type=int, default=2020)
    parser.add_argument("--out-dir", default="/tmp/cn-reit-financials")
    parser.add_argument("--import-db", action="store_true")
    parser.add_argument("--batch-id", help="Optional rollback batch tag for --import-db")
    return parser.parse_args()


def clean_number(raw: str | None) -> float | None:
    if raw is None:
        return None
    value = raw.replace(",", "").replace("−", "-")
    try:
        return float(value)
    except ValueError:
        return None


def first_number(text: str, labels: list[str]) -> float | None:
    for label in labels:
        # Allow PDF line breaks between characters of a wrapped label, but do
        # not remove whitespace between adjacent numbers: doing that turns
        # 142,324,217.65 / 162,730,347.50 into one corrupted value.
        label_pattern = r"\s*".join(re.escape(char) for char in label)
        match = re.search(label_pattern, text)
        if not match:
            continue
        # A label is often followed by a note reference such as 11.5.7.23.1
        # before the actual amount. Only accept a currency-like amount (with
        # thousands separators) or a number of a plausible monetary magnitude.
        tail = text[match.end() : match.end() + 240]
        for token in re.finditer(NUMBER, tail):
            raw = token.group(0)
            value = clean_number(raw)
            if value is None:
                continue
            if "," in raw or abs(value) >= 1000:
                return value
    return None


def amount_from_following_lines(text: str, labels: list[str]) -> float | None:
    """Read a standalone amount on the next few lines after a statement label.

    PDF extraction often puts XBRL/note references such as 11.5.7.23.2 between
    the label and amount. Looking only for a comma-formatted amount line avoids
    concatenating the trailing note number with the actual value.
    """
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for index, line in enumerate(lines):
        if not any(label in line for label in labels):
            continue
        for candidate in lines[index + 1 : index + 10]:
            if re.fullmatch(NUMBER, candidate) and "," in candidate:
                return clean_number(candidate)
    return None


def balance_sheet_amount(text: str, labels: list[str]) -> float | None:
    """Read a balance-sheet amount, treating an explicit dash as zero.

    The first matching summary table is used. A dash is only accepted when it
    appears immediately after the requested label; unrelated dashes deeper in
    the table are ignored.
    """
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for index, line in enumerate(lines):
        label = next((candidate for candidate in labels if candidate in line), None)
        if not label:
            continue
        candidates = [line.split(label, 1)[1].strip(), *lines[index + 1 : index + 8]]
        for candidate in candidates:
            if re.fullmatch(r"[-−]", candidate):
                return 0.0
            for match in re.finditer(NUMBER, candidate):
                raw = match.group(0)
                value = clean_number(raw)
                if value is None:
                    continue
                if "," in raw or abs(value) >= 1000:
                    return value
    return None


def note_referenced_amount(text: str, label: str, note: str) -> float | None:
    """Read the first statement amount tied to a specific note reference."""
    pattern = (
        re.escape(label)
        + r"\s*"
        + re.escape(note)
        + r"\s*("
        + NUMBER
        + ")"
    )
    match = re.search(pattern, text)
    return clean_number(match.group(1)) if match else None


def sum_label_numbers(text: str, label: str) -> float | None:
    """Sum repeated project-company rows for the current reporting period."""
    compact = re.sub(r"\s+", "", text)
    values: list[float] = []
    for match in re.finditer(rf"{re.escape(label)}({NUMBER})", compact):
        value = clean_number(match.group(1))
        if value is not None:
            values.append(value)
    return round(sum(values), 2) if values else None


def extract_report_financials(pdf_path: Path, year: int) -> list[dict]:
    with fitz.open(str(pdf_path)) as document:
        text = "\n".join(page.get_text() for page in document)
    compact = re.sub(r"\s+", "", text)

    revenue = first_number(text, ["本期收入", "本期营业收入", "一、营业总收入"])
    net_income = first_number(text, ["本期净利润", "五、净利润"])
    ocf = first_number(text, ["本期经营活动产生的现金流量净额"])
    total_assets = first_number(text, ["期末不动产基金总资产", "资产总计"])
    net_assets = first_number(text, ["期末不动产基金净资产", "所有者权益合计"])
    cash = amount_from_following_lines(
        text,
        ["六、期末现金及现金等价物余额", "期末现金及现金等价物余额"],
    )
    shares = first_number(text, ["基金份额总额"])
    if shares is None:
        match = re.search(rf"注.*?基金份额总额({NUMBER})份", compact)
        if match:
            shares = clean_number(match.group(1))
    distribution = first_number(text, ["分配支付的现金", "本期实际分配金额"])
    capex = first_number(
        text,
        [
            "购建固定资产、无形资产和其他长期资产支付的现金",
        ],
    )
    contract_liabilities = amount_from_following_lines(text, ["合同负债"])
    investment_property = note_referenced_amount(
        text,
        "投资性房地产",
        "11.5.7.3",
    )
    short_term_debt = balance_sheet_amount(text, ["短期借款"])
    long_term_debt = balance_sheet_amount(text, ["长期借款"])

    records: list[dict] = []

    def add(line_item: str, value: float | None, unit: str = "CNY") -> None:
        if value is None:
            return
        records.append(
            {
                "periodEnd": f"{year}-12-31",
                "periodType": "FY",
                "lineItem": line_item,
                "value": value,
                "unit": unit,
                "mappingRule": "cn-reit-annual:direct",
                "confidence": 1,
            }
        )

    add("Revenue", revenue)
    add("NetIncome", net_income)
    add("OperatingCashFlow", ocf)
    add("TotalAssets", total_assets)
    add("ShareholdersEquity", net_assets)
    add("TotalEquity", net_assets)
    if total_assets is not None and net_assets is not None:
        add("TotalLiabilities", round(total_assets - net_assets, 2))
    add("CashAndCashEquivalents", cash)
    add("CommonStockSharesOutstanding", shares, "shares")
    add("WeightedAverageSharesDiluted", shares, "shares")
    add("DividendsPaid", distribution)
    add("CapEx", capex)
    add("ContractLiabilities", contract_liabilities)
    add("InvestmentProperty", investment_property)
    add("ShortTermDebt", short_term_debt)
    add("LongTermDebt", long_term_debt)
    if net_income is not None and shares:
        add("EPSBasic", round(net_income / shares, 6), "CNY/shares")
        add("EPSDiluted", round(net_income / shares, 6), "CNY/shares")

    return records


def main() -> int:
    args = parse_args()
    reports = find_cn_reit_annual_reports(args.code, args.from_year)
    if not reports:
        print(f"No REIT annual reports found for {args.code}", file=sys.stderr)
        return 1

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    all_records: list[dict] = []
    for report in reports:
        pdf_path = out_dir / f"{args.code}_{report['periodYear']}.pdf"
        if not pdf_path.exists() or pdf_path.stat().st_size == 0:
            response = requests.get(
                report["url"],
                headers={"User-Agent": USER_AGENT},
                timeout=90,
            )
            response.raise_for_status()
            pdf_path.write_bytes(response.content)
        records = extract_report_financials(pdf_path, report["periodYear"])
        all_records.extend(records)
        print(
            f"FY{report['periodYear']}: extracted {len(records)} financial facts",
            file=sys.stderr,
        )

    if not all_records:
        print(f"No financial facts extracted for {args.code}", file=sys.stderr)
        return 1

    json_path = out_dir / f"{args.code}.json"
    json_path.write_text(
        json.dumps(all_records, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Wrote {len(all_records)} records to {json_path}")

    if args.import_db:
        command = [
            "node",
            "--env-file=.env.local",
            "./node_modules/.bin/tsx",
            "scripts/import-cn-hk-financials-from-file.ts",
            str(json_path),
            "--ticker",
            args.ticker,
            "--code",
            args.code,
            "--market",
            args.market,
            "--currency",
            args.currency,
        ]
        if args.batch_id:
            command.extend(["--batch-id", args.batch_id])
        subprocess.run(command, check=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

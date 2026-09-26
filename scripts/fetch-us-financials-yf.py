#!/usr/bin/env python3
"""
Fetch US company financial statements from yfinance for companies that lack
XBRL 10-K/10-Q in SEC CompanyFacts (e.g. Foreign Private Issuers, recent IPOs).

Outputs structured JSON with normalized lineItems matching Buffett Tribe Financial schema.

Usage:
    .venv/bin/python scripts/fetch-us-financials-yf.py --ticker BSP
    .venv/bin/python scripts/fetch-us-financials-yf.py --ticker BSP --out-file /tmp/bsp-fin.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
import yfinance as yf


MAPPING_INCOME = {
    "Total Revenue": "Revenue",
    "Operating Revenue": "Revenue",
    "Cost Of Revenue": "CostOfRevenue",
    "Reconciled Cost Of Revenue": "CostOfRevenue",
    "Gross Profit": "GrossProfit",
    "Operating Income": "OperatingIncome",
    "Total Operating Income As Reported": "OperatingIncome",
    "Net Income": "NetIncome",
    "Net Income Common Stockholders": "NetIncome",
    "Net Income From Continuing Operation Net Minority Interest": "NetIncome",
    "Diluted EPS": "DilutedEPS",
    "Basic EPS": "BasicEPS",
}

MAPPING_BALANCE_SHEET = {
    "Total Assets": "TotalAssets",
    "Current Assets": "CurrentAssets",
    "Current Liabilities": "CurrentLiabilities",
    "Total Liabilities Net Minority Interest": "TotalLiabilities",
    "Total Non Current Liabilities Net Minority Interest": "TotalNonCurrentLiabilities",
    "Stockholders Equity": "StockholdersEquity",
    "Common Stock Equity": "StockholdersEquity",
    "Cash And Cash Equivalents": "CashAndCashEquivalents",
    "Cash Cash Equivalents And Short Term Investments": "CashAndCashEquivalents",
    "Working Capital": "WorkingCapital",
    "Total Debt": "TotalDebt",
    "Net Debt": "NetDebt",
}

MAPPING_CASH_FLOW = {
    "Operating Cash Flow": "OperatingCashFlow",
    "Cash Flow From Continuing Operating Activities": "OperatingCashFlow",
    "Capital Expenditure": "CapEx",
    "Free Cash Flow": "FreeCashFlow",
}


def process_df(df, ptype: str, mapping: dict[str, str], currency: str, items: list[dict]):
    if df is None or df.empty:
        return
    for col in df.columns:
        date_str = str(col)[:10]
        period_type = ptype
        if ptype == "Q":
            month = getattr(col, "month", 0)
            if month in (1, 2, 3):
                period_type = "Q1"
            elif month in (4, 5, 6):
                period_type = "Q2"
            elif month in (7, 8, 9):
                period_type = "Q3"
            else:
                period_type = "Q4"

        seen_targets = set()
        for orig_key, target_item in mapping.items():
            if target_item in seen_targets:
                continue
            if orig_key in df.index:
                val = df.loc[orig_key, col]
                if val is not None and str(val) != "nan":
                    try:
                        fval = float(val)
                        seen_targets.add(target_item)
                        items.append({
                            "periodEnd": date_str,
                            "periodType": period_type,
                            "lineItem": target_item,
                            "value": fval,
                            "unit": currency,
                        })
                    except (ValueError, TypeError):
                        pass


def fetch_financials(ticker: str) -> dict:
    t = yf.Ticker(ticker)
    info = getattr(t, "info", {}) or {}
    currency = info.get("financialCurrency") or info.get("currency") or "USD"

    items: list[dict] = []

    # Annual
    process_df(t.financials, "FY", MAPPING_INCOME, currency, items)
    process_df(t.balance_sheet, "FY", MAPPING_BALANCE_SHEET, currency, items)
    process_df(t.cashflow, "FY", MAPPING_CASH_FLOW, currency, items)

    # Quarterly
    process_df(t.quarterly_financials, "Q", MAPPING_INCOME, currency, items)
    process_df(t.quarterly_balance_sheet, "Q", MAPPING_BALANCE_SHEET, currency, items)
    process_df(t.quarterly_cashflow, "Q", MAPPING_CASH_FLOW, currency, items)

    return {
        "ticker": ticker.upper(),
        "currency": currency,
        "records": items,
    }


def main():
    parser = argparse.ArgumentParser(description="Fetch US financials from yfinance.")
    parser.add_argument("--ticker", required=True, help="Stock ticker (e.g. BSP)")
    parser.add_argument("--out-file", help="Path to write JSON output")
    args = parser.parse_args()

    data = fetch_financials(args.ticker)

    if args.out_file:
        out_path = Path(args.out_file)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        print(f"Wrote {len(data['records'])} records to {args.out_file}")
    else:
        print(json.dumps(data))


if __name__ == "__main__":
    main()

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
import re
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
    "Diluted EPS": "EPSDiluted",
    "Basic EPS": "EPSBasic",
    "Diluted Average Shares": "WeightedAverageSharesDiluted",
    "Basic Average Shares": "WeightedAverageShares",
}

MAPPING_BALANCE_SHEET = {
    "Total Assets": "TotalAssets",
    "Current Assets": "TotalCurrentAssets",
    "Current Liabilities": "TotalCurrentLiabilities",
    "Total Liabilities Net Minority Interest": "TotalLiabilities",
    "Total Non Current Liabilities Net Minority Interest": "TotalNonCurrentLiabilities",
    "Stockholders Equity": "ShareholdersEquity",
    "Common Stock Equity": "ShareholdersEquity",
    "Cash And Cash Equivalents": "CashAndCashEquivalents",
    "Cash Cash Equivalents And Short Term Investments": "CashAndCashEquivalents",
    "Working Capital": "WorkingCapital",
    "Total Debt": "TotalDebt",
    "Net Debt": "NetDebt",
    "Ordinary Shares Number": "CommonStockSharesOutstanding",
    "Share Issued": "CommonStockSharesOutstanding",
}

MAPPING_CASH_FLOW = {
    "Operating Cash Flow": "OperatingCashFlow",
    "Cash Flow From Continuing Operating Activities": "OperatingCashFlow",
    "Capital Expenditure": "CapEx",
    "Free Cash Flow": "FreeCashFlow",
    "Cash Dividends Paid": "DividendsPaid",
    "Dividends Paid": "DividendsPaid",
    "Common Stock Dividend Paid": "DividendsPaid",
    "Repurchase Of Capital Stock": "ShareRepurchaseAmt",
    "Net Business Purchase And Sale": "PurchaseSaleOfBusinessNet",
}

SHARE_ITEMS = {
    "CommonStockSharesOutstanding",
    "WeightedAverageSharesDiluted",
    "WeightedAverageShares",
}

PER_SHARE_ITEMS = {
    "EPSDiluted",
    "EPSBasic",
}

ADR_CANDIDATES = [0.1, 0.2, 0.25, 0.5, 1.0, 2.0, 3.0, 4.0, 5.0, 8.0, 10.0, 20.0]


def detect_adr_factor(info: dict, ordinary_shares: float | None) -> float:
    if not ordinary_shares or ordinary_shares <= 0:
        return 1.0
    adr_shares = info.get("sharesOutstanding")
    if not adr_shares or adr_shares <= 0:
        return 1.0
    try:
        raw_ratio = float(adr_shares) / float(ordinary_shares)
    except (ZeroDivisionError, ValueError):
        return 1.0

    best_cand = 1.0
    min_err = float("inf")
    for cand in ADR_CANDIDATES:
        err = abs(raw_ratio - cand) / cand
        if err < min_err:
            min_err = err
            best_cand = cand

    if min_err <= 0.05:
        return best_cand
    return 1.0


def process_df(
    df,
    ptype: str,
    mapping: dict[str, str],
    currency: str,
    adr_factor: float,
    items: list[dict],
):
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

                        # Adjust signs
                        if target_item == "ShareRepurchaseAmt":
                            fval = abs(fval)
                        elif target_item == "PurchaseSaleOfBusinessNet":
                            # yfinance net business purchase and sale is negative for net acquisition outflow;
                            # we canonicalize positive = net cash acquisition outflow
                            fval = -fval

                        # Adjust ADR ratio if applicable
                        if adr_factor != 1.0:
                            if target_item in SHARE_ITEMS:
                                fval = fval * adr_factor
                            elif target_item in PER_SHARE_ITEMS:
                                fval = fval / adr_factor

                        # Assign unit
                        if target_item in SHARE_ITEMS:
                            unit = "shares"
                        elif target_item in PER_SHARE_ITEMS:
                            unit = f"{currency}/shares" if currency else "USD/shares"
                        else:
                            unit = currency if currency else "USD"

                        items.append({
                            "periodEnd": date_str,
                            "periodType": period_type,
                            "lineItem": target_item,
                            "value": fval,
                            "unit": unit,
                        })
                    except (ValueError, TypeError):
                        pass


def fetch_financials(ticker: str) -> dict:
    t = yf.Ticker(ticker)
    info = getattr(t, "info", {}) or {}
    currency_value = info.get("financialCurrency") or info.get("currency")
    currency = str(currency_value).strip().upper() if currency_value else ""
    if not re.fullmatch(r"[A-Z]{3}", currency):
        currency = "USD"

    # Detect ordinary shares for ADR factor detection
    ordinary_shares = None
    for bs in [t.balance_sheet, t.quarterly_balance_sheet]:
        if bs is not None and not bs.empty:
            for k in ["Ordinary Shares Number", "Share Issued"]:
                if k in bs.index:
                    row_vals = bs.loc[k].dropna()
                    if len(row_vals) > 0:
                        try:
                            val = float(row_vals.iloc[0])
                            if val > 0:
                                ordinary_shares = val
                                break
                        except (ValueError, TypeError):
                            pass
            if ordinary_shares:
                break

    adr_factor = detect_adr_factor(info, ordinary_shares)

    items: list[dict] = []

    # Annual
    process_df(t.financials, "FY", MAPPING_INCOME, currency, adr_factor, items)
    process_df(t.balance_sheet, "FY", MAPPING_BALANCE_SHEET, currency, adr_factor, items)
    process_df(t.cashflow, "FY", MAPPING_CASH_FLOW, currency, adr_factor, items)

    # Quarterly
    process_df(t.quarterly_financials, "Q", MAPPING_INCOME, currency, adr_factor, items)
    process_df(t.quarterly_balance_sheet, "Q", MAPPING_BALANCE_SHEET, currency, adr_factor, items)
    process_df(t.quarterly_cashflow, "Q", MAPPING_CASH_FLOW, currency, adr_factor, items)

    return {
        "ticker": ticker.upper(),
        "currency": currency,
        "adrFactor": adr_factor,
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

#!/usr/bin/env python3

"""Fetch A-share/HK-share company profile (name, exchange, raw industry) via
akshare and optionally import into the database.

Usage:
  .venv/bin/python scripts/fetch-cn-hk-company-profile-ak.py --code 600900 --market cn --import-db
  .venv/bin/python scripts/fetch-cn-hk-company-profile-ak.py --code 09992 --market hk --out-dir /tmp/foo

Mirrors the two-stage shape of fetch-cn-hk-financials-ak.py: this script does
the akshare fetch + field mapping and writes a normalized JSON file, then
(with --import-db) shells out to
scripts/import-cn-hk-company-profile-from-file.ts to do the actual Prisma
write (that script also does the LLM sector classification — kept out of
Python so it shares the same DeepSeek call plumbing as
scripts/lib/company-name-zh.ts instead of duplicating it here).

Verified against two real companies before writing this mapping (not
speculative): 长江电力 (600900, CN) and 泡泡玛特 (09992, HK) — every field
below matched the pre-existing hand-typed scripts/lib/cn-hk-company-seeds.ts
entry for canonicalName/nameZh/nameEnShort/exchange exactly.

CN via ak.stock_profile_cninfo(symbol=code):
  公司名称 -> canonicalName ("中国长江电力股份有限公司")
  英文名称 -> nameEnShort ("China Yangtze Power Co., Ltd.")
  A股简称 -> nameZh ("长江电力")
  所属市场 -> exchange, via CN_EXCHANGE_MAP ("上交所" -> "上海证券交易所")
  所属行业 -> industryRaw ("电力、热力生产和供应业")

HK needs two calls (neither alone has every field):
  ak.stock_hk_security_profile_em(symbol=code):
    证券简称 -> nameZh ("泡泡玛特")
    交易所   -> exchange ("香港交易所")
  ak.stock_hk_company_profile_em(symbol=code):
    英文名称 -> canonicalName ("POP MART INTERNATIONAL GROUP LIMITED")
    所属行业 -> industryRaw ("家庭电器及用品")
    公司介绍 -> businessDescription (context for the LLM sector classifier
                only — not persisted as its own field, US companies don't
                have an equivalent stored either)

currency is deliberately NOT fetched here — akshare exposes no currency
field on either market's profile or financial-statement endpoints (checked
both), and see scripts/lib/cn-hk-currency-resolve.ts for how it's resolved
instead (CN: hardcoded CNY, a regulatory fact, not a per-company guess; HK:
extracted from the annual report text after it's downloaded, so it can't
run this early in the pipeline).

Known environment snag: a *different* candidate function,
ak.stock_individual_info_em() (wraps push2.eastmoney.com's realtime quote
endpoint), reliably fails with a connection reset in this repo's .venv
(Python 3.14 / requests 2.34.2 / urllib3 2.7.0) as soon as `import akshare`
has run in the process — even a plain requests.get() to the same host
breaks afterward, while it works fine before the import. Root cause not
chased down; stock_profile_cninfo/stock_hk_*_profile_em above use different
hosts (cninfo.com.cn / a different eastmoney endpoint) and were verified
unaffected in the same session. Don't reach for stock_individual_info_em
without re-checking this.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import akshare as ak
import pandas as pd

CN_EXCHANGE_MAP: dict[str, str] = {
    "上交所": "上海证券交易所",
    "深交所": "深圳证券交易所",
    "北交所": "北京证券交易所",
}


def map_cn_exchange(raw_market: str | None) -> str | None:
    """所属市场 isn't always the bare exchange name — Shenzhen board tiers
    come back qualified (e.g. "深交所主板"/"深交所创业板", verified against
    000858/300750), while Shanghai so far has only been seen bare ("上交所").
    Prefix match instead of exact match so board-tier suffixes don't fall
    through to the raw (unmapped) string."""
    if not raw_market:
        return raw_market
    for prefix, full_name in CN_EXCHANGE_MAP.items():
        if raw_market.startswith(prefix):
            return full_name
    return raw_market


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch CN/HK company profile (name/exchange/industry) via akshare and optionally import into the database."
    )
    parser.add_argument("--code", required=True, help="Exchange code, e.g. 09992 (hk) or 600900 (cn)")
    parser.add_argument("--market", required=True, choices=["cn", "hk"], help="cn or hk")
    parser.add_argument("--ticker", default=None, help="Entity.ticker to resolve, e.g. 9992.HK (defaults to derived from --code/--market)")
    parser.add_argument("--out-dir", default="/tmp/cn-hk-company-profile-ak", help="Directory for the generated JSON fixture")
    parser.add_argument("--import-db", action="store_true", help="Import the generated JSON into the database after fetching")
    parser.add_argument("--keep-file", action="store_true", help="Keep the generated JSON instead of deleting it after import")
    return parser.parse_args()


def clean_str(value: object) -> str | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    text = str(value).strip()
    return text or None


def clean_cn_name(value: object) -> str | None:
    """Like clean_str, but also strips internal whitespace — cninfo's 公司名称/
    A股简称 fields sometimes have stray full/half-width spaces between every
    character (e.g. 五粮液 000858 returns "五 粮 液" from A股简称), which is
    display noise, not a legitimate multi-word Chinese name. Only for
    guaranteed-Chinese fields; nameEnShort legitimately needs its spaces."""
    text = clean_str(value)
    if text is None:
        return None
    stripped = text.replace(" ", "").replace("　", "")
    return stripped or None


def fetch_cn_profile(code: str) -> dict[str, str | None]:
    df = ak.stock_profile_cninfo(symbol=code)
    if df.empty:
        raise RuntimeError(f"stock_profile_cninfo returned no rows for {code}")
    row = df.iloc[0]
    raw_market = clean_str(row.get("所属市场"))
    return {
        "canonicalName": clean_cn_name(row.get("公司名称")),
        "nameZh": clean_cn_name(row.get("A股简称")),
        "nameEnShort": clean_str(row.get("英文名称")),
        "exchange": map_cn_exchange(raw_market),
        "industryRaw": clean_str(row.get("所属行业")),
        "businessDescription": clean_str(row.get("主营业务")),
    }


def fetch_hk_profile(code: str) -> dict[str, str | None]:
    security_df = ak.stock_hk_security_profile_em(symbol=code)
    company_df = ak.stock_hk_company_profile_em(symbol=code)
    if security_df.empty:
        raise RuntimeError(f"stock_hk_security_profile_em returned no rows for {code}")
    if company_df.empty:
        raise RuntimeError(f"stock_hk_company_profile_em returned no rows for {code}")
    security_row = security_df.iloc[0]
    company_row = company_df.iloc[0]
    return {
        "canonicalName": clean_str(company_row.get("英文名称")),
        "nameZh": clean_cn_name(security_row.get("证券简称")),
        "nameEnShort": clean_str(company_row.get("英文名称")),
        "exchange": clean_str(security_row.get("交易所")),
        "industryRaw": clean_str(company_row.get("所属行业")),
        "businessDescription": clean_str(company_row.get("公司介绍")),
    }


def write_output(out_dir: Path, code: str, profile: dict[str, str | None]) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / f"{code}.json"
    json_path.write_text(json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8")
    return json_path


def import_into_db(json_path: Path, ticker: str, code: str, market: str) -> None:
    cmd = [
        "node",
        "--env-file=.env.local",
        "./node_modules/.bin/tsx",
        "scripts/import-cn-hk-company-profile-from-file.ts",
        str(json_path),
        "--ticker", ticker,
        "--code", code,
        "--market", market,
    ]
    subprocess.run(cmd, check=True)


def main() -> int:
    args = parse_args()

    if args.market == "cn":
        ticker = args.ticker or f"{args.code}.SS"
        print(f"Fetching CN company profile for {args.code} ({ticker})...")
        profile = fetch_cn_profile(args.code)
    else:
        ticker = args.ticker or f"{args.code.lstrip('0') or '0'}.HK"
        print(f"Fetching HK company profile for {args.code} ({ticker})...")
        profile = fetch_hk_profile(args.code)

    required = ["canonicalName", "nameZh", "exchange"]
    missing = [field for field in required if not profile.get(field)]
    if missing:
        print(f"ERROR: {args.code}: required profile fields missing from akshare response: {missing}", file=sys.stderr)
        return 1

    out_dir = Path(args.out_dir)
    json_path = write_output(out_dir, args.code, profile)
    print(f"  wrote {json_path}")
    print(f"  canonicalName={profile['canonicalName']!r} nameZh={profile['nameZh']!r} exchange={profile['exchange']!r}")

    if args.import_db:
        print("  importing into database...")
        import_into_db(json_path, ticker, args.code, args.market)
        if not args.keep_file:
            json_path.unlink(missing_ok=True)
            try:
                out_dir.rmdir()
            except OSError:
                pass

    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

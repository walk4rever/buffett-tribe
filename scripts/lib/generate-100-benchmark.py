import asyncio
import json
import os
import urllib.parse
from playwright.async_api import async_playwright

# Load existing 30 companies
with open('scripts/lib/morningstar-benchmark-suite.json', 'r') as f:
    existing_suite = json.load(f)

existing_tickers = {c['ticker']: c for c in existing_suite}
print(f"Loaded {len(existing_suite)} existing benchmark companies.")

# Target 100 benchmark list
# Group 1: US 10-K (Total ~38)
# Group 2: US 20-F / 40-F (Total ~16)
# Group 3: CN A-Shares (Total ~26)
# Group 4: HK Stocks (Total ~20)

new_us_targets = [
    # US 10-K
    {"ticker": "GOOGL", "name": "Alphabet Inc.", "market": "us", "form": "10-K", "cik": "0001652044", "category": "US 10-K Tech / Cloud / AI"},
    {"ticker": "AMZN", "name": "Amazon.com, Inc.", "market": "us", "form": "10-K", "cik": "0001018724", "category": "US 10-K Cloud / E-Commerce / Logistics"},
    {"ticker": "META", "name": "Meta Platforms, Inc.", "market": "us", "form": "10-K", "cik": "0001326801", "category": "US 10-K Digital Advertising / Social"},
    {"ticker": "TSLA", "name": "Tesla, Inc.", "market": "us", "form": "10-K", "cik": "0001318605", "category": "US 10-K EV / Clean Energy / Tech"},
    {"ticker": "JNJ", "name": "Johnson & Johnson", "market": "us", "form": "10-K", "cik": "0000200406", "category": "US 10-K Healthcare / Pharma"},
    {"ticker": "PG", "name": "The Procter & Gamble Company", "market": "us", "form": "10-K", "cik": "0000080424", "category": "US 10-K Consumer Staples"},
    {"ticker": "UNH", "name": "UnitedHealth Group Incorporated", "market": "us", "form": "10-K", "cik": "0000731766", "category": "US 10-K Managed Healthcare"},
    {"ticker": "HD", "name": "The Home Depot, Inc.", "market": "us", "form": "10-K", "cik": "0000354950", "category": "US 10-K Home Improvement Retail"},
    {"ticker": "LLY", "name": "Eli Lilly and Company", "market": "us", "form": "10-K", "cik": "0000059478", "category": "US 10-K Healthcare / Biotechnology"},
    {"ticker": "ABBV", "name": "AbbVie Inc.", "market": "us", "form": "10-K", "cik": "0001551152", "category": "US 10-K Healthcare / BioPharma"},
    {"ticker": "MRK", "name": "Merck & Co., Inc.", "market": "us", "form": "10-K", "cik": "0000064978", "category": "US 10-K Healthcare / Oncology"},
    {"ticker": "PEP", "name": "PepsiCo, Inc.", "market": "us", "form": "10-K", "cik": "0000077476", "category": "US 10-K Consumer Beverages / Snacks"},
    {"ticker": "CVX", "name": "Chevron Corporation", "market": "us", "form": "10-K", "cik": "0000093410", "category": "US 10-K Integrated Energy"},
    {"ticker": "XOM", "name": "Exxon Mobil Corporation", "market": "us", "form": "10-K", "cik": "0000034088", "category": "US 10-K Integrated Energy / Petrochemical"},
    {"ticker": "WMT", "name": "Walmart Inc.", "market": "us", "form": "10-K", "cik": "0000104169", "category": "US 10-K Global Retail"},
    {"ticker": "COST", "name": "Costco Wholesale Corporation", "market": "us", "form": "10-K", "cik": "0000909832", "category": "US 10-K Membership Warehouse Club"},
    {"ticker": "BAC", "name": "Bank of America Corporation", "market": "us", "form": "10-K", "cik": "0000070858", "category": "US 10-K Mega Commercial Bank"},
    {"ticker": "WFC", "name": "Wells Fargo & Company", "market": "us", "form": "10-K", "cik": "0000072971", "category": "US 10-K Diversified Financial Services / Bank"},
    {"ticker": "MS", "name": "Morgan Stanley", "market": "us", "form": "10-K", "cik": "0000895421", "category": "US 10-K Global Investment Bank / Wealth"},
    {"ticker": "GS", "name": "The Goldman Sachs Group, Inc.", "market": "us", "form": "10-K", "cik": "0000886982", "category": "US 10-K Investment Banking / Trading"},
    {"ticker": "CAT", "name": "Caterpillar Inc.", "market": "us", "form": "10-K", "cik": "0000018230", "category": "US 10-K Heavy Machinery / Industrials"},
    {"ticker": "GE", "name": "General Electric Company", "market": "us", "form": "10-K", "cik": "0000040545", "category": "US 10-K Aerospace / Defense / Energy"},
    {"ticker": "V", "name": "Visa Inc.", "market": "us", "form": "10-K", "cik": "0001403161", "category": "US 10-K Global Payment Network"},
    {"ticker": "MA", "name": "Mastercard Incorporated", "market": "us", "form": "10-K", "cik": "0001141391", "category": "US 10-K Global Payment Network"},
    {"ticker": "MCD", "name": "McDonald's Corporation", "market": "us", "form": "10-K", "cik": "0000063908", "category": "US 10-K Global Quick Service Restaurant Franchise"},
    {"ticker": "INTC", "name": "Intel Corporation", "market": "us", "form": "10-K", "cik": "0000050863", "category": "US 10-K Semiconductor / IDM"},
    {"ticker": "CSCO", "name": "Cisco Systems, Inc.", "market": "us", "form": "10-K", "cik": "0000858877", "category": "US 10-K Networking Equipment"},
    {"ticker": "NFLX", "name": "Netflix, Inc.", "market": "us", "form": "10-K", "cik": "0001065280", "category": "US 10-K Streaming Media"},
    {"ticker": "ABT", "name": "Abbott Laboratories", "market": "us", "form": "10-K", "cik": "0000001800", "category": "US 10-K Healthcare Devices / Diagnostics"},
    {"ticker": "ORCL", "name": "Oracle Corporation", "market": "us", "form": "10-K", "cik": "0001341439", "category": "US 10-K Enterprise Database / Cloud"},
    {"ticker": "CRM", "name": "Salesforce, Inc.", "market": "us", "form": "10-K", "cik": "0001108524", "category": "US 10-K SaaS / Enterprise CRM"},
    {"ticker": "PFE", "name": "Pfizer Inc.", "market": "us", "form": "10-K", "cik": "0000078003", "category": "US 10-K Biopharma / Vaccines"},

    # US 20-F / 40-F
    {"ticker": "PDD", "name": "PDD Holdings Inc.", "market": "us", "form": "20-F", "cik": "0001737806", "reportingCurrency": "CNY", "category": "US 20-F E-Commerce / Consumer Tech"},
    {"ticker": "JD", "name": "JD.com, Inc.", "market": "us", "form": "20-F", "cik": "0001549802", "reportingCurrency": "CNY", "category": "US 20-F Supply Chain / E-Commerce"},
    {"ticker": "NTES", "name": "NetEase, Inc.", "market": "us", "form": "20-F", "cik": "0001110646", "reportingCurrency": "CNY", "category": "US 20-F Online Gaming / Digital Media"},
    {"ticker": "BIDU", "name": "Baidu, Inc.", "market": "us", "form": "20-F", "cik": "0001329099", "reportingCurrency": "CNY", "category": "US 20-F AI / Search / Autonomous Driving"},
    {"ticker": "SE", "name": "Sea Limited", "market": "us", "form": "20-F", "cik": "0001703344", "reportingCurrency": "USD", "category": "US 20-F Southeast Asia Gaming / E-Commerce"},
    {"ticker": "AZN", "name": "AstraZeneca PLC", "market": "us", "form": "20-F", "cik": "0001071494", "reportingCurrency": "USD", "category": "US 20-F Biopharma / Oncology"},
    {"ticker": "SAP", "name": "SAP SE", "market": "us", "form": "20-F", "cik": "0001000184", "reportingCurrency": "EUR", "category": "US 20-F Enterprise Software / ERP"},
    {"ticker": "LIN", "name": "Linde plc", "market": "us", "form": "10-K", "cik": "0001707925", "category": "US 10-K Industrial Gases / Chemicals"},
    {"ticker": "BP", "name": "BP p.l.c.", "market": "us", "form": "20-F", "cik": "0000313807", "reportingCurrency": "USD", "category": "US 20-F Integrated Energy"},
    {"ticker": "SHEL", "name": "Shell plc", "market": "us", "form": "20-F", "cik": "0001306965", "reportingCurrency": "USD", "category": "US 20-F Integrated Energy / LNG"},
    {"ticker": "TTE", "name": "TotalEnergies SE", "market": "us", "form": "20-F", "cik": "0000879764", "reportingCurrency": "USD", "category": "US 20-F Multi-Energy Global Major"},
    {"ticker": "CNQ", "name": "Canadian Natural Resources Limited", "market": "us", "form": "40-F", "cik": "0001063259", "reportingCurrency": "CAD", "category": "US 40-F Canadian Oil Sands & E&P"},
    {"ticker": "RY", "name": "Royal Bank of Canada", "market": "us", "form": "40-F", "cik": "0001000275", "reportingCurrency": "CAD", "category": "US 40-F Major Canadian Commercial Bank"},
    {"ticker": "TD", "name": "The Toronto-Dominion Bank", "market": "us", "form": "40-F", "cik": "0000947263", "reportingCurrency": "CAD", "category": "US 40-F North American Banking"},
]

# CN A-Shares Targets (all exist in DB with >1500 financials)
new_cn_targets = [
    {"ticker": "600519", "name": "贵州茅台", "market": "cn", "form": "A-Share CAS", "category": "A-Share CAS Liquor / High Margin Consumer"},
    {"ticker": "000333", "name": "美的集团", "market": "cn", "form": "A-Share CAS", "category": "A-Share CAS Consumer Appliances / Smart Home"},
    {"ticker": "000651", "name": "格力电器", "market": "cn", "form": "A-Share CAS", "category": "A-Share CAS HVAC / White Goods"},
    {"ticker": "600887", "name": "伊利股份", "market": "cn", "form": "A-Share CAS", "category": "A-Share CAS Dairy Products / FMCG"},
    {"ticker": "000895", "name": "双汇发展", "market": "cn", "form": "A-Share CAS", "category": "A-Share CAS Meat Processing / Consumer Goods"},
    {"ticker": "000725", "name": "京东方A", "market": "cn", "form": "A-Share CAS", "category": "A-Share CAS Display Panels / High CapEx"},
    {"ticker": "000009", "name": "中国宝安", "market": "cn", "form": "A-Share CAS", "category": "A-Share CAS Conglomerate / High Tech Materials"},
    {"ticker": "000338", "name": "潍柴动力", "market": "cn", "form": "A-Share CAS", "category": "A-Share CAS Heavy Duty Engines / Commercial Vehicles"},
    {"ticker": "000157", "name": "中联重科", "market": "cn", "form": "A-Share CAS", "category": "A-Share CAS Construction Machinery"},
    {"ticker": "002352", "name": "顺丰控股", "market": "cn", "form": "A-Share CAS", "category": "A-Share CAS Express Logistics"},
    {"ticker": "000060", "name": "中金岭南", "market": "cn", "form": "A-Share CAS", "category": "A-Share CAS Non-ferrous Metals"},
    {"ticker": "000786", "name": "北新建材", "market": "cn", "form": "A-Share CAS", "category": "A-Share CAS Gypsum Board / Building Materials"},
    {"ticker": "601668", "name": "中国建筑", "market": "cn", "form": "A-Share CAS", "category": "A-Share CAS Construction / Megaprojects Infrastructure"},
    {"ticker": "601857", "name": "中国石油", "market": "cn", "form": "A-Share CAS", "category": "A-Share CAS Oil & Gas Exploration / Refining"},
    {"ticker": "600900", "name": "长江电力", "market": "cn", "form": "A-Share CAS", "category": "A-Share CAS Clean Hydropower / Regulated Utility"},
    {"ticker": "600309", "name": "万华化学", "market": "cn", "form": "A-Share CAS", "category": "A-Share CAS Chemical / Polyurethane Global Leader"},
    {"ticker": "600276", "name": "恒瑞医药", "market": "cn", "form": "A-Share CAS", "category": "A-Share CAS Innovative Pharmaceuticals"},
    {"ticker": "601398", "name": "工商银行", "market": "cn", "form": "A-Share CAS", "category": "A-Share CAS Mega State Commercial Bank"},
    {"ticker": "601288", "name": "农业银行", "market": "cn", "form": "A-Share CAS", "category": "A-Share CAS Mega State Commercial Bank"},
    {"ticker": "601988", "name": "中国银行", "market": "cn", "form": "A-Share CAS", "category": "A-Share CAS Internationalized Commercial Bank"},
    {"ticker": "601318", "name": "中国平安", "market": "cn", "form": "A-Share CAS", "category": "A-Share CAS Integrated Insurance & Financial Group"},
]

# HK Stock Targets (all exist in DB with >500 financials)
new_hk_targets = [
    {"ticker": "1211.HK", "name": "BYD Company Limited", "market": "hk", "form": "HK IFRS/CAS", "category": "HK EV / Batteries / Auto"},
    {"ticker": "9988.HK", "name": "Alibaba Group Holding Limited", "market": "hk", "form": "HK IFRS", "reportingCurrency": "CNY", "category": "HK Tech / Cloud / E-Commerce"},
    {"ticker": "3690.HK", "name": "Meituan", "market": "hk", "form": "HK IFRS", "reportingCurrency": "CNY", "category": "HK Local Life Services / On-demand Delivery"},
    {"ticker": "0992.HK", "name": "Lenovo Group Limited", "market": "hk", "form": "HK IFRS", "reportingCurrency": "USD", "category": "HK PC / Server / Smart Devices"},
    {"ticker": "0981.HK", "name": "SMIC", "market": "hk", "form": "HK IFRS", "reportingCurrency": "USD", "category": "HK Pure-play Semiconductor Foundry"},
    {"ticker": "0168.HK", "name": "Tsingtao Brewery Company Limited", "market": "hk", "form": "HK IFRS/CAS", "category": "HK Beer & Beverages FMCG"},
    {"ticker": "0386.HK", "name": "China Petroleum & Chemical Corporation", "market": "hk", "form": "HK IFRS/CAS", "category": "HK Refining / Petrochemicals"},
    {"ticker": "0669.HK", "name": "Techtronic Industries Co. Ltd.", "market": "hk", "form": "HK IFRS", "reportingCurrency": "USD", "category": "HK Power Tools & Outdoor Equipment"},
    {"ticker": "0019.HK", "name": "Swire Pacific Limited A", "market": "hk", "form": "HK IFRS", "reportingCurrency": "HKD", "category": "HK Traditional Conglomerate (Aviation/Property/Beverages)"},
    {"ticker": "0268.HK", "name": "Kingdee International Software", "market": "hk", "form": "HK IFRS", "reportingCurrency": "CNY", "category": "HK Enterprise Cloud ERP / SaaS"},
    {"ticker": "9633.HK", "name": "Nongfu Spring Co., Ltd.", "market": "hk", "form": "HK IFRS", "reportingCurrency": "CNY", "category": "HK Packaged Drinking Water / Tea Beverages"},
    {"ticker": "0142.HK", "name": "First Pacific Company Limited", "market": "hk", "form": "HK IFRS", "reportingCurrency": "USD", "category": "HK Consumer / Telecommunications Conglomerate"},
    {"ticker": "0177.HK", "name": "Jiangsu Expressway Company Limited", "market": "hk", "form": "HK IFRS/CAS", "category": "HK Toll Roads / Infrastructure"},
    {"ticker": "0317.HK", "name": "CSSC Offshore & Marine Engineering", "market": "hk", "form": "HK IFRS/CAS", "category": "HK Shipbuilding / Marine Engineering"},
]

all_new_targets = new_us_targets + new_cn_targets + new_hk_targets
print(f"Total new targets to resolve secId: {len(all_new_targets)}")

async def resolve_all():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=['--disable-blink-features=AutomationControlled', '--no-sandbox']
        )
        context = await browser.new_context(
            user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        )
        page = await context.new_page()
        print("Navigating to morningstar.com to initialize session...")
        await page.goto("https://www.morningstar.com", wait_until="domcontentloaded", timeout=40000)
        await page.wait_for_timeout(3000)
        
        resolved_suite = list(existing_suite)
        already_added = {c['ticker'] for c in resolved_suite}

        for item in all_new_targets:
            ticker = item['ticker']
            if ticker in already_added:
                continue

            query = ticker
            if item['market'] == 'hk':
                # Remove .HK suffix for morningstar search or try both
                clean = ticker.replace('.HK', '')
                query = clean
            elif item['market'] == 'cn':
                query = ticker

            script = f"""
            async () => {{
                try {{
                    const res = await fetch('https://www.morningstar.com/api/v2/search?q={query}');
                    if (!res.ok) return null;
                    return await res.json();
                }} catch (e) {{
                    return null;
                }}
            }}
            """
            data = await page.evaluate(script)
            sec_id = None
            if data and data.get('results'):
                candidates = []
                for r in data['results']:
                    val = r.get('value', {})
                    if val.get('securityID'):
                        candidates.append(val)
                
                # Match strategy
                if item['market'] == 'us':
                    # Exact ticker match preferred
                    for c in candidates:
                        if c.get('ticker') == ticker:
                            sec_id = c.get('securityID')
                            break
                    if not sec_id and candidates:
                        sec_id = candidates[0].get('securityID')
                elif item['market'] == 'hk':
                    # Match exchange XHKG or clean ticker
                    clean = ticker.replace('.HK', '')
                    for c in candidates:
                        if c.get('exchange') == 'XHKG' or c.get('ticker') == clean:
                            sec_id = c.get('securityID')
                            break
                    if not sec_id and candidates:
                        for c in candidates:
                            if c.get('exchange') == 'XHKG':
                                sec_id = c.get('securityID')
                                break
                    if not sec_id and candidates:
                        sec_id = candidates[0].get('securityID')
                elif item['market'] == 'cn':
                    # Match XSHG or XSHE or ticker
                    for c in candidates:
                        if c.get('exchange') in ('XSHG', 'XSHE') or c.get('ticker') == ticker:
                            sec_id = c.get('securityID')
                            break
                    if not sec_id and candidates:
                        sec_id = candidates[0].get('securityID')

            if sec_id:
                entry = dict(item)
                entry['secId'] = sec_id
                resolved_suite.append(entry)
                already_added.add(ticker)
                print(f"✓ Resolved {ticker:10s} -> {sec_id} ({item['name']})")
            else:
                print(f"✗ Failed {ticker:10s} ({item['name']})")

            await page.wait_for_timeout(300)

        print(f"\nFinal suite size: {len(resolved_suite)}")
        with open('scripts/lib/morningstar-benchmark-suite.json', 'w', encoding='utf-8') as f:
            json.dump(resolved_suite, f, indent=2, ensure_ascii=False)
        print("Successfully saved updated benchmark suite to scripts/lib/morningstar-benchmark-suite.json")
        await browser.close()

asyncio.run(resolve_all())

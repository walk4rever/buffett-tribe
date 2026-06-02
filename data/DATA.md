# Buffett Tribe Data Tracker

Last updated: 2026-06-02

This file is the project data glossary and operational tracker. Keep it current when adding new import scripts, generated artifacts, or data quality checks.

## Operating Rules

| Rule | Current policy |
|---|---|
| Latest display | Pages read the latest row from canonical tables such as `CompanyAnalysis`, `BusinessCanvas`, `MasterProfile`, and `PortfolioInsight`. |
| LLM version history | LLM outputs must write immutable history rows. `BusinessCanvas` uses `BusinessCanvasVersion`; company profile/business/value outputs use `GeneratedContentVersion`. |
| Raw source preservation | SEC filings and local documents should keep raw source files or archived artifacts before derived extraction. |
| Batch tracking | Long-running imports should have checkpointing or a queryable completion report. |
| Re-runs | Import scripts should be idempotent through unique keys, upsert, or `skipDuplicates`. |

## Master And Fund Data

In this project, `fund` means the SEC 13F filer or fund vehicle linked to a master, not a separate generic fund database. The operational chain is: `master` -> linked `fund/filer` -> historical `13F filings` -> quarterly `holdings` -> generated `portfolio insight`.

| Category | Data / artifact | Source | Canonical table / files | Script / command | Current status | Needs follow-up |
|---|---|---|---|---|---|---|
| Masters | Master entities (`buffett`, `lilu`, `duan`) | Code / seed data | `Entity(type=master)` | `scripts/import-13f.ts`, `scripts/neo4j-seed-mvp.ts` | Present for core masters. | Keep `tribeId` stable; add new masters only with explicit profile and source plan. |
| Fund / filer identity | Master-linked 13F reporting entity / fund vehicle | SEC filer metadata + project mapping | `Entity(type=master)`, `ExtSource.filerEntityId` | `npm run import:13f` | Current model treats the reporting filer as the master-linked fund/filer identity. | If one master has multiple filers, add explicit mapping before importing. |
| 13F filings | Quarterly holdings filings | SEC EDGAR 13F | `ExtSource(kind=13f)`, `Holding`, `Security`, `Entity` | `npm run import:13f`, `npm run pipeline:13f` | Core pipeline exists. | Periodically run latest quarter and integrity checks. |
| 13F company links | Security to company entity links | 13F + ticker/name maps | `Security.companyEntityId`, `CompanyNameMap` | `npm run backfill:security:company-links`, `npm run sync:company-name-map` | Existing repair scripts available. | Run after new 13F imports; inspect unresolved issuers. |
| Holdings change sets | Quarter-over-quarter add/trim/new/exit signals | `Holding` history | Derived in scripts / app queries | `scripts/generate-portfolio-insight.ts` | Used by portfolio insight generation. | Add explicit coverage report by master and quarter if this becomes a recurring gap. |
| Master profile | LLM-generated investment profile | Latest holdings + source material counts | `MasterProfile`, `GeneratedContentVersion(artifactType=master_profile)` | `npm run generate:master-profile` | Latest display plus version history now supported. | Backfill history for rows generated before the version table if needed. |
| Portfolio insight | LLM-generated quarterly commentary | Holdings delta + master profile | `PortfolioInsight`, `GeneratedContentVersion(artifactType=portfolio_insight)` | `npm run generate:portfolio-insight` | Latest row per master/quarter plus version history now supported. | Backfill history for rows generated before the version table if needed. |

## Company Data

| Category | Data / artifact | Source | Canonical table / files | Script / command | Current status | Needs follow-up |
|---|---|---|---|---|---|---|
| Company entities | Company CIK/ticker/profile metadata | SEC submissions + ticker map | `Entity(type=company)` | `npm run import:10k`, `npm run backfill:company:profiles` | 126 company entities in current DB check. | Keep CIK as primary identity; reconcile duplicate tickers/classes. |
| Annual reports | 10-K / 20-F / 40-F from 2020 to latest | SEC EDGAR | `ExtSource(kind=10k/20f/40f)`, `FilingArtifact`, `FilingSection`, `FilingAttachment` | `npm run import:10k -- --ticker AAPL --from 2020 --to 2025` | Coverage is incomplete for 64/126 companies in current 2020-2025 check. | Run catch-up imports; distinguish true missing data from companies without pre-IPO annual reports. |
| Batch annual report import | All companies 2020-latest | SEC EDGAR | Same as annual reports | `npm run import:10k:all -- --from 2020 --to 2026 --concurrency 2 --filing-concurrency 2 --archive-concurrency 4` | Script has checkpointing and concurrency flags. | Tune concurrency against SEC/R2/DB limits; monitor failures in `.cache/import-10k-all.json`. |
| XBRL source facts | Raw XBRL facts | SEC CompanyFacts + inline XBRL | `FinancialFact` | `npm run import:10k` | Import path exists; now filters API facts by filing accession when available. | Add a coverage report for facts by source/year/concept. |
| Financial line items | Derived FY metrics | `FinancialFact` / CompanyFacts / inline XBRL | `Financial` | `npm run import:10k`, `npm run check:financial:integrity` | Derived layer maintained for core metrics. | Expand line items only after page requirements are clear. |
| Filing sections | Business, risk, MD&A, market risk, notes, company information | Primary filing HTML / 40-F attachments | `FilingSection` | `npm run import:10k` | Extractor supports 10-K/20-F/40-F target sections. | Add section-level coverage report for Item 1/1A/7/8 equivalents. |
| Filing archive | Primary HTML, index HTML, attachments, data files | SEC EDGAR + R2 | `FilingArtifact`, R2 object keys | `npm run import:10k` | Existing artifacts are now reused by object key to avoid re-upload. | Consider retention policy and R2 cost dashboard. |
| Stock prices | Historical OHLC data | Yahoo Finance | `StockPrice` | `npm run import:company-stock-prices:yf` | Script exists. | Track ticker coverage and date ranges. |
| Company profile | LLM-generated basic company information | SEC filings + metadata + financial dashboard | `CompanyAnalysis.narrative.overview`, `GeneratedContentVersion(artifactType=company_profile)` | `npm run generate:company-profile` | Latest display plus version history now supported. | Backfill history for rows generated before the version table if needed. |
| Business overview | LLM-generated business narrative | SEC filings + financials | `CompanyAnalysis.narrative.business`, `GeneratedContentVersion(artifactType=business_overview)` | `npm run generate:business-model` | Latest display plus version history now supported. | Keep prompt version aligned with business canvas prompt changes. |
| Business canvas | LLM-generated 9-grid business model | SEC filings + financials | `BusinessCanvas`, `BusinessCanvasVersion` | `npm run generate:business-model` / compatibility: `npm run generate:business-canvas` | Latest display plus version history supported. | Normalize legacy canvas rows as needed. |
| Value analysis | LLM-generated moat/value analysis | SEC filings + financials + holdings | `CompanyAnalysis.moat`, `GeneratedContentVersion(artifactType=value_analysis)` | `npm run generate:value-analysis` | Latest display plus version history now supported. | Add quality review / source confidence checks. |

## Source Document Data

| Category | Data / artifact | Source | Canonical table / files | Script / command | Current status | Needs follow-up |
|---|---|---|---|---|---|---|
| Berkshire shareholder letters | Annual shareholder letters | Local markdown / Berkshire source material | `data/shareholder/*.md`, `Source`, `Chunk` | `scripts/import-markdown.ts` | Local corpus present through 2025. | Track import status into `Source`/`Chunk` after content edits. |
| Buffett partnership letters | Partnership-era letters | Local markdown | `data/partnership/*.md`, `Source`, `Chunk` | `scripts/import-markdown.ts` | Local corpus present. | Maintain source provenance and date metadata. |
| Annual meeting transcripts | Buffett meeting transcripts | Local markdown | `data/annual_meeting/raw_en/*.md`, `Source`, `Chunk` | `scripts/import-markdown.ts` | Local corpus present for many years. | Track translation/cleanup status if adding bilingual views. |
| Master PDFs | Li Lu / Duan / Buffett PDFs | Local raw PDFs + R2 | `data/documents/raw/**`, document routes | `scripts/upload-documents-to-r2.ts` | Raw document upload script exists. | Maintain per-document upload/checksum status. |
| Graph extraction | Concept/company/person graph triples | Source text chunks | Neo4j | `scripts/neo4j-extract-triplets.ts`, `scripts/neo4j-import-shareholder-range.ts` | Experimental / operational scripts exist. | Add graph import coverage by source type/year. |

## Operational Checks

| Check | Command | What it tells us | Current known gap |
|---|---|---|---|
| Database connectivity | `npm run check:db` | Prisma connectivity and latency | None. |
| Security/company integrity | `npm run check:security:integrity` | Security link completeness | Run after 13F imports. |
| Financial integrity | `npm run check:financial:integrity` | Missing FY metrics and abnormal values | Needs regular use after annual report imports. |
| Latest holdings company coverage | `node --env-file=.env.local ./node_modules/.bin/tsx scripts/check-latest-holdings-company-coverage.ts` | Latest holdings missing finance/analysis coverage | Analysis command now points to `generate:value-analysis`. |
| Company annual report coverage | Ad hoc query over `ExtSource(kind=10k/20f/40f)` | Missing 2020-latest annual filing rows | Turn into a maintained script if this becomes a weekly operation. |
| Script type check | `npm run typecheck:scripts` | Type safety for scripts | Should pass before shipping data pipeline changes. |
| Production build | `npm run build` | App and route build health | Should pass before tags. |

## Current Annual Report Coverage Snapshot

Checked against `Entity(type=company)` with CIK and expected years `2020-2025`.

| Rank | Missing count | Ticker | Company | Present years | Missing years | Note |
|---:|---:|---|---|---|---|---|
| 1 | 5 | CRCL | Circle Internet Group, Inc. | 2025 | 2020, 2021, 2022, 2023, 2024 | Likely limited by filing history / IPO timing; verify against SEC before treating as import failure. |
| 2 | 5 | CRWV | CoreWeave, Inc. | 2025 | 2020, 2021, 2022, 2023, 2024 | Likely limited by filing history / IPO timing. |
| 3 | 5 | LLYVK | Liberty Live Holdings, Inc. | 2025 | 2020, 2021, 2022, 2023, 2024 | Verify successor/spin-off history. |
| 4 | 4 | TEM | Tempus AI, Inc. | 2024, 2025 | 2020, 2021, 2022, 2023 | Likely limited by filing history / IPO timing. |
| 5 | 3 | BATRK | Atlanta Braves Holdings, Inc. | 2023, 2024, 2025 | 2020, 2021, 2022 | Verify tracking-stock / spin-off history. |
| 6 | 2 | BMY | BRISTOL MYERS SQUIBB CO | 2022, 2023, 2024, 2025 | 2020, 2021 | Import candidate. |
| 7 | 2 | CRDO | Credo Technology Group Holding Ltd | 2022, 2023, 2024, 2025 | 2020, 2021 | Verify fiscal history. |
| 8 | 2 | GOLD | Gold.com, Inc. | 2022, 2023, 2024, 2025 | 2020, 2021 | Import candidate / verify ticker identity. |
| 9 | 2 | MTB | M&T BANK CORP | 2022, 2023, 2024, 2025 | 2020, 2021 | Import candidate. |
| 10 | 2 | PNC | PNC FINANCIAL SERVICES GROUP, INC. | 2022, 2023, 2024, 2025 | 2020, 2021 | Import candidate. |
| 11 | 2 | SYF | Synchrony Financial | 2022, 2023, 2024, 2025 | 2020, 2021 | Import candidate. |
| 12 | 2 | TEVA | TEVA PHARMACEUTICAL INDUSTRIES LTD | 2022, 2023, 2024, 2025 | 2020, 2021 | 20-F import candidate. |
| 13 | 2 | UAL | United Airlines Holdings, Inc. | 2022, 2023, 2024, 2025 | 2020, 2021 | Import candidate. |
| 14 | 2 | VTS | Vitesse Energy, Inc. | 2022, 2023, 2024, 2025 | 2020, 2021 | Verify spin-off history. |
| 15+ | 1 | Multiple | 50 companies | 2021-2025 | 2020 | Mostly import candidates; verify companies that did not have public annual reports in 2020. |

## LLM Versioning

| Artifact | Latest table / field | History table | Scope | Prompt version |
|---|---|---|---|---|
| Company profile | `CompanyAnalysis.narrative.overview` | `GeneratedContentVersion` | `scopeType=entity`, `artifactType=company_profile` | `company-profile-v1` |
| Business overview | `CompanyAnalysis.narrative.business` | `GeneratedContentVersion` | `scopeType=entity`, `artifactType=business_overview` | `business-model-v1` |
| Value analysis | `CompanyAnalysis.moat` | `GeneratedContentVersion` | `scopeType=entity`, `artifactType=value_analysis` | `value-analysis-v1` |
| Business canvas | `BusinessCanvas.canvas` | `BusinessCanvasVersion` | Entity-specific relation | `business-model-v1` |
| Master profile | `MasterProfile.profile` | `GeneratedContentVersion` | `scopeType=master`, `artifactType=master_profile` | `master-profile-v1` |
| Portfolio insight | `PortfolioInsight.structured` / `narrative` | `GeneratedContentVersion` | `scopeType=portfolio`, `artifactType=portfolio_insight` | `portfolio-insight-v1` |

## Recommended Catch-Up Commands

```bash
# Annual reports for all tracked companies, conservative parallelism
npm run import:10k:all -- --from 2020 --to 2026 --concurrency 2 --filing-concurrency 2 --archive-concurrency 4

# One company annual report catch-up
npm run import:10k -- --ticker BMY --from 2020 --to 2021 --filing-concurrency 2 --archive-concurrency 4

# LLM generated company artifacts
npm run generate:company-profile -- --company AAPL --force
npm run generate:business-model -- --company AAPL --force
npm run generate:value-analysis -- --company AAPL --force
```

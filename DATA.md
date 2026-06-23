# Buffett Tribe Data Tracker

Last updated: 2026-06-09

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
| Masters | Master entities (`buffett`, `lilu`, `duan`, `gavin-baker`) | Code / seed data | `Entity(type=master)` | `npm run import:13f` | Core masters remain the primary tribe; Gavin Baker is the first `alpha` master and is displayed separately. | Keep `tribeId` stable; add new masters only with explicit profile, category, and source plan. |
| Fund / filer identity | Master-linked 13F reporting entity / fund vehicle | SEC filer metadata + project mapping | `Entity(type=master)`, `ExtSource.filerEntityId` | `npm run import:13f` | Current model treats the reporting filer as the master-linked fund/filer identity. | If one master has multiple filers, add explicit mapping before importing. |
| 13F filings | Quarterly holdings filings | SEC EDGAR 13F | `ExtSource(kind=13f)`, `Holding`, `Security`, `Entity` | `npm run import:13f`, `npm run pipeline:13f` | Core pipeline exists. Atreides Management, LP is mapped to `gavin-baker` with CIK `0001777813`. | Periodically run latest quarter and integrity checks. |
| 13F company links | Security to company entity links | 13F + ticker/name maps | `Security.companyEntityId`, `CompanyNameMap` | `npm run backfill:security:company-links`, `npm run sync:company-name-map` | Existing repair scripts available. | Run after new 13F imports; inspect unresolved issuers. |
| Holdings change sets | Quarter-over-quarter add/trim/new/exit signals | `Holding` history | Derived in scripts / app queries | `scripts/generate-portfolio-insight.ts` | Used by portfolio insight generation. | Add explicit coverage report by master and quarter if this becomes a recurring gap. |
| Master profile | LLM-generated investment profile | Latest holdings + source material counts | `MasterProfile`, `GeneratedContentVersion(artifactType=master_profile)` | `npm run generate:master-profile` | Latest display plus version history now supported. | Backfill history for rows generated before the version table if needed. |
| Portfolio insight | LLM-generated quarterly commentary | Holdings delta + master profile | `PortfolioInsight`, `GeneratedContentVersion(artifactType=portfolio_insight)` | `npm run generate:portfolio-insight` | Latest row per master/quarter plus version history now supported. | Backfill history for rows generated before the version table if needed. |

## Company Data

| Category | Data / artifact | Source | Canonical table / files | Script / command | Current status | Needs follow-up |
|---|---|---|---|---|---|---|
| Company entities | Company CIK/ticker/profile metadata | SEC submissions + ticker map | `Entity(type=company)` | `npm run import:10k`, `npm run backfill:company:profiles` | 126 company entities in current DB check. | Keep CIK as primary identity; reconcile duplicate tickers/classes. |
| Annual reports | 10-K / 20-F / 40-F from 2020 to latest | SEC EDGAR | `ExtSource(kind=10k/20f/40f)`, `FilingArtifact`, `FilingSection`, `FilingAttachment` | `npm run import:10k -- --ticker AAPL --from 2020 --to 2026` | 2020-2026 catch-up completed for all 126 tracked company entities; checkpoint shows 882 completed annual-report years and 0 failed years. | Distinguish true missing filings from companies without pre-IPO annual reports when adding new companies. |
| Batch annual report import | All companies 2020-latest | SEC EDGAR | Same as annual reports | `npm run import:10k:all -- --from 2020 --to 2026 --concurrency 1 --filing-concurrency 1` | Script has company/year checkpointing in `.cache/import-10k-all.json`; 126/126 companies completed in the latest run. | Keep conservative concurrency unless SEC/R2/DB limits are re-tested; use `--no-edgartools-html` for edgartools HTML read timeouts. |
| XBRL source facts | Raw XBRL facts | SEC CompanyFacts + inline XBRL | `FinancialFact` | `npm run import:10k` | Import path exists; now filters API facts by filing accession when available. | Add a coverage report for facts by source/year/concept. |
| Financial line items | Derived FY metrics | `FinancialFact` / CompanyFacts / inline XBRL | `Financial` | `npm run import:10k`, `npm run check:financial:integrity` | Derived layer maintained for core metrics. | Expand line items only after page requirements are clear. |
| Filing sections | Business, risk, MD&A, market risk, notes, company information | Primary filing HTML / 40-F attachments | `FilingSection` | `npm run import:10k` | Extractor supports 10-K/20-F/40-F target sections. | Add section-level coverage report for Item 1/1A/7/8 equivalents. |
| Filing section extraction jobs | Source-level v3 structured section backfill status | Existing `ExtSource` annual filings | `FilingSectionExtractionJob`, `FilingSection`, `FilingArtifact` | `npm run backfill:filing-section-jobs -- --kinds 10k --sample 20` | Job queue added for low-QPS, auditable backfill; initial 20-job 10-K sample completed with 18 success, 2 no_sections, 0 failed. | Review Supabase hourly Disk IO before increasing sample size; keep 20-F/40-F in separate queues until parser quality is reviewed. |
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

## Operational Checks

| Check | Command | What it tells us | Current known gap |
|---|---|---|---|
| Database connectivity | `npm run check:db` | Prisma connectivity and latency | None. |
| Security/company integrity | `npm run check:security:integrity` | Security link completeness | Run after 13F imports. |
| Financial integrity | `npm run check:financial:integrity` | Missing FY metrics and abnormal values | Needs regular use after annual report imports. |
| Latest holdings company coverage | `node --env-file=.env.local ./node_modules/.bin/tsx scripts/check-latest-holdings-company-coverage.ts` | Latest holdings missing finance/analysis coverage | Analysis command now points to `generate:value-analysis`. |
| Company annual report coverage | `.cache/import-10k-all.json` plus ad hoc query over `ExtSource(kind=10k/20f/40f)` | Missing 2020-latest annual filing rows and failed import years | Latest checkpoint has `completed=126`, `failed=0`, `completedYears=882`, `failedYears=0`; turn DB coverage query into a maintained script if this becomes weekly. |
| Filing section job status | `npm run backfill:filing-section-jobs -- --kinds 10k --sample 20 --seed-only` plus query over `FilingSectionExtractionJob` | Source-level backfill state and failure/no-section audit trail | Use before any broad v3 section backfill; current policy is small 10-K samples only while Supabase Disk IO is constrained. |
| Supabase pooler health | `node --env-file=.env.local ./node_modules/.bin/tsx -e 'import db from "./src/lib/prisma"; db.entity.count().then(console.log).finally(()=>db.$disconnect())'` | Whether Prisma can check out even a lightweight connection | 2026-06-09: pooler returned `ECHECKOUTTIMEOUT`; pause imports/backfills until Disk IO / pooler recovers. |
| Script type check | `npm run typecheck:scripts` | Type safety for scripts | Should pass before shipping data pipeline changes. |
| Production build | `npm run build` | App and route build health | Should pass before tags. |

## Current Annual Report Coverage Snapshot

Checked from `.cache/import-10k-all.json` after the 2020-2026 catch-up.

| Metric | Value |
|---|---:|
| Tracked company targets | 126 |
| Completed companies | 126 |
| Failed companies | 0 |
| Completed annual-report years | 882 |
| Failed annual-report years | 0 |
| In-progress annual-report years | 0 |

The latest catch-up completed the remaining failed years: `SIRI 2020`, `SNOW 2025`, `SNOW 2026`, `VTS 2024`, and `ZM 2025`.

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
npm run import:10k:all -- --from 2020 --to 2026 --concurrency 1 --filing-concurrency 1

# Failed-year annual report backfill with longer timeouts and SEC-side HTML fetch
npm run import:10k:all -- --from 2020 --to 2026 --concurrency 1 --filing-concurrency 1 --no-edgartools-html --extract-timeout-ms 1800000 --company-timeout-ms 5400000 --retries 5 --retry-delay-ms 30000

# One company annual report catch-up
npm run import:10k -- --ticker BMY --from 2020 --to 2021 --filing-concurrency 1 --no-edgartools-html

# Safe structured section v3 backfill sample; source-level jobs, single worker, low QPS
npm run backfill:filing-section-jobs -- --kinds 10k --sample 20

# Seed only, then run the queued jobs manually; useful when observing Supabase hourly Disk IO
npm run backfill:filing-section-jobs -- --kinds 10k --sample 20 --seed-only
npm run backfill:filing-section-jobs -- --kinds 10k --run-only --limit 20 --delay-ms 60000

# LLM generated company artifacts
npm run generate:company-profile -- --company AAPL --force
npm run generate:business-model -- --company AAPL --force
npm run generate:value-analysis -- --company AAPL --force
```

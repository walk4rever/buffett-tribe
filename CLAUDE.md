# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

巴菲特部落 (Buffett Tribe) — a knowledge-base + agent-driven value-investing research platform. Core loop: pick a company, understand it through value-investing frameworks (moat, management, valuation), see what the "masters" (tracked investors) actually hold and have said. Three data layers drive the `/agent` chat: what masters *said* (GBrain semantic search over letters/transcripts), what masters *hold* (13F data in Postgres), what companies *disclosed* (10-K/20-F filing sections).

Full product spec: `PRODUCT.md` (large; prefer targeted `grep`/section reads over reading it whole — it has a table of contents at the top; data model notes live in its "数据字典与工程口径" and "数据资产清单" sections — `DATA.md` was retired 2026-08-07, folded in here). Script catalog: `scripts/README.md` (numbered index of the ~90 scripts in `scripts/`, grouped by pipeline — read this before writing a new script; there is very likely already one that does most of what you need). Design tokens: `APPLE-DESIGN.md`.

## Commands

```bash
npm run dev                    # next dev --webpack
npm run build                  # prisma generate && next build --webpack (needs prod secrets — not in CI, run locally before release)
npm run lint                   # eslint
npx tsc --noEmit -p tsconfig.json      # typecheck app code (scripts/ included via **/*.ts glob)
npm run typecheck:scripts      # tsc -p tsconfig.scripts.json --noEmit (separate project for scripts/)
npm run test                   # vitest run (whole suite)
node --env-file=.env.local ./node_modules/.bin/vitest run tests/agent-tools/search-holdings.test.ts   # single file, with DB env
```

Root `npm test` also picks up `services/pi-gateway/src/tools/*.test.ts` — **when touching anything under `services/pi-gateway/`, run the root `vitest run`, not just a pi-gateway-local test command**, or you can pass CI while a root-level test (e.g. `tests/agent-tools/search-holdings.test.ts`, which imports directly from `services/pi-gateway/src/tools/`) is broken.

Prisma migrations: `npx prisma migrate dev` normally works, but the shadow DB has broken history from an old migration (`P3006` on `20260520000100_add_structured_portfolio_insight`). Workaround already used repeatedly in this repo: `npx prisma migrate diff --from-url <DIRECT_URL> --to-schema-datamodel prisma/schema.prisma --script`, hand-extract only the `ALTER TABLE` for the model you actually touched (the diff also proposes dropping GBrain's non-Prisma-managed tables — `content_chunks`, `pages`, `oauth_*`, `minion_*`, etc. — never apply those), apply the extracted SQL directly via `prisma.$executeRawUnsafe`, then `npx prisma migrate resolve --applied <migration_name>`.

Env setup: `cp .env.example .env.local`, fill in `DATABASE_URL`/`DIRECT_URL` (Supabase Postgres), `AI_API_KEY`/`AI_API_BASE_URL`/`AI_MODEL` (LLM generation scripts), `EMBEDDING_*` (GBrain), `CLOUDFLARE_R2_*` (filing archive), `PI_GATEWAY_URL`/`PI_AGENT_SECRET` (agent proxy). Most `scripts/*.ts` are run as `node --env-file=.env.local ./node_modules/.bin/tsx scripts/<name>.ts` — check `package.json` for the exact npm alias before invoking a script directly.

### Release convention

Patch bump by default, direct-push to `main` (no PR flow for solo iteration): `npm version patch --no-git-tag-version` → commit the feature change and the version bump as **two separate commits** (`feat/fix(...): ...` then `chore: bump version to vX.Y.Z`) → `git tag vX.Y.Z` → push both `main` and the tag. Minor/major only on explicit request. `npm run build` is intentionally not a CI gate (needs prod secrets) — run it locally before tagging. Vercel deploys on push to `main` via its GitHub integration.

## Architecture

### Cross-market structural constraints (US / HK / CN)

The company page supports all three markets on one code path. Three rules exist specifically to keep it that way — violating them has caused real rework before:

1. **Don't port US extraction logic to HK/CN by copy-paste.** Each market's filing format is different (SEC inline XBRL vs. HKEXnews/巨潮资讯网 PDFs); design extraction per-market from the data source, not by generalizing `extract-10k-sections.ts`.
2. **`market` enters code in exactly one place**: the parse/format helpers in `src/lib/company-data.ts` (`parseCompanyIdentifier`, `getCompanyByIdentifier`, `formatCompanyUrl`). Every other call site treats an `Entity` by *capability* ("does it have Financial rows / FilingSection rows / Holding rows") and renders or placeholders accordingly — never `if (market === 'cn')` branching scattered through components. (A past violation: `/insights` used to hardcode a color per source, needing a JS+CSS edit for every new source; collapsed to one token.)
3. **`onboard-company.ts` doesn't fork per market.** The valuable part is market-agnostic (checkpoint file, per-step DB verification, resumable). Market differences are just a different `steps` list (US: 10-K import → price → 5 LLM generation steps; CN/HK Phase 1: entity seed → price only) selected by `--market`, not a separate script.

### Tribe members are DB-driven, not hardcoded

`src/lib/tribe.ts` used to export a static `TRIBE_MEMBERS` array; it's now backed by the `Filer` table (`getTribeMembers()` / `getTribeMember(id)`, wrapped in React `cache()` for per-request dedup). Onboarding a new investor (`npm run onboard:alpha-investor`) writes directly to `Filer` (`personNameEn`/`personNameZh`/`initials`/`materialLabel`/`materialSub`/`isMasterPersona`), so a new investor appears site-wide immediately — no code change, no redeploy. `isMasterPersona` (true = core tribe with a wisdom library — currently just Buffett/Li Lu/Duan Yongping — false = "Alpha 部落", 13F-only) is set once at creation and deliberately never overwritten by routine 13F reimports.

The quarterly reimport scripts (`import:13f`, `import:beneficial-ownership`) also resolve their filer roster from the `Filer` table (`getTrackedFilers()` in `scripts/lib/13f-import-core.ts`), not a hardcoded array — so a newly onboarded investor is picked up by the next `import:13f --all` with no code change either.

`MasterProfile.profile` (LLM-generated) is `{ bio, fundOverview }` — two free-text paragraphs, not a rigid dated-milestone list. The prompt (`scripts/generate-master-profile.ts`) explicitly tells the model to stay short and honest when public data is thin rather than padding out fake "date unknown" entries; grounded fund-level facts (concentration, sector mix, turnover) come from real Holding data, not the model's general knowledge.

### Agent runtime chain (`/agent`)

```
browser → buffett-tribe.com/agent (Vercel, Next.js)
  → /api/pi (Next.js proxy, keeps AGENT_SECRET server-side)
    → pi-gateway (Express SSE, air7, PM2, port 3456)
      → @earendil-works/pi-coding-agent → DeepSeek API
      → search_wisdom  → GBrain (air7 :3457, pgvector 1536d)
      → search_holdings → Supabase (Holding SQL; roster generated fresh per-session from Filer, not hardcoded)
      → search_filings  → Supabase (FilingSection SQL + FilingArtifact primary_html live parse)
```

`services/pi-gateway/` is a **separate deployable** from the Next.js app — it has its own `package.json`, is deployed via `services/pi-gateway/deploy.sh` (rsync → npm install → `pm2 restart pi-gateway-buffett-tribe`) to air7, and needs to be redeployed independently after changes under that directory. `deploy.sh` excludes `.pi-agent/` from rsync — that directory holds real API keys on the server; the committed copy is a dev template with a placeholder key, and syncing it would silently break the deployed agent (this happened once).

Tool descriptions are built dynamically where possible (`createSearchHoldingsTool()` queries `Filer` at session-creation time) rather than hardcoded in `AGENTS.md` prose — the same "onboard should require zero manual doc updates" principle as the tribe-member refactor above.

**Conversation persistence is a separate layer from pi-gateway's live session.** Turns persist per `(userId, contextKey)` in `ChatTurn` (`contextKey` from `src/lib/agent-context.ts`'s `deriveContextKey()` — one continuous thread per page/investor/company, not per browser tab), independent of pi-gateway's in-memory `AgentSession` (tab-scoped key, 30min TTL, wiped on restart/redeploy). `/api/pi` forwards the caller's last 10 `ChatTurn` rows as `history`; `getSession()` in `session-manager.ts` only replays them (`SessionManager.appendMessage()`) when actually creating a fresh session, so a cold-started session isn't amnesiac relative to what the UI already shows — an already-warm session is never re-seeded. Pasted images archive to R2 under `buffett-tribe/users/{userId}/{category}/...` (`buildUserObjectKey()` in `src/lib/r2.ts` — the convention for any per-user file, distinct from the site's public-content R2 key schemes for filings/documents/insight media) but replay as a `"[用户发送了一张图片]"` text placeholder on cold start rather than being re-fetched as bytes — see TODO.md's "Agent 会话持久化" entry for the full design/verification trail.

### Data model (Prisma, Postgres/Supabase)

`Entity` (`type`: `company` | `security` | `master` | `concept`) is the polymorphic core node — companies, tracked investors ("masters"), and tradeable securities are all rows here, distinguished by `type` plus market-specific identity fields (`cik` for US, `market`+`code` for HK/CN). `Filer` is a 1:1 companion for anything tracked via 13F (see above). `Holding` links a filer's `Entity` to a `Security` for one `ExtSource` (one filing = one row in `ExtSource`; `kind` discriminates 13F/10-K/10-Q/XBRL/price/13D/13G). `BeneficialOwnership` holds SC 13D/13G event-triggered disclosures (distinct from quarterly 13F snapshots — reports % of the *issuer's* share class, not % of the filer's own portfolio). `CompanyAnalysis` (`profile`/`business`/`moat`/`management`/`valuation`, one field per independently-regenerable LLM step) is the sole authoritative store for company-scoped generated content — `BusinessCanvas` was dropped and `GeneratedContentVersion` no longer mirrors company data (2026-08-08). `GeneratedContentVersion` still versions `MasterProfile`/`PortfolioInsight` (master/portfolio scope) but nothing in the app currently reads its history, only the latest row via each artifact's own table — see PRODUCT.md "LLM 生成内容版本表现状" before adding a new mirrored artifact type. `GBrain` (external, air7) owns its own tables (`content_chunks`, `pages`, etc.) that are **not** in this Prisma schema — never let a migration diff drop them (see the migration workaround above).

`/company` shows only "complete" entities (have `Financial`/`CompanyAnalysis`/`BusinessCanvas` rows — these three are written together as one unit by onboarding, so checking any one is a reliable signal) in the market-grouped sections; everything else is a bare stub auto-created the moment some investor's 13F holdings first mentioned the ticker, and is grouped into a separate "待完善" section rather than presented as if it had real content. Prefer computing this kind of "is this fully onboarded" signal at query time over storing a synced boolean flag — a stored flag drifts the moment some pipeline forgets to update it.

### Testing strategy — risk-tiered, not coverage-tiered

The risk in this codebase is data-pipeline integrity (external sources → transform → user), not algorithmic correctness, so the test pyramid weights toward tests that hit real data:

- **L0/L1** (CI-gated, every push): lint + typecheck + pure-function unit tests (fixtures, no external deps).
- **L3** (CI-gated except `search_wisdom`): agent tool contract tests in `tests/agent-tools/`, read-only against the **production** DB — `search_holdings`/`search_filings` run every push (need only `DIRECT_URL`); `search_wisdom` is excluded from CI (costs real `OPENAI_API_KEY` money per run) and only run locally/pre-release.
- **L4** (weekly + pre-release): `data-integrity-check.yml` runs 4 read-only checks (`check:financial:integrity`, `check:security:integrity`, `check:holdings-company-coverage`, `check:filing-section:integrity`), opens a GitHub issue on `--strict` failures.
- **L2/L5** (integration, E2E) are deferred/not yet built.

When adding a new agent tool or changing its parameters, add/update its L3 golden case in the same change. When adding a new data-import path, add or run the corresponding L4 check.

### Design constraints

Single functional blue only (`--apple-blue` #0071e3 / dark-mode link `#2997ff`) — do not introduce a second accent blue. Reading surfaces (letters, filings, insights) use `--apple-near-black` for body text, `.md-reader`'s 780px measure (74ch for financials) as the max reading width. Each core-tribe "master" may have exactly one brand color, used only in that master's hero identity strip — never in buttons/links/body text (Alpha-tribe members instead share one category color; see `getTribeMemberColor()` in `src/lib/tribe.ts`).

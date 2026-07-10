/**
 * backfill-security-company-links.ts
 *
 * One-shot reconciliation for security/company linkage and ticker completeness.
 *
 * What it does:
 * 1) Resolve ticker via stable priority:
 *    CUSIP override > existing security ticker > existing entity ticker > issuer map
 * 2) Resolve company entity via:
 *    existing link > ticker->company > issuer->company > SEC ticker map -> create company shell
 * 3) Persist updates to BOTH security + entity(metadata/companyEntityId/ticker)
 *
 * Usage:
 *   npm run backfill:security:company-links
 *   npm run backfill:security:company-links -- --dry-run
 *   npm run backfill:security:company-links -- --strict
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { hasChineseText, issuerKey, normalizeEnglishName } from "../src/lib/company-name-map";
import { normalizeTicker } from "../src/lib/ticker";
import { translateCompanyNameToZh, upsertNameMapEntries } from "./lib/company-name-zh";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const strict = process.argv.includes("--strict");

const SEC_WWW = "https://www.sec.gov";
const HEADERS = {
  "User-Agent": "buffett-tribe research walkklaw@gmail.com",
  Accept: "application/json, text/xml, */*",
};

// High-confidence CUSIP overrides for known dual-class / naming edge cases.
const CUSIP_TICKER_OVERRIDES: Record<string, string> = {
  "02079K107": "GOOG", // Alphabet Class C
  "02079K305": "GOOGL", // Alphabet Class A
  "88034P109": "TME", // Tencent Music ADR
  "G9001E102": "LILA", // Liberty Latin America Class A
  "G9001E128": "LILAK", // Liberty Latin America Class C
  "530909100": "LLYVA", // Liberty Live Series A
  "530909308": "LLYVK", // Liberty Live Series C
};

function normalizeCusip(raw: string): string {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact) return "";
  if (/^\d+$/.test(compact) && compact.length < 9) return compact.padStart(9, "0");
  return compact;
}

function issuerMatchKey(name: string): string {
  const base = normalizeEnglishName(name)
    .replace(/\b(DEL|DE|NEW)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const ABBR: Record<string, string> = {
    AIRLS: "AIRLINES",
    CONTL: "CONTINENTAL",
    COMM: "COMMUNICATIONS",
    INTL: "INTERNATIONAL",
    ENTMT: "ENTERTAINMENT",
    BK: "BANK",
    MTRS: "MOTORS",
    WHSL: "WHOLESALE",
    COS: "COMPANIES",
    SYS: "SYSTEMS",
    HLDG: "HOLDING",
    HLDGS: "HOLDINGS",
  };

  const expanded = base
    .split(/\s+/)
    .map((token) => ABBR[token.toUpperCase()] ?? token)
    .join(" ");

  return expanded.toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function asObj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return v as Record<string, unknown>;
}

function toJsonObject(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function scoreCompanyCandidate(input: { cik?: string | null }) {
  return input.cik ? 100 : 0;
}

async function getTickerCikMap() {
  const res = await fetch(`${SEC_WWW}/files/company_tickers.json`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Ticker map fetch failed: ${res.status}`);
  const data = (await res.json()) as Record<string, { cik_str: number; ticker: string; title: string }>;
  const map = new Map<string, { cik: string; title: string }>();
  const tickerByIssuer = new Map<string, string>();
  for (const item of Object.values(data)) {
    map.set(item.ticker.toUpperCase(), { cik: String(item.cik_str), title: item.title });
    tickerByIssuer.set(issuerMatchKey(item.title), item.ticker.toUpperCase());
  }
  return { tickerMap: map, tickerByIssuer };
}

async function main() {
  const { tickerMap, tickerByIssuer: secTickerByIssuer } = await getTickerCikMap();

  const nameMapRows = await db.companyNameMap.findMany({
    where: { keyType: { in: ["ticker", "issuer", "cusip"] } },
    select: { keyType: true, key: true, nameZh: true, ticker: true },
  });
  const zhByTicker = new Map<string, string>();
  const tickerByIssuer = new Map<string, string>();
  const tickerByCusip = new Map<string, string>();
  for (const row of nameMapRows) {
    if (row.keyType === "ticker") {
      const ticker = normalizeTicker(row.key);
      if (hasChineseText(row.nameZh) && ticker) zhByTicker.set(ticker, row.nameZh);
      continue;
    }
    if (row.keyType === "cusip") {
      const ticker = normalizeTicker(row.ticker);
      if (ticker) tickerByCusip.set(row.key.toUpperCase(), ticker);
      continue;
    }
    const ticker = normalizeTicker(row.ticker);
    if (ticker) tickerByIssuer.set(row.key, ticker);
  }

  const companies = await db.entity.findMany({
    where: { type: "company" },
    select: { id: true, ticker: true, cik: true, canonicalName: true, type: true },
  });
  const companyByTicker = new Map<string, { id: string; cik: string | null; type: string }>();
  const companyByIssuer = new Map<string, string>();
  const companyById = new Set<string>();
  const companyMetaById = new Map<string, { cik: string | null; type: string }>();
  companies.sort((a, b) => {
    return scoreCompanyCandidate(b) - scoreCompanyCandidate(a);
  });
  for (const c of companies) {
    companyById.add(c.id);
    companyMetaById.set(c.id, { cik: c.cik ?? null, type: c.type });
    const ticker = normalizeTicker(c.ticker);
    if (ticker && !companyByTicker.has(ticker)) {
      companyByTicker.set(ticker, { id: c.id, cik: c.cik ?? null, type: c.type });
    }
    const key = issuerKey(c.canonicalName);
    if (!companyByIssuer.has(key)) companyByIssuer.set(key, c.id);
  }

  // A filer that is ALSO a public company (currently: buffett/Berkshire) is
  // the one case where a security's ticker/CIK legitimately corresponds to
  // a Filer's companyEntityId. Preload it so resolution never has to guess
  // via scoring for this case — see TODOS.md「Filer / Company 拆分」.
  const filerLinks = await db.filer.findMany({
    where: { companyEntityId: { not: null } },
    select: { filerCik: true, companyEntityId: true, companyEntity: { select: { ticker: true } } },
  });
  const filerCompanyByTicker = new Map<string, string>();
  const filerCompanyByCik = new Map<string, string>();
  for (const f of filerLinks) {
    if (!f.companyEntityId) continue;
    if (f.filerCik) filerCompanyByCik.set(f.filerCik, f.companyEntityId);
    const ticker = normalizeTicker(f.companyEntity?.ticker ?? null);
    if (ticker) filerCompanyByTicker.set(ticker, f.companyEntityId);
  }

  const rows = await db.security.findMany({
    select: {
      id: true,
      ticker: true,
      cusip: true,
      titleOfClass: true,
      companyEntityId: true,
      metadata: true,
      company: { select: { id: true, canonicalName: true, ticker: true, metadata: true } },
    },
  });

  let kept = 0;
  let updated = 0;
  let linked = 0;
  let createdCompany = 0;
  let unresolved = 0;
  let unresolvedWithCusip = 0;

  for (const row of rows) {
    const normalizedCusip = row.cusip ? normalizeCusip(row.cusip) : null;
    const secMeta = asObj(row.metadata);
    const companyMeta = asObj(row.company?.metadata);
    const existingCompanyId =
      row.companyEntityId ??
      (typeof secMeta.companyEntityId === "string" ? secMeta.companyEntityId : null) ??
      (typeof companyMeta.companyEntityId === "string" ? companyMeta.companyEntityId : null);

    const issuer =
      row.company?.canonicalName ??
      (typeof secMeta.nameEnShort === "string" ? secMeta.nameEnShort : null) ??
      (typeof secMeta.nameZh === "string" ? secMeta.nameZh : null) ??
      row.titleOfClass ??
      row.ticker ??
      normalizedCusip ??
      "UNKNOWN";
    const issuerK = issuerKey(issuer);

    const rawTickerCandidates = [
      row.ticker,
      typeof secMeta.ticker === "string" ? secMeta.ticker : null,
      row.company?.ticker ?? null,
      normalizedCusip ? tickerByCusip.get(normalizedCusip) ?? null : null,
      normalizedCusip ? CUSIP_TICKER_OVERRIDES[normalizedCusip] ?? null : null,
      tickerByIssuer.get(issuerK) ?? null,
      secTickerByIssuer.get(issuerMatchKey(issuer)) ?? null,
    ].filter((x): x is string => !!x && x.trim().length > 0);

    const resolvedTicker = rawTickerCandidates.length ? normalizeTicker(rawTickerCandidates[0]) : null;

    // A filer's own companyEntityId (set only when the filer is also a
    // public company, e.g. Berkshire) always wins — no need to fall through
    // to scoring/guessing for this case.
    let companyId: string | null = resolvedTicker ? filerCompanyByTicker.get(resolvedTicker) ?? null : null;

    if (!companyId) {
      const candidateCompanyIds: string[] = [];
      if (existingCompanyId && companyById.has(existingCompanyId)) {
        candidateCompanyIds.push(existingCompanyId);
      }
      if (resolvedTicker) {
        const byTicker = companyByTicker.get(resolvedTicker)?.id ?? null;
        if (byTicker) candidateCompanyIds.push(byTicker);
      }
      const byIssuer = companyByIssuer.get(issuerK) ?? null;
      if (byIssuer) candidateCompanyIds.push(byIssuer);

      companyId =
        [...new Set(candidateCompanyIds)].sort((a, b) => {
          const left = companyMetaById.get(a) ?? {};
          const right = companyMetaById.get(b) ?? {};
          return scoreCompanyCandidate(right) - scoreCompanyCandidate(left);
        })[0] ?? null;
    }

    if (!companyId && resolvedTicker) {
      const secRef = tickerMap.get(resolvedTicker);
      if (secRef) {
        const byCik = await db.entity.findUnique({ where: { cik: secRef.cik }, select: { id: true } });
        if (byCik) {
          companyId = byCik.id;
        } else if (!dryRun) {
          const nameEnShort = normalizeEnglishName(secRef.title);
          let nameZh = zhByTicker.get(resolvedTicker) ?? null;
          if (!nameZh) {
            nameZh = await translateCompanyNameToZh({
              englishName: secRef.title,
              ticker: resolvedTicker,
            });
            await upsertNameMapEntries({
              db,
              issuerKey: issuerKey(secRef.title),
              ticker: resolvedTicker,
              nameZh,
              nameEnShort,
              source: "import-translation",
            });
            zhByTicker.set(resolvedTicker, nameZh);
          }
          const created = await db.entity.create({
            data: {
              type: "company",
              canonicalName: secRef.title,
              ticker: resolvedTicker,
              cik: secRef.cik,
              metadata: {
                source: "sec-edgar",
                importedBy: "backfill-security-company-links",
                ...(nameZh ? { nameZh } : {}),
                nameEnShort,
              },
            },
            select: { id: true },
          }).catch(async (err) => {
            // Another entity with same CIK may exist (race / legacy type). Reuse it.
            const conflict = await db.entity.findUnique({ where: { cik: secRef.cik }, select: { id: true } });
            if (conflict) return conflict;
            throw err;
          });
          companyId = created.id;
          companyById.add(created.id);
          companyMetaById.set(created.id, { cik: secRef.cik, type: "company" });
          companyByTicker.set(resolvedTicker, { id: created.id, cik: secRef.cik, type: "company" });
          createdCompany++;

          // If this newly-created company shell's CIK belongs to one of our
          // tracked filers, link it back so future runs never have to guess
          // again — this is the guardrail that prevents the Berkshire class
          // of bug from recurring for a future dual-natured filer.
          const linkedFilerCompanyId = filerCompanyByCik.get(secRef.cik);
          if (!linkedFilerCompanyId) {
            await db.filer.updateMany({
              where: { filerCik: secRef.cik, companyEntityId: null },
              data: { companyEntityId: created.id },
            });
            filerCompanyByCik.set(secRef.cik, created.id);
            filerCompanyByTicker.set(resolvedTicker, created.id);
          }
        }
      }
    }

    const willUpdateTicker = resolvedTicker && (row.ticker ?? null) !== resolvedTicker;
    const willLinkCompany = companyId && row.companyEntityId !== companyId;
    const willNormalizeCusip = normalizedCusip != null && normalizedCusip !== row.cusip;
    const hasAnyChange = Boolean(willUpdateTicker || willLinkCompany || willNormalizeCusip);

    if (!hasAnyChange) {
      kept++;
    } else {
      updated++;
      if (willLinkCompany) linked++;
    }

    if (!companyId || !resolvedTicker) {
      unresolved++;
      if (normalizedCusip) unresolvedWithCusip++;
    }

    if (dryRun || !hasAnyChange) continue;

    const nextSecMeta = { ...secMeta };
    if (normalizedCusip) {
      nextSecMeta.cusip = normalizedCusip;
    }
    if (companyId) {
      nextSecMeta.companyEntityId = companyId;
    }
    if (resolvedTicker) {
      nextSecMeta.ticker = resolvedTicker;
    }

    await db.security.update({
      where: { id: row.id },
      data: {
        cusip: normalizedCusip ?? row.cusip,
        ticker: resolvedTicker ?? row.ticker,
        companyEntityId: companyId ?? row.companyEntityId,
        metadata: toJsonObject(nextSecMeta),
      },
    });
  }

  const report = {
    mode: dryRun ? "dry-run" : "live",
    strict,
    totalSecurities: rows.length,
    kept,
    updated,
    linked,
    createdCompany,
    unresolved,
    unresolvedWithCusip,
  };

  console.log(JSON.stringify(report, null, 2));

  if (strict && unresolvedWithCusip > 0) {
    throw new Error(`strict mode failed: unresolvedWithCusip=${unresolvedWithCusip}`);
  }

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("[backfill-security-company-links] fatal", err);
  await db.$disconnect();
  process.exit(1);
});

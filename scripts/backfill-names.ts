/**
 * backfill-names.ts
 *
 * Patches existing company/security entities in the DB:
 *   - Sets ticker from CompanyNameMap(issuer) when currently null
 *   - Sets/overwrites nameZh from CompanyNameMap(ticker/issuer)
 *   - Ignores English-only nameZh values in CompanyNameMap so they do not poison future backfills
 *   - Optionally translates missing/English-only nameZh values via AI_API_* when --translate is passed
 *   - Updates nameEnShort from normalizeEnglishName
 *
 * Usage:
 *   npx dotenv -e .env.local -- npx tsx scripts/backfill-names.ts
 *   npx dotenv -e .env.local -- npx tsx scripts/backfill-names.ts --dry-run
 */
import { PrismaClient } from "@prisma/client";
import {
  hasChineseText,
  normalizeEnglishName,
  issuerKey,
} from "../src/lib/company-name-map";
import { translateCompanyNameToZh, upsertNameMapEntries } from "./lib/company-name-zh";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const translateMissing = process.argv.includes("--translate");

async function main() {
  console.log(`[backfill-names] mode=${dryRun ? "dry-run" : "live"} translate=${translateMissing ? "on" : "off"}`);
  const rows = await db.companyNameMap.findMany({
    where: { keyType: { in: ["ticker", "issuer"] } },
    select: { keyType: true, key: true, ticker: true, nameZh: true },
  });
  const zhByTicker = new Map<string, string>();
  const zhByIssuer = new Map<string, string>();
  const tickerByIssuer = new Map<string, string>();
  for (const row of rows) {
    if (row.keyType === "ticker") {
      if (hasChineseText(row.nameZh)) zhByTicker.set(row.key.toUpperCase(), row.nameZh);
      continue;
    }
    if (hasChineseText(row.nameZh)) zhByIssuer.set(row.key, row.nameZh);
    if (row.ticker) tickerByIssuer.set(row.key, row.ticker.toUpperCase());
  }

  const entities = await db.entity.findMany({
    where: { type: "company" },
    select: { id: true, canonicalName: true, ticker: true, metadata: true },
  });

  console.log(`[backfill-names] found ${entities.length} company entities`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const entity of entities) {
    const meta = (entity.metadata as Record<string, unknown> | null) ?? {};
    const metaNameZh = typeof meta.nameZh === "string" ? meta.nameZh : null;
    const existingNameZh = hasChineseText(metaNameZh) ? metaNameZh : null;
    const key = issuerKey(entity.canonicalName);
    const resolvedTicker = entity.ticker?.toUpperCase() ?? tickerByIssuer.get(key) ?? null;
    let resolvedZh =
      (resolvedTicker ? zhByTicker.get(resolvedTicker) : null) ??
      zhByIssuer.get(key) ??
      null;
    const resolvedEnShort = normalizeEnglishName(entity.canonicalName);

    if (!resolvedZh && translateMissing && !dryRun) {
      try {
        resolvedZh = await translateCompanyNameToZh({
          englishName: entity.canonicalName,
          ticker: resolvedTicker,
        });
        await upsertNameMapEntries({
          db,
          issuerKey: key,
          ticker: resolvedTicker,
          nameZh: resolvedZh,
          nameEnShort: resolvedEnShort,
          source: "llm-translation",
        });
        zhByIssuer.set(key, resolvedZh);
        if (resolvedTicker) zhByTicker.set(resolvedTicker, resolvedZh);
      } catch (err) {
        failed++;
        console.error(`[backfill-names] translate failed: ${entity.canonicalName} | ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Determine what needs updating
    const needsZh = resolvedZh !== null && resolvedZh !== existingNameZh;
    const needsTicker = resolvedTicker !== null && entity.ticker !== resolvedTicker;
    const needsEnShort = resolvedEnShort !== meta.nameEnShort;

    if (!needsZh && !needsTicker && !needsEnShort) {
      skipped++;
      continue;
    }

    const newZh = resolvedZh ?? existingNameZh ?? metaNameZh ?? resolvedEnShort;
    const changes: string[] = [];
    if (needsZh) changes.push(`nameZh: "${existingNameZh ?? "(none)"}" → "${newZh}"`);
    if (needsTicker) changes.push(`ticker: "${entity.ticker ?? "null"}" → "${resolvedTicker}"`);
    if (needsEnShort) changes.push(`nameEnShort: "${meta.nameEnShort ?? "(none)"}" → "${resolvedEnShort}"`);

    console.log(`[backfill-names] ${entity.canonicalName} | ${changes.join(" | ")}`);

    if (!dryRun) {
      await db.entity.update({
        where: { id: entity.id },
        data: {
          ticker: needsTicker ? resolvedTicker : entity.ticker,
          metadata: {
            ...meta,
            nameZh: newZh,
            nameEnShort: resolvedEnShort,
          },
        },
      });
    }
    updated++;
  }

  console.log(`\n[backfill-names] done — updated=${dryRun ? `${updated} (dry-run)` : updated} skipped=${skipped} failed=${failed}`);
  await db.$disconnect();
}

main().catch((err) => {
  console.error("[backfill-names] fatal", err);
  process.exit(1);
});

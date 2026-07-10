/**
 * Slim ExtSource.metadata: archive the full JSON to R2, keep only the fields
 * the app and pipelines actually read (audited 2026-06-13):
 *   - accession / accessionNumber (company page filing dedupe)
 *   - form (company page display + kind preference)
 *   - primaryDocument, importedBy, edgartools, filingSectionExtraction (small ops fields)
 * Everything else (tocJson, full EDGAR filing index, files arrays) is dead
 * weight inside Postgres — 893 rows carried 38MB of it.
 *
 * Usage:
 *   tsx scripts/slim-ext-source-metadata.ts --dry-run
 *   tsx scripts/slim-ext-source-metadata.ts
 */

import { Prisma } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { uploadToR2 } from "../src/lib/r2";

const KEEP_KEYS = [
  "accession",
  "accessionNumber",
  "form",
  "primaryDocument",
  "importedBy",
  "edgartools",
  "filingSectionExtraction",
  "metaArchivedKey",
] as const;

const SIZE_THRESHOLD_BYTES = 4096;

function trimMetadata(metadata: Record<string, unknown>, archiveKey: string): Prisma.InputJsonValue {
  const trimmed: Record<string, unknown> = { metaArchivedKey: archiveKey };
  for (const key of KEEP_KEYS) {
    if (key in metadata && metadata[key] != null) trimmed[key] = metadata[key];
  }
  return trimmed as Prisma.InputJsonValue;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const fatRows = await prisma.$queryRawUnsafe<Array<{ id: string; bytes: number }>>(`
    SELECT id, pg_column_size(metadata)::int AS bytes
    FROM "ExtSource"
    WHERE pg_column_size(metadata) > ${SIZE_THRESHOLD_BYTES}
    ORDER BY pg_column_size(metadata) DESC`);

  const totalMb = fatRows.reduce((acc, r) => acc + r.bytes, 0) / 1e6;
  console.log(`Found ${fatRows.length} ExtSource rows with metadata > ${SIZE_THRESHOLD_BYTES / 1024}KB (total ${totalMb.toFixed(1)}MB)${dryRun ? " [DRY-RUN]" : ""}\n`);

  let archived = 0;
  let failed = 0;

  for (const row of fatRows) {
    const source = await prisma.extSource.findUnique({
      where: { id: row.id },
      select: { id: true, metadata: true },
    });
    if (!source?.metadata || typeof source.metadata !== "object" || Array.isArray(source.metadata)) continue;

    const metadata = source.metadata as Record<string, unknown>;
    const archiveKey = `buffett-tribe/sec/ext-source-meta/${source.id}.json`;

    if (dryRun) {
      const trimmed = trimMetadata(metadata, archiveKey);
      console.log(`  ${source.id}: ${(row.bytes / 1024).toFixed(0)}KB -> ~${(JSON.stringify(trimmed).length / 1024).toFixed(1)}KB (archive ${archiveKey})`);
      archived += 1;
      continue;
    }

    try {
      await uploadToR2(archiveKey, Buffer.from(JSON.stringify(metadata)), "application/json");
      await prisma.extSource.update({
        where: { id: source.id },
        data: { metadata: trimMetadata(metadata, archiveKey) },
      });
      archived += 1;
      if (archived % 100 === 0) console.log(`  ...${archived}/${fatRows.length}`);
    } catch (err) {
      failed += 1;
      console.error(`  FAILED ${source.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\nDone: ${archived} archived+trimmed, ${failed} failed.`);
  if (!dryRun && archived > 0) {
    console.log(`Run VACUUM FULL "ExtSource" (via vacuum-bloated-tables script) to reclaim disk.`);
  }
  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("[slim-ext-source-metadata] fatal", err);
  await prisma.$disconnect();
  process.exit(1);
});

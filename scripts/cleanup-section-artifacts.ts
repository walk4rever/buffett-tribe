/**
 * Delete section_blocks FilingArtifact rows and their corresponding R2
 * objects. filing-section-storage.ts stopped writing this kind on 2026-08-30
 * (zero production consumers — see handoff.md "效率问题"); this clears the
 * pre-existing backlog it left behind.
 *
 * FilingSection.blocksArtifactId has onDelete: SetNull, so DB delete
 * propagates cleanly.
 *
 * DO NOT widen the `kind` filter back to include section_text/section_html.
 * This script originally deleted all three kinds in one pass (2026-06-13,
 * 9722cc8a) on the theory that the new iframe reader made all of them
 * unused — that was wrong for section_text: it's the only full-text copy for
 * HK/CN annual reports (no primary_html to re-derive from) and for 40-F
 * EX-99 attachment sections, and running it unnarrowed a second time would
 * destroy both again (see handoff.md for the incident this caused).
 *
 * Usage:
 *   tsx scripts/cleanup-section-artifacts.ts [--dry-run]
 */

import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import prisma from "../src/lib/prisma";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH = 1000;

const BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME!;
const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.CLOUDFLARE_R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
  },
});

async function deleteR2Batch(keys: string[]) {
  if (!keys.length) return;
  const res = await r2.send(
    new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }),
  );
  if (res.Errors?.length) {
    for (const e of res.Errors) {
      console.error(`  R2 delete error key=${e.Key} code=${e.Code} msg=${e.Message}`);
    }
  }
}

async function main() {
  const rows = await prisma.filingArtifact.findMany({
    where: { kind: "section_blocks" },
    select: { id: true, objectKey: true, kind: true },
    orderBy: { kind: "asc" },
  });

  const byKind = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.kind] = (acc[r.kind] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`Section artifacts to delete${DRY_RUN ? " (dry-run)" : ""}:`);
  for (const [kind, count] of Object.entries(byKind)) {
    console.log(`  ${kind}: ${count}`);
  }
  console.log(`  total: ${rows.length}`);

  if (DRY_RUN) {
    console.log("\n(dry-run: no writes)");
    return;
  }

  // Delete from R2 in batches of 1000
  const keys = rows.map((r) => r.objectKey);
  for (let i = 0; i < keys.length; i += BATCH) {
    const batch = keys.slice(i, i + BATCH);
    process.stdout.write(`  R2 delete ${i + 1}–${Math.min(i + BATCH, keys.length)}/${keys.length}…`);
    await deleteR2Batch(batch);
    console.log(" done");
  }

  // Delete from DB (onDelete: SetNull nulls the FK in FilingSection)
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    process.stdout.write(`  DB delete ${i + 1}–${Math.min(i + BATCH, ids.length)}/${ids.length}…`);
    await prisma.filingArtifact.deleteMany({ where: { id: { in: batch } } });
    console.log(" done");
  }

  console.log(`\nDone: deleted ${rows.length} section artifacts from R2 + DB`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

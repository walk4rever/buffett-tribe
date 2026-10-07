/**
 * Cleanup orphaned `data_file` FilingArtifact records and delete their R2 objects.
 *
 * Background:
 * Early ingestion pipelines archived raw SEC XBRL linkbases and data files (.xml, .xsd)
 * into Cloudflare R2 under kind "data_file".
 *
 * First-principles audit confirms:
 * - 0 production consumers in src/
 * - 0 references in FilingSection (textArtifactId / blocksArtifactId / htmlArtifactId)
 * - 0 references in Financial.sourceFactIds
 * - SEC EDGAR already provides free, permanent, canonical storage for these raw files.
 *
 * Usage:
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/cleanup-data-file-artifacts.ts            # Dry run
 *   node --env-file=.env.local ./node_modules/.bin/tsx scripts/cleanup-data-file-artifacts.ts --execute  # Execute
 */

import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import prisma from "../src/lib/prisma";

const BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME!;
const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.CLOUDFLARE_R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
  },
});

const BATCH_SIZE = 500;

async function deleteR2Batch(keys: string[]) {
  if (!keys.length) return 0;
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
  return res.Deleted?.length ?? keys.length;
}

async function main() {
  const isExecute = process.argv.includes("--execute");

  console.log("=== Cleanup data_file FilingArtifacts (Raw XBRL linkbases) ===");
  console.log(`Mode: ${isExecute ? "EXECUTE (Permanent deletion)" : "DRY RUN (No data modified)"}\n`);

  const artifacts = await prisma.filingArtifact.findMany({
    where: { kind: "data_file" },
    select: { id: true, objectKey: true, sizeBytes: true, originalName: true },
  });

  const totalBytes = artifacts.reduce((sum, a) => sum + Number(a.sizeBytes || 0), 0);
  const totalMb = (totalBytes / 1024 / 1024).toFixed(2);

  console.log(`Found ${artifacts.length} data_file records (${totalMb} MB) in database.`);

  if (artifacts.length === 0) {
    console.log("No data_file records found. Nothing to clean up.");
    return;
  }

  if (!isExecute) {
    console.log("\nSample keys to be removed from R2 & DB:");
    for (const sample of artifacts.slice(0, 5)) {
      console.log(`  - [${sample.id}] ${sample.objectKey} (${sample.originalName})`);
    }
    console.log(`\n[DRY RUN] Run with --execute to permanently delete from R2 and database.`);
    return;
  }

  console.log("\n1. Deleting objects from Cloudflare R2...");
  const keys = artifacts.map((a) => a.objectKey);
  let r2Deleted = 0;
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const chunk = keys.slice(i, i + BATCH_SIZE);
    await deleteR2Batch(chunk);
    r2Deleted += chunk.length;
    console.log(`  Deleted ${r2Deleted}/${keys.length} R2 objects...`);
  }

  console.log("\n2. Deleting records from PostgreSQL database...");
  const ids = artifacts.map((a) => a.id);
  let dbDeleted = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const res = await prisma.filingArtifact.deleteMany({
      where: { id: { in: chunk } },
    });
    dbDeleted += res.count;
    console.log(`  Deleted ${dbDeleted}/${ids.length} database records...`);
  }

  console.log(`\n✓ Cleanup complete! Successfully deleted ${dbDeleted} records and freed ${totalMb} MB.`);
}

main()
  .catch((err) => {
    console.error("Cleanup failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

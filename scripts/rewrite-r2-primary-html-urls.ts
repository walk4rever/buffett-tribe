/**
 * Batch-rewrite relative URLs in existing primary_html R2 artifacts to absolute
 * https://www.sec.gov/... URLs.
 *
 * Queries all primary_html FilingArtifact rows, downloads each from R2,
 * rewrites, and re-uploads only if the content changed. Updates sizeBytes
 * and sha256 in DB to match the new content.
 *
 * Usage:
 *   tsx scripts/rewrite-r2-primary-html-urls.ts [--dry-run] [--limit N]
 */

import crypto from "node:crypto";
import prisma from "../src/lib/prisma";
import { getR2ObjectBuffer, uploadToR2 } from "../src/lib/r2";
import { rewriteSecHtmlUrls } from "./lib/sec-html-rewriter";
import { mapLimit } from "./lib/annual-report-import-core";

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function getArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const DRY_RUN = hasFlag("--dry-run");
const LIMIT = getArg("--limit") ? Number(getArg("--limit")) : undefined;
const CONCURRENCY = 3;

async function main() {
  const artifacts = await prisma.filingArtifact.findMany({
    where: { kind: "primary_html", sourceUrl: { not: null } },
    select: { id: true, objectKey: true, sourceUrl: true, sizeBytes: true },
    orderBy: { createdAt: "asc" },
    ...(LIMIT ? { take: LIMIT } : {}),
  });

  console.log(`Found ${artifacts.length} primary_html artifacts to process${DRY_RUN ? " (dry-run)" : ""}`);

  let rewritten = 0;
  let skipped = 0;
  let errored = 0;

  await mapLimit(artifacts, CONCURRENCY, async (artifact, idx) => {
    const label = `[${idx + 1}/${artifacts.length}] ${artifact.objectKey.split("/").slice(-3).join("/")}`;
    try {
      const original = await getR2ObjectBuffer(artifact.objectKey);
      const originalHtml = original.toString("utf8");
      const rewrittenHtml = rewriteSecHtmlUrls(originalHtml, artifact.sourceUrl!);

      if (rewrittenHtml === originalHtml) {
        console.log(`  ${label}: no-op (already absolute)`);
        skipped++;
        return;
      }

      const rewrittenBuf = Buffer.from(rewrittenHtml, "utf8");
      const sha256 = crypto.createHash("sha256").update(rewrittenBuf).digest("hex");

      console.log(
        `  ${label}: ${original.length.toLocaleString()} → ${rewrittenBuf.length.toLocaleString()} bytes`,
      );

      if (!DRY_RUN) {
        await uploadToR2(artifact.objectKey, rewrittenBuf, "text/html; charset=utf-8");
        await prisma.filingArtifact.update({
          where: { id: artifact.id },
          data: { sizeBytes: BigInt(rewrittenBuf.length), sha256 },
        });
      }
      rewritten++;
    } catch (err) {
      console.error(`  ${label}: ERROR ${err instanceof Error ? err.message : String(err)}`);
      errored++;
    }
  });

  console.log(`\nDone: rewritten=${rewritten} skipped=${skipped} errored=${errored}`);
  if (DRY_RUN) console.log("(dry-run: no R2 or DB writes)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

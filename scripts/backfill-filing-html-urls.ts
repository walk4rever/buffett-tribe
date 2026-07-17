/**
 * Re-apply rewriteSecHtmlUrls() to already-archived primary_html filing
 * artifacts in R2 and overwrite them in place.
 *
 * Why: rewriteSecHtmlUrls() (which converts relative href/src/action/data
 * attributes in SEC HTML to absolute https://www.sec.gov/... URLs) was only
 * added 2026-06-13 (b5cee181). Every primary_html artifact archived before
 * that date still has the original relative URLs baked into the R2 object —
 * most visibly, <img src="img119055556_0.jpg"> resolves against the current
 * page (/api/filing-html?sourceId=...) instead of SEC, so images render
 * broken. Re-running import:10k does NOT fix this: archiveFilingArtifact()
 * short-circuits on an existing objectKey and never re-uploads.
 *
 * This script reads each artifact straight from R2, re-runs the (idempotent)
 * rewrite against its stored sourceUrl, and only re-uploads when the content
 * actually changed — no SEC EDGAR calls, no re-extraction, sections/
 * financials are untouched.
 *
 * Usage:
 *   npm run backfill:filing-html-urls -- --dry-run
 *   npm run backfill:filing-html-urls -- --ticker TEM --dry-run
 *   npm run backfill:filing-html-urls
 *   npm run backfill:filing-html-urls -- --limit 20 --concurrency 4
 */

import crypto from "node:crypto";
import prisma from "@/lib/prisma";
import { getR2ObjectBuffer, uploadToR2 } from "@/lib/r2";
import { rewriteSecHtmlUrls } from "./lib/sec-html-rewriter";

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  return args.find((_, i) => args[i - 1] === flag);
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

async function runPool<T>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await fn(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const limitArg = getArg("--limit");
  const limit = limitArg ? Number.parseInt(limitArg, 10) : undefined;
  const ticker = getArg("--ticker")?.trim().toUpperCase();
  const concurrency = Number.parseInt(getArg("--concurrency") ?? "1", 10);

  const artifacts = await prisma.filingArtifact.findMany({
    where: {
      kind: "primary_html",
      ...(ticker ? { source: { is: { filer: { is: { ticker: { equals: ticker, mode: "insensitive" } } } } } } : {}),
    },
    select: { id: true, objectKey: true, sourceUrl: true, contentType: true },
    orderBy: { createdAt: "asc" },
    ...(limit ? { take: limit } : {}),
  });

  console.log(`Found ${artifacts.length} primary_html artifacts${ticker ? ` for ${ticker}` : ""}${dryRun ? " (dry-run)" : ""}`);

  let fixed = 0;
  let unchanged = 0;
  let skippedNoUrl = 0;
  let failed = 0;

  await runPool(artifacts, concurrency, async (artifact, index) => {
    const prefix = `[${index + 1}/${artifacts.length}] ${artifact.objectKey}`;

    if (!artifact.sourceUrl) {
      skippedNoUrl++;
      console.log(`${prefix} — skip: no sourceUrl on record`);
      return;
    }

    try {
      const buffer = await getR2ObjectBuffer(artifact.objectKey);
      const html = buffer.toString("utf8");
      const rewritten = rewriteSecHtmlUrls(html, artifact.sourceUrl);

      if (rewritten === html) {
        unchanged++;
        console.log(`${prefix} — already correct`);
        return;
      }

      if (dryRun) {
        fixed++;
        console.log(`${prefix} — would fix`);
        return;
      }

      const newBuffer = Buffer.from(rewritten, "utf8");
      const sha256 = crypto.createHash("sha256").update(newBuffer).digest("hex");
      await uploadToR2(artifact.objectKey, newBuffer, artifact.contentType);
      await prisma.filingArtifact.update({
        where: { id: artifact.id },
        data: { sizeBytes: BigInt(newBuffer.length), sha256 },
      });
      fixed++;
      console.log(`${prefix} — fixed`);
    } catch (err) {
      failed++;
      console.error(`${prefix} — FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  console.log(
    `\nDone. fixed=${fixed} unchanged=${unchanged} skippedNoUrl=${skippedNoUrl} failed=${failed} total=${artifacts.length}`,
  );
  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("[backfill-filing-html-urls] fatal", err instanceof Error ? err.message : String(err));
  await prisma.$disconnect();
  process.exit(1);
});

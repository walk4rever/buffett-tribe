/**
 * Create ExtSource records for CN/HK annual reports without fetching PDFs or
 * slicing — P1 lightweight variant.
 *
 * For CN: queries cninfo API for annual report list
 * For HK: queries HKEXnews API for annual report list
 *
 * Usage:
 *   npm run create:cn-hk-annual-extsource -- --ticker 600519.SS --market cn --code 600519 --from-year 2020
 *   npm run create:cn-hk-annual-extsource -- --ticker 0700.HK --market hk --code 00700 --from-year 2020
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

type ReportMetadata = {
  periodYear: number;
  url: string;
  form?: string;
  filingKind?: "cn-annual-report" | "cn-prospectus" | "hk-annual-report";
  metadata?: Record<string, unknown>;
};

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  return args.find((_, i) => args[i - 1] === flag);
}

function runPythonHelper(params: {
  python: string;
  args: string[];
  timeoutMs: number;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(params.python, params.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`Python helper timeout after ${params.timeoutMs}ms`));
    }, params.timeoutMs);

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`Python helper exited with code ${code}`));
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function main() {
  const ticker = getArg("--ticker");
  const code = getArg("--code");
  const market = getArg("--market");
  const fromYearArg = getArg("--from-year");
  const python = getArg("--python") ?? path.join(process.cwd(), ".venv/bin/python");

  if (!ticker || !code || !market) {
    throw new Error("Missing required args. Usage: --ticker <T> --code <C> --market <cn|hk> [--from-year <YYYY>]");
  }

  if (market !== "cn" && market !== "hk") {
    throw new Error(`Invalid --market "${market}". Expected cn or hk.`);
  }

  const fromYear = fromYearArg ? Number.parseInt(fromYearArg, 10) : 2020;
  if (!Number.isFinite(fromYear)) throw new Error("Invalid --from-year");

  const entity = await prisma.entity.findFirst({
    where: { type: "company", market, code },
    select: { id: true, cik: true },
  });

  if (!entity) {
    throw new Error(`No Entity found for market=${market} code=${code} — run seed_entity first`);
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), `${market}-annual-meta-`));
  const outputPath = path.join(tempDir, "reports.json");

  try {
    const helperScript = market === "cn"
      ? "scripts/helpers/fetch-cn-annual-report-metadata.py"
      : "scripts/helpers/fetch-hk-annual-report-metadata.py";

    await runPythonHelper({
      python,
      args: [
        helperScript,
        "--code", code,
        "--from-year", String(fromYear),
        "--output", outputPath,
      ],
      timeoutMs: 60000,
    });

    const raw = await readFile(outputPath, "utf8");
    const reports = JSON.parse(raw) as ReportMetadata[];

    let created = 0;
    let updated = 0;

    for (const report of reports) {
      const filingKind = report.filingKind ?? (market === "cn" ? "cn-annual-report" : "hk-annual-report");
      const accessionNumber = market === "cn"
        ? `${filingKind}-${report.periodYear}`
        : `hk-annual-report-${report.periodYear}`;

      const form = report.form ?? (filingKind === "cn-prospectus" ? "Prospectus" : "Annual Report");

      const metadata: Record<string, unknown> = {
        ticker,
        market,
        code,
        form,
        ...(report.metadata ?? {}),
      };

      const existing = await prisma.extSource.findUnique({
        where: { ExtSource_filer_accession_unique: { filerEntityId: entity.id, accessionNumber } },
        select: { id: true },
      });

      if (existing) {
        await prisma.extSource.update({
          where: { id: existing.id },
          data: { url: report.url, metadata: metadata as Prisma.InputJsonValue },
        });
        updated++;
      } else {
        await prisma.extSource.create({
          data: {
            kind: filingKind,
            filerEntityId: entity.id,
            accessionNumber,
            periodYear: report.periodYear,
            url: report.url,
            metadata: metadata as Prisma.InputJsonValue,
          },
        });
        created++;
      }
    }

    console.log(`✓ ${ticker}: Created ${created} ExtSource records, updated ${updated}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error("[create-cn-hk-annual-extsource] fatal", err instanceof Error ? err.message : String(err));
  await prisma.$disconnect();
  process.exit(1);
});

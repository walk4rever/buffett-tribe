/**
 * check-13f-quarter-coverage.ts
 *
 * For every tracked filer, compares our imported 13F quarters (ExtSource)
 * against the filer's real 13F-HR report dates on SEC EDGAR (ground truth,
 * fetched via edgartools — no filing.obj() calls, so this is cheap and safe)
 * from 2020Q1 onward. Flags any quarter EDGAR has that we don't.
 *
 * Usage:
 *   npm run check:13f-quarter-coverage
 *   npm run check:13f-quarter-coverage -- --json
 *   npm run check:13f-quarter-coverage -- --strict
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const json = process.argv.includes("--json");
const strict = process.argv.includes("--strict");

const START_QUARTER = { year: 2020, quarter: 1 };

function quarterKey(year: number, quarter: number): string {
  return `${year}Q${quarter}`;
}

function quarterOrdinal(year: number, quarter: number): number {
  return year * 4 + quarter;
}

function reportDateToQuarter(dateStr: string): { year: number; quarter: number } {
  const [year, month] = dateStr.split("-").map(Number);
  return { year, quarter: Math.ceil(month / 3) };
}

async function getEdgarQuarters(cik: string, python: string): Promise<Array<{ year: number; quarter: number }>> {
  const res = spawnSync(python, ["scripts/edgartools_13f_report_dates.py", "--cik", cik], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(res.stderr?.trim() || `edgartools_13f_report_dates.py exited with code ${res.status}`);
  }
  const payload = JSON.parse(res.stdout) as { reportDates: string[] };
  return payload.reportDates.map(reportDateToQuarter);
}

type FilerResult = {
  tribeId: string;
  name: string;
  cik: string | null;
  earliestOnEdgar: string | null;
  latestOnEdgar: string | null;
  expectedCount: number;
  missing: string[];
  status: "ok" | "gap" | "no-cik" | "no-edgar-history" | "error";
  error?: string;
};

async function main() {
  const filers = await db.filer.findMany({
    select: { tribeId: true, name: true, filerCik: true, filerEntityId: true },
    orderBy: { tribeId: "asc" },
  });
  const python = process.env.EDGARTOOLS_PYTHON || path.join(process.cwd(), ".venv/bin/python");

  const results: FilerResult[] = [];

  for (const filer of filers) {
    if (!filer.filerCik) {
      results.push({
        tribeId: filer.tribeId,
        name: filer.name,
        cik: null,
        earliestOnEdgar: null,
        latestOnEdgar: null,
        expectedCount: 0,
        missing: [],
        status: "no-cik",
      });
      continue;
    }

    let edgarQuarters: Array<{ year: number; quarter: number }>;
    try {
      edgarQuarters = await getEdgarQuarters(filer.filerCik, python);
    } catch (err) {
      results.push({
        tribeId: filer.tribeId,
        name: filer.name,
        cik: filer.filerCik,
        earliestOnEdgar: null,
        latestOnEdgar: null,
        expectedCount: 0,
        missing: [],
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const relevant = edgarQuarters
      .filter((q) => quarterOrdinal(q.year, q.quarter) >= quarterOrdinal(START_QUARTER.year, START_QUARTER.quarter))
      .sort((a, b) => quarterOrdinal(a.year, a.quarter) - quarterOrdinal(b.year, b.quarter));

    if (!relevant.length) {
      results.push({
        tribeId: filer.tribeId,
        name: filer.name,
        cik: filer.filerCik,
        earliestOnEdgar: null,
        latestOnEdgar: null,
        expectedCount: 0,
        missing: [],
        status: "no-edgar-history",
      });
      continue;
    }

    const dbRows = await db.extSource.findMany({
      where: { kind: "13f", filerEntityId: filer.filerEntityId },
      select: { periodYear: true, periodQuarter: true },
    });
    const dbQuarters = new Set(
      dbRows
        .filter((r) => r.periodYear != null && r.periodQuarter != null)
        .map((r) => quarterKey(r.periodYear!, r.periodQuarter!)),
    );

    const missing = relevant.filter((q) => !dbQuarters.has(quarterKey(q.year, q.quarter)));

    results.push({
      tribeId: filer.tribeId,
      name: filer.name,
      cik: filer.filerCik,
      earliestOnEdgar: quarterKey(relevant[0].year, relevant[0].quarter),
      latestOnEdgar: quarterKey(relevant[relevant.length - 1].year, relevant[relevant.length - 1].quarter),
      expectedCount: relevant.length,
      missing: missing.map((q) => quarterKey(q.year, q.quarter)),
      status: missing.length === 0 ? "ok" : "gap",
    });
  }

  const gapCount = results.filter((r) => r.status === "gap").length;
  const errorCount = results.filter((r) => r.status === "error").length;

  if (json) {
    console.log(JSON.stringify({ startQuarter: quarterKey(START_QUARTER.year, START_QUARTER.quarter), results, gapCount, errorCount }, null, 2));
  } else {
    console.log(`13F quarter coverage check (floor: ${quarterKey(START_QUARTER.year, START_QUARTER.quarter)})\n`);
    for (const r of results) {
      if (r.status === "ok") {
        console.log(`✓ ${r.name} (${r.tribeId}): ${r.earliestOnEdgar}–${r.latestOnEdgar}, ${r.expectedCount}/${r.expectedCount} quarters present`);
      } else if (r.status === "gap") {
        console.log(`✗ ${r.name} (${r.tribeId}): ${r.earliestOnEdgar}–${r.latestOnEdgar}, missing ${r.missing.length}/${r.expectedCount} — ${r.missing.join(", ")}`);
      } else if (r.status === "no-cik") {
        console.log(`- ${r.name} (${r.tribeId}): no filerCik on record, skipped`);
      } else if (r.status === "no-edgar-history") {
        console.log(`- ${r.name} (${r.tribeId}): no 13F-HR filings on EDGAR at/after ${quarterKey(START_QUARTER.year, START_QUARTER.quarter)}`);
      } else {
        console.log(`! ${r.name} (${r.tribeId}): check failed — ${r.error}`);
      }
    }
    console.log(`\nSummary: ${results.length} filers checked, ${gapCount} with gaps, ${errorCount} check failures`);
  }

  if (strict && (gapCount > 0 || errorCount > 0)) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("[check-13f-quarter-coverage] fatal", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });

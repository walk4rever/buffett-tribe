import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import db from "../src/lib/prisma.js";

type ParsedArgs = {
  batchSize: number;
  start: string;
  end: string | null;
  outDir: string;
  checkpointFile: string;
  fresh: boolean;
  failFast: boolean;
  keepFiles: boolean;
};

function getArgValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index >= 0 && index + 1 < argv.length) return argv[index + 1];
  const prefixed = argv.find((arg) => arg.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : undefined;
}

function parseArgs(): ParsedArgs {
  const argv = process.argv.slice(2);
  return {
    batchSize: Number(getArgValue(argv, "--batch-size") ?? "10"),
    start: getArgValue(argv, "--start") ?? "2020-01-01",
    end: getArgValue(argv, "--end") ?? null,
    outDir: getArgValue(argv, "--out-dir") ?? "/tmp/stock-prices-yf",
    checkpointFile:
      getArgValue(argv, "--checkpoint-file") ?? ".cache/stock-prices-yf/checkpoints-company.json",
    fresh: argv.includes("--fresh"),
    failFast: argv.includes("--fail-fast"),
    keepFiles: argv.includes("--keep-files"),
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error("batch-size must be positive");
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

async function main() {
  const args = parseArgs();
  const companies = await db.entity.findMany({
    where: {
      type: "company",
    },
    select: { id: true, ticker: true, canonicalName: true },
    orderBy: { ticker: "asc" },
  });

  const securities = await db.security.findMany({
    where: {
      companyEntityId: { in: companies.map((company) => company.id) },
      ticker: { not: null },
    },
    select: { ticker: true },
  });

  const tickers = [...new Set([
    ...companies.map((row) => row.ticker?.trim().toUpperCase()),
    ...securities.map((row) => row.ticker?.trim().toUpperCase()),
  ].filter(Boolean))].sort();
  if (!tickers.length) {
    throw new Error("No company or security tickers found");
  }

  const batches = chunk(tickers, args.batchSize);
  const python = existsSync(".venv/bin/python") ? ".venv/bin/python" : "python3";
  const scriptPath = path.resolve("scripts/fetch-stock-prices-yf.py");
  let failures = 0;

  console.log(`Found ${tickers.length} company/security tickers. Running ${batches.length} batches of ${args.batchSize}.`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchLabel = `${i + 1}/${batches.length}`;
    const command = [
      scriptPath,
      "--tickers",
      batch.join(","),
      "--start",
      args.start,
      "--out-dir",
      args.outDir,
      "--checkpoint-file",
      args.checkpointFile,
      ...(args.end ? ["--end", args.end] : []),
      ...(args.fresh ? ["--fresh"] : []),
      ...(args.failFast ? ["--fail-fast"] : []),
      ...(args.keepFiles ? ["--keep-files"] : []),
      "--import-db",
    ];

    console.log(`Batch ${batchLabel}: ${batch.join(", ")}`);
    const result = spawnSync(python, command, {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
    });

    if (result.status !== 0) {
      failures += 1;
      console.error(`Batch ${batchLabel} failed.`);
      if (args.failFast) break;
    }
  }

  await db.$disconnect();
  if (failures > 0) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error(err);
  try {
    await db.$disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});

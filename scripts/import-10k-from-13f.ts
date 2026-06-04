import { PrismaClient } from "@prisma/client";
import { spawn } from "node:child_process";

const db = new PrismaClient();

type RunResult = {
  ticker: string;
  ok: boolean;
  attempts: number;
  ms: number;
  error?: string;
};

type CliArgs = {
  fromYear: number;
  toYear: number;
  concurrency: number;
  retries: number;
  retryDelayMs: number;
  limit: number | null;
  investors: string[];
  tickerList: string[] | null;
  dryRun: boolean;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string) => argv.find((_, i) => argv[i - 1] === flag);
  const has = (flag: string) => argv.includes(flag);

  const fromArg = get("--from") ?? "2020";
  const toArg = get("--to") ?? String(new Date().getUTCFullYear() - 1);
  const concArg = get("--concurrency") ?? "3";
  const retriesArg = get("--retries") ?? "2";
  const retryDelayArg = get("--retry-delay-ms") ?? "2000";
  const limitArg = get("--limit");
  const investorsArg = get("--investors");
  const tickerListArg = get("--ticker-list");

  const fromYear = Number(fromArg);
  const toYear = Number(toArg);
  if (!Number.isFinite(fromYear) || !Number.isFinite(toYear) || fromYear > toYear) {
    throw new Error("Invalid --from/--to. Example: --from 2020 --to 2025");
  }

  const concurrency = Math.max(1, Number(concArg));
  const retries = Math.max(0, Number(retriesArg));
  const retryDelayMs = Math.max(0, Number(retryDelayArg));
  const limit = limitArg ? Math.max(1, Number(limitArg)) : null;
  const investors = (investorsArg ?? "buffett,lilu,duan")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const tickerList = tickerListArg
    ? tickerListArg.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : null;

  return {
    fromYear,
    toYear,
    concurrency,
    retries,
    retryDelayMs,
    limit,
    investors,
    tickerList,
    dryRun: has("--dry-run"),
  };
}

async function getTickersFrom13f(investors: string[]): Promise<{ tickers: string[]; unresolved: Array<{ issuer: string; cusip: string | null }> }> {
  const rows = await db.holding.findMany({
    where: {
      holder: { tribeId: { in: investors } },
      source: {
        kind: "13f",
        periodYear: { gte: 2020 },
      },
    },
    select: {
      security: {
        select: {
          ticker: true,
          cusip: true,
          titleOfClass: true,
          company: { select: { ticker: true, canonicalName: true } },
        },
      },
    },
  });

  const set = new Set<string>();
  const unresolvedByIssuer = new Map<string, { issuer: string; cusip: string | null }>();
  for (const r of rows) {
    const t = (
      r.security?.ticker ??
      r.security?.company?.ticker ??
      ""
    ).trim().toUpperCase();
    if (!t) {
      const issuer =
        r.security?.company?.canonicalName?.trim() ||
        r.security?.titleOfClass?.trim() ||
        "UNKNOWN_ISSUER";
      unresolvedByIssuer.set(issuer, {
        issuer,
        cusip: r.security?.cusip ?? null,
      });
      continue;
    }
    if (/[^A-Z0-9.\-]/.test(t)) continue;
    set.add(t);
  }

  return {
    tickers: [...set.values()].sort(),
    unresolved: [...unresolvedByIssuer.values()].sort((a, b) => a.issuer.localeCompare(b.issuer)),
  };
}

function runTickerImport(ticker: string, fromYear: number, toYear: number): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "--env-file=.env.local",
        "./node_modules/.bin/tsx",
        "scripts/import-10k-edgartools.ts",
        "--ticker",
        ticker,
        "--from",
        String(fromYear),
        "--to",
        String(toYear),
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: process.cwd(),
        env: process.env,
      },
    );

    let err = "";
    child.stderr.on("data", (d) => {
      err += d.toString();
    });

    child.on("close", (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: err.trim() || `exit ${code}` });
    });
  });
}

async function runWithRetry(ticker: string, args: CliArgs): Promise<RunResult> {
  const started = Date.now();
  let lastErr: string | undefined;

  for (let i = 0; i <= args.retries; i++) {
    const attempt = i + 1;
    const run = await runTickerImport(ticker, args.fromYear, args.toYear);
    if (run.ok) {
      return { ticker, ok: true, attempts: attempt, ms: Date.now() - started };
    }
    lastErr = run.error;
    if (attempt <= args.retries) await sleep(args.retryDelayMs);
  }

  return {
    ticker,
    ok: false,
    attempts: args.retries + 1,
    ms: Date.now() - started,
    error: lastErr,
  };
}

async function runPool(tickers: string[], args: CliArgs): Promise<RunResult[]> {
  const results: RunResult[] = [];
  let cursor = 0;

  const workers = Array.from({ length: args.concurrency }, async (_, workerId) => {
    while (true) {
      const idx = cursor++;
      if (idx >= tickers.length) return;
      const ticker = tickers[idx];
      const t0 = new Date().toISOString();
      console.log(`[${workerId + 1}] ${t0} start ${ticker} (${idx + 1}/${tickers.length})`);
      const r = await runWithRetry(ticker, args);
      results.push(r);
      const tag = r.ok ? "ok" : "fail";
      console.log(`[${workerId + 1}] ${new Date().toISOString()} ${tag} ${ticker} ${r.ms}ms attempts=${r.attempts}`);
      if (!r.ok && r.error) {
        const short = r.error.split("\n").slice(-1)[0]?.slice(0, 220) ?? "unknown";
        console.log(`  error: ${short}`);
      }
    }
  });

  await Promise.all(workers);
  return results.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const discovery = await getTickersFrom13f(args.investors);
  const discovered = discovery.tickers;
  const sourceTickers = args.tickerList
    ? [...new Set(args.tickerList.map((t) => t.trim().toUpperCase()).filter(Boolean))].sort()
    : discovered;
  const tickers = args.limit ? sourceTickers.slice(0, args.limit) : sourceTickers;

  console.log(
    JSON.stringify(
      {
        fromYear: args.fromYear,
        toYear: args.toYear,
        investors: args.investors,
        discoveredTickers: discovered.length,
        selectedTickers: tickers.length,
        concurrency: args.concurrency,
        retries: args.retries,
        dryRun: args.dryRun,
      },
      null,
      2,
    ),
  );

  if (args.dryRun || tickers.length === 0) {
    if (tickers.length) console.log(`sample: ${tickers.slice(0, 20).join(", ")}`);
    if (discovery.unresolved.length) {
      console.log(`unresolvedIssuerCount: ${discovery.unresolved.length}`);
      for (const item of discovery.unresolved.slice(0, 30)) {
        console.log(`  unresolved: issuer=${item.issuer} cusip=${item.cusip ?? "-"}`);
      }
    }
    return;
  }

  if (discovery.unresolved.length) {
    console.log(`unresolvedIssuerCount: ${discovery.unresolved.length}`);
    for (const item of discovery.unresolved.slice(0, 30)) {
      console.log(`  unresolved: issuer=${item.issuer} cusip=${item.cusip ?? "-"}`);
    }
  }

  const started = Date.now();
  const results = await runPool(tickers, args);
  const totalMs = Date.now() - started;

  const ok = results.filter((r) => r.ok);
  const fail = results.filter((r) => !r.ok);
  const avgMs = ok.length ? Math.round(ok.reduce((s, r) => s + r.ms, 0) / ok.length) : 0;

  console.log("\nSummary:");
  console.log(
    JSON.stringify(
      {
        total: results.length,
        success: ok.length,
        failed: fail.length,
        avgSuccessMs: avgMs,
        totalSeconds: Math.round(totalMs / 1000),
      },
      null,
      2,
    ),
  );

  if (fail.length) {
    const failedTickers = fail.map((f) => f.ticker);
    console.log(`failedTickers: ${failedTickers.join(",")}`);
  }
}

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });

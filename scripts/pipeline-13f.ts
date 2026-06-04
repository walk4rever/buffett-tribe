import { spawn } from "node:child_process";

type CmdResult = { code: number; stdout: string; stderr: string };

function run(cmd: string, args: string[]): Promise<CmdResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["inherit", "pipe", "pipe"], env: process.env, cwd: process.cwd() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      process.stdout.write(s);
    });
    child.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      process.stderr.write(s);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function parseJsonTail(text: string): Record<string, unknown> | null {
  const start = text.lastIndexOf("{");
  if (start < 0) return null;
  const maybe = text.slice(start);
  try {
    return JSON.parse(maybe) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const importArgs = args.filter((a) => a !== "--strict");

  console.log("\\n[1/3] Import 13F filings");
  const importRes = await run(process.execPath, ["--env-file=.env.local", "./node_modules/.bin/tsx", "scripts/import-13f-edgartools.ts", ...importArgs]);
  if (importRes.code !== 0) process.exit(importRes.code);

  console.log("\\n[2/3] Reconcile security/company linkage");
  const reconcileArgs = ["--env-file=.env.local", "./node_modules/.bin/tsx", "scripts/backfill-security-company-links.ts"];
  if (strict) reconcileArgs.push("--strict");
  const reconcileRes = await run(process.execPath, reconcileArgs);
  if (reconcileRes.code !== 0) process.exit(reconcileRes.code);

  console.log("\\n[3/3] Check security integrity");
  const checkRes = await run(process.execPath, ["--env-file=.env.local", "./node_modules/.bin/tsx", "scripts/check-security-integrity.ts"]);
  if (checkRes.code !== 0) process.exit(checkRes.code);

  const report = parseJsonTail(checkRes.stdout);
  if (report) {
    const unresolved = Number(report.withCusipNoTicker ?? 0);
    if (strict && unresolved > 0) {
      console.error(`strict mode failed: withCusipNoTicker=${unresolved}`);
      process.exit(1);
    }
  }

  console.log("\\n13F pipeline done.");
}

main().catch((err) => {
  console.error("[pipeline-13f] fatal", err);
  process.exit(1);
});

/**
 * Shared failure-isolated loop for running `onboard:company` over a list of
 * tickers. One ticker's failure is caught, logged, and skipped rather than
 * aborting the whole batch (same tolerance pattern as
 * import-13f-edgartools.ts's per-filing error handling).
 */
import { spawn } from "node:child_process";

export type OnboardBatchResult = {
  succeeded: string[];
  failed: Array<{ ticker: string; error: string }>;
};

function runCommand(cmd: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit", env: process.env, cwd: process.cwd() });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function onboardTickersWithFailureIsolation(
  tickers: string[],
  onSuccess?: (ticker: string) => Promise<void> | void,
): Promise<OnboardBatchResult> {
  const succeeded: string[] = [];
  const failed: Array<{ ticker: string; error: string }> = [];

  for (const ticker of tickers) {
    console.log(`\n  Onboarding ${ticker}...`);
    try {
      const code = await runCommand("npm", ["run", "onboard:company", "--", "--ticker", ticker]);
      if (code !== 0) throw new Error(`npm run onboard:company exited with code ${code}`);
      succeeded.push(ticker);
      if (onSuccess) await onSuccess(ticker);
    } catch (error: unknown) {
      const message = errorMessage(error);
      console.error(`  FAILED ${ticker}: ${message}`);
      failed.push({ ticker, error: message });
    }
  }

  return { succeeded, failed };
}

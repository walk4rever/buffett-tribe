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

export type OnboardBatchOptions = {
  market?: "us" | "cn" | "hk";
  phase?: "1" | "2" | "all";
  extraArgs?: string[];
  delayMs?: number;
  onSuccess?: (ticker: string) => Promise<void> | void;
};

export async function onboardTickersWithFailureIsolation(
  tickers: string[],
  optionsOrOnSuccess?: OnboardBatchOptions | ((ticker: string) => Promise<void> | void),
  legacyOnSuccess?: (ticker: string) => Promise<void> | void,
): Promise<OnboardBatchResult> {
  const options: OnboardBatchOptions =
    typeof optionsOrOnSuccess === "function"
      ? { onSuccess: optionsOrOnSuccess }
      : { ...optionsOrOnSuccess, onSuccess: optionsOrOnSuccess?.onSuccess ?? legacyOnSuccess };

  const succeeded: string[] = [];
  const failed: Array<{ ticker: string; error: string }> = [];

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    console.log(`\n  [${i + 1}/${tickers.length}] Onboarding ${ticker}...`);
    try {
      const args = ["run", "onboard:company", "--", "--ticker", ticker];
      if (options.market) args.push("--market", options.market);
      if (options.phase) args.push("--phase", options.phase);
      if (options.extraArgs) args.push(...options.extraArgs);

      const code = await runCommand("npm", args);
      if (code !== 0) throw new Error(`npm run onboard:company exited with code ${code}`);
      succeeded.push(ticker);
      if (options.onSuccess) await options.onSuccess(ticker);
    } catch (error: unknown) {
      const message = errorMessage(error);
      console.error(`  FAILED ${ticker}: ${message}`);
      failed.push({ ticker, error: message });
    }

    if (options.delayMs && i < tickers.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
  }

  return { succeeded, failed };
}


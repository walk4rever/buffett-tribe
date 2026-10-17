const DETERMINISTIC_ERROR_PATTERNS: RegExp[] = [
  /\b(?:http|status(?:\s+code)?)\s*[:=]?\s*(?:400|401|403|404|405|406|409|410|422)\b/i,
  /\b(?:400\s+bad\s+request|401\s+unauthorized|403\s+forbidden|404\s+not\s+found|422\s+unprocessable)\b/i,
  /\b(?:invalid\s+--|missing\s+--|cannot\s+derive\s+.*code|missing\s+ai_api_key|no\s+entity\s+found|empty\s+records\s+file|no\s+hk-annual-report\s+extsource\s+found|filingsection\s+text\s+is\s+empty|could\s+not\s+resolve\s+hk\s+reporting\s+currency|usage:\s+tsx)\b/i,
];

const TRANSIENT_ERROR_PATTERNS: RegExp[] = [
  /\b(?:ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPIPE|EHOSTUNREACH|ENETUNREACH|UND_ERR_[A-Z_]+)\b/i,
  /\b(?:fetch\s+failed|socket\s+hang\s+up|network\s+error|timed?\s*out|TimeoutError|AbortError|exited\s+with\s+code\s+124)\b/i,
  /\b(?:http|status(?:\s+code)?)\s*[:=]?\s*(?:408|429|500|502|503|504)\b/i,
  /\b(?:429\s+too\s+many\s+requests|rate\s*limit(?:ed)?|500\s+internal\s+server\s+error|502\s+bad\s+gateway|503\s+service\s+unavailable|504\s+gateway\s+timeout)\b/i,
  /\b(?:P1001|P1002|P1008|P1017|P2024|P2028|P2034|deadlock\s+detected|transaction\s+api\s+error|connection\s+pool|lock\s+timeout|serialization\s+failure|could\s+not\s+serialize)\b/i,
];

export interface StepCommandError extends Error {
  exitCode?: number;
  output?: string;
}

/**
 * Classifies whether an onboarding step error is transient (network jitter, rate limit,
 * 5xx, timeout, or transient DB lock contention) and safe to retry, vs. deterministic
 * (4xx client errors, missing records, invalid arguments) which should fail immediately.
 */
export function isRetryableStepError(err: unknown): boolean {
  if (!err) return false;

  const errObj = err as StepCommandError & { code?: string; name?: string };
  if (errObj.exitCode === 124 || errObj.name === "TimeoutError") {
    return true;
  }

  const combinedText = [
    err instanceof Error ? err.message : String(err),
    typeof errObj.code === "string" ? errObj.code : "",
    typeof errObj.output === "string" ? errObj.output : "",
  ]
    .filter(Boolean)
    .join("\n");

  for (const pattern of DETERMINISTIC_ERROR_PATTERNS) {
    if (pattern.test(combinedText)) {
      return false;
    }
  }

  for (const pattern of TRANSIENT_ERROR_PATTERNS) {
    if (pattern.test(combinedText)) {
      return true;
    }
  }

  return false;
}

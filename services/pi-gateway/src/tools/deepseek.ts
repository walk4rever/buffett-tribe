const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_TIMEOUT_MS = 20000;
const MAX_ATTEMPTS = 2;

export class DeepSeekToolError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "DeepSeekToolError";
  }
}

function apiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new DeepSeekToolError(
      "DEEPSEEK_API_KEY is not configured on the gateway. Add it to enable web search and fetch.",
    );
  }
  return key;
}

function baseUrl(): string {
  return (process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function retryDelayMs(): number {
  const raw = Number(process.env.DEEPSEEK_RETRY_DELAY_MS ?? 600);
  return Number.isFinite(raw) && raw >= 0 ? raw : 600;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function errorMessage(status: number, rawBody: string): string {
  let detail = "";
  try {
    const parsed = JSON.parse(rawBody) as { error?: { message?: string } };
    detail = parsed.error?.message ?? "";
  } catch {
    detail = rawBody.trim().slice(0, 300);
  }

  const summary: Record<number, string> = {
    400: "DeepSeek rejected the request",
    401: "DeepSeek API key is missing or invalid",
    402: "DeepSeek account balance is insufficient",
    403: "The page was blocked by DeepSeek's security policy",
    404: "DeepSeek could not fetch usable page content",
    408: "DeepSeek timed out reading the request",
    413: "The request body is too large for DeepSeek",
    429: "DeepSeek rate limit exceeded (5 QPS per account)",
    500: "DeepSeek server error",
    504: "DeepSeek downstream timeout",
  };
  const base = summary[status] ?? `DeepSeek API error ${status}`;
  return detail ? `${base}: ${detail}` : base;
}

function signalFor(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Calls DeepSeek's Search/Fetch JSON APIs. Both are read-only and share the
 *  same bearer key as the model; retry only transient failures once. */
export async function deepseekToolRequest<T>(
  path: "/v1/tools/search" | "/v1/tools/fetch",
  body: Record<string, unknown>,
  options: RequestOptions = {},
): Promise<T> {
  const key = apiKey();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (options.signal?.aborted) throw new DeepSeekToolError("Cancelled.");

    try {
      const response = await fetch(`${baseUrl()}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: signalFor(options.signal, timeoutMs),
      });

      if (response.ok) return (await response.json()) as T;

      const raw = await response.text();
      const message = errorMessage(response.status, raw);
      if (isRetryable(response.status) && attempt < MAX_ATTEMPTS - 1) {
        await sleep(retryDelayMs());
        continue;
      }
      throw new DeepSeekToolError(message, response.status);
    } catch (error) {
      if (error instanceof DeepSeekToolError) throw error;
      if (options.signal?.aborted) throw new DeepSeekToolError("Cancelled.");

      const timedOut = error instanceof Error && error.name === "TimeoutError";
      const message = timedOut
        ? "DeepSeek request timed out."
        : `DeepSeek request failed: ${error instanceof Error ? error.message : String(error)}`;
      lastError = new DeepSeekToolError(message);

      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(retryDelayMs());
        continue;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new DeepSeekToolError("DeepSeek request failed.");
}

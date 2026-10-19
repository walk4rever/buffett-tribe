export type CompanyMetricsView = "capital_allocation" | "valuation";

export type CompanyMetricsPayload = {
  available?: boolean;
  view?: CompanyMetricsView;
  company?: {
    entityId?: string;
    name?: string;
    nameZh?: string | null;
    ticker?: string;
    market?: string;
    reportingCurrency?: string | null;
    tradingCurrency?: string | null;
  };
  [key: string]: unknown;
};

export class CompanyMetricsRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CompanyMetricsRequestError";
  }
}

function appOrigin(): string {
  return (process.env.APP_ORIGIN || "https://vt.air7fun.com").replace(/\/+$/, "");
}

function requestSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(30_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** Read the compact computed company metrics from the Next.js app.
 *  The endpoint reuses getValueLineData() so capital allocation and valuation
 *  stay byte-for-byte aligned with the company page. */
export async function fetchCompanyMetrics(
  company: string,
  view: CompanyMetricsView,
  signal?: AbortSignal,
): Promise<CompanyMetricsPayload> {
  const secret = process.env.AGENT_SECRET;
  if (!secret) {
    throw new CompanyMetricsRequestError(
      "AGENT_SECRET is not configured on the gateway.",
    );
  }

  const url = new URL("/api/internal/company-metrics", appOrigin());
  url.searchParams.set("company", company.trim());
  url.searchParams.set("view", view);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Agent-Secret": secret,
      },
      signal: requestSignal(signal),
    });
  } catch (error) {
    if (signal?.aborted) throw new CompanyMetricsRequestError("Cancelled.");
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new CompanyMetricsRequestError(
      timedOut
        ? "Company metrics request timed out."
        : `Company metrics request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    let detail = body.trim().slice(0, 300);
    try {
      const parsed = JSON.parse(body) as { error?: string };
      detail = parsed.error?.trim() || detail;
    } catch {
      // Keep the short raw body.
    }
    throw new CompanyMetricsRequestError(
      detail || `Company metrics endpoint returned ${response.status}.`,
      response.status,
    );
  }

  try {
    return (await response.json()) as CompanyMetricsPayload;
  } catch {
    throw new CompanyMetricsRequestError("Company metrics endpoint returned invalid JSON.");
  }
}

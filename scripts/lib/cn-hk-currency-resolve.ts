// Resolves the reporting/functional currency for a CN/HK company's Financial
// rows. akshare exposes no currency field anywhere (checked both markets'
// company-profile and financial-statement endpoints) — see
// scripts/fetch-cn-hk-company-profile-ak.py's module docstring.
//
// CN is a hardcoded fact, not a per-company lookup: A-share listed companies
// are required (CSRC / mainland accounting rules) to report in RMB. Every CN
// entry ever hand-typed into the old scripts/lib/cn-hk-company-seeds.ts (贵州
// 茅台/中国神华/宁德时代/招商银行/泸州老窖/长江电力, 6/6) was CNY — zero
// exceptions.
//
// HK genuinely varies — 泡泡玛特 (09992) is HK-listed but reports in RMB, not
// HKD, confirmed against real FY2024 revenue figures (see TODOS.md P0 ②).
// So HK currency is extracted from the annual report text itself, which by
// pipeline order is only available after import_annual_report runs (see
// onboard-company.ts's HK step reordering) — this can't run at seed_entity
// time like the CN case.
import db from "@/lib/prisma";

export function resolveCnCurrency(): "CNY" {
  return "CNY";
}

type CurrencyGuess = "CNY" | "HKD" | "USD";

// Verified against 泡泡玛特's already-stored hk-annual-report FilingSection
// text: real financial-statement tables repeat a currency unit header on
// every column (e.g. "RMB'000" / "人民幣千元") dozens of times, while an
// incidental mention elsewhere (a subsidiary's functional currency in the
// notes, e.g. "美元" for a Hong Kong entity) shows up once or twice — a
// frequency count cleanly separates the two rather than matching on the
// first hit.
const CURRENCY_PATTERNS: Record<CurrencyGuess, RegExp> = {
  CNY: /RMB|人民[幣币]/g,
  HKD: /HK\$|港[元幣币]/g,
  USD: /US\$|美元/g,
};

const MIN_DOMINANT_COUNT = 5;
const MIN_DOMINANCE_RATIO = 3;

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

async function classifyCurrencyLlm(sampleText: string): Promise<CurrencyGuess | null> {
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_API_BASE_URL;
  const model = process.env.AI_MODEL;
  if (!apiKey || !baseUrl || !model) {
    throw new Error("Missing AI_API_KEY / AI_API_BASE_URL / AI_MODEL env vars for currency classification.");
  }

  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 4000,
      stream: false,
      messages: [
        {
          role: "system",
          content:
            "You read excerpts of company annual reports and answer only with the currency the financial statements are denominated in: CNY, HKD, or USD. No explanation.",
        },
        {
          role: "user",
          content: `What currency are the financial statements in this annual report excerpt denominated in? Answer only CNY, HKD, or USD.\n\n${sampleText.slice(0, 3000)}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
  const raw = (data.choices?.[0]?.message?.content ?? "").trim().toUpperCase();
  if (raw.includes("CNY")) return "CNY";
  if (raw.includes("HKD")) return "HKD";
  if (raw.includes("USD")) return "USD";
  return null;
}

// Reads the most recently imported hk-annual-report's FilingSection text for
// this entity and resolves the currency it's denominated in. Regex-first
// (frequency count over real repeated table headers), LLM fallback only if
// the regex can't find a clearly dominant currency. Throws rather than
// silently defaulting — an unresolved currency must not silently become
// "assume HKD", the exact mistake 泡泡玛特 already proved wrong once.
export async function resolveHkCurrencyFromAnnualReport(entityId: string): Promise<CurrencyGuess> {
  const latestSource = await db.extSource.findFirst({
    where: { filerEntityId: entityId, kind: "hk-annual-report" },
    orderBy: { periodYear: "desc" },
    select: { id: true },
  });
  if (!latestSource) {
    throw new Error(`No hk-annual-report ExtSource found for entity ${entityId} — run import_annual_report first.`);
  }

  const sections = await db.filingSection.findMany({
    where: { entityId, sourceId: latestSource.id },
    select: { content: true },
  });
  const text = sections.map((s) => s.content ?? "").join("\n");
  if (!text.trim()) {
    throw new Error(`hk-annual-report FilingSection text is empty for entity ${entityId} — cannot resolve currency.`);
  }

  const counts = Object.fromEntries(
    (Object.entries(CURRENCY_PATTERNS) as Array<[CurrencyGuess, RegExp]>).map(([currency, pattern]) => [
      currency,
      countMatches(text, pattern),
    ]),
  ) as Record<CurrencyGuess, number>;

  const sorted = (Object.entries(counts) as Array<[CurrencyGuess, number]>).sort((a, b) => b[1] - a[1]);
  const [topCurrency, topCount] = sorted[0];
  const runnerUpCount = sorted[1][1];

  if (topCount >= MIN_DOMINANT_COUNT && (runnerUpCount === 0 || topCount >= runnerUpCount * MIN_DOMINANCE_RATIO)) {
    return topCurrency;
  }

  const llmGuess = await classifyCurrencyLlm(text);
  if (llmGuess) return llmGuess;

  throw new Error(
    `Could not resolve HK reporting currency for entity ${entityId} from annual report text (regex counts: ${JSON.stringify(counts)}, LLM fallback also failed). Needs manual investigation.`,
  );
}

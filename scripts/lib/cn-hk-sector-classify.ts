// LLM-assisted sector classification for CN/HK companies. akshare's company
// profile endpoints only return a raw Chinese industry label (e.g. "电力、
// 热力生产和供应业", "家庭电器及用品") — there's no English GICS-style
// bucket. Rather than inventing a separate CN/HK-only taxonomy (the old
// hand-typed scripts/lib/cn-hk-company-seeds.ts drifted into exactly that,
// using "Consumer Discretionary"/"Consumer Staples" — GICS sectors the US
// path never produces), this classifies into the SAME 9-bucket vocabulary
// scripts/lib/sec-company-profile.ts's mapSectorFromSic() already produces
// for every US company, so `sector` means the same thing across all three
// markets. Low-stakes labeling task (display only, doesn't touch financial
// figures) — deliberately no human-confirmation step, matching the "LLM
// confirms, not a human" instruction this was built under.

// Keep in sync with the buckets mapSectorFromSic() (scripts/lib/sec-company-profile.ts)
// actually produces.
export const SECTOR_BUCKETS = [
  "Energy",
  "Financials",
  "Technology",
  "Health Care",
  "Consumer",
  "Communication Services",
  "Industrials",
  "Utilities",
  "Materials",
] as const;

export type SectorBucket = (typeof SECTOR_BUCKETS)[number];

function isSectorBucket(value: string): value is SectorBucket {
  return (SECTOR_BUCKETS as readonly string[]).includes(value);
}

export async function classifySectorLlm(input: {
  companyName: string;
  industryRaw: string;
  businessDescription?: string | null;
}): Promise<SectorBucket> {
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_API_BASE_URL;
  const model = process.env.AI_MODEL;
  if (!apiKey || !baseUrl || !model) {
    throw new Error("Missing AI_API_KEY / AI_API_BASE_URL / AI_MODEL env vars for sector classification.");
  }

  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const userPrompt =
    `Classify this company into exactly one sector bucket.\n` +
    `Company: ${input.companyName}\n` +
    `Raw industry label (Chinese): ${input.industryRaw}\n` +
    (input.businessDescription ? `Business description: ${input.businessDescription.slice(0, 500)}\n` : "") +
    `\nAllowed buckets (return exactly one, verbatim, nothing else):\n${SECTOR_BUCKETS.join(", ")}\n`;

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
          content: "You are a financial sector classifier. Answer with only the bucket name, verbatim from the allowed list, no explanation.",
        },
        { role: "user", content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sector classification API failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const raw = (data.choices?.[0]?.message?.content ?? "").trim().replace(/^["'`]+|["'`]+$/g, "");

  if (isSectorBucket(raw)) return raw;

  // Model sometimes wraps the bucket in a short sentence despite the system
  // prompt — fall back to a substring match before giving up.
  const matched = SECTOR_BUCKETS.find((bucket) => raw.includes(bucket));
  if (matched) return matched;

  throw new Error(`Sector classification returned an unrecognized bucket: ${JSON.stringify(raw)}`);
}

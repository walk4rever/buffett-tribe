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

function heuristicSectorMatch(text: string): SectorBucket | null {
  if (/医药|生物|医疗|健康/i.test(text)) return "Health Care";
  if (/软件|半导体|信息技术|计算机|人工智能|硬件/i.test(text)) return "Technology";
  if (/金融|银行|保险|证券|投资/i.test(text)) return "Financials";
  if (/公用|供电|供水|燃气|水务|环保/i.test(text)) return "Utilities";
  if (/石油|天然气|煤炭/i.test(text)) return "Energy";
  if (/材料|化工|金属|有色|钢铁|矿|塑料|化学/i.test(text)) return "Materials";
  if (/通信|电信|传媒|互联/i.test(text)) return "Communication Services";
  if (/消费|零售|食品|饮料|酒|家电|服装|服饰|汽车|旅游|商业/i.test(text)) return "Consumer";
  if (/工业|工程|机械|装备|制造|建筑|运输|仓储|物流|包装|印刷/i.test(text)) return "Industrials";
  return null;
}

export async function classifySectorLlm(input: {
  companyName: string;
  industryRaw: string;
  businessDescription?: string | null;
}): Promise<SectorBucket> {
  const fallbackText = `${input.industryRaw} ${input.companyName} ${input.businessDescription ?? ""}`;
  const heuristic = heuristicSectorMatch(fallbackText);

  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_API_BASE_URL;
  const model = process.env.AI_MODEL;
  if (!apiKey || !baseUrl || !model) {
    console.warn("[sector-classify] Missing AI credentials, using heuristic fallback:", heuristic ?? "Industrials");
    return heuristic ?? "Industrials";
  }

  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const userPrompt =
    `Classify this company into exactly one sector bucket.\n` +
    `Company: ${input.companyName}\n` +
    `Raw industry label (Chinese): ${input.industryRaw}\n` +
    (input.businessDescription ? `Business description: ${input.businessDescription.slice(0, 500)}\n` : "") +
    `\nAllowed buckets (return exactly one, verbatim, nothing else):\n${SECTOR_BUCKETS.join(", ")}\n`;

  try {
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
      console.warn(`[sector-classify] API error (${res.status} ${text.slice(0, 100)}), falling back to heuristic:`, heuristic ?? "Industrials");
      return heuristic ?? "Industrials";
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

    console.warn(`[sector-classify] Unrecognized bucket "${raw}", falling back to heuristic:`, heuristic ?? "Industrials");
    return heuristic ?? "Industrials";
  } catch (err) {
    console.warn(`[sector-classify] Classification error (${err instanceof Error ? err.message : String(err)}), falling back:`, heuristic ?? "Industrials");
    return heuristic ?? "Industrials";
  }
}

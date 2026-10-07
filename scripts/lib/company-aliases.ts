
export type AliasExtractionInput = {
  canonicalName: string;
  ticker?: string | null;
  nameZh?: string | null;
  nameEnShort?: string | null;
};

const NOISE_WORDS = new Set([
  "INC",
  "INCORPORATED",
  "CORP",
  "CORPORATION",
  "LTD",
  "LIMITED",
  "CO",
  "COMPANY",
  "HOLDINGS",
  "HOLDING",
  "GROUP",
  "PLC",
  "NV",
  "SA",
  "AG",
  "GMBH",
  "LLC",
]);

/**
 * Clean, normalize and deduplicate company aliases.
 * Filters out purely noise terms, exact legal duplicates, and case variants.
 */
export function sanitizeAliases(params: {
  rawAliases: string[];
  canonicalName: string;
  ticker?: string | null;
  nameZh?: string | null;
  existingAliases?: string[];
}): string[] {
  const { rawAliases, canonicalName, ticker, nameZh, existingAliases = [] } = params;

  const seen = new Set<string>();
  const results: string[] = [];

  const normCanonical = canonicalName.trim().toUpperCase();
  const normTicker = (ticker ?? "").trim().toUpperCase();
  const normNameZh = (nameZh ?? "").trim();

  // Combine existing aliases and new ones
  const allCandidates = [...existingAliases, ...rawAliases];

  for (const candidate of allCandidates) {
    if (!candidate || typeof candidate !== "string") continue;
    const trimmed = candidate.trim().replace(/^["'`]+|["'`]+$/g, "");
    if (trimmed.length < 2 || trimmed.length > 50) continue;

    const upper = trimmed.toUpperCase();
    if (NOISE_WORDS.has(upper)) continue;
    if (upper === normCanonical || upper === normTicker) continue;
    if (trimmed === normNameZh) continue;

    const lowerKey = trimmed.toLowerCase();
    if (seen.has(lowerKey)) continue;

    seen.add(lowerKey);
    results.push(trimmed);
  }

  return results.slice(0, 10);
}

/**
 * Call LLM to deduce public brand names, trade names and common aliases.
 */
export async function extractCompanyAliasesLlm(input: AliasExtractionInput): Promise<string[]> {
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_API_BASE_URL;
  const model = process.env.AI_MODEL;
  if (!apiKey || !baseUrl || !model) {
    throw new Error("Missing AI_API_KEY / AI_API_BASE_URL / AI_MODEL environment variables.");
  }

  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const prompt =
    `请为该上市公司提取大众公认的核心商业品牌名、英文俗称或中文简称（主要用于搜索索引，例如 Alphabet -> Google/谷歌，Meta -> Facebook/脸书，SPACE EXPLORATION TECHNOLOGIES -> SpaceX/太空探索）。\n` +
    `公司法定名：${input.canonicalName}\n` +
    `代码：${input.ticker ?? "未知"}\n` +
    `现有中文名：${input.nameZh ?? "未知"}\n\n` +
    "规则：\n" +
    "1. 仅提取公认的商业品牌名、大众熟知的俗称或常用简称（1-4个）。\n" +
    "2. 不要包含 INC, CORP, LTD, PLC 等企业法律组织后缀。\n" +
    "3. 若无特殊品牌名或与公司法定名/中文名完全一致，可返回空数组。\n" +
    "4. 输出严格合法 JSON: {\"aliases\": [\"string\", ...]}\n";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You extract recognizable brand names and aliases for companies. Return JSON only.",
        },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alias extraction API failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  if (!content) return [];

  try {
    const parsed = JSON.parse(content) as { aliases?: string[] };
    const rawAliases = Array.isArray(parsed.aliases) ? parsed.aliases : [];
    return sanitizeAliases({
      rawAliases,
      canonicalName: input.canonicalName,
      ticker: input.ticker,
      nameZh: input.nameZh,
    });
  } catch {
    return [];
  }
}

/**
 * Generate Business Model Canvas (9-grid) for companies using LLM.
 *
 * Usage:
 *   npx tsx scripts/generate-business-canvas.ts AAPL KO MCO
 */

import { getCompanyByTicker, getCompanyFinancials } from "../src/lib/company-data";
import { buildCompanyFinancialDashboard } from "../src/lib/company-financial-dashboard";

const AI_API_KEY = process.env.AI_API_KEY!;
const AI_API_BASE_URL = process.env.AI_API_BASE_URL!;
const AI_MODEL = process.env.AI_MODEL!;

const SYSTEM_PROMPT = `You are a business analyst specializing in value investing. Given a company's basic info and financial data, generate a Business Model Canvas (9-grid) in JSON format.

The 9 grids are:
1. customerSegments - Who does the company serve?
2. valuePropositions - What problems does it solve? Why do customers choose it?
3. channels - How does it reach customers?
4. customerRelationships - How does it maintain relationships?
5. revenueStreams - How does it make money?
6. keyResources - What are its most important assets?
7. keyActivities - What must it do every day?
8. keyPartnerships - Who does it rely on?
9. costStructure - What are its biggest costs?

Rules:
- Each field should be an array of 3-5 concise bullet points (strings).
- Use Chinese for the content.
- Be factual and specific. Avoid generic statements.
- Focus on what makes THIS company's business model distinctive.
- If some information is unavailable, make reasonable inferences from the industry and financials, but mark uncertain items with "（推测）".

Output ONLY valid JSON. No markdown, no explanation.`;

async function callLLM(messages: Array<{ role: string; content: string }>): Promise<string> {
  const res = await fetch(`${AI_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages,
      temperature: 0.5,
      max_tokens: 2000,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI API error: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function generateCanvas(ticker: string) {
  const company = await getCompanyByTicker(ticker);
  if (!company) {
    console.error(`❌ Company not found: ${ticker}`);
    return null;
  }

  const financials = await getCompanyFinancials(company.id, 5);
  const dashboard = buildCompanyFinancialDashboard(company, financials);

  const meta = company.metadata as Record<string, unknown> | null;
  const latestYear = dashboard.latestYear;
  const latestCardValues = dashboard.cards.map((c) => `${c.label}: ${c.value}`).join("\n");

  const userPrompt = `Company: ${company.canonicalName} (${ticker})
Sector: ${company.sector ?? "N/A"}
Industry: ${(meta?.industry as string) ?? "N/A"}
Exchange: ${(meta?.exchange as string) ?? "N/A"}

Latest FY: ${latestYear ?? "N/A"}
Key Metrics:
${latestCardValues}

Financial history (5 years):
${financials.map((f) => {
  const items = Object.entries(f.items).map(([k, v]) => `  ${k}: ${v}`).join("\n");
  return `FY ${f.year}:\n${items}`;
}).join("\n\n")}

Generate the Business Model Canvas for this company.`;

  const content = await callLLM([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ]);

  // Try to extract JSON from the response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error(`❌ No JSON found in response for ${ticker}`);
    console.error("Raw response:", content);
    return null;
  }

  try {
    const canvas = JSON.parse(jsonMatch[0]);
    return {
      ticker,
      companyName: company.canonicalName,
      zhName: (meta?.nameZh as string) ?? company.canonicalName,
      canvas,
    };
  } catch (err) {
    console.error(`❌ JSON parse error for ${ticker}:`, err);
    console.error("Raw response:", content);
    return null;
  }
}

async function main() {
  const tickers = process.argv.slice(2);
  if (tickers.length === 0) {
    console.error("Usage: npx tsx scripts/generate-business-canvas.ts <ticker1> [ticker2] ...");
    process.exit(1);
  }

  console.log(`Generating business canvas for: ${tickers.join(", ")}\n`);

  for (const ticker of tickers) {
    console.log(`\n=== ${ticker} ===`);
    const result = await generateCanvas(ticker);
    if (result) {
      console.log(JSON.stringify(result, null, 2));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

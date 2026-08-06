/**
 * Tags InsightPost.entityIds with the companies an article substantively
 * discusses, so /company/[id]'s 参考资料 tab can list related articles.
 *
 * entityIds stores Entity.id (the internal cuid primary key), not ticker or
 * name — see src/app/insights/[slug]/page.tsx's getEntitiesByIds(), which is
 * the existing reader of this field (currently unused: 0/68 published posts
 * have any entityIds — this script is the missing writer).
 *
 * Two-step design, same shape as the rest of this codebase's LLM usage
 * (LLM proposes, code resolves/verifies against the DB — see
 * company-name-zh.ts, valuation-metrics.ts): the LLM reads the article and
 * names companies + tickers from its own knowledge; it never sees or picks
 * from our Entity table, so it doesn't scale with company count and can't
 * be steered by what happens to already be onboarded. Code then resolves
 * each candidate against Entity by exact ticker match first, falling back
 * to a canonical-name substring match only when that's unambiguous (single
 * hit) — ambiguous or unresolved candidates are logged and dropped, never
 * guessed.
 *
 * Usage:
 *   tsx scripts/tag-insight-companies.ts --slug <slug> [--dry-run] [--force]
 *   tsx scripts/tag-insight-companies.ts --all [--dry-run] [--force]
 */
import "dotenv/config";
import db from "../src/lib/prisma";
import { callJsonLLM } from "./lib/company-generation";

const SYSTEM_PROMPT = `You are a financial content analyst. Read the article and list the real-world companies it substantively discusses — companies central to the story, a decision, an investment, or a business described in depth. Do not include a company that's only named once in passing (e.g. a throwaway analogy or a one-word mention).

Output JSON:
{
  "companies": [
    { "name": "official English company name", "ticker": "stock ticker if publicly traded and you're confident, else null", "reason": "under 15 words, why this counts as substantive" }
  ]
}

Rules:
- Only real companies you're confident exist. Never invent one.
- ticker: only for companies you know are publicly traded, using the primary listing's ticker. null for private/acquired/unknown-ticker companies — do not guess a ticker.
- Skip people, funds/VCs themselves (e.g. the VC firm being profiled), books, and non-company entities.
- Output ONLY valid JSON, no markdown.`;

type LlmCandidate = { name: string; ticker: string | null; reason: string };

function parseLlmCompanies(raw: string): LlmCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`LLM did not return valid JSON: ${raw.slice(0, 200)}`);
  }
  const obj = parsed as { companies?: unknown };
  if (!Array.isArray(obj.companies)) throw new Error("Missing companies array");
  return obj.companies
    .map((c) => {
      const row = c as Record<string, unknown>;
      const name = typeof row.name === "string" ? row.name.trim() : "";
      const ticker = typeof row.ticker === "string" && row.ticker.trim() ? row.ticker.trim() : null;
      const reason = typeof row.reason === "string" ? row.reason.trim() : "";
      return { name, ticker, reason };
    })
    .filter((c) => c.name);
}

type ResolveResult =
  | { status: "matched"; entityId: string; entityName: string; via: "ticker" | "name" }
  | { status: "unmatched" }
  | { status: "ambiguous"; count: number };

async function resolveCandidate(candidate: LlmCandidate): Promise<ResolveResult> {
  if (candidate.ticker) {
    const byTicker = await db.entity.findFirst({
      where: { type: "company", ticker: { equals: candidate.ticker, mode: "insensitive" } },
      select: { id: true, canonicalName: true },
    });
    if (byTicker) return { status: "matched", entityId: byTicker.id, entityName: byTicker.canonicalName, via: "ticker" };
  }

  const byName = await db.entity.findMany({
    where: { type: "company", canonicalName: { contains: candidate.name, mode: "insensitive" } },
    select: { id: true, canonicalName: true },
    take: 5,
  });
  if (byName.length === 1) {
    return { status: "matched", entityId: byName[0].id, entityName: byName[0].canonicalName, via: "name" };
  }
  if (byName.length > 1) return { status: "ambiguous", count: byName.length };
  return { status: "unmatched" };
}

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  return args.find((_, i) => args[i - 1] === flag);
}
function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

async function tagPost(post: { slug: string; title: string; contentRaw: string; entityIds: string[] }, dryRun: boolean) {
  console.log(`--- ${post.title} (${post.slug}) ---`);

  const content = await callJsonLLM({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: `Title: ${post.title}\n\n${post.contentRaw}`,
    temperature: 0.1,
    maxTokens: 6000,
  });

  const candidates = parseLlmCompanies(content);
  console.log(`  LLM proposed ${candidates.length} candidate(s)`);

  const matchedIds: string[] = [];
  for (const candidate of candidates) {
    const result = await resolveCandidate(candidate);
    const tickerLabel = candidate.ticker ? ` [${candidate.ticker}]` : "";
    if (result.status === "matched") {
      console.log(`    ✓ ${candidate.name}${tickerLabel} -> ${result.entityName} (via ${result.via}) — ${candidate.reason}`);
      matchedIds.push(result.entityId);
    } else if (result.status === "ambiguous") {
      console.log(`    ? ${candidate.name}${tickerLabel} — ${result.count} name matches, skipped (ambiguous)`);
    } else {
      console.log(`    ✕ ${candidate.name}${tickerLabel} — no Entity in DB, skipped`);
    }
  }

  const uniqueIds = [...new Set(matchedIds)];
  console.log(`  Resolved ${uniqueIds.length}/${candidates.length} to existing entities`);

  if (dryRun) {
    console.log("  DRY-RUN: not writing entityIds");
    return;
  }

  await db.insightPost.update({ where: { slug: post.slug }, data: { entityIds: uniqueIds } });
  console.log(`  Saved entityIds (${uniqueIds.length})`);
}

async function main() {
  const slug = getArg("--slug");
  const all = hasFlag("--all");
  const dryRun = hasFlag("--dry-run");
  const force = hasFlag("--force");

  if (!slug && !all) {
    console.error("Usage: tsx scripts/tag-insight-companies.ts --slug <slug> [--dry-run] [--force]");
    console.error("       tsx scripts/tag-insight-companies.ts --all [--dry-run] [--force]");
    process.exit(1);
  }

  const posts = slug
    ? await db.insightPost.findMany({ where: { slug }, select: { slug: true, title: true, contentRaw: true, entityIds: true } })
    : await db.insightPost.findMany({ where: { status: "published" }, select: { slug: true, title: true, contentRaw: true, entityIds: true } });

  if (!posts.length) {
    console.error(`No post found for: ${slug}`);
    process.exit(1);
  }

  console.log(`Found ${posts.length} post(s) to process\n`);

  for (const post of posts) {
    if (post.entityIds.length > 0 && !force) {
      console.log(`--- ${post.title} (${post.slug}) ---`);
      console.log(`  SKIP: already has ${post.entityIds.length} entityIds, use --force to retag\n`);
      continue;
    }
    try {
      await tagPost(post, dryRun);
    } catch (err) {
      console.error(`  Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    console.log();
  }

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("[tag-insight-companies] fatal", err);
  await db.$disconnect();
  process.exit(1);
});

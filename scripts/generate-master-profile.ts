/**
 * generate-master-profile.ts
 *
 * Unlike every other generate-*.ts script, this one is not grounded in our
 * own Financial/Holding/FilingSection data — MasterProfile (bio + fund
 * overview) is a pure public-knowledge summary, the same task as asking an
 * LLM "summarize this person and their fund company." Holdings-derived
 * numbers (concentration, sector mix, AUM computed from 13F filings) belong
 * to PortfolioInsight, not here — and our own 13F-reportable value isn't
 * the same figure as a fund's true AUM anyway, so it shouldn't be presented
 * as if it were.
 *
 * Usage:
 *   tsx scripts/generate-master-profile.ts --master buffett    [--dry-run]
 *   tsx scripts/generate-master-profile.ts --all                [--dry-run]
 */

import { Prisma, PrismaClient } from "@prisma/client";
import { getTribeMember, getTribeMembers } from "@/lib/tribe";

const db = new PrismaClient();

const AI_API_KEY = process.env.AI_API_KEY;
const AI_API_BASE_URL = process.env.AI_API_BASE_URL;
const AI_MODEL = process.env.AI_MODEL;
const PROMPT_VERSION = "master-profile-v1";

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function createGeneratedContentVersion(params: {
  tx: Prisma.TransactionClient;
  scopeType: string;
  scopeId: string;
  artifactType: string;
  payload: Prisma.InputJsonValue;
  source: string;
  promptVersion: string;
}) {
  const latest = await params.tx.generatedContentVersion.aggregate({
    where: {
      scopeType: params.scopeType,
      scopeId: params.scopeId,
      artifactType: params.artifactType,
    },
    _max: { versionSeq: true },
  });

  return params.tx.generatedContentVersion.create({
    data: {
      scopeType: params.scopeType,
      scopeId: params.scopeId,
      artifactType: params.artifactType,
      versionSeq: (latest._max.versionSeq ?? 0) + 1,
      payload: params.payload,
      source: params.source,
      promptVersion: params.promptVersion,
    },
  });
}

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  return args.find((_, i) => args[i - 1] === flag);
}
function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

// ---------------------------------------------------------------------------
// DB queries
// ---------------------------------------------------------------------------

async function getMasterEntity(tribeId: string) {
  return db.entity.findFirst({
    where: { tribeId, type: "master" },
    select: { id: true, canonicalName: true, tribeId: true },
  });
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildPrompt(params: { masterName: string; masterNameZh: string }): string {
  return `请基于你已知的公开信息，为 ${params.masterNameZh}（${params.masterName}）本人及其管理的基金公司做一份简明总结。

请严格输出以下 JSON 格式，不要包含 markdown 代码块标记，只输出纯 JSON。所有中文文本句尾使用中文句号（。）。

{
  "bio": "投资人个人经历与投资理念，150-250字：教育/职业背景、职业转折、投资理念与方法论、代表性投资/维权事件等确凿可信的事实。",
  "fundOverview": "基金公司基本情况，80-150字：成立时间与背景、组织形式、公开披露的管理规模等基本信息。"
}

重要约束：
1. 只写你有把握的事实。如果某人公开资料很少，就写得简短，宁可只有一两句话，也不要为了凑够字数编造，更不要使用"未知年份""不详""无可信公开数据"这类占位句式反复堆砌——没有实质内容的条目直接不写。
2. bio 只写人物本身，fundOverview 只写基金机构本身，两个字段不要互相重复内容——如果对人物没有把握的信息，宁可把 bio 写短，也不要转而复述 fundOverview 里的内容（反之亦然）。
3. 输出必须是纯 JSON，不要包含 \`\`\`json 包裹。`;
}

// ---------------------------------------------------------------------------
// AI call
// ---------------------------------------------------------------------------

async function callAI(prompt: string): Promise<unknown> {
  if (!AI_API_KEY || !AI_API_BASE_URL || !AI_MODEL) {
    throw new Error("Missing AI_API_KEY / AI_API_BASE_URL / AI_MODEL env vars");
  }

  const res = await fetch(`${AI_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: "You are a meticulous research assistant who writes concise, factual biographical summaries from public knowledge. Output only valid JSON. Use Chinese for all text content." },
        { role: "user", content: prompt },
      ],
      temperature: 0.5,
      // CJK output is more token-dense than the English-heavy US filings this
      // limit was originally tuned against — 4000 truncated mid-JSON for
      // christopher-begg (see commit 1a055f2e for the same symptom/fix on
      // generate:value-analysis / generate:management-analysis).
      max_tokens: 7000,
      stream: false,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI API error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content?.trim() ?? "";

  // Strip markdown code block if present
  const jsonText = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(jsonText);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateProfile(raw: unknown): asserts raw is Record<string, unknown> {
  const obj = raw as Record<string, unknown>;
  const required = ["bio", "fundOverview"];
  const missing = required.filter((k) => !(k in obj));
  if (missing.length) throw new Error(`Missing fields: ${missing.join(", ")}`);
  if (typeof obj.bio !== "string") throw new Error("bio must be a string");
  if (typeof obj.fundOverview !== "string") throw new Error("fundOverview must be a string");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const masterId = getArg("--master");
  const all = hasFlag("--all");
  const dryRun = hasFlag("--dry-run");

  if (!masterId && !all) {
    console.error("Usage: tsx scripts/generate-master-profile.ts --master <buffett|lilu|duan> [--dry-run]");
    console.error("       tsx scripts/generate-master-profile.ts --all [--dry-run]");
    process.exit(1);
  }

  const tribeIds = all ? (await getTribeMembers()).map((m) => m.id) : [masterId!];

  for (const tribeId of tribeIds) {
    console.log(`\n─── ${tribeId} ───`);

    const entity = await getMasterEntity(tribeId);
    if (!entity) {
      console.log(`  SKIP: no entity with tribeId="${tribeId}"`);
      continue;
    }

    const member = await getTribeMember(tribeId);
    if (!member) {
      console.log(`  SKIP: no Filer/tribe member for tribeId="${tribeId}"`);
      continue;
    }

    // Prompt with the person's real name (member.name/nameZh), not
    // entity.canonicalName (the 13F filer's legal/firm name, e.g. "Dalal
    // Street, LLC") — asking an LLM to profile an obscure fund-registration
    // name instead of the actual, often well-documented, person produces
    // "no public data available" filler for everything, even when the
    // person themself is extensively documented (e.g. Mohnish Pabrai).
    const prompt = buildPrompt({
      masterName: member.name,
      masterNameZh: member.nameZh,
    });

    console.log(`  Prompt length: ${prompt.length} chars`);

    if (dryRun) {
      console.log("  DRY-RUN: prompt preview:");
      console.log("  " + prompt.slice(0, 500).replace(/\n/g, "\n  ") + "...\n");
      continue;
    }

    try {
      const result = await callAI(prompt);
      validateProfile(result);

      const source = AI_MODEL ?? "unknown";
      await db.$transaction(async (tx) => {
        await tx.masterProfile.upsert({
          where: { entityId: entity.id },
          create: {
            entityId: entity.id,
            profile: toJsonValue(result),
            source,
            version: 1,
            generatedAt: new Date(),
          },
          update: {
            profile: toJsonValue(result),
            source,
            version: { increment: 1 },
            generatedAt: new Date(),
          },
        });

        await createGeneratedContentVersion({
          tx,
          scopeType: "master",
          scopeId: entity.id,
          artifactType: "master_profile",
          payload: toJsonValue(result),
          source,
          promptVersion: PROMPT_VERSION,
        });
      });

      const profile = result as {
        bio?: unknown;
        fundOverview?: unknown;
      };
      console.log(`  ✓ Profile saved (v${(await db.masterProfile.findUnique({ where: { entityId: entity.id }, select: { version: true } }))?.version ?? 0})`);
      console.log(`    bio: ${String(profile.bio).length} chars`);
      console.log(`    fundOverview: ${String(profile.fundOverview).length} chars`);
    } catch (err) {
      console.error(`  ✗ Failed:`, err instanceof Error ? err.message : String(err));
    }
  }

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("[generate-master-profile] fatal", err);
  await db.$disconnect();
  process.exit(1);
});

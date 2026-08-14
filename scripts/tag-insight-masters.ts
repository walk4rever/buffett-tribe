/**
 * Tags InsightPost.entityIds with the master Entity that a "标题 (人名)"-style
 * interview article is about, so /master/[id]'s 资料库 section can list it
 * as reference material.
 *
 * Matching is title/tag-based, not LLM-based: this content (translated
 * investor interview transcripts, imported via `npm run import:insight`)
 * either carries "(English Name)" in the title or has the name as a literal
 * tag. Verified against Gavin Baker: 7/7 articles genuinely about him
 * matched (6 by title, 1 more by tag alone — "从攀岩少年到投资大师：Gavin
 * Baker的成长史" embeds the name without parens), 3/3 articles that merely
 * mention his name in passing (inside another investor's profile) correctly
 * excluded, since they carry his name in neither title nor tags. Unlike
 * tag-insight-companies.ts (which needs an LLM because company mentions are
 * more free-form and contextual), no LLM call is needed for this content
 * shape.
 *
 * Appends to entityIds (dedupe, never overwrites) so this composes safely
 * with tag-insight-companies.ts running on the same posts.
 *
 * Usage:
 *   tsx scripts/tag-insight-masters.ts --master gavin-baker [--dry-run]
 *   tsx scripts/tag-insight-masters.ts --all [--dry-run]
 */
import "dotenv/config";
import db from "../src/lib/prisma";
import { getTribeMembers, type TribeMember } from "../src/lib/tribe";

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  return args.find((_, i) => args[i - 1] === flag);
}
function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

async function getMasterEntityId(tribeId: string): Promise<string | null> {
  const entity = await db.entity.findFirst({ where: { tribeId, type: "master" }, select: { id: true } });
  return entity?.id ?? null;
}

async function tagForMember(member: TribeMember, dryRun: boolean) {
  console.log(`--- ${member.nameZh} (${member.name}) [${member.id}] ---`);

  const entityId = await getMasterEntityId(member.id);
  if (!entityId) {
    console.log(`  SKIP: no Entity(type=master) for tribeId="${member.id}"`);
    return;
  }

  const posts = await db.insightPost.findMany({
    where: {
      status: "published",
      OR: [{ title: { contains: member.name } }, { tags: { has: member.name } }],
    },
    select: { id: true, slug: true, title: true, entityIds: true },
  });

  console.log(`  Found ${posts.length} post(s) mentioning "${member.name}" in title or tags`);

  for (const post of posts) {
    if (post.entityIds.includes(entityId)) {
      console.log(`    = ${post.slug} — already tagged`);
      continue;
    }
    console.log(`    + ${post.slug} — ${post.title}`);
    if (!dryRun) {
      await db.insightPost.update({
        where: { id: post.id },
        data: { entityIds: [...post.entityIds, entityId] },
      });
    }
  }
}

async function main() {
  const masterId = getArg("--master");
  const all = hasFlag("--all");
  const dryRun = hasFlag("--dry-run");

  if (!masterId && !all) {
    console.error("Usage: tsx scripts/tag-insight-masters.ts --master <tribeId> [--dry-run]");
    console.error("       tsx scripts/tag-insight-masters.ts --all [--dry-run]");
    process.exit(1);
  }

  const allMembers = await getTribeMembers();
  const members = all ? allMembers : allMembers.filter((m) => m.id === masterId);

  if (!members.length) {
    console.error(`No tribe member found for: ${masterId}`);
    process.exit(1);
  }

  for (const member of members) {
    await tagForMember(member, dryRun);
    console.log();
  }

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("[tag-insight-masters] fatal", err);
  await db.$disconnect();
  process.exit(1);
});

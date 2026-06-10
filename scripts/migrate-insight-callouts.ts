import { PrismaClient } from "@prisma/client";
import { normalizeInsightLegacyCallouts } from "../src/lib/insights";

const db = new PrismaClient();

type Args = {
  dryRun: boolean;
  slug: string | null;
  limit: number | null;
};

function parseArgs(argv: string[]): Args {
  const read = (flag: string) => {
    const index = argv.indexOf(flag);
    if (index === -1) return null;
    const value = argv[index + 1];
    return value && !value.startsWith("--") ? value : null;
  };

  const limitRaw = read("--limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : null;

  return {
    dryRun: argv.includes("--dry-run"),
    slug: read("--slug"),
    limit: Number.isFinite(limit ?? Number.NaN) ? Math.max(1, limit as number) : null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = await db.insightPost.findMany({
    where: args.slug ? { slug: args.slug } : undefined,
    select: {
      id: true,
      slug: true,
      title: true,
      contentRaw: true,
    },
    orderBy: { updatedAt: "desc" },
    ...(args.limit ? { take: args.limit } : {}),
  });

  let changed = 0;
  let unchanged = 0;
  const updates: Array<{ id: string; slug: string; next: string; before: string }> = [];

  for (const row of rows) {
    const next = normalizeInsightLegacyCallouts(row.contentRaw);
    if (next === row.contentRaw) {
      unchanged += 1;
      continue;
    }

    changed += 1;
    updates.push({ id: row.id, slug: row.slug, next, before: row.contentRaw });
  }

  for (const update of updates) {
    console.log(JSON.stringify({
      slug: update.slug,
      mode: args.dryRun ? "dry-run" : "live",
      beforeLength: update.before.length,
      afterLength: update.next.length,
    }));

    if (!args.dryRun) {
      await db.insightPost.update({
        where: { id: update.id },
        data: { contentRaw: update.next },
      });
    }
  }

  console.log(JSON.stringify({
    total: rows.length,
    changed,
    unchanged,
    mode: args.dryRun ? "dry-run" : "live",
  }, null, 2));
}

main()
  .catch(async (error) => {
    console.error("[migrate-insight-callouts] fatal", error);
    await db.$disconnect();
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { formatCompanyUrl } from "@/lib/company-data";
import { getTribeMembers } from "@/lib/tribe";

const MAX_QUERY_LENGTH = 80;
const MIN_QUERY_LENGTH = 2;
const RESULTS_PER_GROUP = 5;

function relevanceScore(query: string, values: Array<string | null | undefined>): number {
  const normalizedQuery = query.toLocaleLowerCase();
  let best = 3;

  for (const value of values) {
    if (!value) continue;
    const normalizedValue = value.toLocaleLowerCase();
    if (normalizedValue === normalizedQuery) return 0;
    if (normalizedValue.startsWith(normalizedQuery)) best = Math.min(best, 1);
    else if (normalizedValue.includes(normalizedQuery)) best = Math.min(best, 2);
  }

  return best;
}

export async function GET(request: NextRequest) {
  const rawQuery = new URL(request.url).searchParams.get("q") ?? "";
  const query = rawQuery.trim().replace(/\s+/g, " ").slice(0, MAX_QUERY_LENGTH);

  if (Array.from(query).length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ masters: [], companies: [], insights: [] });
  }

  try {
    const pattern = `%${query}%`;
    const upperPattern = `%${query.toUpperCase()}%`;
    const contains = { contains: query, mode: "insensitive" as const };
    const [members, companyRows, insightRows] = await Promise.all([
      getTribeMembers(),
      prisma.$queryRaw<Array<{
        id: string;
        canonicalName: string;
        ticker: string | null;
        code: string | null;
        market: string | null;
        cik: string | null;
        metadata: unknown;
        aliases: string[];
      }>>(Prisma.sql`
        SELECT id, "canonicalName", ticker, code, market, cik, metadata, aliases
        FROM "Entity"
        WHERE type = 'company'
          AND "onboardPhase" >= 1
          AND (
            ticker ILIKE ${upperPattern}
            OR code ILIKE ${upperPattern}
            OR "canonicalName" ILIKE ${pattern}
            OR (metadata->>'nameZh') ILIKE ${pattern}
            OR (metadata->>'nameEnShort') ILIKE ${upperPattern}
            OR array_to_string(aliases, ' ') ILIKE ${pattern}
          )
        LIMIT 20
      `),
      prisma.insightPost.findMany({
        where: {
          status: "published",
          OR: [
            { title: contains },
            { description: contains },
            { tags: { has: query } },
          ],
        },
        select: {
          slug: true,
          title: true,
          description: true,
          source: true,
          tags: true,
        },
        orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
        take: RESULTS_PER_GROUP,
      }),
    ]);

    const normalizedQuery = query.toLocaleLowerCase();
    const masters = members
      .filter((member) =>
        [member.nameZh, member.name, member.firm]
          .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)),
      )
      .sort((a, b) =>
        relevanceScore(query, [a.nameZh, a.name, a.firm]) -
        relevanceScore(query, [b.nameZh, b.name, b.firm]),
      )
      .slice(0, RESULTS_PER_GROUP)
      .map((member) => ({
        id: member.id,
        name: member.nameZh,
        subtitle: member.firm,
        href: `/master/${member.id}`,
      }));

    const companies = companyRows
      .sort((a, b) => {
        const aMeta = (a.metadata ?? {}) as { nameZh?: string; nameEnShort?: string };
        const bMeta = (b.metadata ?? {}) as { nameZh?: string; nameEnShort?: string };
        return relevanceScore(query, [a.ticker, a.code, aMeta.nameZh, a.canonicalName, ...(a.aliases ?? [])]) -
          relevanceScore(query, [b.ticker, b.code, bMeta.nameZh, b.canonicalName, ...(b.aliases ?? [])]);
      })
      .map((company) => {
        const metadata = (company.metadata ?? {}) as { nameZh?: string; nameEnShort?: string };
        const ticker = company.ticker ?? company.code;
        const shortName = metadata.nameEnShort;
        const subtitle = [ticker, shortName && shortName !== ticker ? shortName : null]
          .filter(Boolean)
          .join(" · ");

        return {
          id: company.id,
          name: metadata.nameZh || company.canonicalName,
          subtitle,
          href: formatCompanyUrl(company),
        };
      })
      .filter((company) => company.href)
      .slice(0, RESULTS_PER_GROUP);

    const insights = insightRows.map((post) => ({
      slug: post.slug,
      title: post.title,
      subtitle: post.description || post.source || post.tags.slice(0, 2).join(" · "),
      href: `/insights/${post.slug}`,
    }));

    return NextResponse.json({ masters, companies, insights }, {
      headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=30" },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      return NextResponse.json({ masters: [], companies: [], insights: [] });
    }
    console.error("[site-search] Search failed:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { formatCompanyUrl } from "@/lib/company-data";
import type { CompanyDirectoryItem, CompanyMarket } from "@/components/CompanyDirectory";
import { Prisma } from "@prisma/client";

function uniqueTickers(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const ticker = value?.trim().toUpperCase();
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    result.push(ticker);
  }
  return result;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const market = searchParams.get("market")?.trim().toLowerCase() ?? "";
  const phaseStr = searchParams.get("phase")?.trim() ?? "";
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "60", 10)));

  if (!q && !market && !phaseStr) {
    return NextResponse.json({ items: [] });
  }

  const query = q;
  const pattern = `%${query}%`;
  const upper = query.toUpperCase();
  const upperPattern = `%${upper}%`;

  const conditions: Prisma.Sql[] = [Prisma.sql`e.type = 'company'`];

  if (q) {
    conditions.push(Prisma.sql`(
      e.ticker ILIKE ${upperPattern}
      OR e.code ILIKE ${upperPattern}
      OR e."canonicalName" ILIKE ${pattern}
      OR (e.metadata->>'nameZh') ILIKE ${pattern}
      OR (e.metadata->>'nameEnShort') ILIKE ${upperPattern}
    )`);
  }

  if (market && market !== "all" && (market === "us" || market === "hk" || market === "cn")) {
    conditions.push(Prisma.sql`e.market = ${market}`);
  }

  if (phaseStr && phaseStr !== "all") {
    const phaseNum = parseInt(phaseStr, 10);
    if (!Number.isNaN(phaseNum)) {
      conditions.push(Prisma.sql`e."onboardPhase" = ${phaseNum}`);
    }
  }

  const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;

  try {
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        canonicalName: string;
        cik: string | null;
        market: string | null;
        code: string | null;
        ticker: string | null;
        onboardPhase: number;
        updatedAt: Date;
        metadata: Record<string, unknown> | null;
      }>
    >`
      SELECT 
        e.id, 
        e."canonicalName", 
        e.cik, 
        e.market, 
        e.code, 
        e.ticker, 
        e."onboardPhase", 
        e."updatedAt",
        e.metadata
      FROM "Entity" e
      ${whereClause}
      ORDER BY 
        ${
          q
            ? Prisma.sql`
          CASE 
            WHEN e.ticker = ${upper} OR e.code = ${upper} THEN 0
            WHEN e.ticker ILIKE ${upper + "%"} OR e.code ILIKE ${upper + "%"} THEN 1
            WHEN e."canonicalName" ILIKE ${query + "%"} OR (e.metadata->>'nameZh') ILIKE ${query + "%"} THEN 2
            ELSE 3
          END ASC,`
            : Prisma.empty
        }
        e."onboardPhase" DESC,
        e."canonicalName" ASC
      LIMIT ${limit};
    `;

    const items: Array<CompanyDirectoryItem & { updatedAt?: string; error?: string }> = rows.map((row) => {
      const meta = row.metadata as Record<string, unknown> | null;
      const nameZh =
        (typeof meta?.nameZh === "string" && meta.nameZh.trim()) || row.canonicalName;
      const nameEn =
        (typeof meta?.nameEnShort === "string" && meta.nameEnShort.trim()) ||
        row.canonicalName;
      const tickers = uniqueTickers([row.ticker, row.code]);
      const marketVal: CompanyMarket = (row.market as CompanyMarket) ?? "us";
      const onboardPhase = typeof row.onboardPhase === "number" ? row.onboardPhase : 0;
      const isPhase1OrHigher = onboardPhase >= 1;

      return {
        key: row.cik ?? (row.market && row.code ? `${row.market}-${row.code}` : row.id),
        nameZh,
        nameEn,
        tickers,
        href: isPhase1OrHigher ? formatCompanyUrl(row) : null,
        market: marketVal,
        isComplete: isPhase1OrHigher,
        onboardPhase,
        updatedAt: row.updatedAt?.toISOString(),
        error: typeof meta?.onboardPhase1LastError === "string" ? meta.onboardPhase1LastError : undefined,
      };
    });

    return NextResponse.json(
      { items },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      }
    );
  } catch (error) {
    console.error("[company:search] Search error:", error);
    return NextResponse.json({ items: [], error: "Search failed" }, { status: 500 });
  }
}

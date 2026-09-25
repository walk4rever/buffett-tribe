import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { formatCompanyUrl } from "@/lib/company-data";
import type { CompanyDirectoryItem, CompanyMarket } from "@/components/CompanyDirectory";

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

  if (!q) {
    return NextResponse.json({ items: [] });
  }

  const query = q;
  const pattern = `%${query}%`;
  const upper = query.toUpperCase();
  const upperPattern = `%${upper}%`;

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
        e.metadata
      FROM "Entity" e
      WHERE e.type = 'company'
        AND (
          e.ticker ILIKE ${upperPattern}
          OR e.code ILIKE ${upperPattern}
          OR e."canonicalName" ILIKE ${pattern}
          OR (e.metadata->>'nameZh') ILIKE ${pattern}
          OR (e.metadata->>'nameEnShort') ILIKE ${upperPattern}
        )
      ORDER BY 
        CASE 
          WHEN e.ticker = ${upper} OR e.code = ${upper} THEN 0
          WHEN e.ticker ILIKE ${upper + '%'} OR e.code ILIKE ${upper + '%'} THEN 1
          WHEN e."canonicalName" ILIKE ${query + '%'} OR (e.metadata->>'nameZh') ILIKE ${query + '%'} THEN 2
          ELSE 3
        END ASC,
        e."onboardPhase" DESC,
        e."canonicalName" ASC
      LIMIT 90;
    `;

    const items: CompanyDirectoryItem[] = rows.map((row) => {
      const meta = row.metadata as Record<string, unknown> | null;
      const nameZh =
        (typeof meta?.nameZh === "string" && meta.nameZh.trim()) || row.canonicalName;
      const nameEn =
        (typeof meta?.nameEnShort === "string" && meta.nameEnShort.trim()) ||
        row.canonicalName;
      const tickers = uniqueTickers([row.ticker, row.code]);
      const market: CompanyMarket = (row.market as CompanyMarket) ?? "us";
      const onboardPhase = typeof row.onboardPhase === "number" ? row.onboardPhase : 0;
      const isPhase1OrHigher = onboardPhase >= 1;

      return {
        key: row.cik ?? (row.market && row.code ? `${row.market}-${row.code}` : row.id),
        nameZh,
        nameEn,
        tickers,
        // Phase 0 is grey & unclickable (href is null); Phase >= 1 is normal & clickable
        href: isPhase1OrHigher ? formatCompanyUrl(row) : null,
        market,
        isComplete: isPhase1OrHigher,
        onboardPhase,
      };
    });

    return NextResponse.json(
      { items },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        },
      }
    );
  } catch (error) {
    console.error("[company:search] Search error:", error);
    return NextResponse.json({ items: [], error: "Search failed" }, { status: 500 });
  }
}

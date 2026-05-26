import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  return args.find((_, i) => args[i - 1] === flag);
}

async function main() {
  const investors = (getArg("--investors") ?? "buffett,lilu,duan")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const fromYear = Number(getArg("--from-year") ?? "2020");

  const holdings = await db.holding.findMany({
    where: {
      holder: { tribeId: { in: investors } },
      source: { kind: "13f", periodYear: { gte: fromYear } },
    },
    select: {
      security: {
        select: {
          id: true,
          ticker: true,
          titleOfClass: true,
          metadata: true,
          companyEntityId: true,
          company: { select: { id: true, canonicalName: true, ticker: true } },
        },
      },
    },
  });

  const byCompany = new Map<string, { id: string; name: string; ticker: string | null; refs: number }>();
  const unresolved: Array<{ issuer: string; ticker: string | null }> = [];

  for (const h of holdings) {
    const company = h.security.company;
    if (!company || !h.security.companyEntityId) {
      const meta = (h.security.metadata && typeof h.security.metadata === "object" && !Array.isArray(h.security.metadata))
        ? (h.security.metadata as { nameEnShort?: string; nameZh?: string })
        : {};
      unresolved.push({
        issuer: meta.nameEnShort ?? meta.nameZh ?? h.security.titleOfClass ?? h.security.ticker ?? h.security.id,
        ticker: h.security.ticker,
      });
      continue;
    }
    const key = company.id;
    const prev = byCompany.get(key);
    if (prev) prev.refs += 1;
    else byCompany.set(key, { id: company.id, name: company.canonicalName, ticker: company.ticker, refs: 1 });
  }

  const companies = [...byCompany.values()];
  const companyIds = companies.map((c) => c.id);
  const financialRows = companyIds.length
    ? await db.financial.findMany({
        where: {
          entityId: { in: companyIds },
          periodType: "FY",
        },
        select: { entityId: true },
      })
    : [];
  const companyIdsWithFY = new Set(financialRows.map((row) => row.entityId));
  const hasFY = companies.filter((c) => companyIdsWithFY.has(c.id)).length;
  const missingFY = companies.filter((c) => !companyIdsWithFY.has(c.id)).map((c) => ({
    companyId: c.id,
    name: c.name,
    ticker: c.ticker,
    refs: c.refs,
  }));

  missingFY.sort((a, b) => b.refs - a.refs);

  console.log(
    JSON.stringify(
      {
        investors,
        fromYear,
        companiesFromHoldings: companies.length,
        companiesWithFY: hasFY,
        companiesMissingFY: missingFY.length,
        unresolvedCompanyLinkRows: unresolved.length,
        missingFYSamples: missingFY.slice(0, 30),
      },
      null,
      2,
    ),
  );

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("[check-financial-integrity] fatal", err);
  await db.$disconnect();
  process.exit(1);
});

/**
 * check-security-integrity.ts
 *
 * Read-only health report for security/company/ticker completeness.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const securities = await db.security.findMany({
    select: {
      id: true,
      cusip: true,
      ticker: true,
      titleOfClass: true,
      metadata: true,
      companyEntityId: true,
      company: { select: { canonicalName: true, ticker: true } },
      holdings: { select: { id: true } },
    },
  });

  const total = securities.length;
  const noTicker = securities.filter((s) => !s.ticker).length;
  const noCompany = securities.filter((s) => !s.companyEntityId).length;
  const withCusipNoTicker = securities.filter((s) => s.cusip && !s.ticker).length;
  const withHoldingsNoCompany = securities.filter((s) => s.holdings.length > 0 && !s.companyEntityId).length;
  const withHoldingsNoTicker = securities.filter((s) => s.holdings.length > 0 && !s.ticker).length;

  const samples = securities
    .filter((s) => s.holdings.length > 0 && (!s.ticker || !s.companyEntityId))
    .slice(0, 30)
    .map((s) => ({
      securityId: s.id,
      issuer:
        s.company?.canonicalName ??
        ((s.metadata && typeof s.metadata === "object" && !Array.isArray(s.metadata))
          ? ((s.metadata as { nameEnShort?: string; nameZh?: string }).nameEnShort ??
             (s.metadata as { nameEnShort?: string; nameZh?: string }).nameZh ??
             null)
          : null) ??
        s.titleOfClass ??
        null,
      cusip: s.cusip,
      ticker: s.ticker,
      companyTicker: s.company?.ticker ?? null,
      companyEntityId: s.companyEntityId,
      holdingsCount: s.holdings.length,
    }));

  console.log(
    JSON.stringify(
      {
        total,
        noTicker,
        noCompany,
        withCusipNoTicker,
        withHoldingsNoCompany,
        withHoldingsNoTicker,
        samples,
      },
      null,
      2,
    ),
  );

  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("[check-security-integrity] fatal", err);
  await db.$disconnect();
  process.exit(1);
});

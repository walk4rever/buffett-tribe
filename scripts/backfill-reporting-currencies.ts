import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import db from "../src/lib/prisma";
import { getFinancialsCurrency } from "../src/lib/company-data";
import {
  currenciesNeededForConversion,
  normalizeCurrencyCode,
  tradingCurrencyForMarket,
} from "../src/lib/fx-rates-core";
import { refreshFxRates } from "../src/lib/fx-rates";

const LOOKUP_CONCURRENCY = 8;

async function main() {
  const apply = process.argv.includes("--apply");
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg >= 0 ? Number.parseInt(process.argv[limitArg + 1] ?? "", 10) : null;
  if (limit != null && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error("--limit must be a positive integer");
  }

  const entities = await db.entity.findMany({
    where: { type: "company", reportingCurrency: null },
    select: { id: true, ticker: true, canonicalName: true, market: true },
    orderBy: { ticker: "asc" },
    ...(limit ? { take: limit } : {}),
  });
  const currencyPairs: Array<{
    reportingCurrency: string | null;
    tradingCurrency: string | null;
  }> = [];
  let registered = 0;
  let unresolved = 0;

  for (let offset = 0; offset < entities.length; offset += LOOKUP_CONCURRENCY) {
    const batch = entities.slice(offset, offset + LOOKUP_CONCURRENCY);
    const resolved = await Promise.all(
      batch.map(async (entity) => ({
        entity,
        currency: normalizeCurrencyCode(await getFinancialsCurrency(entity.id)),
      })),
    );

    for (const { entity, currency } of resolved) {
      if (!currency) {
        unresolved += 1;
        continue;
      }

      registered += 1;
      currencyPairs.push({
        reportingCurrency: currency,
        tradingCurrency: tradingCurrencyForMarket(entity.market),
      });
      if (apply) {
        await db.entity.update({
          where: { id: entity.id },
          data: { reportingCurrency: currency },
        });
      }
    }

    const processed = Math.min(offset + batch.length, entities.length);
    if (processed % 100 < LOOKUP_CONCURRENCY || processed === entities.length) {
      console.log(`[${processed}/${entities.length}] resolved=${registered}, unresolved=${unresolved}`);
    }
  }

  const currencies = currenciesNeededForConversion(currencyPairs);
  console.log(
    `${apply ? "Registered" : "Would register"} ${registered} reporting currencies; ` +
      `${unresolved} companies remain unresolved.`,
  );
  console.log(`FX currencies needed: ${currencies.length ? currencies.join(", ") : "none"}`);

  if (apply && currencies.length) {
    const result = await refreshFxRates(currencies);
    for (const currency of result.updated) {
      console.log(`Updated ${currency} -> USD`);
    }
    for (const failure of result.failed) {
      console.error(`Failed ${failure.currency} -> USD: ${failure.error}`);
    }
    if (result.failed.length) process.exitCode = 1;
  }

  if (!apply) {
    console.log("Preview only. Pass --apply to persist currencies and fetch required FX rates.");
  }
}

main()
  .catch((error) => {
    console.error("Reporting currency backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import db from "../src/lib/prisma";
import { currenciesNeededForConversion, tradingCurrencyForMarket } from "../src/lib/fx-rates-core";
import { refreshFxRates } from "../src/lib/fx-rates";

async function main() {
  const entities = await db.entity.findMany({
    where: {
      type: "company",
      reportingCurrency: { not: null },
    },
    select: {
      market: true,
      reportingCurrency: true,
    },
  });

  const currencies = currenciesNeededForConversion(entities.map((entity) => ({
    reportingCurrency: entity.reportingCurrency,
    tradingCurrency: tradingCurrencyForMarket(entity.market),
  })));

  if (!currencies.length) {
    console.log("No cross-currency company valuations need FX rates.");
    return;
  }

  console.log(`Refreshing latest Yahoo FX rates for: ${currencies.join(", ")}`);
  const result = await refreshFxRates(currencies);
  for (const currency of result.updated) {
    console.log(`Updated ${currency} -> USD`);
  }
  for (const failure of result.failed) {
    console.error(`Failed ${failure.currency} -> USD: ${failure.error}`);
  }

  if (result.failed.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("FX refresh failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });

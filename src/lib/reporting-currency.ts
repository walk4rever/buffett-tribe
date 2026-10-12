import db from "@/lib/prisma";
import { ensureFxRatesForPair } from "@/lib/fx-rates";
import { withShortWriteTransaction } from "@/lib/db-short-write";
import {
  normalizeCurrencyCode,
  tradingCurrencyForMarket,
} from "@/lib/fx-rates-core";

export async function persistReportingCurrency(
  entityId: string,
  market: string | null | undefined,
  currency: string | null | undefined,
): Promise<string | null> {
  const reportingCurrency = normalizeCurrencyCode(currency);
  if (!reportingCurrency) return null;

  await withShortWriteTransaction(db, (tx) =>
    tx.entity.update({
      where: { id: entityId },
      data: { reportingCurrency },
    }),
  );

  const tradingCurrency = tradingCurrencyForMarket(market);
  if (tradingCurrency && reportingCurrency !== tradingCurrency) {
    try {
      await ensureFxRatesForPair(reportingCurrency, tradingCurrency);
    } catch (error) {
      console.warn(
        `[fx] Could not fetch initial ${reportingCurrency}/${tradingCurrency} rates; financial import remains successful:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return reportingCurrency;
}

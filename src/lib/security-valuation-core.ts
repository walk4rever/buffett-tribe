const KNOWN_ADR_RATIOS: Record<string, number> = {
  TSM: 5,
  BABA: 8,
  PDD: 4,
  JD: 2,
  BILI: 1,
  NIO: 1,
  LI: 2,
  BEKE: 3,
  TME: 2,
  NTES: 5,
  FUTU: 1,
  YMM: 20,
  BZ: 2,
  ARM: 1,
  NOK: 1,
  SONY: 1,
};

export function getAdrRatio(ticker: string, titleOfClass: string | null): number | null {
  const knownRatio = KNOWN_ADR_RATIOS[ticker.trim().toUpperCase()];
  if (knownRatio != null) return knownRatio;

  const representedShares = titleOfClass?.toUpperCase().match(/REP(?:STG)?\s*([0-9]+)\s*COM/);
  const parsedRatio = representedShares ? Number.parseInt(representedShares[1], 10) : null;
  return parsedRatio != null && parsedRatio > 0 ? parsedRatio : null;
}

export function adjustEpsForAdr(eps: number | null, adrRatio: number | null): number | null {
  if (eps == null || !Number.isFinite(eps)) return null;
  return adrRatio != null && adrRatio > 1 ? Number((eps * adrRatio).toFixed(2)) : eps;
}

export function adjustSharesForAdr(
  ordinaryShares: number | null,
  adrRatio: number | null,
): number | null {
  if (ordinaryShares == null || !Number.isFinite(ordinaryShares)) return null;
  return adrRatio != null && adrRatio > 1
    ? Math.round(ordinaryShares / adrRatio)
    : ordinaryShares;
}

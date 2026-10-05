/**
 * Canonical CIK (Central Index Key) normalization and formatting utilities.
 * SEC EDGAR standard requires 10-digit zero-padded numeric string (e.g. "0001855612").
 */

/**
 * Normalizes any CIK representation (string, number, with/without "CIK" prefix, with/without padding)
 * into a canonical 10-digit zero-padded string.
 * Returns null if the input is null/undefined or contains no digits / only zeroes.
 */
export function normalizeCik(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const str = typeof value === "number" ? String(value) : String(value).trim();
  const digits = str
    .replace(/^CIK/i, "")
    .replace(/^US-/i, "")
    .replace(/\D/g, "");
  if (!digits) return null;
  const num = Number(digits);
  if (!Number.isFinite(num) || num === 0) return null;
  return digits.padStart(10, "0");
}

/**
 * Returns the unpadded numeric string representation (e.g. "1855612"),
 * useful for legacy endpoints or URLs that require raw integer CIKs.
 */
export function unpadCik(value: string | number | null | undefined): string | null {
  const norm = normalizeCik(value);
  if (!norm) return null;
  return norm.replace(/^0+/, "") || "0";
}

/**
 * Returns both padded (10-digit) and unpadded representations for safe DB lookups:
 * e.g. where: { cik: { in: getCikLookupVariants(raw) } }
 */
export function getCikLookupVariants(value: string | number | null | undefined): string[] {
  const padded = normalizeCik(value);
  if (!padded) return [];
  const unpadded = unpadCik(padded)!;
  return padded === unpadded ? [padded] : [padded, unpadded];
}

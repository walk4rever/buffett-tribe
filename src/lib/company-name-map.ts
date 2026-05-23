import { normalizeTicker } from "./ticker";

export function normalizeEnglishName(name: string): string {
  return name
    .replace(/\b(INC|CORP|CORPORATION|CO|COMPANY|COMPANIES|HOLDINGS|HLDGS|GROUP|PLC|LTD|LLC|CL A|CL B|COM|SER [A-Z])\b\.?/gi, "")
    .replace(/\s+[,，]/g, ",")
    .replace(/[,，.&/\-\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasChineseText(value: string | null | undefined): value is string {
  return typeof value === "string" && /[\u3400-\u9FFF]/.test(value);
}

export function issuerKey(name: string) {
  return normalizeEnglishName(name).toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim().replace(/\s+/g, " ");
}

export type NameMapCaches = {
  zhByTicker: Map<string, string>;
  zhByIssuer: Map<string, string>;
  tickerByIssuer: Map<string, string>;
};

export function resolveCompanyNamesFromMaps(input: {
  ticker?: string | null;
  canonicalName: string;
  existingNameZh?: string | null;
  maps: NameMapCaches;
}) {
  const normalizedTicker = normalizeTicker(input.ticker);
  const key = issuerKey(input.canonicalName);
  const ticker = normalizedTicker ?? input.maps.tickerByIssuer.get(key) ?? null;
  const nameEnShort = normalizeEnglishName(input.canonicalName);
  const nameZh =
    (ticker ? input.maps.zhByTicker.get(ticker) : null) ??
    input.maps.zhByIssuer.get(key) ??
    (hasChineseText(input.existingNameZh) ? input.existingNameZh : null);

  return {
    ticker,
    nameZh,
    nameEnShort,
    issuerKey: key,
  };
}

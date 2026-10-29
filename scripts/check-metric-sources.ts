/**
 * Check that all sources defined in METRICS.md:
 * 1. canonical:<Key> exists in canonical-financial-dictionary.json
 * 2. canonical:<Key> has corresponding tags/aliases for its declared markets
 * 3. extractor:<Extractor> is registered in scripts/lib/
 *
 * Usage:
 *   npx tsx scripts/check-metric-sources.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

type CanonicalDictEntry = {
  key: string;
  nameZh: string;
  tagsUsGaap?: string[];
  tagsIfrs?: string[];
  cnAliases?: string[];
  hkAliases?: string[];
};

const METRICS_PATH = path.join(process.cwd(), "METRICS.md");
const DICT_PATH = path.join(
  process.cwd(),
  "scripts",
  "lib",
  "canonical-financial-dictionary.json",
);

function main() {
  const markdown = readFileSync(METRICS_PATH, "utf8");
  const section12Idx = markdown.indexOf("## 十二、页面与来源映射");
  if (section12Idx === -1) {
    throw new Error("Section '## 十二、页面与来源映射' not found in METRICS.md");
  }

  const dict: CanonicalDictEntry[] = JSON.parse(readFileSync(DICT_PATH, "utf8"));
  const dictMap = new Map(dict.map((d) => [d.key, d]));

  const section12 = markdown.slice(section12Idx);
  const rows = section12
    .split("\n")
    .filter(
      (l) =>
        l.startsWith("| ") &&
        !l.includes("| --- |") &&
        !l.includes("| ID |") &&
        (l.startsWith("| GR-") ||
          l.startsWith("| GD-") ||
          l.startsWith("| CA-") ||
          l.startsWith("| VL-") ||
          l.startsWith("| BK-") ||
          l.startsWith("| IN-") ||
          l.startsWith("| RE-") ||
          l.startsWith("| FS-")),
    );

  const errors: string[] = [];
  let canonicalRefCount = 0;
  let extractorRefCount = 0;

  for (const row of rows) {
    const parts = row
      .split("|")
      .map((p) => p.trim())
      .slice(1, -1);
    if (parts.length < 8) continue;
    const [id, name, , , , source, marketsStr] = parts;
    const markets = marketsStr.split(/\s+/).map((m) => m.toLowerCase());

    // 1. Check canonical references
    const canonMatches = source.match(/canonical:([A-Za-z0-9_]+)/g);
    if (canonMatches) {
      for (const cm of canonMatches) {
        canonicalRefCount++;
        const key = cm.replace("canonical:", "");
        const entry = dictMap.get(key);
        if (!entry) {
          errors.push(
            `[${id} ${name}] canonical key '${key}' does not exist in canonical dictionary`,
          );
          continue;
        }

        const hasUs =
          (entry.tagsUsGaap && entry.tagsUsGaap.length > 0) ||
          (entry.tagsIfrs && entry.tagsIfrs.length > 0);
        const hasCn = entry.cnAliases && entry.cnAliases.length > 0;
        const hasHk = entry.hkAliases && entry.hkAliases.length > 0;

        if (markets.includes("us") && !hasUs) {
          errors.push(
            `[${id} ${name}] canonical key '${key}' missing US GAAP / IFRS tags for US market`,
          );
        }
        if (markets.includes("cn") && !hasCn) {
          errors.push(
            `[${id} ${name}] canonical key '${key}' missing cnAliases for CN market`,
          );
        }
        if (markets.includes("hk") && !hasHk) {
          errors.push(
            `[${id} ${name}] canonical key '${key}' missing hkAliases for HK market`,
          );
        }
      }
    }

    // 2. Check extractor references
    const extractorMatches = source.match(/extractor:([A-Za-z0-9_-]+)/g);
    if (extractorMatches) {
      for (const em of extractorMatches) {
        extractorRefCount++;
        const ext = em.replace("extractor:", "");
        const validExtractors = [
          "bank-annual-report-v1",
          "insurance-annual-report-v1",
          "reit-report-v1",
        ];
        if (!validExtractors.includes(ext)) {
          errors.push(`[${id} ${name}] unknown extractor '${ext}'`);
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error(`Found ${errors.length} source verification errors:`);
    for (const err of errors) console.error(` - ${err}`);
    process.exit(1);
  }

  console.log(
    `Verified ${canonicalRefCount} canonical references and ${extractorRefCount} extractor references across ${rows.length} metrics. All source paths valid.`,
  );
}

main();

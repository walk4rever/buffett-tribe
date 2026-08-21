import { parseReportDate, quarterKey } from "./13f-import-core";

export type RestatableFiling = {
  accession: string;
  reportDate: string;
  filedAt: string;
  // SEC's own distinction for a 13F-HR/A: "NEW HOLDINGS" (adds a position
  // that was under confidential treatment — additive, combine with the
  // original) vs "RESTATEMENT" (corrects/replaces the whole prior report for
  // this period — supersedes it, not additive).
  amendmentType: string | null;
};

// A quarter can have more than one 13F filing on file (e.g. a fund discloses
// most positions in the primary 13F-HR, then adds a confidential-treatment
// position via a 13F-HR/A once it expires — SEC's "NEW HOLDINGS" amendment
// type, additive by design; see reconcilePercentOfPortfolio in
// 13f-import-core.ts). A "RESTATEMENT" amendment is different: SEC defines
// it as replacing the entire prior report for that period, not adding to
// it — importing both the original and the restatement produces duplicate
// positions (found for H&H International/段永平 2024Q4: the original 13F-HR
// mistakenly tagged 8 positions as Put options, corrected same-day via a
// RESTATEMENT that removed the tag — importing both doubled the portfolio).
export function dropSupersededByRestatement<T extends RestatableFiling>(filings: T[]): T[] {
  const byQuarter = new Map<string, T[]>();
  for (const filing of filings) {
    const { year, quarter } = parseReportDate(filing.reportDate);
    const key = quarterKey(year, quarter);
    if (!byQuarter.has(key)) byQuarter.set(key, []);
    byQuarter.get(key)!.push(filing);
  }

  const result: T[] = [];
  for (const group of byQuarter.values()) {
    const restatements = group.filter((f) => f.amendmentType === "RESTATEMENT");
    if (!restatements.length) {
      result.push(...group);
      continue;
    }
    // More than one RESTATEMENT for the same period shouldn't happen; keep
    // whichever was filed most recently if it does.
    const latest = restatements.reduce((a, b) => (a.filedAt >= b.filedAt ? a : b));
    result.push(latest);
    const dropped = group.filter((f) => f !== latest);
    if (dropped.length) {
      console.warn(
        `  RESTATEMENT ${latest.accession} (${latest.reportDate}) supersedes ${dropped.map((f) => f.accession).join(", ")} — importing restatement only`,
      );
    }
  }
  return result;
}

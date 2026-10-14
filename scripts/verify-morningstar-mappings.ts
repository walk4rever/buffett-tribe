/**
 * verify-morningstar-mappings.ts
 *
 * 校验我们声明的晨星映射到底对不对。
 *
 * 字典给 117 个科目里的大部分都填了 `morningstarId`，但那些映射从没有人对着晨星
 * 的原始数据验过。CapEx 就是一个例子：它指向 IFCF001330，而那条在快照里的 label 是
 * "Purchase/Sale and Disposal of Property, Plant and Equipment, Net"，不是毛额资本开支。
 *
 * 这个脚本不猜、不推理，只做一件事：拿我们的值去和快照里**每一行**比对，看实际跟
 * 哪一行对得上，然后把结论和字典里声明的 id 并排放出来。对不上时它会指出真正对得上
 * 的是哪一行（或者根本没有）。
 *
 * 只读。
 *
 * Usage:
 *   npx tsx scripts/verify-morningstar-mappings.ts                     # golden 100 家，默认校验项
 *   npx tsx scripts/verify-morningstar-mappings.ts --ticker MCD
 *   npx tsx scripts/verify-morningstar-mappings.ts --items CapEx,DividendsPaid,GrossProfit
 *   npx tsx scripts/verify-morningstar-mappings.ts --top 3             # 列出候选行前三名
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";

const db = new PrismaClient();
const SUITE_PATH = path.join(process.cwd(), "scripts", "lib", "morningstar-benchmark-suite.json");
const DICTIONARY_PATH = path.join(process.cwd(), "scripts", "lib", "canonical-financial-dictionary.json");
const SNAPSHOT_DIR = path.join(process.cwd(), ".cache", "morningstar-snapshots");

/** 判定「对得上」的相对容差。晨星快照是百万为单位取整的，所以不能卡太死。 */
const MATCH_TOLERANCE = 0.01;
/** 每个科目至少要能比几家公司才下结论。 */
const MIN_COMPANIES_FOR_VERDICT = 5;

/**
 * 默认校验项：eval 的 29 项里容易踩映射坑的那几个，加上它们的兄弟科目。
 * Revenue 不在其中 —— 它被当作标定单位量级的基准，不参与被检。
 */
const DEFAULT_ITEMS = [
  "CapEx",
  "PurchaseSaleOfPPE",
  "CashReceivedFromDisposalOfAssets",
  "DividendsPaid",
  "CashAndCashEquivalents",
  "ShortTermInvestments",
  "GrossProfit",
  "OperatingIncome",
  "CostOfRevenue",
  "NetIncome",
  "TotalAssets",
  "TotalLiabilities",
  "ShareholdersEquity",
  "OperatingCashFlow",
  "InvestingCashFlow",
  "FinancingCashFlow",
];

interface MstarRow {
  id: string;
  label: string;
  /** 年份 -> 值，单位与快照一致（百万）。 */
  byYear: Map<number, number>;
}

interface Snapshot {
  /** 全部行，按 id 索引。 */
  rowsById: Map<string, MstarRow>;
  allRows: MstarRow[];
}

function parseSnapshot(file: string): Snapshot {
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
    isData?: { columnDefs?: string[]; rows?: unknown };
    bsData?: { columnDefs?: string[]; rows?: unknown };
    cfData?: { columnDefs?: string[]; rows?: unknown };
  };
  const rowsById = new Map<string, MstarRow>();
  const allRows: MstarRow[] = [];

  const visit = (node: unknown, columns: string[]): void => {
    if (Array.isArray(node)) {
      for (const n of node) visit(n, columns);
      return;
    }
    if (!node || typeof node !== "object") return;
    const rec = node as { dataPointId?: string; label?: string; datum?: unknown[]; subLevel?: unknown };
    if (rec.dataPointId && !rowsById.has(rec.dataPointId)) {
      const byYear = new Map<number, number>();
      (rec.datum ?? []).forEach((v, i) => {
        const year = Number(columns[i]);
        if (Number.isInteger(year) && typeof v === "number" && Number.isFinite(v)) byYear.set(year, v);
      });
      const row: MstarRow = { id: rec.dataPointId, label: rec.label ?? "", byYear };
      rowsById.set(row.id, row);
      allRows.push(row);
    }
    if (Array.isArray(rec.subLevel)) visit(rec.subLevel, columns);
  };

  for (const key of ["isData", "bsData", "cfData"] as const) {
    const stmt = data[key];
    if (!stmt?.rows) continue;
    visit(stmt.rows, (stmt.columnDefs ?? []).map(String));
  }
  return { rowsById, allRows };
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface Candidate {
  id: string;
  label: string;
  matchedYears: number;
  comparedYears: number;
  /** 命中率 = 命中年份 / 我方有值的年份数，避免不同行分母不同导致不可比。 */
  rate: number;
}

/**
 * 我们某个科目在若干公司上实际跟哪一行晨星数据对得上。
 *
 * 对比前先按 Revenue / IFIS001170 标定该公司的单位量级 —— 晨星快照用百万，
 * 我们存绝对值，不标定就会把所有行都判成差 10^6 倍。
 */
function rankCandidates(
  ourByYear: Map<number, number>,
  snapshot: Snapshot,
  scale: number | null,
): Candidate[] {
  const out: Candidate[] = [];
  if (scale == null || ourByYear.size === 0) return out;
  const ourYears = ourByYear.size;

  for (const row of snapshot.allRows) {
    let compared = 0;
    let matched = 0;
    for (const [year, ours] of ourByYear) {
      const theirs = row.byYear.get(year);
      if (theirs == null || theirs === 0) continue;
      compared++;
      const scaled = theirs * scale;
      // 符号约定两边不一致（晨星成本/支出为负），所以只比绝对值。
      if (Math.abs(Math.abs(ours) - Math.abs(scaled)) <= MATCH_TOLERANCE * Math.abs(ours)) matched++;
    }
    if (compared > 0 && matched > 0) {
      out.push({ id: row.id, label: row.label, matchedYears: matched, comparedYears: compared, rate: matched / ourYears });
    }
  }
  return out.sort((a, b) => b.rate - a.rate || b.matchedYears - a.matchedYears);
}

async function main() {
  const tickerArg = argValue("--ticker");
  const itemsArg = argValue("--items");
  const topN = Number(argValue("--top") ?? "2");
  const items = itemsArg ? itemsArg.split(",").map((s) => s.trim()) : DEFAULT_ITEMS;

  const suite = JSON.parse(fs.readFileSync(SUITE_PATH, "utf8")) as Array<{ ticker: string; secId?: string }>;
  const dictionary = JSON.parse(fs.readFileSync(DICTIONARY_PATH, "utf8")) as Array<{
    key: string;
    nameZh: string;
    morningstarId?: string | null;
  }>;
  const declared = new Map(dictionary.map((d) => [d.key, d.morningstarId ?? null]));
  const targets = tickerArg ? suite.filter((c) => c.ticker === tickerArg) : suite;
  if (tickerArg && !targets.length) throw new Error(`样本清单里没有 ${tickerArg}`);

  // 一次取全我方数据
  const tickers = targets.map((t) => t.ticker);
  const bare = tickers.map((t) => t.replace(".HK", "").replace("-", "."));
  const entities = await db.entity.findMany({
    where: { OR: [{ ticker: { in: [...tickers, ...tickers.map((t) => `${t}.SS`), ...tickers.map((t) => `${t}.SZ`), ...bare] } }, { code: { in: bare } }] },
    select: { id: true, ticker: true, code: true, canonicalName: true },
  });
  // 分批查：一次拉一百多家实体 × 全部财年，会话池会在大结果集上直接断连。
  const facts: Array<{ entityId: string; periodEnd: Date; lineItem: string; value: unknown }> = [];
  const CHUNK = 20;
  for (let i = 0; i < entities.length; i += CHUNK) {
    const batch = entities.slice(i, i + CHUNK).map((e) => e.id);
    facts.push(
      ...(await db.financial.findMany({
        where: { entityId: { in: batch }, periodType: "FY" },
        select: { entityId: true, periodEnd: true, lineItem: true, value: true },
      })),
    );
  }

  const ourByEntityItem = new Map<string, Map<string, Map<number, number>>>();
  for (const f of facts) {
    if (f.value == null) continue;
    const year = f.periodEnd.getUTCMonth() === 0 && f.periodEnd.getUTCDate() <= 15 ? f.periodEnd.getUTCFullYear() - 1 : f.periodEnd.getUTCFullYear();
    if (!ourByEntityItem.has(f.entityId)) ourByEntityItem.set(f.entityId, new Map());
    const byItem = ourByEntityItem.get(f.entityId)!;
    if (!byItem.has(f.lineItem)) byItem.set(f.lineItem, new Map());
    byItem.get(f.lineItem)!.set(year, Number(f.value.toString()));
  }

  const entityForTicker = new Map<string, string>();
  for (const e of entities) {
    const t = e.ticker ?? e.code;
    if (t && !entityForTicker.has(t)) entityForTicker.set(t, e.id);
  }

  interface ItemVerdict {
    key: string;
    declaredId: string | null;
    companies: number;
    /** 只有声明的 id 对得上。 */
    declaredOnly: number;
    /** 两者都对得上（并列），说明这个样本分辨不出差别。 */
    both: number;
    /** 只有别的行对得上 —— 这才是映射错的证据。 */
    altOnly: number;
    /** 快照里没有任何一行对得上。 */
    neither: number;
    replacements: Map<string, { label: string; count: number }>;
  }
  const verdicts = new Map<string, ItemVerdict>();
  const examples: string[] = [];

  for (const company of targets) {
    const entityId = entityForTicker.get(company.ticker) ?? entities.find((e) => e.ticker === company.ticker)?.id;
    if (!entityId || !company.secId) continue;
    const snapshotFile = path.join(SNAPSHOT_DIR, `${company.secId}.json`);
    if (!fs.existsSync(snapshotFile)) continue;
    const snapshot = parseSnapshot(snapshotFile);
    const byItem = ourByEntityItem.get(entityId);
    if (!byItem) continue;

    // 用 Revenue 标定单位量级：我们绝对值 vs 晨星百万
    let scale: number | null = null;
    // 用多个稳定科目一起取中位比值，单靠一个科目碰上它本身抽错就会整家公司失真。
    const calibrationPairs: Array<[string, string]> = [
      ["Revenue", "IFIS001170"],
      ["TotalAssets", "IFBS002270"],
      ["NetIncome", "IFIS001100"],
    ];
    const scaleSamples: number[] = [];
    for (const [ourKey, mstarId] of calibrationPairs) {
      const row = snapshot.rowsById.get(mstarId);
      const series = byItem.get(ourKey);
      if (!row || !series) continue;
      const ratios: number[] = [];
      for (const [year, ours] of series) {
        const theirs = row.byYear.get(year);
        if (theirs != null && theirs !== 0) ratios.push(ours / theirs);
      }
      if (ratios.length >= 3) {
        ratios.sort((a, b) => a - b);
        scaleSamples.push(ratios[Math.floor(ratios.length / 2)]);
      }
    }
    if (scaleSamples.length) {
      scaleSamples.sort((a, b) => a - b);
      scale = scaleSamples[Math.floor(scaleSamples.length / 2)];
    }
    if (scale == null) continue;

    for (const key of items) {
      // 支持 "A+B" 形式的求和表达式，用来验证契约里声明的 sum_of 投影是否真的成立 ——
      // 这是对契约本身的反向校验：契约说「相加后应该等于晨星那条」，这里就实测。
      const parts = key.split("+").map((s) => s.trim());
      let ourSeries: Map<number, number> | null = null;
      if (parts.length === 1) {
        ourSeries = byItem.get(key) ?? null;
      } else {
        const seriesList = parts.map((p) => byItem.get(p));
        if (seriesList.every((s) => s && s.size > 0)) {
          const summed = new Map<number, number>();
          const first = seriesList[0]!;
          for (const year of first.keys()) {
            const vals = seriesList.map((s) => s!.get(year));
            if (vals.every((v) => v != null)) summed.set(year, vals.reduce<number>((a, v) => a + (v as number), 0));
          }
          ourSeries = summed.size ? summed : null;
        }
      }
      if (!ourSeries || ourSeries.size === 0) continue;

      const declaredId = parts.length === 1 ? (declared.get(key) ?? null) : parts.map((p) => declared.get(p) ?? "?").join("+");
      const candidates = rankCandidates(ourSeries, snapshot, scale);
      const best = candidates[0];

      const v = verdicts.get(key) ?? {
        key,
        declaredId,
        companies: 0,
        declaredOnly: 0,
        both: 0,
        altOnly: 0,
        neither: 0,
        replacements: new Map(),
      };
      v.companies++;

      const declaredHit = declaredId ? candidates.find((c) => c.id === declaredId) : undefined;
      const declaredRate = declaredHit?.rate ?? 0;
      const bestRate = best?.rate ?? 0;

      if (bestRate < 0.6) {
        // 没有任何一行能把我们的值对上，先别急着归因到映射
        v.neither++;
      } else if (declaredRate >= bestRate - 0.01) {
        v.declaredOnly++;
      } else if (declaredRate <= 0.2) {
        v.altOnly++;
      } else {
        // 声明的 id 能对上一部分但不是最好 —— 需要人看
        v.both++;
      }

      if (best && !(declaredRate >= bestRate - 0.01)) {
        const prev = v.replacements.get(best.id);
        v.replacements.set(best.id, { label: best.label, count: (prev?.count ?? 0) + 1 });
        if (examples.length < 14) {
          examples.push(
            `${company.ticker} ${key}: 声明 ${declaredId ?? "(无)"} 命中率 ${(declaredRate * 100).toFixed(0)}%，` +
              `实际对得上 ${best.id} "${best.label}" (${(bestRate * 100).toFixed(0)}%)`,
          );
        }
      }
      verdicts.set(key, v);
    }
  }

  console.log(`\n晨星映射校验 | ${targets.length} 家公司 | 容差 ±${MATCH_TOLERANCE * 100}%\n`);
  for (const key of items) {
    const v = verdicts.get(key);
    if (!v) {
      console.log(`  ${key.padEnd(32)} 样本里没有可比的年份，跳过`);
      continue;
    }
    // 只有当「只有别的行对得上」占多数时，才算映射确实错了。
    const wrong = v.companies > 0 && v.altOnly / v.companies >= 0.4;
    const flag = v.companies < MIN_COMPANIES_FOR_VERDICT ? "…" : wrong ? "❌" : v.neither / v.companies >= 0.3 ? "⚠️ " : "✅";
    console.log(`${flag} ${key.padEnd(32)} 声明 ${String(v.declaredId ?? "(无)").padEnd(12)} n=${String(v.companies).padStart(3)}`);
    console.log(
      `     只有声明对得上 ${String(v.declaredOnly).padStart(3)} | 两者并列 ${String(v.both).padStart(3)} | ` +
        `只有别的行对得上 ${String(v.altOnly).padStart(3)} | 都对不上 ${String(v.neither).padStart(3)}`,
    );
    const top = [...v.replacements.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, topN);
    for (const [id, info] of top) {
      console.log(`      ↳ ${info.count} 家实际对得上 ${id} "${info.label}"`);
    }
  }

  if (examples.length) {
    console.log("\n逐例抽样：");
    for (const e of examples) console.log(`  - ${e}`);
  }
  await db.$disconnect();
}

if (process.argv[1]?.includes("verify-morningstar-mappings.ts")) {
  main().catch(async (err) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
  });
}

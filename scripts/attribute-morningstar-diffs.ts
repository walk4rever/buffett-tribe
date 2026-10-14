/**
 * attribute-morningstar-diffs.ts
 *
 * 归因层。eval 只回答「哪儿对不上」，这里回答「为什么对不上」。
 *
 * 输入是一次 eval 落盘的 artifact（默认取 tests/evals/history/ 下最新的 raw 跑分），
 * 以及我们的模型 canonical-financial-dictionary.json 和比对契约 comparability-overrides.json。
 * 输出是缺陷台账：每个成因一张工单，带影响面、证据单元格、复现命令、归属组件。
 *
 * 台账是后面所有修复的工单来源 —— 先归因，再决定修模型还是修 backfill。
 *
 * Usage:
 *   npx tsx scripts/attribute-morningstar-diffs.ts
 *   npx tsx scripts/attribute-morningstar-diffs.ts --mode calibrated
 *   npx tsx scripts/attribute-morningstar-diffs.ts --file tests/evals/history/xxx.json
 *
 * 只读：不写任何业务表，只读 DB 取我方科目值做同公司兄弟科目交叉验证。
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { PrismaClient } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";

const db = new PrismaClient();

const DICTIONARY_PATH = path.join(process.cwd(), "scripts", "lib", "canonical-financial-dictionary.json");
const OVERRIDES_PATH = path.join(process.cwd(), "scripts", "lib", "golden-set", "comparability-overrides.json");
const HISTORY_DIR = path.join(process.cwd(), "tests", "evals", "history");
const LEDGER_DIR = path.join(process.cwd(), "tests", "evals", "ledger");

/** 相对偏差阈值：判定「这就是同一个数」的上限。 */
const SAME_VALUE_TOLERANCE = 0.01;
/** 归因用的宽松阈值：口径分歧往往有零头差异，但主因清楚。 */
const CAUSE_TOLERANCE = 0.03;
/** 同公司同年出现多少条差异，才足以判断存在系统性因子。 */
const SYSTEMIC_MIN_CELLS = 3;
/** 认定「同一个因子」的相对容差。 */
const SYSTEMIC_CLUSTER_TOLERANCE = 0.05;
/** 支持该因子的单元格至少要占该组的一半，才算系统性问题而不是零散巧合。 */
const SYSTEMIC_MIN_SUPPORT = 0.5;
/** 判定为「同向微差」的相对偏差上限。 */
const RESIDUAL_SMALL_MAX = 0.1;
/** 跨年持续偏差：至少要有几年数据才谈得上「持续」。 */
const PERSISTENT_MIN_YEARS = 4;
/** 跨年持续偏差：中位比值偏离 1 的最小幅度。低于此值视为正常口径松紧。 */
const PERSISTENT_MIN_BIAS = 0.15;

type CauseCode =
  | "EVAL_FX_GAP"
  | "CURRENCY_BASIS"
  | "CONCEPT_AGGREGATION"
  | "SIGN_INVERSION"
  | "UNIT_SCALE"
  | "DERIVABLE_MISSING"
  | "EXTRACTION_MISSING"
  | "MSTAR_COVERAGE_GAP"
  | "PERSISTENT_BIAS"
  | "DECLARED_AMBIGUOUS"
  | "RESIDUAL_SMALL"
  | "UNCLASSIFIED";

interface CauseMeta {
  label: string;
  owner: "model" | "backfill" | "eval" | "triage";
  action: string;
}

const CAUSES: Record<CauseCode, CauseMeta> = {
  EVAL_FX_GAP: {
    label: "评测器缺汇率（换算不了，判定失效）",
    owner: "eval",
    action:
      "评测器 YEAR_END_CNY_PER_USD 手工表缺该年度，且未使用库内 FxRate。补年度汇率前，这些单元格的 DISCREPANCY 是假性失分，不能当作数据质量问题。",
  },
  CURRENCY_BASIS: {
    label: "币种基准错位（整片同因子偏移）",
    owner: "backfill",
    action:
      "同一公司同一年度多条科目出现同一个系统性因子，说明注入时的币种基准与本币不一致。查该公司的 reportingCurrency 声明与实际写入 unit，修 backfill 的币种解析后重灌。",
  },
  CONCEPT_AGGREGATION: {
    label: "概念边界分歧（晨星是合并值，我们是拆分项）",
    owner: "model",
    action:
      "按比对契约把拆分项相加后再对，或显式声明不可直比（not_comparable）。这是模型定义问题，不是数据错误，改契约即可，不要动已入库的数据。",
  },
  SIGN_INVERSION: {
    label: "符号相反（绝对值一致）",
    owner: "model",
    action: "该科目在字典/eval 里声明了 signFlip 但注入或比对时未应用，核对符号约定后统一在一处翻转。",
  },
  UNIT_SCALE: {
    label: "量纲差 10^k",
    owner: "backfill",
    action: "注入时单位缩放错误，查该来源的 unit / scale 解析（常见于『千元』『百万元』混入）。",
  },
  DERIVABLE_MISSING: {
    label: "可推导但未推导（我们没抽到，但输入齐全）",
    owner: "model",
    action:
      "模型缺 derivedFrom 概念：字典里没有任何一项声明派生来源，导致这类科目只能等申报方自己披露。应在字典加入公式并让抽取管线回填。",
  },
  EXTRACTION_MISSING: {
    label: "根本没抽到（输入也不齐）",
    owner: "backfill",
    action: "该科目在该来源下的 tag / 别名覆盖不足，属抽取管线覆盖问题，需补 tag 或解析规则。",
  },
  MSTAR_COVERAGE_GAP: {
    label: "参考系缺该科目（晨星没有这一项）",
    owner: "eval",
    action:
      "我方有值、晨星没有。这不是我们的数据问题，而是参考系覆盖不到。需要给这类「晨星不覆盖」的科目指定另一个真值来源（申报文件原始事实），或在契约里显式声明不可比，否则它们会长期混在失分里。",
  },
  PERSISTENT_BIAS: {
    label: "跨年持续同向偏差（系统性口径范围差）",
    owner: "triage",
    action:
      "同一公司同一科目逐年都以固定比例偏离同向，说明是系统的口径范围差（含不含少数股东、含不含利息、毛额还是净额），不是随机误差。先钉死该科目的口径边界，再决定是修抽取还是修契约。",
  },
  DECLARED_AMBIGUOUS: {
    label: "已知口径歧义未裁决",
    owner: "model",
    action:
      "该科目在字典或比对契约里已被标记为不如一比（多科目共享同一晨星条目，或契约声明 either_of / overlaps）。残差大小说明歧义已经造成实际损失：需要人工裁决一个口径并写进契约，代码再照做。",
  },
  RESIDUAL_SMALL: {
    label: "同向微差（≤10%，无结构性解释）",
    owner: "triage",
    action:
      "差异同向且不大，既不是币种也不是量纲也不是符号。典型来源是口径微差、财年期间切分、或舍入。要么把口径钉死让它归零，要么把容差显式写进评测契约——不能默认忽略。",
  },
  UNCLASSIFIED: {
    label: "未归因（需人工看）",
    owner: "triage",
    action: "规则未能解释，逐条人工判定后把结论沉淀成新规则或新契约条目。",
  },
};

/** 差异量级分档：客观量，永远可算，用来给未裁决的口径歧义排优先级。 */
function bandOf(ratio: number | null): string {
  if (ratio == null) return "n/a";
  const gap = Math.abs(ratio - 1);
  if (gap < 0.01) return "<1%";
  if (gap < 0.03) return "1-3%";
  if (gap < 0.1) return "3-10%";
  if (gap < 0.5) return "10-50%";
  return ">50%";
}

interface DictItem {
  key: string;
  nameZh: string;
  statement: string;
  periodType: string;
  tagsUsGaap?: string[];
  tagsIfrs?: string[];
  morningstarId?: string | null;
}

interface Override {
  mode: "sum_of" | "absorbed" | "derived" | "either_of" | "overlaps";
  sumWith?: string[];
  absorbedBy?: string;
  formula?: string[];
  altMstarIds?: string[];
  overlapsWith?: string[];
  note: string;
}

interface VerifiedFinding {
  id: string;
  severity: string;
  title: string;
  evidence: string;
  repro: string;
  action: string;
}

interface MetricComparison {
  metric: string;
  year: number;
  ourValue: number | null;
  mstarValue: number | null;
  diffPercent: number | null;
  status: "MATCH" | "MINOR_DIFF" | "DISCREPANCY" | "MISSING_OURS" | "MISSING_MSTAR";
  adjustments?: string[];
}

interface CompanyReport {
  company: { ticker: string; name: string; market: string; form: string; reportingCurrency?: string };
  matchRate: number;
  details: MetricComparison[];
}

interface RunArtifact {
  generatedAt: string;
  mode: string;
  companies: CompanyReport[];
}

interface OurFacts {
  currency: string | null;
  unitHistogram: Array<[string, number]>;
  byMetric: Map<string, Map<number, number>>;
  entityFound: boolean;
}

interface CellFinding {
  ticker: string;
  market: string;
  form: string;
  metric: string;
  year: number;
  ourValue: number | null;
  mstarValue: number | null;
  ratio: number | null;
  band: string;
  cause: CauseCode;
  evidence: string;
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function pickArtifact(): string {
  const explicit = argValue("--file");
  if (explicit) return path.resolve(explicit);
  const mode = argValue("--mode") ?? "raw";
  if (!fs.existsSync(HISTORY_DIR)) throw new Error(`没有跑分历史目录：${HISTORY_DIR}`);
  const candidates = fs
    .readdirSync(HISTORY_DIR)
    .filter((f) => f.startsWith(`morningstar-${mode}-`) && f.endsWith(".json"))
    .map((f) => ({ f, mtime: fs.statSync(path.join(HISTORY_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  // 取体积最大的那份：小文件是 --ticker / --suite 的单次抽跑，不是全量。
  const full = candidates.filter((c) => fs.statSync(path.join(HISTORY_DIR, c.f)).size > 500_000);
  const chosen = (full[0] ?? candidates[0])?.f;
  if (!chosen) throw new Error(`tests/evals/history/ 下没有 mode=${mode} 的跑分 artifact`);
  return path.join(HISTORY_DIR, chosen);
}

function relativeGap(a: number, b: number): number {
  if (b === 0) return a === 0 ? 0 : Infinity;
  return Math.abs(a - b) / Math.abs(b);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 只认干净的量纲倍率，避免把巧合的数字误判成量纲问题。 */
function detectUnitScale(ratio: number): number | null {
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  for (const factor of [1e2, 1e3, 1e4, 1e6, 1e8, 1 / 1e2, 1 / 1e3, 1 / 1e4, 1 / 1e6, 1 / 1e8]) {
    if (relativeGap(ratio, factor) < SAME_VALUE_TOLERANCE) return factor;
  }
  return null;
}

async function fetchOurFacts(ticker: string): Promise<OurFacts> {
  const bare = ticker.replace(".HK", "").replace("-", ".");
  const entities = await db.entity.findMany({
    where: {
      OR: [
        { ticker },
        { ticker: `${ticker}.SS` },
        { ticker: `${ticker}.SZ` },
        { code: bare },
        { ticker: bare },
        { ticker: `${bare}.HK` },
      ],
    },
    include: { financials: { where: { periodType: "FY" }, orderBy: { periodEnd: "desc" } } },
  });
  const entity = entities.find((e) => e.financials.length > 0) ?? entities[0];
  const byMetric = new Map<string, Map<number, number>>();
  const unitHistogram = new Map<string, number>();
  let currency: string | null = null;

  if (entity) {
    for (const fin of entity.financials) {
      if (fin.unit) unitHistogram.set(fin.unit, (unitHistogram.get(fin.unit) ?? 0) + 1);
      if (fin.value == null || fin.periodType !== "FY") continue;
      const rawYear = fin.periodEnd.getUTCFullYear();
      const month = fin.periodEnd.getUTCMonth();
      const day = fin.periodEnd.getUTCDate();
      const year = month === 0 && day <= 15 ? rawYear - 1 : rawYear;
      if (!byMetric.has(fin.lineItem)) byMetric.set(fin.lineItem, new Map());
      byMetric.get(fin.lineItem)!.set(year, Number(fin.value.toString()));
    }
    // 金额单位 = 出现次数最多的「像币种」的 unit。eval 里取第一条非 shares 记录，
    // 那个口径在混入 ratio 行时会静默失效，所以这里用众数。
    const moneyUnits = [...unitHistogram.entries()]
      .filter(([u]) => /^[A-Z]{3}$/.test(u))
      .sort((a, b) => b[1] - a[1]);
    currency = moneyUnits[0]?.[0] ?? null;
  }

  return {
    currency,
    unitHistogram: [...unitHistogram.entries()].sort((a, b) => b[1] - a[1]),
    byMetric,
    entityFound: Boolean(entity),
  };
}

function ourValue(facts: OurFacts, metric: string, year: number): number | null {
  return facts.byMetric.get(metric)?.get(year) ?? null;
}

/** 按 overrides 里的公式/聚合声明，算出一个可与晨星直比的候选值。 */
function derivedCandidates(metric: string, year: number, facts: OurFacts, override?: Override): Array<{ label: string; value: number }> {
  if (!override) return [];
  const out: Array<{ label: string; value: number }> = [];

  if (override.mode === "sum_of" && override.sumWith?.length) {
    const parts = [metric, ...override.sumWith].map((k) => ourValue(facts, k, year));
    if (parts.every((v) => v != null)) {
      out.push({
        label: parts.length === 2 ? `${metric} + ${override.sumWith[0]}` : `${metric} + (${override.sumWith.join(" + ")})`,
        value: parts.reduce<number>((acc, v) => acc + (v ?? 0), 0),
      });
    }
  }

  if (override.mode === "derived" && override.formula) {
    const [a, op, b] = override.formula;
    const va = ourValue(facts, a, year);
    const vb = ourValue(facts, b, year);
    if (va != null && vb != null) {
      out.push({ label: `${a} ${op} ${b}`, value: op === "-" ? va - vb : va + vb });
    }
  }

  return out;
}

interface SystemicFactor {
  ticker: string;
  year: number;
  factor: number;
  cells: number;
  support: number;
}

interface PersistentBias {
  ticker: string;
  metric: string;
  factor: number;
  years: number[];
}

/**
 * 跨年持续偏差：同一公司同一科目逐年都以固定比例偏在同一侧。
 * 这类问题按单元格看零散（每年一条），按公司-科目看却是稳定的口径范围差，
 * 所以必须跨年聚合才显形。
 */
function detectPersistentBias(artifact: RunArtifact): Map<string, PersistentBias> {
  const byTickerMetric = new Map<string, Array<{ year: number; ratio: number }>>();
  for (const report of artifact.companies) {
    for (const d of report.details) {
      if (d.status !== "DISCREPANCY" && d.status !== "MINOR_DIFF") continue;
      if (d.ourValue == null || d.mstarValue == null || d.mstarValue === 0) continue;
      if (Math.sign(d.ourValue) !== Math.sign(d.mstarValue)) continue;
      const key = `${report.company.ticker}|${d.metric}`;
      if (!byTickerMetric.has(key)) byTickerMetric.set(key, []);
      byTickerMetric.get(key)!.push({ year: d.year, ratio: d.ourValue / d.mstarValue });
    }
  }

  const found = new Map<string, PersistentBias>();
  for (const [key, cells] of byTickerMetric) {
    if (cells.length < PERSISTENT_MIN_YEARS) continue;
    const ratios = cells.map((c) => c.ratio);
    const allAbove = ratios.every((r) => r > 1);
    const allBelow = ratios.every((r) => r < 1);
    if (!allAbove && !allBelow) continue;
    const med = median(ratios);
    if (Math.abs(med - 1) < PERSISTENT_MIN_BIAS) continue;
    const [ticker, metric] = key.split("|");
    found.set(key, { ticker, metric, factor: med, years: cells.map((c) => c.year) });
  }
  return found;
}

/**
 * 预扫描：同一公司同一年度若有多条差异共享同一个比值，就是一个系统性因子。
 * 币种基准错位、量纲错位都会在这里现形，而且不依赖 eval 自己有没有汇率。
 *
 * 用「多数派簇」而不是「全体离散度」：整片偏移的公司往往还夹着几条无关的零散差异，
 * 要求所有比值都紧密会让这些离群值一票否决掉整片偏移。
 */
function detectSystemicFactors(artifact: RunArtifact): Map<string, SystemicFactor> {
  const byCompanyYear = new Map<string, MetricComparison[]>();
  for (const report of artifact.companies) {
    for (const d of report.details) {
      if (d.status !== "DISCREPANCY" && d.status !== "MINOR_DIFF") continue;
      if (d.ourValue == null || d.mstarValue == null || d.mstarValue === 0) continue;
      if (Math.sign(d.ourValue) !== Math.sign(d.mstarValue)) continue;
      const key = `${report.company.ticker}@${d.year}`;
      if (!byCompanyYear.has(key)) byCompanyYear.set(key, []);
      byCompanyYear.get(key)!.push(d);
    }
  }

  const found = new Map<string, SystemicFactor>();
  for (const [key, cells] of byCompanyYear) {
    if (cells.length < SYSTEMIC_MIN_CELLS) continue;
    const ratios = cells.map((c) => (c.ourValue as number) / (c.mstarValue as number));
    // 找支持度最高的簇：对每个候选中心数一下有多少比值落在容差内
    let best = { center: ratios[0], support: 0 };
    for (const center of ratios) {
      const support = ratios.filter((r) => relativeGap(r, center) <= SYSTEMIC_CLUSTER_TOLERANCE).length;
      if (support > best.support) best = { center, support };
    }
    if (best.support < SYSTEMIC_MIN_CELLS) continue;
    if (best.support / cells.length < SYSTEMIC_MIN_SUPPORT) continue;
    if (relativeGap(best.center, 1) < RESIDUAL_SMALL_MAX) continue;
    const [ticker, yearStr] = key.split("@");
    found.set(key, {
      ticker,
      year: Number(yearStr),
      factor: best.center,
      cells: cells.length,
      support: best.support,
    });
  }
  return found;
}

function classifyCell(
  d: MetricComparison,
  facts: OurFacts,
  override: Override | undefined,
  systemic: SystemicFactor | undefined,
  persistent: PersistentBias | undefined,
  ambiguousMetrics: Set<string>,
  ticker: string,
  market: string,
  form: string,
): CellFinding {
  const ratio = d.ourValue != null && d.mstarValue ? d.ourValue / d.mstarValue : null;
  const base = {
    ticker,
    market,
    form,
    metric: d.metric,
    year: d.year,
    ourValue: d.ourValue,
    mstarValue: d.mstarValue,
    ratio,
    band: bandOf(ratio),
  };
  const hasFxGap = (d.adjustments ?? []).some((a) => a.startsWith("fx:no-rate"));

  if (d.status === "MISSING_OURS") {
    const derivable = derivedCandidates(d.metric, d.year, facts, override);
    if (d.ourValue == null && derivable.length > 0) {
      return {
        ...base,
        cause: "DERIVABLE_MISSING",
        evidence: `可推导但未入库：${derivable.map((c) => `${c.label} = ${c.value.toExponential(4)}`).join("; ")}；晨星 = ${d.mstarValue}`,
      };
    }
    return { ...base, cause: "EXTRACTION_MISSING", evidence: "我方该年度该科目无数据" };
  }

  if (d.mstarValue == null) {
    return {
      ...base,
      cause: "MSTAR_COVERAGE_GAP",
      evidence: `我方有值 ${d.ourValue}，晨星该年度无对应科目（status ${d.status}）`,
    };
  }

  if (d.ourValue == null) {
    return { ...base, cause: "EXTRACTION_MISSING", evidence: "我方该年度该科目无数据（未被标为 MISSING_OURS）" };
  }

  // 符号相反但绝对值一致
  if (relativeGap(d.ourValue, -d.mstarValue) < SAME_VALUE_TOLERANCE) {
    return { ...base, cause: "SIGN_INVERSION", evidence: `绝对值一致、符号相反：我们 ${d.ourValue} vs 晨星 ${d.mstarValue}` };
  }

  // 口径分歧：按契约把拆分项加回去就对上了
  for (const candidate of derivedCandidates(d.metric, d.year, facts, override)) {
    if (relativeGap(candidate.value, d.mstarValue) < CAUSE_TOLERANCE) {
      return {
        ...base,
        cause: "CONCEPT_AGGREGATION",
        evidence: `按契约聚合后重合：${candidate.label} = ${candidate.value} vs 晨星 ${d.mstarValue}（偏差 ${(relativeGap(candidate.value, d.mstarValue) * 100).toFixed(2)}%）；单看 ${d.metric} = ${d.ourValue}`,
      };
    }
  }

  // 量纲
  const scale = detectUnitScale((d.ourValue as number) / (d.mstarValue as number));
  if (scale != null) {
    return { ...base, cause: "UNIT_SCALE", evidence: `比值 ${((d.ourValue as number) / (d.mstarValue as number)).toFixed(6)} ≈ ${scale} 倍量纲差` };
  }

  // 币种基准：同公司同年整片同因子
  if (systemic) {
    return {
      ...base,
      cause: "CURRENCY_BASIS",
      evidence: `${ticker} FY${d.year} 共 ${systemic.cells} 条差异中有 ${systemic.support} 条共享因子 ${systemic.factor.toFixed(4)}，本条比值 ${ratio!.toFixed(4)}`,
    };
  }

  // 评测器缺汇率：会掩盖真实成因，所以放在最后兜底时明确标注
  if (hasFxGap) {
    return {
      ...base,
      cause: "EVAL_FX_GAP",
      evidence: `评测器无可用汇率（adjustments: ${(d.adjustments ?? []).join(", ")}），本条 DISCREPANCY 判定失效`,
    };
  }

  // 跨年持续同向偏差：口径范围差，按单元格看不出规律，按公司-科目才显形
  if (persistent) {
    return {
      ...base,
      cause: "PERSISTENT_BIAS",
      evidence: `${ticker} 该科目 FY${persistent.years.join("/")} 共 ${persistent.years.length} 年全部同向偏离，中位比值 ${persistent.factor.toFixed(4)}；本条 ${ratio!.toFixed(4)}`,
    };
  }

  // 已知口径歧义：字典/契约已经声明不如一比，残差就是歧义造成的实际损失
  if (ambiguousMetrics.has(d.metric)) {
    const why = override ? `契约声明 ${override.mode}` : "与其它科目共享晨星条目";
    return {
      ...base,
      cause: "DECLARED_AMBIGUOUS",
      evidence: `${why}：我们 ${d.ourValue} vs 晨星 ${d.mstarValue}，比值 ${ratio!.toFixed(4)}（${base.band}）`,
    };
  }

  if (ratio != null && Math.abs(ratio - 1) <= RESIDUAL_SMALL_MAX) {
    return {
      ...base,
      cause: "RESIDUAL_SMALL",
      evidence: `同向微差 ${((ratio - 1) * 100).toFixed(2)}%：我们 ${d.ourValue} vs 晨星 ${d.mstarValue}（${base.band}）`,
    };
  }

  return {
    ...base,
    cause: "UNCLASSIFIED",
    evidence: `我们 ${d.ourValue} vs 晨星 ${d.mstarValue}，比值 ${ratio!.toFixed(4)}（${base.band}），规则未解释${override ? `；该科目契约声明为 ${override.mode}` : ""}`,
  };
}

async function main() {
  const artifactPath = pickArtifact();
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as RunArtifact;
  const dictionary = JSON.parse(fs.readFileSync(DICTIONARY_PATH, "utf8")) as DictItem[];
  const overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf8")) as {
    items: Record<string, Override>;
    dictionaryDefects: Record<string, string>;
    verifiedFindings: { items: VerifiedFinding[] };
  };
  const verifiedFindings = overrides.verifiedFindings?.items ?? [];

  // 字典自身的矛盾：同一个晨星 id 被我方多个科目认领
  const byMstar = new Map<string, string[]>();
  for (const item of dictionary) {
    if (!item.morningstarId) continue;
    if (!byMstar.has(item.morningstarId)) byMstar.set(item.morningstarId, []);
    byMstar.get(item.morningstarId)!.push(item.key);
  }
  const conflicts = [...byMstar.entries()].filter(([, keys]) => keys.length > 1);
  const untagged = dictionary.filter((i) => !i.tagsUsGaap?.length && !i.tagsIfrs?.length);

  // 「已知不如一比」的科目：与别的科目共享晨星 id，或契约已经声明口径不唯一。
  const ambiguousMetrics = new Set<string>();
  for (const [, keys] of conflicts) for (const k of keys) ambiguousMetrics.add(k);
  for (const [key, ov] of Object.entries(overrides.items)) {
    if (ov.mode === "either_of" || ov.mode === "overlaps" || ov.mode === "absorbed") ambiguousMetrics.add(key);
  }

  console.log(`\n归因基准 artifact: ${path.relative(process.cwd(), artifactPath)}`);
  console.log(`  生成时间 ${artifact.generatedAt} | 模式 ${artifact.mode} | 公司 ${artifact.companies.length}`);

  const systemic = detectSystemicFactors(artifact);
  const persistentBias = detectPersistentBias(artifact);
  const findings: CellFinding[] = [];
  let cellTotal = 0;
  let matched = 0;
  let companiesWithoutEntity = 0;
  const entitylessTickers: string[] = [];

  for (const report of artifact.companies) {
    const { ticker, market, form } = report.company;
    const facts = await fetchOurFacts(ticker);
    if (!facts.entityFound) {
      companiesWithoutEntity++;
      entitylessTickers.push(ticker);
    }
    for (const d of report.details) {
      cellTotal++;
      if (d.status === "MATCH") {
        matched++;
        continue;
      }
      findings.push(
        classifyCell(
          d,
          facts,
          overrides.items[d.metric],
          systemic.get(`${ticker}@${d.year}`),
          persistentBias.get(`${ticker}|${d.metric}`),
          ambiguousMetrics,
          ticker,
          market,
          form,
        ),
      );
    }
  }

  // FxRate 覆盖情况：评测脚本用硬编码年度汇率，而库里的表只有单日 spot —— 两边都撑不起历史年度换算。
  const fxRows = await db.fxRate.findMany();
  const fxDates = [...new Set(fxRows.map((r) => r.asOfDate.toISOString().slice(0, 10)))].sort();

  const byCause = new Map<CauseCode, CellFinding[]>();
  for (const f of findings) {
    if (!byCause.has(f.cause)) byCause.set(f.cause, []);
    byCause.get(f.cause)!.push(f);
  }

  const nonMatch = cellTotal - matched;
  const pct = (n: number) => `${((n / nonMatch) * 100).toFixed(1)}%`;

  console.log(`\n单元格 ${cellTotal} | MATCH ${matched} | 非 MATCH ${nonMatch}`);
  console.log("\n--- 归因分布 ---");
  const ordered = (Object.keys(CAUSES) as CauseCode[])
    .map((c) => [c, byCause.get(c) ?? []] as const)
    .filter(([, cells]) => cells.length > 0)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [cause, cells] of ordered) {
    console.log(`  ${cause.padEnd(22)} ${String(cells.length).padStart(5)}  ${pct(cells.length).padStart(6)}  [${CAUSES[cause].owner}] ${CAUSES[cause].label}`);
  }

  // ---- 工单组装 ----
  interface WorkOrder {
    id: string;
    cause: CauseCode;
    title: string;
    owner: string;
    scope: string;
    cells: number;
    share: string;
    companies: string[];
    bands: Record<string, number>;
    evidence: string[];
    repro: string[];
    action: string;
  }
  const workOrders: WorkOrder[] = [];
  let wo = 0;
  for (const [cause, cells] of ordered) {
    const companyScoped = cause === "CURRENCY_BASIS" || cause === "EVAL_FX_GAP";
    const groups = new Map<string, CellFinding[]>();
    for (const c of cells) {
      const key = companyScoped ? c.ticker : c.metric;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c);
    }
    for (const [key, group] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
      wo++;
      const companies = [...new Set(group.map((g) => g.ticker))];
      const tickers = companies.slice(0, 4);
      const bands: Record<string, number> = {};
      for (const g of group) bands[g.band] = (bands[g.band] ?? 0) + 1;
      workOrders.push({
        id: `WO-${String(wo).padStart(2, "0")}`,
        cause,
        title: companyScoped
          ? `${tickers[0]}：${CAUSES[cause].label}`
          : `${key}（${dictionary.find((i) => i.key === key)?.nameZh ?? "?"}）：${CAUSES[cause].label}`,
        owner: CAUSES[cause].owner,
        scope: companyScoped ? `公司 ${key}` : `科目 ${key}`,
        cells: group.length,
        share: pct(group.length),
        companies,
        bands,
        evidence: group.slice(0, 4).map((g) => `[${g.ticker} FY${g.year}] ${g.evidence}`),
        repro: [
          ...tickers.map((t) => `npx tsx scripts/eval-financials-against-morningstar.ts --ticker ${t}`),
          `npx tsx scripts/attribute-morningstar-diffs.ts --file ${path.relative(process.cwd(), artifactPath)}`,
        ],
        action: CAUSES[cause].action,
      });
    }
  }

  fs.mkdirSync(LEDGER_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(LEDGER_DIR, `ledger-${stamp}.json`);
  const mdPath = path.join(LEDGER_DIR, `ledger-${stamp}.md`);

  const summary = {
    artifact: path.relative(process.cwd(), artifactPath),
    artifactGeneratedAt: artifact.generatedAt,
    mode: artifact.mode,
    companies: artifact.companies.length,
    companiesWithoutEntity,
    entitiesMissing: entitylessTickers,
    cells: cellTotal,
    matched,
    nonMatch,
    causes: ordered.map(([cause, cells]) => ({
      cause,
      label: CAUSES[cause].label,
      owner: CAUSES[cause].owner,
      cells: cells.length,
      share: pct(cells.length),
    })),
    dictionaryConflicts: conflicts.map(([mstarId, keys]) => ({ mstarId, keys, note: overrides.dictionaryDefects[mstarId] })),
    untaggedItems: untagged.map((i) => ({ key: i.key, nameZh: i.nameZh, morningstarId: i.morningstarId ?? null })),
    ambiguousMetrics: [...ambiguousMetrics].sort(),
    verifiedFindings,
    persistentBiases: [...persistentBias.values()].sort((a, b) => Math.abs(b.factor - 1) - Math.abs(a.factor - 1)),
    fxCoverage: { rows: fxRows.length, asOfDates: fxDates },
  };
  fs.writeFileSync(jsonPath, JSON.stringify({ summary, workOrders, findings }, null, 2), "utf8");

  const lines: string[] = [];
  lines.push("# 晨星对账缺陷台账", "");
  lines.push(`- 数据源：\`${summary.artifact}\`（${artifact.generatedAt}，模式 ${artifact.mode}）`);
  lines.push(`- 样本：${artifact.companies.length} 家公司，${cellTotal} 个比对单元格，MATCH ${matched}，非 MATCH ${nonMatch}`);
  if (companiesWithoutEntity > 0)
    lines.push(
      `- ⚠️ ${companiesWithoutEntity} 家公司在库里没找到 entity（${entitylessTickers.join("、")}），其「MISSING_OURS」可能是 entity 关联问题而非抽取问题`,
    );
  lines.push("");
  lines.push("## 归因分布", "");
  lines.push("| 成因 | 单元格 | 占非 MATCH | 归属 | 说明 |");
  lines.push("| --- | ---: | ---: | --- | --- |");
  for (const [cause, cells] of ordered) {
    lines.push(`| \`${cause}\` | ${cells.length} | ${pct(cells.length)} | ${CAUSES[cause].owner} | ${CAUSES[cause].label} |`);
  }
  lines.push("");
  lines.push(
    "`DECLARED_AMBIGUOUS` / `RESIDUAL_SMALL` / `UNCLASSIFIED` 这三类不是「没查清」，而是「查清了但没有唯一正确答案」——",
  );
  lines.push("它们的共同解法是人工裁决一个口径并写进 `scripts/lib/golden-set/comparability-overrides.json`，而不是继续查数据。");
  lines.push("");
  if (verifiedFindings.length) {
    lines.push("## 已核实的具体缺陷（人工定位到机制）", "");
    lines.push("自动归因只把差异分类；下面这些是已经查到底、能直接开工的问题。", "");
    for (const v of verifiedFindings) {
      lines.push(`### ${v.id}（${v.severity}）${v.title}`);
      lines.push("");
      lines.push(`证据：${v.evidence}`);
      lines.push("");
      lines.push("复现：");
      lines.push("```bash");
      lines.push(v.repro);
      lines.push("```");
      lines.push("");
      lines.push(`建议动作：${v.action}`);
      lines.push("");
    }
  }
  lines.push("## 模型层矛盾（脚本自动检出）", "");
  lines.push("字典里同一个晨星条目被我方多个科目认领——这是模型定义冲突，与数据质量无关，但会让对应科目永远比不平。", "");
  lines.push("| 晨星条目 | 认领我方科目 | 结论 |");
  lines.push("| --- | --- | --- |");
  for (const c of summary.dictionaryConflicts) {
    lines.push(`| \`${c.mstarId}\` | ${c.keys.join(" / ")} | ${c.note ?? "待确认"} |`);
  }
  lines.push("");
  if (untagged.length) {
    lines.push(`另有 ${untagged.length} 项字典科目没有任何 XBRL tag 且无晨星条目，属纯派生/纯本地科目：${untagged.map((u) => u.key).join("、")}。`);
    lines.push("");
  }
  lines.push("## 管线层缺陷", "");
  lines.push(
    `- **年度汇率缺位**：库内 \`FxRate\` 只有 ${fxRows.length} 行，全部是 ${fxDates.join(" / ")} 的单日 spot 快照，没有历史年度汇率；` +
      `而评测脚本用硬编码的 \`YEAR_END_CNY_PER_USD\` 兜底，该表又缺 FY2025。两边都撑不起历史年度换算，FY2025 的跨币种比对因此整体失效。`,
  );
  lines.push("- 评测脚本用「第一条非 shares 的 unit」判断公司币种，遇到混入 ratio 行的公司会静默取错币种。");
  lines.push("");
  lines.push("## 工单", "");
  for (const w of workOrders) {
    lines.push(`### ${w.id} [${w.owner}] ${w.title}`);
    lines.push("");
    const bandText = Object.entries(w.bands)
      .sort((a, b) => b[1] - a[1])
      .map(([b, n]) => `${b} ×${n}`)
      .join("，");
    lines.push(
      `影响 ${w.cells} 个单元格（占非 MATCH 的 ${w.share}），量级分布：${bandText}；涉及 ${w.companies.length} 家公司：${w.companies.slice(0, 12).join("、")}${w.companies.length > 12 ? ` 等 ${w.companies.length} 家` : ""}`,
    );
    lines.push("");
    lines.push("证据：");
    for (const e of w.evidence) lines.push(`- ${e}`);
    lines.push("");
    lines.push("复现：");
    lines.push("```bash");
    for (const r of w.repro) lines.push(r);
    lines.push("```");
    lines.push("");
    lines.push(`建议动作：${w.action}`);
    lines.push("");
  }
  fs.writeFileSync(mdPath, lines.join("\n"), "utf8");

  console.log(`\n台账 JSON: ${path.relative(process.cwd(), jsonPath)}`);
  console.log(`台账 MD  : ${path.relative(process.cwd(), mdPath)}`);
  console.log(`工单 ${workOrders.length} 张 | 未归因 ${(byCause.get("UNCLASSIFIED") ?? []).length} 个单元格`);
  await db.$disconnect();
}

if (process.argv[1]?.includes("attribute-morningstar-diffs.ts")) {
  main().catch(async (err) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
  });
}

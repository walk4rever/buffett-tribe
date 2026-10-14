/**
 * audit-model-coverage.ts
 *
 * 模型审计：我们的科目表离「全量拷贝晨星标准化模型」还差多远。
 *
 * 前提（本项目已定）：晨星的标准化报表模型就是我们的模型，只有当晨星没有定义某个科目、
 * 我们又确实需要、并且能从源头拿到时，才允许扩展。这条规则意味着审计表要有三列，
 * 前两列机器算，第三列只能人工判断：
 *
 *   1. 晨星是否定义         → 用 100 份快照的行并集查，命中就给出 id 和 label
 *   2. 源头能否拿到         → 分 US / CN / HK 三列（字典声明的取数途径）
 *   3. 我们是否需要         → 产品判断，本脚本留空
 *
 * 另外反向算一遍：晨星 schema 里有哪些行我们**完全没有对应科目**，按被多少家公司使用排序。
 * 那才是「拷贝没做完」的真缺口。
 *
 * 只读本地快照与字典，不需要数据库。
 *
 * Usage:
 *   npx tsx scripts/audit-model-coverage.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { CORE_METRIC_MAP } from "./eval-financials-against-morningstar";

const SNAPSHOT_DIR = path.join(process.cwd(), ".cache", "morningstar-snapshots");
const DICTIONARY_PATH = path.join(process.cwd(), "scripts", "lib", "canonical-financial-dictionary.json");
const SUITE_PATH = path.join(process.cwd(), "scripts", "lib", "morningstar-benchmark-suite.json");
const OUT_DIR = path.join(process.cwd(), "tests", "evals", "model-audit");
const DECISIONS_PATH = path.join(process.cwd(), "scripts", "lib", "golden-set", "model-decisions.json");

/** 只考虑被至少这么多家公司使用的晨星行 —— 只出现在一两家公司的行多半是公司特有科目。 */
const MIN_COMPANIES_FOR_ROW = 3;
/** 按名称匹配科目的最低相似度。 */
const NAME_MATCH_THRESHOLD = 0.7;

type Statement = "income" | "balance" | "cashflow";

interface DictItem {
  key: string;
  nameZh: string;
  nameEn: string;
  statement: string;
  periodType: string;
  morningstarId?: string;
  modelSource?: string;
  unitCandidates?: string[];
  tagsUsGaap?: string[];
  tagsIfrs?: string[];
  tagsCustom?: string[];
  cnAliases?: string[];
  hkAliases?: string[];
}

interface RowStat {
  id: string;
  label: string;
  labels: Set<string>;
  statement: Statement;
  path: string;
  companies: number;
  kind: RowKind;
}

/**
 * 晨星的 414 行里混着四种东西，不分清楚会把缺口算虚：
 *   container   —— 报表/区块的容器行（IncomeStatement、CashFlow、各种 Section），不是科目
 *   supplemental —— 晨星自己的「as reported / 标准化前」平行轨，和我们缺科目不是一回事
 *   maturity    —— 到期日阶梯表（DMBS*：合同义务、租赁负债分年、债务分年）
 *   data        —— 真正的报表科目
 */
type RowKind = "data" | "container" | "supplemental" | "maturity";

function classifyRow(id: string, label: string): RowKind {
  if (/^[A-Z]{4}000000$/.test(id)) return "container";
  if (/^(IncomeStatement|BalanceSheet|CashFlow|EpsAndWaso)$/i.test(label)) return "container";
  if (/Section$/i.test(label)) return "container";
  if (id.startsWith("DMBS")) return "maturity";
  if (/Supplemental|as Reported|Reported Normalized/i.test(label)) return "supplemental";
  return "data";
}

/** 我方所属表 → 可比的晨星表。补充表（supplementary）不限制。 */
function compatibleStatements(ours: string): Statement[] {
  if (ours.startsWith("income")) return ["income"];
  if (ours.startsWith("balance")) return ["balance"];
  if (ours === "cash_flow") return ["cashflow"];
  return ["income", "balance", "cashflow"];
}

function collectRows(rows: unknown, statement: Statement, into: Map<string, RowStat>, pathSoFar: string[]): void {
  if (Array.isArray(rows)) {
    for (const r of rows) collectRows(r, statement, into, pathSoFar);
    return;
  }
  if (!rows || typeof rows !== "object") return;
  const rec = rows as { dataPointId?: string; label?: string; subLevel?: unknown };
  if (rec.dataPointId && rec.label) {
    const existing = into.get(rec.dataPointId);
    if (existing) {
      existing.labels.add(rec.label);
      existing.companies++;
    } else {
      into.set(rec.dataPointId, {
        id: rec.dataPointId,
        label: rec.label,
        labels: new Set([rec.label]),
        statement,
        path: [...pathSoFar, rec.label].join(" > "),
        companies: 1,
        kind: classifyRow(rec.dataPointId, rec.label),
      });
    }
  }
  if (Array.isArray(rec.subLevel)) collectRows(rec.subLevel, statement, into, [...pathSoFar, rec.label ?? ""]);
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** 粗糙但够用的词形还原。不处理的话 "Minority Interest" 对不上 "Minority Interests"，
 *  而那条正好是「少数股东权益」在晨星侧的正确行。 */
const IRREGULAR_STEMS: Record<string, string> = {
  liabilities: "liability",
  subsidiaries: "subsidiary",
  securities: "security",
  activities: "activity",
  companies: "company",
  equities: "equity",
  properties: "property",
  inventories: "inventory",
};

function stem(token: string): string {
  if (IRREGULAR_STEMS[token]) return IRREGULAR_STEMS[token];
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function tokenSet(s: string): Set<string> {
  return new Set(norm(s).split(" ").filter(Boolean).map(stem));
}

/** 名称相似度：完全相等 1；我方词集是对方子集 0.9；否则 Jaccard。 */
function nameScore(ours: string, theirs: string): number {
  const a = norm(ours);
  const b = norm(theirs);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const at = tokenSet(a);
  const bt = tokenSet(b);
  if (at.size >= 2 && [...at].every((t) => bt.has(t))) return 0.9;
  if (bt.size >= 2 && [...bt].every((t) => at.has(t))) return 0.9;
  const inter = [...at].filter((t) => bt.has(t)).length;
  return inter / new Set([...at, ...bt]).size;
}

async function main() {
  const suite = JSON.parse(fs.readFileSync(SUITE_PATH, "utf8")) as Array<{ ticker: string; secId?: string }>;
  const dictionary = JSON.parse(fs.readFileSync(DICTIONARY_PATH, "utf8")) as DictItem[];

  // ---- 1. 晨星标准化 schema 并集 ----
  const schema = new Map<string, RowStat>();
  let snapshotsRead = 0;
  for (const company of suite) {
    if (!company.secId) continue;
    const file = path.join(SNAPSHOT_DIR, `${company.secId}.json`);
    if (!fs.existsSync(file)) continue;
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, { rows?: unknown }>;
    snapshotsRead++;
    // 每份快照内部先独立计数，避免同一公司在多张表里重复计入
    const seen = new Set<string>();
    const perCompany = new Map<string, RowStat>();
    if (data.isData?.rows) collectRows(data.isData.rows, "income", perCompany, []);
    if (data.bsData?.rows) collectRows(data.bsData.rows, "balance", perCompany, []);
    if (data.cfData?.rows) collectRows(data.cfData.rows, "cashflow", perCompany, []);
    for (const [id, row] of perCompany) {
      if (seen.has(id)) continue;
      seen.add(id);
      const existing = schema.get(id);
      if (existing) {
        for (const l of row.labels) existing.labels.add(l);
        existing.companies++;
      } else {
        schema.set(id, { ...row, labels: new Set(row.labels), companies: 1 });
      }
    }
  }

  console.log(`\n模型审计 | 读了 ${snapshotsRead} 份快照 | 晨星 schema 并集 ${schema.size} 行 | 我们字典 ${dictionary.length} 项`);

  // ---- 2. 声明的 id：字典 + eval 指标表（后者有字典漏填的） ----
  const declared = new Map<string, { id: string; from: string }>();
  for (const item of dictionary) {
    if (item.morningstarId) declared.set(item.key, { id: item.morningstarId, from: "字典" });
  }
  for (const m of CORE_METRIC_MAP) {
    if (!m.mstarId) continue;
    const prev = declared.get(m.key);
    if (prev && prev.id !== m.mstarId) {
      declared.set(m.key, { id: m.mstarId, from: `eval 指标表（与字典 ${prev.id} 冲突）` });
    } else if (!prev) {
      declared.set(m.key, { id: m.mstarId, from: "eval 指标表" });
    }
  }

  // ---- 3. 逐项判定 ----
  type Verdict = "已拷贝" | "声明 id 不在晨星 schema 里" | "待补 id（按名称匹配）" | "候选扩展" | "候选扩展（按名称有疑似行）";
  interface AuditRow {
    key: string;
    nameZh: string;
    nameEn: string;
    statement: string;
    declaredId: string | null;
    declaredFrom: string | null;
    declaredLabel: string | null;
    matchedId: string | null;
    matchedLabel: string | null;
    matchScore: number;
    us: boolean;
    cn: boolean;
    hk: boolean;
    verdict: Verdict;
    note: string;
  }

  const audited: AuditRow[] = [];
  const coveredIds = new Set<string>();

  for (const item of dictionary) {
    const dec = declared.get(item.key);
    const declaredRow = dec ? schema.get(dec.id) : undefined;
    const us = (item.tagsUsGaap?.length ?? 0) > 0 || (item.tagsCustom?.length ?? 0) > 0;
    const cn = (item.cnAliases?.length ?? 0) > 0;
    const hk = (item.hkAliases?.length ?? 0) > 0 || (item.tagsIfrs?.length ?? 0) > 0;

    // 按名称找候选行。跨表的候选要有更强的名称证据才允许胜出，
    // 否则「少数股东权益」这种会被同名但它表的行抢走。
    const compat = compatibleStatements(item.statement);
    let best: { id: string; label: string; score: number; crossStatement: boolean } | null = null;
    for (const row of schema.values()) {
      if (row.companies < MIN_COMPANIES_FOR_ROW) continue;
      if (row.kind === "container") continue;
      const sameStatement = compat.includes(row.statement);
      for (const label of row.labels) {
        const raw = nameScore(item.nameEn, label);
        const effective = sameStatement ? raw : raw * 0.85;
        if (effective >= NAME_MATCH_THRESHOLD && (!best || effective > best.score)) {
          best = { id: row.id, label, score: effective, crossStatement: !sameStatement };
        }
      }
    }

    let verdict: Verdict;
    let note = "";
    if (dec && declaredRow) {
      verdict = "已拷贝";
      coveredIds.add(dec.id);
      if (best && best.id !== dec.id && best.score >= 0.9) {
        note = `注意：名称也匹配到 ${best.id} "${best.label}"`;
      }
    } else if (dec && !declaredRow) {
      verdict = "声明 id 不在晨星 schema 里";
      note = `${dec.id} 在 ${snapshotsRead} 份快照里从未出现`;
    } else if (best) {
      verdict = "待补 id（按名称匹配）";
      coveredIds.add(best.id);
      const flags: string[] = [];
      if (best.crossStatement) flags.push("跨表匹配，需确认");
      if (/net/i.test(best.label) !== /net/i.test(item.nameEn)) flags.push("净额/毛额口径可能不同");
      note = flags.join("；");
    } else {
      verdict = "候选扩展";
      note = "";
    }

    if (verdict !== "已拷贝" && verdict !== "待补 id（按名称匹配）") {
      if (!us && !cn && !hk) note = [note, "三个市场都声明不出取数途径，建议删除"].filter(Boolean).join("；");
    }

    audited.push({
      key: item.key,
      nameZh: item.nameZh,
      nameEn: item.nameEn,
      statement: item.statement,
      declaredId: dec?.id ?? null,
      declaredFrom: dec?.from ?? null,
      declaredLabel: declaredRow?.label ?? null,
      matchedId: verdict === "待补 id（按名称匹配）" ? (best?.id ?? null) : null,
      matchedLabel: verdict === "待补 id（按名称匹配）" ? (best?.label ?? null) : null,
      matchScore: best?.score ?? 0,
      us,
      cn,
      hk,
      verdict,
      note,
    });
  }

  // ---- 4. 同一晨星行被我们多项认领（1:N 冲突） ----
  const claimants = new Map<string, string[]>();
  for (const a of audited) {
    const effective = a.declaredId ?? a.matchedId;
    if (!effective) continue;
    if (!claimants.has(effective)) claimants.set(effective, []);
    claimants.get(effective)!.push(a.key);
  }
  for (const a of audited) {
    const effective = a.declaredId ?? a.matchedId;
    const others = effective ? (claimants.get(effective) ?? []).filter((k) => k !== a.key) : [];
    if (others.length) a.note = [a.note, `与 ${others.join("、")} 共用 ${effective}`].filter(Boolean).join("；");
  }
  const conflicts = [...claimants.entries()].filter(([, keys]) => keys.length > 1);

  // ---- 5. 晨星 schema 里我们完全没有的行 ----
  const dataRows = [...schema.values()].filter((r) => r.kind === "data" && r.companies >= MIN_COMPANIES_FOR_ROW);
  const uncovered = [...schema.values()]
    .filter((r) => !coveredIds.has(r.id) && r.companies >= MIN_COMPANIES_FOR_ROW && r.kind !== "container")
    .sort((a, b) => a.kind.localeCompare(b.kind) || b.companies - a.companies);
  const coveredDataRows = dataRows.filter((r) => coveredIds.has(r.id)).length;

  // ---- 5. 人工裁决文件的现状 ----
  const decisions = fs.existsSync(DECISIONS_PATH)
    ? (JSON.parse(fs.readFileSync(DECISIONS_PATH, "utf8")) as {
        $comment?: string;
        items?: Record<string, { need?: string; note?: string }>;
      })
    : {};
  const pending = audited.filter((a) => a.verdict === "候选扩展" || a.verdict === "声明 id 不在晨星 schema 里");

  // 只补缺的键，不动已填的值 —— 否则每次重跑都会覆盖人工裁决。
  const decisionItems = decisions.items ?? {};
  const missingDecisions = pending.filter((a) => !(a.key in decisionItems));
  if (missingDecisions.length) {
    for (const a of missingDecisions) decisionItems[a.key] = { need: "" };
    const next = {
      $comment:
        "模型扩展裁决。取值：需要-保留扩展 / 不需要-删除 / 待定。本文件由 scripts/audit-model-coverage.ts 补键，不覆盖已填的值。",
      items: Object.fromEntries(Object.entries(decisionItems).sort(([a], [b]) => a.localeCompare(b))),
    };
    fs.writeFileSync(DECISIONS_PATH, JSON.stringify(next, null, 2) + "\n", "utf8");
  }

  // ---- 6. 输出 ----
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const jsonPath = path.join(OUT_DIR, `model-audit-${stamp}.json`);
  const mdPath = path.join(OUT_DIR, "model-audit.md");

  const byVerdict = new Map<string, number>();
  for (const a of audited) byVerdict.set(a.verdict, (byVerdict.get(a.verdict) ?? 0) + 1);

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        snapshotsRead,
        morningstarSchemaRows: schema.size,
        dictionaryItems: dictionary.length,
        verdicts: Object.fromEntries(byVerdict),
        morningstarDataRows: dataRows.length,
        coveredDataRows,
        conflicts: conflicts.map(([id, keys]) => ({ id, keys })),
        items: audited,
        uncoveredMorningstarRows: uncovered.map((r) => ({
          id: r.id,
          label: r.label,
          statement: r.statement,
          companies: r.companies,
          kind: r.kind,
          path: r.path,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );

  const lines: string[] = [];
  lines.push(`# 模型覆盖审计（${stamp}）`, "");
  lines.push(
    `读了 ${snapshotsRead} 份晨星快照，schema 并集 **${schema.size} 行**；我们字典 **${dictionary.length} 项**。`,
  );
  lines.push("");
  lines.push(
    `把它按性质分开之后：真正要拷贝的**数据行 ${dataRows.length} 行，我们覆盖了 ${coveredDataRows} 行（${((coveredDataRows / dataRows.length) * 100).toFixed(0)}%）**` +
      `，其余是容器行、晨星自己的 as-reported 平行轨、和到期日阶梯表。`,
  );
  lines.push("");
  lines.push("判定标准（三条同时成立才允许扩展）：**晨星没定义 + 我们确实需要 + 源头拿得到**。");
  lines.push("前两条机器算，第三条只有人能填，见文末待裁决清单。");
  lines.push("");
  lines.push("## 总览", "");
  lines.push("| 判定 | 项数 |");
  lines.push("| --- | ---: |");
  for (const [v, n] of [...byVerdict.entries()].sort((a, b) => b[1] - a[1])) lines.push(`| ${v} | ${n} |`);
  lines.push("");
  const badId = audited.filter((a) => a.verdict === "声明 id 不在晨星 schema 里");
  let sectionNo = 1;
  if (conflicts.length) {
    lines.push(`## ${sectionNo}. 同一晨星行被多项认领（${conflicts.length} 处）`, "");
    lines.push("一个晨星概念对应我们多个科目。要么拆错了，要么其中一个该改成别的行。", "");
    lines.push("| 晨星条目 | 认领的我方科目 |");
    lines.push("| --- | --- |");
    for (const [id, keys] of conflicts.sort((a, b) => b[1].length - a[1].length)) lines.push(`| \`${id}\` | ${keys.join(" / ")} |`);
    lines.push("");
    sectionNo++;
  }
  const pendingId = audited.filter((a) => a.verdict === "待补 id（按名称匹配）");
  if (pendingId.length) {
    lines.push(`## ${sectionNo}. 待补 id：晨星有、我们没填（${pendingId.length} 项）`, "");
    lines.push("这些不是扩展申请，是拷贝没做完。名称匹配已给出候选，需人工确认后填入字典。", "");
    lines.push("| 我们的科目 | 中文名 | 疑似晨星条目 | 晨星 label | 相似度 | 备注 |");
    lines.push("| --- | --- | --- | --- | ---: | --- |");
    for (const a of pendingId) {
      lines.push(`| \`${a.key}\` | ${a.nameZh} | \`${a.matchedId}\` | ${a.matchedLabel} | ${(a.matchScore * 100).toFixed(0)}% | ${a.note} |`);
    }
    lines.push("");
    sectionNo++;
  }
  if (badId.length) {
    lines.push(`## ${sectionNo}. 声明 id 无效（${badId.length} 项）`, "");
    lines.push("字典写了晨星 id，但该 id 在 100 份快照里从未出现 —— 是错映射，要限期清掉。", "");
    lines.push("| 我们的科目 | 声明的 id | 声明来源 | 备注 |");
    lines.push("| --- | --- | --- | --- |");
    for (const a of badId) lines.push(`| \`${a.key}\` | \`${a.declaredId}\` | ${a.declaredFrom} | ${a.note} |`);
    lines.push("");
    sectionNo++;
  }
  lines.push(`## ${sectionNo}. 候选扩展（${audited.filter((a) => a.verdict === "候选扩展").length} 项）`, "");
  lines.push("晨星 schema 里找不到对应行。**是否保留取决于第三列**，机器判不了。", "");
  lines.push("| 我们的科目 | 中文名 | 所属表 | US 可取 | CN 可取 | HK 可取 | 备注 | 需要？ |");
  lines.push("| --- | --- | --- | :-: | :-: | :-: | --- | --- |");
  for (const a of audited.filter((a) => a.verdict === "候选扩展")) {
    const known = decisions.items?.[a.key];
    lines.push(
      `| \`${a.key}\` | ${a.nameZh} | ${a.statement} | ${a.us ? "✓" : "—"} | ${a.cn ? "✓" : "—"} | ${a.hk ? "✓" : "—"} | ${a.note} | ${known?.need ?? ""} |`,
    );
  }
  lines.push("");
  sectionNo++;
  lines.push(`## ${sectionNo}. 晨星有、我们完全没有的行（${uncovered.length} 行）`, "");
  lines.push("按性质分开看，别把 250 这个数当成 250 个缺失科目。", "");
  for (const kind of ["data", "supplemental", "maturity"] as const) {
    const rows = uncovered.filter((r) => r.kind === kind);
    if (!rows.length) continue;
    const title =
      kind === "data"
        ? "真正缺的科目"
        : kind === "supplemental"
          ? "晨星自己的 as-reported / 标准化前平行轨（不是我们缺科目，是另一条轨）"
          : "到期日阶梯表（合同义务、租赁负债分年、债务分年）";
    lines.push(`### ${sectionNo}.${kind === "data" ? "1" : kind === "supplemental" ? "2" : "3"} ${title}（${rows.length} 行）`, "");
    lines.push("| 晨星 id | label | 表 | 多少家公司有 | 层级 |");
    lines.push("| --- | --- | --- | ---: | --- |");
    for (const r of rows.slice(0, 40)) lines.push(`| \`${r.id}\` | ${r.label} | ${r.statement} | ${r.companies} | ${r.path} |`);
    if (rows.length > 40) lines.push(`| … | 其余 ${rows.length - 40} 行见 JSON | | | |`);
    lines.push("");
  }
  sectionNo++;
  lines.push(`## ${sectionNo}. 待你裁决的清单`, "");
  lines.push(`把结论写进 \`${path.relative(process.cwd(), DECISIONS_PATH)}\` 的 \`items.<key>.need\`，取值：`);
  lines.push("`需要-保留扩展` / `不需要-删除` / `待定`。脚本下次运行会把它填进上表。", "");
  for (const a of pending) {
    lines.push(`- \`${a.key}\`（${a.nameZh}）：${a.note || "晨星 schema 里无对应行"}`);
  }
  lines.push("");
  fs.writeFileSync(mdPath, lines.join("\n"), "utf8");

  console.log("\n判定分布:");
  for (const [v, n] of [...byVerdict.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${v}`);
  console.log(`\n晨星 schema 里我们完全没有的行: ${uncovered.length}（出现在 ${MIN_COMPANIES_FOR_ROW}+ 家公司的）`);
  console.log(`待人工裁决: ${pending.length} 项`);
  console.log(`\n审计表: ${path.relative(process.cwd(), mdPath)}`);
  console.log(`明细  : ${path.relative(process.cwd(), jsonPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

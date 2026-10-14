/**
 * derived-metrics.ts
 *
 * 派生科目的唯一定义处。
 *
 * 背景：字典里有相当一批科目在申报文件里不必然单独披露（`GrossProfit` 的可选 tag
 * 就是典型），但它们可以由已披露的科目按会计恒等式算出来。此前代码里没有任何
 * 「派生」概念，于是这些科目只能碰运气等申报方自己披露，缺了就永远缺。
 *
 * 两条纪律：
 *   1. 派生发生在数据层（入库时），不在评测层。评测器一旦自己补数，基准就退化成
 *      答案本 —— 那正是 `calibrated` 模式必须逐条留痕的原因。
 *   2. 派生值必须自带溯源。入库时写 `mappingRule = "derived:<公式>"`、`confidence < 1`，
 *      让任何一格都能回答「这个数是算出来的还是抄来的、按什么公式算的」。
 */

export interface DerivedRule {
  /** 要补出来的科目。 */
  key: string;
  /** 扁平公式，形如 ["Revenue", "-", "CostOfRevenue"]。 */
  formula: string[];
  /** 派生结果的置信度，恒小于 1，用于和直接抽取区分。 */
  confidence: number;
  note: string;
}

export const DERIVED_RULES: DerivedRule[] = [
  {
    key: "GrossProfit",
    formula: ["Revenue", "-", "CostOfRevenue"],
    confidence: 0.9,
    note: "us-gaap:GrossProfit 是可选披露标签，大量申报方不打。全样本 155/442 个单元格因此为空，而年报里毛利是必述项——缺的是我们的覆盖，不是披露。",
  },
];

export function derivedMappingRule(rule: DerivedRule): string {
  return `derived:${rule.formula.join(" ")}`;
}

export interface FactRow {
  lineItem: string;
  value: number;
  unit: string | null;
  sourceId: string;
}

export interface DerivedFact {
  key: string;
  value: number;
  unit: string | null;
  sourceId: string;
  rule: DerivedRule;
  inputs: Array<{ lineItem: string; value: number }>;
}

export interface DerivationSkip {
  key: string;
  reason: string;
}

/**
 * 对一个 entity × period 的科目集合求派生值。
 *
 * 只补缺失项，绝不覆盖已有值；任一输入缺失、或输入之间单位不一致，一律跳过并说明
 * 原因 —— 宁可留空，也不许出现一个用不同量纲拼出来的数。
 */
export function deriveForPeriod(
  rows: FactRow[],
  rules: DerivedRule[] = DERIVED_RULES,
): { derived: DerivedFact[]; skipped: DerivationSkip[] } {
  const present = new Map<string, FactRow>();
  for (const r of rows) if (!present.has(r.lineItem)) present.set(r.lineItem, r);

  const derived: DerivedFact[] = [];
  const skipped: DerivationSkip[] = [];

  for (const rule of rules) {
    if (present.has(rule.key)) {
      skipped.push({ key: rule.key, reason: "已有该科目，不覆盖" });
      continue;
    }

    const first = present.get(rule.formula[0]);
    if (!first) {
      skipped.push({ key: rule.key, reason: `缺少公式首项 ${rule.formula[0]}` });
      continue;
    }

    let acc = first.value;
    const inputs: Array<{ lineItem: string; value: number }> = [{ lineItem: first.lineItem, value: first.value }];
    let missingInput: string | null = null;
    let unitMismatch: string | null = null;

    for (let i = 1; i + 1 < rule.formula.length; i += 2) {
      const operandKey = rule.formula[i + 1];
      const operand = present.get(operandKey);
      if (!operand) {
        missingInput = operandKey;
        break;
      }
      if (operand.unit !== first.unit) {
        unitMismatch = `${first.lineItem}(${first.unit ?? "null"}) 与 ${operandKey}(${operand.unit ?? "null"})`;
        break;
      }
      acc = rule.formula[i] === "-" ? acc - operand.value : acc + operand.value;
      inputs.push({ lineItem: operandKey, value: operand.value });
    }

    if (missingInput) {
      skipped.push({ key: rule.key, reason: `缺少 ${missingInput}` });
      continue;
    }
    if (unitMismatch) {
      skipped.push({ key: rule.key, reason: `单位不一致：${unitMismatch}` });
      continue;
    }

    derived.push({ key: rule.key, value: acc, unit: first.unit, sourceId: first.sourceId, rule, inputs });
  }

  return { derived, skipped };
}

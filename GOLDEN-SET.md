# Golden Set Worktree

本 worktree 只做一件事：**100 家公司财务数据 vs 晨星（Morningstar）标准化财务报表的比对测试集**。
主仓 `/Users/rafael/R129/buffett-tribe` 继续承担产品开发，这里只动抽取质量与评测口径。

分支 `golden-set`，从 `main @ 230e4a4a` 切出。

## 这套测试集的四块资产

| 资产 | 路径 | 说明 |
| --- | --- | --- |
| 样本清单 | `scripts/lib/morningstar-benchmark-suite.json` | 100 家：美股 58（10-K 39 / 20-F 14 / 40-F 5）、A 股 27、港股 15 |
| 比对引擎 | `scripts/eval-financials-against-morningstar.ts` | raw / calibrated 双模式，逐公司逐年逐项对差 |
| 晨星真值快照 | `.cache/morningstar-snapshots/<secId>.json` | 100 个 secId，已随 worktree 复制，默认不再打 API |
| 跑分历史 | `tests/evals/history/` | 每次运行一份时间戳 JSON，已 gitignore，不入库 |
| 缺陷台账 | `tests/evals/ledger/` | 归因层产出：把每个差异归因到具体成因，按工单组织 |

比对口径：29 个指标 = 11 个全行业基石（营收/税前利润/所得税/归母净利/总资产/总负债/股东权益/OCF/ICF/FCF/分红）
+ 工业 7（营业成本/毛利/营业利润/流动资产/流动负债/现金及等价物/CapEx）
+ 银行 5（利息净收入/非利息收入/贷款净额/存款/减值计提）+ 保险 5。
判定阈值：MATCH ±1%，MINOR_DIFF ±3%，其余 DISCREPANCY。

## 怎么跑

```bash
npm run eval:golden                 # 100 家全量，raw 模式（诚实分）
npm run eval:golden:both            # raw + calibrated 两轮
npm run eval:golden:compare         # 全量并与上一次 raw 跑分基线对差
npm run eval:golden:ledger          # 对最新一次 raw 跑分做归因，产出缺陷台账
npm run backfill:derived-metrics    # 派生科目回填（默认 dry-run，加 --execute 落库）

npx tsx scripts/eval-financials-against-morningstar.ts --ticker AAPL
npx tsx scripts/eval-financials-against-morningstar.ts --suite cn --years 5
```

不带 `--all` 时只跑 5 家代表公司（AAPL/BABA/…），别把它当成全量。全量单模式约 10 分钟，`--both` 约 20 分钟。
归因层约 13 分钟（它要为每家公司读一遍库内科目做交叉验证）。

## 归因层：从「哪儿对不上」到「为什么对不上」

`scripts/attribute-morningstar-diffs.ts` 是纯派生工具，读 eval 的 artifact + 字典 + 比对契约，
不写任何业务表。它把每个非 MATCH 单元格归到十个成因之一，按成因 × 科目（或成因 × 公司）组成工单，
产出 `tests/evals/ledger/ledger-<ts>.md`（人读，工单来源）和同名 `.json`（全量证据）。

十个成因分三层，含义完全不同，修复顺序也不同：

1. **改契约就能解决的（不动数据）**：`CONCEPT_AGGREGATION`（晨星是合并值、我们是拆分项）、
   `DECLARED_AMBIGUOUS`（已知口径歧义未裁决）、`SIGN_INVERSION`、`DERIVABLE_MISSING`（模型缺派生公式）。
2. **参考系或评测器的问题（不是我们的数据错）**：`MSTAR_COVERAGE_GAP`（晨星没这一项）、`EVAL_FX_GAP`。
3. **真数据问题（改 backfill 后重灌）**：`EXTRACTION_MISSING`、`CURRENCY_BASIS`、`UNIT_SCALE`、
   `PERSISTENT_BIAS`（跨年同向的系统性口径范围差）。

另有两类不是「没查清」而是「没有唯一正确答案」，解法是人工裁决口径写进契约：
`RESIDUAL_SMALL`（同向微差 ≤10%）和 `UNCLASSIFIED`（规则解释不了，需逐条看）。

判据全部写在脚本头部的常量里，每个成因的检测机制都要求能复现，不做无法解释的兜底分类。

人工核实过、已定位到机制的问题写在 `comparability-overrides.json` 的 `verifiedFindings` 里，
由脚本渲染进台账，与自动检出的工单分开呈现。

## 必须先守的两条口径

1. **`raw` 是唯一诚实的分数。** 只做单位/币种/符号归一，不套会计恒等式、不做指标聚合、不覆盖容差。
   `calibrated` 允许在评测时做恒等式推导与指标聚合，但每一项调整都会写进 compare row 的 `adjustments[]`，
   与 raw 的差距必须可审计。

   这条有个刻意的例外，叫**契约投影**：我们的模型在个别地方比晨星更细（现金和短期投资我们存两项，
   晨星只有一条 "Cash, Cash Equivalents and Short Term Investments"）。拿拆分项去比合并条目在任何模式下
   都是范畴错误，所以契约里声明的 `sum_of` 投影在 raw 和 calibrated 都生效。它固定、不看晨星的值、
   逐条记成 `rollup:<a>+<b>`。区分标准是：**投影是在定义「比哪两个数」，calibrated 里的恒等式推导和容差覆盖
   是在「调数值」** —— 只有后者必须锁在 calibrated 里。

   由此推论一条纪律：**派生属于数据层，不属于评测层。** 派生值入库时由
   `scripts/lib/derived-metrics.ts` 计算，带 `mappingRule = "derived:<公式>"` 与 `confidence < 1`。
   评测器如果自己补数，基准立刻退化成答案本。
2. **评测器不许偷看晨星的值。** 决定"我们的数怎么推导/取哪个口径"时，晨星值不能进入决策，
   否则 benchmark 就退化成答案本。历史上那些"差得不多就用晨星的数覆盖"的容差 override
   （能源/矿业 ±25%、分红 ±35%、CapEx ±10%，外加两个"谁离晨星近选谁"）已被关进 calibrated 并留痕。

## 快照纪律

默认走 `.cache/morningstar-snapshots/`，分数因此可复现。`--refresh-baseline` 才会重新打晨星 API，
只在确有必要时用——晨星重述应当表现为一次 baseline diff，而不是无声的分数跳动。

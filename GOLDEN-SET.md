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

比对口径：29 个指标 = 11 个全行业基石（营收/税前利润/所得税/归母净利/总资产/总负债/股东权益/OCF/ICF/FCF/分红）
+ 工业 7（营业成本/毛利/营业利润/流动资产/流动负债/现金及等价物/CapEx）
+ 银行 5（利息净收入/非利息收入/贷款净额/存款/减值计提）+ 保险 5。
判定阈值：MATCH ±1%，MINOR_DIFF ±3%，其余 DISCREPANCY。

## 怎么跑

```bash
npm run eval:golden                 # 100 家全量，raw 模式（诚实分）
npm run eval:golden:both            # raw + calibrated 两轮
npm run eval:golden:compare         # 全量并与上一次 raw 跑分基线对差

npx tsx scripts/eval-financials-against-morningstar.ts --ticker AAPL
npx tsx scripts/eval-financials-against-morningstar.ts --suite cn --years 5
```

不带 `--all` 时只跑 5 家代表公司（AAPL/BABA/…），别把它当成全量。全量单模式约 10 分钟，`--both` 约 20 分钟。

## 必须先守的两条口径

1. **`raw` 是唯一诚实的分数。** 只做单位/币种/符号归一，不套会计恒等式、不做指标聚合、不覆盖容差。
   `calibrated` 允许在评测时做恒等式推导与指标聚合，但每一项调整都会写进 compare row 的 `adjustments[]`，
   与 raw 的差距必须可审计。
2. **评测器不许偷看晨星的值。** 决定"我们的数怎么推导/取哪个口径"时，晨星值不能进入决策，
   否则 benchmark 就退化成答案本。历史上那些"差得不多就用晨星的数覆盖"的容差 override
   （能源/矿业 ±25%、分红 ±35%、CapEx ±10%，外加两个"谁离晨星近选谁"）已被关进 calibrated 并留痕。

## 快照纪律

默认走 `.cache/morningstar-snapshots/`，分数因此可复现。`--refresh-baseline` 才会重新打晨星 API，
只在确有必要时用——晨星重述应当表现为一次 baseline diff，而不是无声的分数跳动。

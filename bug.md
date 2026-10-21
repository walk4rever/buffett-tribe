# 财务数据模型、处理与展示缺陷台账

> **版本**：v2026-10-18（金融口径专项审阅 + 第三次独立复核）
> **编号说明**：承接 `GOLDEN.md` 已归档的历史 BUG-01～08，本文从 BUG-09 接续。
> **审阅范围**：`DATA.md`、`GOLDEN.md`、Prisma Schema、财务采集/回填/归一化/计算代码、黄金测试、当前配置库记录，以及 AAPL、BRK-B 公司详情页实际渲染结果。
> **核心结论**：当前系统已具备较好的财务可视化与工程治理框架，但尚不能视为可审计的金融终端。主要风险不是“缺数据”，而是会计语义混用、推断值事实化、跨样本池计算、估值解释过度，以及测试只验证存在性而未验证金融正确性。
>
> **补充说明**：第八章为 2026-10-18 第三次独立复核，专门回答“问题是否真实、方案是否有效”，并给出对第七章方案的具体修订意见。第七章可作为方向性草案，实施前应以第八章的修订结论为准。
>
> **第一批修复记录**：2026-10-20 已完成 BUG-09.5、BUG-11、BUG-12（止血）、BUG-13、BUG-14 + BUG-15、BUG-21、BUG-23 的代码修复与回归测试，详见第九章。

---

## 一、缺陷分级与本次验证边界

### 1. 缺陷分级

- **P0（阻断级）**：可能直接制造错误财务事实、错误历史序列或错误资本配置结论；修复前不应作为投资决策依据。
- **P1（严重级）**：估值方法、行业模型、跨币种、页面解释或验收机制存在实质性偏差，可能造成误导。
- **P2（体验级）**：文案、标签、单位或交互不一致，不一定改变底层事实，但会降低专业可读性。

### 2. 本次已完成验证

- 运行相关单元测试：**7 个测试文件、82 项测试全部通过**。通过不代表本文问题不存在，部分测试恰好固化了错误语义或没有覆盖对应边界。
- 对拆股误判、资本配置跨样本池混算分别做了最小输入复现。
- 抽查当前配置库：共 **1,308,959** 条财务事实；`rawXbrlTag` 非空 **0** 条；`mappingRule` 非空 **3,728** 条，约 **0.28%**。
- 实际渲染并检查 AAPL 价值线、财务分析、资本配置页面，以及 BRK-B 估值页面。
- 对 JPM FY2024 净利润口径与官方年报进行了交叉核对。

### 3. 验证边界

- 全量 23 家在线黄金审计未形成有效复验结果：首次运行在第 12 家时因数据库连接中断终止，重试未能及时完成。因此本文**不将 `GOLDEN.md` 中的“23/23 PASS”视为本次已复验结论**。
- 本文未对所有公司做全量数据重算；标记为“代码确认”的问题需要按建议验收标准补充全库回归。
- 本文不推翻 `GOLDEN.md` 中历史 BUG-01～08 的关闭状态，仅记录本次新发现问题。

---

## 二、缺陷总览

| 编号 | 级别 | 缺陷 | 证据类型 | 状态 |
| :--- | :---: | :--- | :--- | :---: |
| BUG-09 | P0 | 财务事实缺少完整上下文，值、来源和重述版本无法可靠追溯 | 库内实测 + 代码确认 | 止血完成，完整版本化待做 |
| BUG-10 | P0 | 标准字典混用不同会计概念，黄金真值随抽取结果漂移 | 官方年报 + 代码确认 | 待修复 |
| BUG-11 | P0 | 回填仍存在私有派生，负债公式可能把少数股东权益计入负债 | 代码确认 | 代码已修；历史派生行待清理 |
| BUG-12 | P0 | 无公司行动事件的拆股启发式会把真实增发/并购误判为拆股 | 最小复现 | 止血完成；公司行动表待建 |
| BUG-13 | P0 | 加权/推导股数被用于期末 BPS、总股本变化和每股分红 | 代码 + 测试确认 | 代码已修 |
| BUG-14 | P0 | 仅有部分现金流数据即把分红、回购、并购等缺项补零 | 代码 + 测试确认 | 代码已修 |
| BUG-15 | P0 | 资本配置跨年份集合混算；“留存收益扩表”概念不成立 | 最小复现 + 代码确认 | 代码已修 |
| BUG-16 | P1 | 历史相对估值被解释为内在价值；历史汇率和 PE 时点口径不清 | 页面 + 代码确认 | 待修复 |
| BUG-17 | P1 | PB-ROE 推演虚构默认分红率，且近似加总被命名为严格 TSR | 代码确认 | 待修复 |
| BUG-18 | P1 | 六大模板主要仍是展示分类，专属估值模型和杜邦/ROIC 未真正落地 | 页面 + 代码确认 | 待修复 |
| BUG-19 | P1 | 黄金测试存在代数重言式、生产链路旁路和只查存在性的假绿灯 | 代码 + 实测确认 | 待修复 |
| BUG-20 | P1 | ROE、负债率、权益增长等卡片存在无充分依据的品质/安全判断 | AAPL 页面实测 | 待修复 |
| BUG-21 | P1 | 价值线价格与价值点按下标而非日期对齐，hover 可比较不同日期 | 代码确认 | 代码已修 |
| BUG-22 | P1 | 展示币种被标成报告币种，“5 年”标签未始终反映真实覆盖期 | 代码确认 | 待修复 |
| BUG-23 | P1 | 地产净负债率缺失即零，且跨币种时部分公式输入未归一 | 代码确认 | 代码已修；历史数据待重算 |

---

## 三、P0：财务事实与计算污染

### BUG-09：财务事实缺少完整上下文，值、来源和重述版本无法可靠追溯

- **级别**：P0
- **位置**：
  - `prisma/schema.prisma:462-481`
  - `scripts/backfill-company-financials-fast.ts:62-109`
  - `scripts/backfill-company-financials-fast.ts:363-379`
  - `scripts/lib/upsert-financial-rows.ts:62-69`
- **现象与证据**：
  1. `Financial` 唯一键为 `(entityId, periodEnd, periodType, lineItem)`，但缺少 `periodStart`、XBRL context、股类别、合并/母公司口径、维度、披露版本和派生输入事实。
  2. 多类别股票、带维度 XBRL 事实、同一期间的原报/重报无法在同一模型中准确保留。
  3. 当前配置库实测：1,308,959 条事实中，`rawXbrlTag` 非空为 0，`mappingRule` 非空仅 3,728 条。
  4. SEC 提取器跨所有年报选择最新 `filed` 值，却把值写入当前循环年报的 `sourceId`；历史值可能来自后续重述年报，而来源仍指向早年报告。
  5. upsert 会用新行的 `rawXbrlTag`、`mappingRule`、`confidence` 覆盖旧值；新行为空时，已有溯源可能被抹掉。
- **金融影响**：无法回答某数字来自哪条事实、哪个上下文、哪个披露版本；历史 PE 的披露日可得性、拆股复权和审计对账均失去可靠基础。
- **修复要求**：
  - 原始事实采用追加式或版本化存储，保留 tag、context、accession、期间、维度、股类别、单位、披露日和原始值。
  - 将原始事实层与标准科目投影层分离。
  - upsert 不得用空溯源覆盖已有非空溯源；派生行必须保存具体输入事实引用。
- **验收标准**：
  - 任一展示值均可回溯到唯一原始事实或一组明确输入事实。
  - 同一期间的原报与重报可同时存在，查询端能显式选择“截至某日可得版本”或“最新重述版本”。
  - 多类别股数/EPS 不再互相覆盖；新入库关键事实溯源完整率达到 100%。

### BUG-10：标准字典混用不同会计概念，黄金真值随抽取结果漂移

- **级别**：P0
- **位置**：
  - `scripts/lib/canonical-financial-dictionary.json:3-20`
  - `scripts/lib/canonical-financial-dictionary.json:554-572`
  - `scripts/lib/canonical-financial-dictionary.json:1644-1661`
  - `scripts/eval-golden-18.ts:188-193`
  - `scripts/eval-golden-18.ts:332-342`
  - `GOLDEN.md:98-124`
- **现象与证据**：
  1. `Revenue` 混合总营收、客户合同收入、利息与非利息收入等不同概念。
  2. `NetIncome` 混合归母净利润、归属普通股股东净利润和含少数股东损益的合并净利润。
  3. `ShareholdersEquity` 同时接受归母权益和含少数股东权益的总权益。
  4. JPM FY2024：`GOLDEN.md` 写净利润 58.471B，可执行黄金集却使用 56.868B。官方年报同时列示：净利润 58.471B、归属普通股股东净利润 56.868B。二者差额涉及优先股等，不能共用一个含义模糊的 `NetIncome`。
  5. BRK FY2024：`GOLDEN.md` 使用 Revenue 424.232B，可执行黄金集使用 371.433B；二者分别对应含投资损益的总收入与经营收入口径，不能在无说明的情况下互相替换。
  6. AIA 等多个标的在 `GOLDEN.md` 与可执行黄金集之间也存在真值漂移。
- **官方参照**：[JPMorgan Chase 2024 Annual Report](https://www.sec.gov/Archives/edgar/data/19617/000001961725000326/annualreport-2024.pdf)
- **金融影响**：ROE、净利率、现金转化、分红率、杜邦拆解和跨公司比较可能使用不一致的分子分母；黄金集可能验证“系统已采到什么”，而不是“官方年报要求什么”。
- **修复要求**：
  - 拆分为 `ProfitLossConsolidated`、`NetIncomeAttributableToParent`、`NetIncomeAvailableToCommon`、`EquityAttributableToParent`、`TotalEquity` 等独立科目。
  - Revenue 按行业和分析目的区分经营收入、总收入及投资损益，禁止跨语义 fallback。
  - 真值台账独立版本化，任何修改必须附官方事实链接、报表行名和复核记录。
- **验收标准**：JPM 测试同时保留 58.471B 与 56.868B 两个不同科目；BRK 测试明确区分 424.232B 与 371.433B 的收入范围，禁止用一个字段覆盖两种口径。

### BUG-11：回填仍存在私有派生，负债公式可能把少数股东权益计入负债

- **级别**：P0
- **位置**：
  - `scripts/backfill-company-financials-fast.ts:386-457`
  - `scripts/lib/derived-metrics.ts:27-34`
  - `DATA.md:92-96`
- **现象与证据**：快速回填仍在本地推导 `TotalLiabilities`、`CostOfRevenue`、`GrossProfit`、`NetInterestIncome`、`NonInterestIncome`、`IncomeTaxExpense`，未统一走 `derived-metrics.ts`，也未统一写入派生溯源。
- **关键错误公式**：`TotalLiabilities = TotalAssets - ShareholdersEquity`。若 `ShareholdersEquity` 为归母权益，结果实际为“负债 + 少数股东权益”。
- **附加风险**：`IncomeTaxExpense = |TotalProfit - NetIncome|` 在 NetIncome 为归母或归属普通股口径时，会混入少数股东损益、优先股股利等差异，不必然是所得税费用。
- **金融影响**：负债率、净负债、ROIC、税率和安全性指标被系统性扭曲，且页面无法识别这些值为派生值。
- **修复要求**：所有派生进入唯一规则库；负债只能由 `TotalAssets - TotalEquity` 推导；禁止用跨口径利润差推导所得税。
- **验收标准**：构造含少数股东权益的公司样本，验证负债不增加；所有派生行均有公式、输入事实和置信/来源标记，且不再被后续回填抹除。

### BUG-12：无公司行动事件的拆股启发式会把真实增发/并购误判为拆股

- **级别**：P0
- **位置**：`src/lib/financial-math.ts:38-76`、`src/lib/financial-math.ts:146-188`、`src/lib/financial-math.ts:200-260`
- **最小复现**：输入一家真实 10 倍增发公司：旧年股数 1 亿、EPS 10；新年股数 10 亿、EPS 20。算法将旧年改写为股数 10 亿、EPS 1，即把增发误判成 10:1 拆股。
- **根因**：仅根据相邻年度股数比例和宽松 EPS 方向猜测拆股，没有独立公司行动事件。现有测试只保护约 30% 增发，无法保护 2 倍以上的真实发行、换股并购或资本重组。
- **金融影响**：历史 EPS、BPS、DPS、股本变化和 PE/PB 被成批改写，形成极其平滑但完全错误的历史序列。
- **修复要求**：建立独立公司行动表，记录拆股/合股比例、除权日、来源；启发式只能生成待复核候选，不得直接修改生产序列。
- **验收标准**：覆盖 2x、10x 真实增发、换股并购、拆股、合股和多重公司行动；无事件输入时不得改写历史值。

### BUG-13：加权/推导股数被用于期末 BPS、总股本变化和每股分红

- **级别**：P0
- **位置**：
  - `src/lib/share-count-utils.ts:51-61`
  - `src/lib/value-line-data.ts:449-476`
  - `src/lib/value-line-data.ts:1104-1119`
  - `src/lib/value-line-metric-profile.ts:498-508`
  - `tests/capital-allocation-metrics.test.ts:178-237`
- **现象与证据**：
  1. `NetIncome / EPS` 推导的是期间加权股数，却被标记为 `derived` 并允许进入资本配置股数变化。
  2. 历史 BPS 使用 `annual.shares`，该值可能来自期末股数、加权股数或推导股数，未严格限定为期末股数。
  3. REIT 每股分红也使用该通用 `annual.shares`，但文案写“按期末股数计算”。
  4. 现有测试明确接受推导股数参与股本变化，属于把错误契约固化进测试。
- **金融影响**：BPS、PB、回购/稀释判断和每股分红在增发、回购或年内股本剧烈变动时产生系统性误差。
- **修复要求**：期末股数只用于市值、BPS 和期末股本变化；加权股数只用于 EPS 期间分析；推导加权股数必须明确标记，禁止冒充期末股数。
- **验收标准**：构造年内 50% 增发样本，BPS 与股本变化只能使用期末实际股数；缺少期末股数时显示 `null`，不得用加权值补齐。

### BUG-14：仅有部分现金流数据即把分红、回购、并购等缺项补零

- **级别**：P0
- **位置**：`src/lib/financial-normalization.ts:13-74`、`tests/financial-normalization.test.ts:10-83`
- **现象与证据**：只要年度内出现任一受支持的现金流科目，系统就把缺失的 `DividendsPaid`、`ShareRepurchaseAmt`、`PurchaseSaleOfBusinessNet` 等填为 0。测试明确要求仅凭 Revenue、OCF、CapEx 就生成这些零值。
- **根因**：OCF 或 CapEx 被采集，只能证明部分现金流数据存在，不能证明投资与筹资现金流已完整解析。
- **金融影响**：采集缺口被转换成“未分红、未回购、未并购”的公司事实，继而抬高覆盖率并污染资本配置瀑布。
- **修复要求**：只有原始披露明确为 0，或有证据证明相关报表现金流章节完整且该事项不存在时，才能写 0；否则保持 `null`。
- **验收标准**：仅含 OCF/CapEx 的输入不得产生任何股东回报或并购零值；摘要中的“区间未实施”必须有完整披露依据。

### BUG-15：资本配置跨年份集合混算；“留存收益扩表”概念不成立

- **级别**：P0
- **位置**：
  - `src/lib/capital-allocation-metrics.ts:84-153`
  - `src/lib/capital-allocation-metrics.ts:187-223`
  - `src/components/CapitalAllocationView.tsx:530-636`
- **最小复现**：只有 1 年完整 OCF/CapEx，累计 FCF 为 80；并购额却汇总 2 年共 200，系统仍计算分配结余为 -120。
- **根因一**：FCF 使用 `flowAnnuals`，并购使用全部 `annuals`，不同样本池进入同一等式。
- **根因二**：金融模板把 `累计净利润 - 分红 - 回购`命名为 `retainedEarnings`，页面进一步解释为“留存扩表/充实资本”。该差额不是资产负债表留存收益，也不能自动证明用于扩表或监管资本增加。
- **附加问题**：`totalBuyback5Y` 对缺失年份按 0 汇总，仍可能显示“5 年累计回购”。
- **金融影响**：资本覆盖结论、结余和股东返还率可能在数据不完整时显得精确，实际并不成立。
- **修复要求**：所有瀑布分项必须使用同一组年份和同一覆盖范围；任何核心分项不完整时只展示分项，不计算总结余；将留存差额改为中性名称，不与法定留存收益或监管资本混同。
- **验收标准**：上述复现输入不得产生 -120；缺任一年并购数据时不得输出“FCF 减并购与股东回报”的最终结余；覆盖期必须同时显示实际年数与年份缺口。

---

## 四、P1：估值、行业模型与页面解释

### BUG-16：历史相对估值被解释为内在价值；历史汇率和 PE 时点口径不清

- **级别**：P1
- **位置**：
  - `src/lib/value-line-data.ts:1058-1079`
  - `src/lib/value-line-data.ts:1129-1151`
  - `src/lib/fx-rates.ts:195-205`
  - `src/components/ValueLineCard.tsx:182-199`
  - `src/components/ValueLineCard.tsx:385-404`
- **现象与证据**：
  1. 价值线主要是 `EPS × 历史 PE 中位数`，本质为历史相对估值，却被用于“价值击球区”“溢价高估区”“合理估值中枢”等判断。
  2. 跨币种历史 PE/PB 使用最新汇率折算全部历史财务数据。页面虽有注明，但得到的不是各历史时点真实市场倍数，而是固定当前汇率的可比序列。
  3. 当前 PE 使用最新完整年度 EPS，不是 TTM，却只标为“当前 P/E”。
- **金融影响**：用户可能把历史价格中枢误认为企业内在价值或安全边际；汇率大幅波动时，历史分位和高低估结论会失真。
- **修复要求**：统一命名为“历史相对估值参考”；明确静态 FY 与 TTM；建立逐日 FX，区分当时实际倍数与固定汇率分析序列。
- **验收标准**：页面不再仅依据历史 PE/PB 中位数输出“击球区/高估区”；跨币种测试能按每个价格日期的 FX 复算当时 PE/PB。

### BUG-17：PB-ROE 推演虚构默认分红率，且近似加总被命名为严格 TSR

- **级别**：P1
- **位置**：`src/components/ValuationAnalysisView.tsx:358-425`
- **现象与证据**：
  1. 当净利润为正但分红合计为 0 或没有有效分红数据时，`payoutRatio` 默认取 0.3；实际零分红公司也会被假设 30% 分红。
  2. 历史分红率被 `Math.min(0.7, ...)` 封顶 70%，属于未向用户充分说明的模型假设。
  3. 只选择净利润为正的年份计算分红率，损失年份的分红和利润被排除，可能形成选择性偏差。
  4. 年化综合回报通过“价格 CAGR + 估算股息率”相加，未按每年真实股息现金流计算，却被命名为 TSR。
- **金融影响**：虚构股息回报，并可能在 PB 变化时放大回报误差。
- **修复要求**：零分红必须取 0；缺失分红不得默认 30%；任何封顶应作为用户可调假设；按年度股息现金流计算总回报或明确命名为近似估算。
- **验收标准**：零分红公司股息贡献为 0；缺失数据公司不生成假设分红；高派息和亏损年份样本均有独立回归测试。

### BUG-18：六大模板主要仍是展示分类，专属估值模型和杜邦/ROIC 未真正落地

- **级别**：P1
- **位置**：
  - `src/lib/financial-model.ts:35-56`
  - `src/lib/company-financial-dashboard.ts:708-870`
  - `src/components/ValuationAnalysisView.tsx:101-136`
  - `src/app/company/[id]/page.tsx:565-720`
- **现象与证据**：
  1. 实际估值计算主要收敛为 PE 或 PB 两条通道。
  2. REITs 标注 NAV/FFO，但没有完整 FFO、AFFO、NAV 模型；保险标注 EV/PB，但没有 EV/NBV；多元控股标注 SOTP，但没有分部估值加总。
  3. 银行尚缺 NIM、NPL、拨备覆盖率、CET1 等核心指标。
  4. ROIC 虽定义了计算函数，但未进入实际模板行；竞争优势页没有文档所称的杜邦拆解与 ROIC 展示。
  5. 实际 BRK-B 页面仍为“市值—、PB—、估值数据不足”，与 `GOLDEN.md` 所称“估值走廊恢复完整”不一致。
- **金融影响**：行业标签给人以已完成专业模型的错觉，实际只是通用指标的行列开关或 PB 替代。
- **修复要求**：专属估值锚要么真正实现，要么明确标注当前为 PB 替代框架；禁止用 FFO、EV、SOTP 名称包装未实现模型。
- **验收标准**：每个模板以其真实生产输出验收核心科目与估值锚；BRK-B 等标杆必须直接验证生产页面，而非只验证审计脚本内部重建结果。

### BUG-19：黄金测试存在代数重言式、生产链路旁路和只查存在性的假绿灯

- **级别**：P1
- **位置**：
  - `scripts/eval-golden-18.ts:1715-1772`
  - `scripts/eval-golden-18.ts:1809-1871`
  - `tests/golden-benchmark-18.test.ts:139-264`
- **现象与证据**：
  1. 金融瀑布“守恒”来自 `retainedEarnings = cumNetIncome - shareholderReturnAmt` 的定义，本质为代数重言式，不能证明金融含义正确。
  2. 黄金审计构建 `capAllocInput` 时遗漏 `acquisitionsAmt`，并购链路没有被真实覆盖。
  3. PE/PB 门禁主要检查点位非空、下限为正，不检查数值是否正确。
  4. 部分审计重新实现 BPS/估值逻辑，而非调用生产 `getValueLineData()` 和真实页面输出，导致 BRK-B 审计目标与生产结果可不一致。
  5. 离线测试可任意补入 5B 数据满足必现行，证明的是渲染开关，不是金融数据质量。
- **金融影响**：23/23 PASS 可能只表示“有数、有行、有正数”，不能排除错数、错口径和错误投资解释。
- **修复要求**：黄金集直接调用生产函数与页面；真值独立于被测代码；增加语义、边界和负向测试，禁止用重言式替代真实业务对账。
- **验收标准**：BUG-12～17 的最小反例全部进入门禁；BRK-B 生产页面缺失必须导致 FAIL；资本配置并购覆盖、股数分母和跨币种时点均有数值断言。

### BUG-20：ROE、负债率、权益增长等卡片存在无充分依据的品质/安全判断

- **级别**：P1
- **位置**：
  - `src/lib/value-line-data.ts:709-817`
  - `src/lib/value-line-data.ts:1205-1217`
  - `src/components/ValueLineCard.tsx:553-558`
  - `src/components/ValueLineCard.tsx:814-827`
- **AAPL 实际页面证据**：
  - ROE 164.7% 被标为“卓越护城河”；
  - 总负债率 79.5% 被标为“高杠杆警惕”；
  - 股东权益增长被标为“内在价值增长”。
- **其他代码问题**：
  - ROE 数据不足时仍可能显示“周期性波动/具备周期性”；
  - 公用事业卡片在未计算利息覆盖时写出“充沛现金流全额覆盖利息支出”；
  - 周期股低 PE 预警的触发条件过宽，容易把“低 PE”直接解释为景气高位。
- **金融影响**：高 ROE 可能由回购压薄权益或高杠杆造成；总负债率不能替代有息债务、现金、期限结构和利息覆盖；账面权益增长不等于内在价值增长。
- **修复要求**：将品质判断改为可解释的指标描述；确需评价时，必须同时展示权益变化、债务结构、现金和利息覆盖等依据。
- **验收标准**：AAPL 类高回购样本不再仅因高 ROE 自动获得“卓越护城河”；数据不足统一显示“数据不足”，不得显示周期性结论。

### BUG-21：价值线价格与价值点按下标而非日期对齐，hover 可比较不同日期

- **级别**：P1
- **位置**：`src/components/ValueLineCard.tsx:118-141`、`src/components/ValueLineCard.tsx:182-199`
- **现象与证据**：价格点和价值点分别按各自数组下标映射 X 坐标；hover 又直接使用相同下标读取两组数据。当价值点因未披露或 EPS 无效而少于价格点时，两条线会被分别拉伸，且同一 hover 下标对应不同日期。
- **附加问题**：图的“5 年低/高”使用价格与价值点的合并极值，可能并非真实股价高低点。
- **金融影响**：历史某日的“低估/溢价”百分比可能比较了另一日的价值参考，属于直接误导。
- **修复要求**：所有点按日期建立索引并映射到同一时间轴；hover 仅比较同日期数据；股价高低点只由股价序列计算。
- **验收标准**：构造价格 5 点、价值 3 点且日期错开的样本，验证坐标和 hover 日期严格一致；缺失日期不得生成估值差值。

### BUG-22：展示币种被标成报告币种，“5 年”标签未始终反映真实覆盖期

- **级别**：P1
- **位置**：
  - `src/app/company/[id]/page.tsx:480-506`
  - `src/components/CompanyFinancialDashboard.tsx:146-190`
  - `src/lib/value-line-data.ts:650-655`
  - `src/lib/value-line-metric-profile.ts:61-79`
- **现象与证据**：
  1. 财务看板传入的是 `tradingCurrency`，组件却显示“报告币种”。跨币种公司会把折算后的展示币种误标为法定报告币种。
  2. `roeAvg5Y` 可对不足 5 个有效 ROE 年份求平均，但标题仍固定为“5 年 ROE 均值”。
  3. CAGR 可选取最近记录中的首个和最后一个有限值，中间存在缺年也能计算，但副标题仍固定为“5 年复合增速”。
- **金融影响**：用户无法准确理解数据币种、汇率口径和实际统计样本期。
- **修复要求**：分别展示法定报告币种、展示币种、FX 日期与折算方法；所有期限标签使用实际起止财年和有效观察数。
- **验收标准**：CNY 报表/HKD 交易的页面不得把 HKD 标为报告币种；2 个或 3 个有效年份必须显示实际区间，不得显示成完整 5 年。

### BUG-23：地产净负债率缺失即零，且跨币种时部分公式输入未归一

- **级别**：P1
- **位置**：`src/lib/company-financial-dashboard.ts:658-676`、`src/lib/company-financial-dashboard.ts:915-961`
- **现象与证据**：
  1. `NetDebtRatio` 将缺失现金、短期债务、长期债务分别按 0 处理；可能把“未采集”变成“无现金/无债务”。
  2. 归一化科目集合主要由看板 money 行生成，`TotalDebt`、`ShortTermDebt`、`LongTermDebt` 等仅作为公式输入的字段不一定被转换；但现金和权益会被转换，跨币种时可能混用原币与折算币。
- **金融影响**：地产等重资产行业的净负债率可能被高估、低估或产生无意义混合币种结果。
- **修复要求**：所有公式依赖字段必须显式纳入币种归一；现金和债务必需输入缺失时返回 `null`，不得默认 0。
- **验收标准**：构造 CNY 债务、现金和权益折算 HKD 的样本，所有输入必须同币；分别缺失现金、短债、长债时不得生成伪造净负债率。

---

## 五、建议修复顺序与总体验收门槛

### 第一优先级：停止事实污染

1. 暂停无公司行动事件支撑的自动拆股复权。
2. 暂停仅凭部分现金流数据的自动补零。
3. 禁止不同会计语义之间 fallback，禁止私有派生和空溯源覆盖。
4. 先修复 BUG-09～15，再恢复相关全库回填。

### 第二优先级：统一生产计算契约

1. 期末股数、加权股数、股本金额严格分立。
2. 资本配置所有分项使用同一年份集合与覆盖范围。
3. 建立逐日 FX 和明确的公司行动/股类别模型。
4. 估值只输出与其数学含义相符的名称和结论。

### 第三优先级：重做生产端到端门禁

1. 真值台账独立、版本化，附官方报告、报表行名和原始事实引用。
2. 黄金集直接调用生产函数与页面，禁止在审计脚本中另写一套宽松实现。
3. 将本文最小反例全部加入自动化测试，尤其是 10x 增发、跨样本池并购、零分红、缺少年份和跨币种输入。
4. 验收不能只看“有行、有点、为正”，必须断言具体数值、会计语义和数据覆盖率。

---

## 六、修复完成定义（Definition of Done）

只有在以下条件同时满足后，才可将本台账核心问题标记为关闭：

- BUG-09～15 的污染链路已停止，并完成受影响历史数据隔离或重采。
- 每个展示数字可追溯到原始事实或明确派生输入，且口径名称与会计含义一致。
- 期末股数、加权股数、公司行动、股类别和重述版本均有独立模型与测试。
- 资本配置不再跨样本池计算，缺失不被当成零。
- 估值页面不再把历史相对估值直接表述为内在价值或确定的高低估值结论。
- 23 家黄金标杆通过**生产链路**端到端验收，且本文最小反例全部进入持续回归。

---

## 七、代码交叉核验与工程修复评审意见（2026-10-18 二次复核修订版）

> **二次复核结论**：
> 1. **问题真实性**：经直接精读源码与测试集（`upsert-financial-rows.ts`、`backfill-company-financials-fast.ts`、`financial-math.ts`、`financial-normalization.ts`、`capital-allocation-metrics.ts`、`value-line-data.ts`、`ValueLineCard.tsx`、`ValuationAnalysisView.tsx`、`company-financial-dashboard.ts`、`eval-golden-18.ts`），**BUG-09～23 共 15 条问题 100% 真实存在，无一误报**，且额外确认了 7 处关联隐患。
> 2. **原修复方案适当性评估**：台账原文第 3～6 章提出的“终态修复要求”在金融原则上正确，但**有 5 处如果按字面直接硬改，会立即击穿现有生产功能或真实标杆用例**（如破坏历史 PE 的披露日可得性、误杀 NVDA 真实 10:1 拆股、导致无回购的 A/H 股银行瀑布流断链、导致单年并购公司无法输出 5 年结余、触发黄金门禁占位词报错）。下方第 3、4 节给出了经过代码兼容性验证的修正方案。

---

### 1. 核验补充发现（台账未覆盖的 7 处关联缺陷）

1. **BUG-09 补充**：`scripts/lib/upsert-financial-rows.ts:41-42, 64-69` 在 `ON CONFLICT DO UPDATE` 时无条件执行 `rawXbrlTag = EXCLUDED.rawXbrlTag`，而 `backfill-company-financials-fast.ts:351-359, 460-470` 构造的行根本未传 `rawXbrlTag`、`mappingRule`、`confidence`。这直接解释了为何库内 `rawXbrlTag` 非空为 0——每次跑回填都会把已有溯源抹成 `null`、置信度重置为 `1`。此外，`:92-113` 的 Auto-GC 会删除 `periodEnd <= 最大 FY` 的所有非 FY 行。
2. **BUG-10 补充**：除 JPM、BRK 外，`eval-golden-18.ts` 中 BRK 的 OCF（`30.592B` vs `GOLDEN.md` `$30.720B`）以及 AIA 的 Revenue/NetIncome/NPE/Assets/Equity 在代码与文档间均存在漂移。
3. **BUG-11 补充**：`IncomeTaxExpense = |TotalProfit - NetIncome|`（`backfill-company-financials-fast.ts:447-457`）使用了 `Math.abs`，不仅混入少数股东损益和优先股股利，还会把税收抵免/递延税收益（负税费）强行变成正的税费支出。
4. **BUG-13 补充（高危）**：`src/lib/value-line-data.ts:1104-1110` 在历史某年缺失股数时，会回退使用 `secShares`（**当前最新股本**）去计算**历史年度 BPS**，比“加权股数混用”造成的历史序列失真更严重。
5. **BUG-15 补充**：`src/lib/capital-allocation-metrics.ts:195-198` 计算金融模板 `shareholderReturnAmt` 时，并未限制在 `netIncome` 有效年份集合内汇总，且未区分“全周期无回购（如部分国有大行）”与“部分年份缺失数据”。
6. **BUG-21 补充**：`src/lib/value-line-data.ts:1071-1079` 仅用 `!annual?.eps` 过滤，负 EPS 不会被排除，会生成**负数的内在价值参考点**。
7. **BUG-23 补充**：同样的跨币种未归一化问题也存在于 `src/lib/company-financial-dashboard.ts:571-583` 的 ROIC 与研发等计算中：`normalizeFinancialYears`（`:932-936`）只转换了 `metrics` 中 `kind === "money"` 的展示行键名，而仅作为公式输入的底层科目（`TotalDebt`、`ShortTermDebt`、`LongTermDebt`、`TotalEquity`、`TotalStockholdersEquity`、`PretaxIncome`、`TotalProfit`、`ResearchAndDevelopmentExpense`、`NetInvestmentIncome`）全部未转换，保持原币。

---

### 2. 二次复查识别出的 5 个“修复方案陷阱”（为什么不能按原文直接硬改）

1. **陷阱一（BUG-09.4）：直接把重述值的 `sourceId` 改成最新年报，会摧毁历史 PE/PB 时间轴**
   - **原因**：SEC `companyfacts` 中，每份 10-K 都会重复前 2～3 年的比较列数据并带上新 10-K 的 `filed` 日期（即使没有任何重述）。而 `src/lib/company-data.ts:445-453` 用 `row.source.filedAt` 作为该财年的披露日 `disclosedAt`，`value-line-data.ts:1072` 再用 `getAnnualEpsAvailableOnDate(securityAnnuals, p.date)` 判断某日是否已披露该年报。如果把 FY2022、FY2023 的 `sourceId` 指向 FY2024 的 10-K（2025 年披露），系统会认为 2022、2023 年报直到 2025 年才披露，**直接抹掉最近 2～3 年的历史 PE/PB 与价值线点位**。
   - **正确修法**：`Financial.sourceId` 仍锚定该财年原始 10-K（保证初始披露日 `disclosedAt` 正确）；在 `findBestAnnualFactValue` 中，若当年原始 10-K（`row.accn === filing.accession`）与最新 `filed` 候选的数值一致，优先选原始 10-K；若发生重述/拆股导致数值不同，保留原年报 `sourceId` 的同时，将实际取值来源写入 `rawXbrlTag` 与 `mappingRule`（如 `restated:<accn>@<filed>`）。

2. **陷阱二（BUG-12）：简单要求 `epsRatio ≈ factor` 会误杀 NVDA 真实 10:1 拆股**
   - **原因**：`tests/financial-math.test.ts:34-42, 65-73` 中 NVDA 真实数据在 FY22（拆股前）→ FY23（拆股后）股数从 `2.53B` 变为 `25.69B`（`factor = 10`），但同期净利润从 `$9.75B` 跌至 `$4.37B`（腰斩 55%），导致 `epsRatio = 3.85 / 0.17 = 22.65`（偏离 10 达 +126%）。若按窄容差 `|epsRatio - factor| / factor < 0.25` 校验，NVDA 真实拆股会被拒判。
   - **另外**：从代数恒等式看，单年 `EPS = NetIncome / Shares`，因此 `(currEps / nextEps) * (nextNetIncome / currNetIncome)` 恒等于 `nextShares / currShares`，单看两年数字无法在数学上区分“净利润暴增 20 倍 + 10:1 拆股”与“净利润暴增 20 倍 + 10 倍增发”。
   - **正确修法**：
     - **短期止血**：① 正向拆股（`bestCandidate >= 1.5`）要求 `epsRatio >= Math.max(1.35, bestCandidate * 0.45)` 且 `<= bestCandidate * 3.0`（NVDA `22.65` 落在 `[4.5, 30]` 通过；NVO 2:1 的 `1.74` 落在 `[1.35, 6]` 通过；而 BUG-12 的 10 倍增发 `epsRatio = 0.5 < 4.5` 被拦截，2 倍平价换股并购 `epsRatio = 1.0 < 1.35` 也被拦截）；合股（`bestCandidate <= 0.67`）对称要求 `epsRatio <= Math.min(0.74, bestCandidate / 0.45)`；② 修复 Stage 2（`financial-math.ts:211-258`）在无加权股数锚点回退相邻年期末股数对比时未校验 EPS 的漏洞。
     - **中长期根治**：引入独立公司行动/拆股表，或基于 `sourceId`/accession 边界判断（同一份 10-K 比较列内部的股数跳变 100% 是真实增发/并购，绝不可能是未复权拆股）。

3. **陷阱三（BUG-14 + BUG-15 联动）：移除现金流自动补零后，若一刀切要求“并购/回购全非空才算结余”，会导致大量正常公司瀑布流断链**
   - **原因**：在 SEC XBRL 与港/A 股报表中，如果某公司某年**没有发生并购**或**从不回购股票**（如工商银行、招商银行等只分红不回购，或工业公司 5 年中仅 1 年有并购），报表中通常不会披露值为 0 的 `PurchaseSaleOfBusinessNet` 或 `ShareRepurchaseAmt` 标签。一旦按 BUG-14 移除 `applyOptionalCashFlowZeroDefaults` 的全局补零，这些年份的并购/回购就是 `null`。若此时按 BUG-15 原文要求“缺任一年并购数据不得输出最终结余”或“金融模板缺回购就不算留存”，则绝大多数正常公司和无回购银行都会断链（直接触发 `eval-golden-18.ts:1756` 的 `FINANCIAL_WATERFALL_BROKEN`）。
   - **正确修法**：
     - **核心原则是“严格锁定同一年份样本池（Same Cohort）”**：
       - 工商业瀑布流中，所有扣减项（回购、分红、并购）**只能从 `flowAnnuals`（即同时具备 `OCF` 和 `CapEx`、已证明现金流量表被解析的年份集合）中提取**，彻底杜绝 BUG-15 中“1 年 FCF 减 2 年并购得出 -120”的跨样本池混算（不在 `flowAnnuals` 内的年份，其并购/分红/回购一律不得进入 FCF 结余等式）。
       - 在 `flowAnnuals` 内部：由于并购属于偶发事件科目，仅对 `flowAnnuals` 内已披露的并购净额做扣减，并在 UI 明确标注“并购发生并披露 k/n 年”；对于分红与回购，保持现有的 `both`（全齐）、`dividend_only`（分红全齐且全周期无回购记录）、`buyback_only`（回购全齐且全周期无分红记录）三档完备性规则，但若某项在周期内**部分年份有值、部分 `flowAnnuals` 年份缺失**（如 5 年中有 2 年披露分红、3 年缺失），则判定为不完整，不计算 `fcfAfterDistributions`。
       - 金融瀑布流同理：将 `cumNetIncome`、`cumDividends`、`cumBuybacks` 严格锁定在 `netIncomeAnnuals` 同一年份集合内计算；分红与回购要么在该集合内全齐，要么全周期为 0 披露（如只分红不回购的银行），若出现部分年份缺失则不输出 `retainedEarnings`。

4. **陷阱四（BUG-18）：在看板说明中写“未接入/尚未接入”会直接触发黄金门禁 P0 报错**
   - **原因**：`scripts/eval-golden-18.ts:1670` 有硬编码正则检查：`/尚未接入|未接入|待后续接入/.test(dashboard.templateNote)`，命中即报 P0 `DEPRECATED_PLACEHOLDER_BANNER`。
   - **正确修法**：修改 `src/lib/financial-model.ts` 与 `ValuationAnalysisView.tsx` 时，不要使用“尚未接入”等占位词，而是直接按实际算法改写估值锚名称（例如将 REITs 的 `"NAV / FFO"` 改为 `"PB / 分红回报（账面净资产框架）"`，保险改为 `"PB / ROE（账面净资产与内含回报框架）"`，多元控股改为 `"PB / PE（合并报表估值走廊）"`）。

5. **陷阱五（BUG-23）：净负债率直接复用 `calculateInvestedCapital` 的债务完整性契约即可，无需另造规则**
   - **原因**：`src/lib/financial-math.ts:304-314` 的 `calculateInvestedCapital` 已经实现了经过单测验证（`tests/financial-math.test.ts:369-413`）的严格契约：要求 `cashAndEquivalents != null` 且 `totalDebt != null || (shortTermDebt != null && longTermDebt != null)`，否则返回 `null`。`NetDebtRatio`（`company-financial-dashboard.ts:663-676`）只需复用同一套非空判定逻辑，并将底层债务/权益输入科目加入 `normalizeFinancialYears` 的货币折算集合即可。

---

### 3. 严重度校准与“是否必须修改”最终判定

| 分类 | 包含编号 | 评审判定 | 说明 |
| :--- | :--- | :---: | :--- |
| **A. 必须立即修改（写库污染 & 确定性算错）** | BUG-09（第 4/5 条）、BUG-10（真值对齐）、BUG-11、BUG-12、BUG-13（`secShares` 回退 & 推导股数）、BUG-14、BUG-15（跨年份混算）、BUG-17（默认 30% 分红率）、BUG-19、BUG-21、BUG-23 | **必须改（Blocker）** | 正在抹除数据库溯源、制造错误派生事实，或在前端直接算出错误的结余、净负债率、分红回报与错位日期对比。均可在不改表结构的前提下快速止血。 |
| **B. 必须尽快修改（逻辑瑕疵 & 事实性错标）** | BUG-16（标签与 FY/TTM 标注）、BUG-20（`insufficient` 落入“周期性波动” & 公用事业无依据断言 & 周期股恒真条件）、BUG-22（交易币种错标为“报告币种” & 期限标签） | **必须改（High）** | 属于事实性标签错误或分支逻辑 bug（如数据不足却显示周期性波动），修改成本极低。 |
| **C. 建议修改（产品判词中性化 & 诚实命名）** | BUG-15（`retainedEarnings` 页面文案）、BUG-17（TSR 改称近似年化回报）、BUG-18（估值锚名称诚实化）、BUG-20（“卓越护城河/高杠杆警惕/内在价值增长”判词降调） | **建议改（Medium）** | 属于金融严谨性与产品表达边界问题，通过改文案/加说明解除误导（注意避开 `eval-golden-18.ts` 禁用的占位词）。 |
| **D. 中期架构演进（需 Schema 迁移或新数据源）** | BUG-09（完整版本化/多维原始事实表）、BUG-10（标准科目细粒度拆分）、BUG-12（独立公司行动事件表）、BUG-16（逐日历史 FX 表）、BUG-18（真正落地 FFO/AFFO/EV/NBV/SOTP/NIM/CET1） | **排期演进（Roadmap）** | 属于从“展示工具”升级为“可审计金融终端”的架构工程，需设计 Schema 与回填迁移方案，与短期止血解耦推进。 |

---

### 4. 修订后的三阶段安全修复方案（可直接落地）

#### 阶段一：止住数据写库与读取污染（零 Schema 变更）

1. **修复 Upsert 抹除溯源与重述来源记录（BUG-09.4 / 09.5）**：
   - `scripts/lib/upsert-financial-rows.ts:64-69`：`rawXbrlTag`、`mappingRule` 改为 `COALESCE(EXCLUDED."rawXbrlTag", "Financial"."rawXbrlTag")`。
   - `scripts/backfill-company-financials-fast.ts` & `scripts/lib/annual-report-import-core.ts`：`findBestAnnualFactValue` 返回命中的 `tag`、`accn`、`filed`；若原始年报（`row.accn === filing.accession`）已有相同数值则优先选原始年报；若取自后续重述年报，保持 `sourceId` 为当年年报（保护 `disclosedAt` 不漂移），同时将 `rawXbrlTag = <tag>`、`mappingRule = "sec-xbrl:restated_in_<accn>"` 写入行数据。
2. **清理回填私有错误派生（BUG-11）**：
   - `scripts/backfill-company-financials-fast.ts:387-457`：删除 `IncomeTaxExpense = Math.abs(TotalProfit - NetIncome)` 与 `TotalLiabilities = TotalAssets - ShareholdersEquity`（避免把归母权益当总权益把少数股东权益算进负债）；其余安全恒等式（如 `GrossProfit`）统一写入 `mappingRule = "derived:<formula>"` 与 `confidence = 0.8`。
3. **停止现金流缺项盲目补零（BUG-14）**：
   - `src/lib/company-data.ts:486`：移除 `applyOptionalCashFlowZeroDefaults(normalizedYears)` 调用，使未披露的分红、回购、并购保持 `null`；更新对应单测。

#### 阶段二：修复计算层与前端组件的确定性算错

1. **价值线时间轴按日期对齐与极值修正（BUG-21）**：
   - `src/lib/value-line-data.ts:1073`：将 `if (!annual?.eps)` 改为 `if (!annual?.eps || annual.eps <= 0)`，防止负 EPS 产生负价值线点位。
   - `src/components/ValueLineCard.tsx:100-199, 314-349`：
     - “5 年低/高”（`minPrice`/`maxPrice`）仅由股价序列 `prices` 计算，不混入 `vals`（Y 轴绘图缩放范围 `min/max` 仍兼顾两条线以防裁切）；
     - 价值点 X 坐标通过 `date -> priceCoord.x` 映射（与价格点共用同一时间轴 X 坐标），构建 `valueCoordByDate = new Map(mappedValCoords.map(v => [v.date, v]))`；
     - `activeValuePoint` 与 SVG hover 圆点统一通过 `activePricePoint?.date` 从 `valueCoordByDate` 查找，彻底消除跨日期错位比较。
2. **地产净负债率与跨币种底层输入归一化（BUG-23）**：
   - `src/lib/company-financial-dashboard.ts:658-676`：`NetDebtRatio` 对齐 `calculateInvestedCapital` 的非空规则——要求 `cash = value(ctx, year, "CashAndCashEquivalents")` 非空，且 `TotalDebt` 非空或 `ShortTermDebt` 与 `LongTermDebt` 同时非空，否则返回 `null`。
   - `src/lib/company-financial-dashboard.ts:932-936`：在 `normalizedLineItems` 中显式加入公式依赖的金额科目：`TotalDebt`、`ShortTermDebt`、`LongTermDebt`、`TotalEquity`、`TotalStockholdersEquity`、`PretaxIncome`、`TotalProfit`、`ResearchAndDevelopmentExpense`、`NetInvestmentIncome`，同时修复 `NetDebtRatio` 与 `ROIC` 的跨币种混算。
3. **资本配置锁定同样本池（BUG-15）**：
   - `src/lib/capital-allocation-metrics.ts:84-224`：
     - 工商业瀑布流：`flowAcquisitions` 仅在 `flowAnnuals` 内汇总；若 `annuals` 中存在 `flowAnnuals` 之外的并购或分红/回购缺口，不得混入 `fcfAfterDistributions`；当分红或回购在 `flowAnnuals` 内处于“部分年份有值、部分年份为 `null`”时，不输出总结余；
     - 金融瀑布流：将 `cumNetIncome`、`cumDividends`、`cumBuybacks` 锁定在同一组 `netIncomeAnnuals` 年份内汇总；支持“分红完整 + 全周期无回购”的银行计算留存差额，但若分红或回购在 `netIncomeAnnuals` 内仅部分年份披露，则 `shareholderReturnAmt` 与 `retainedEarnings` 返回 `null`；页面将“留存扩表/充实资本”改为中性表述“分红回购后利润留存”。
4. **PB-ROE 推演器移除虚构 30% 默认分红率（BUG-17）**：
   - `src/components/ValuationAnalysisView.tsx:372-398`：
     - 汇总全部有效年份的净利润与分红（含亏损年或明確披露分红为 0 的年份）；
     - 若公司明确披露分红为 0（或全周期无分红记录），`payoutRatio` 取 `0`（零分红公司股息贡献为 0）；若净利润合计 `<= 0`，不计算默认正分红率；
     - 将“预期年化综合回报 (TSR)”标注修正为“预期年化综合回报（近似推演）”，并展示当前使用的实际派息率假设。
5. **拆股启发式收紧与股数分母隔离（BUG-12、BUG-13）**：
   - `src/lib/financial-math.ts:38-76, 200-260`：在 `detectSplitFactor` 中要求正向拆股满足 `epsRatio >= Math.max(1.35, bestCandidate * 0.45) && epsRatio <= bestCandidate * 3.0`（合股对称），并在 Stage 2 无锚点回退相邻年期末股数对比时同样强制调用 `detectSplitFactor` 校验 EPS；
   - `src/lib/value-line-data.ts:1104-1110`：移除历史 BPS 在当年缺股数时回退到当前股本 `secShares` 的逻辑（缺股数时当年 BPS 为 `null`），且仅当 `annual.sharesSource === "disclosed_period_end" || annual.sharesSource === "disclosed"` 时计算期末 BPS；
   - `src/lib/share-count-utils.ts:51-61`：`isCapitalAllocationShareCount` 仅接受 `disclosed_period_end`（及无标签历史期末股数），将 `derived`（由 `NetIncome / EPS` 推导的加权股数）排除出期末总股本变化计算，并更新 `tests/capital-allocation-metrics.test.ts:178-237`。

#### 阶段三：修正文案错标与实心化黄金门禁

1. **修正币种、期限标签与品质判词逻辑（BUG-16、18、20、22）**：
   - `src/components/CompanyFinancialDashboard.tsx:158`：当 `reportingCurrency !== currency` 时分别展示“报告币种”与“展示币种（按最新汇率折算）”；
   - `src/lib/value-line-data.ts:710-725, 780, 1207-1213` & `src/components/ValueLineCard.tsx:553-558`：修复 `roeStability === "insufficient"` 显示为“周期性波动”的 bug（改为“数据不足”）；移除公用事业“充沛现金流全额覆盖利息支出”的无依据文案；收紧周期股低 PE 预警条件；将均值/CAGR 的“5年”标签按实际有效年数或起止年份动态生成；
   - `src/lib/financial-model.ts` & `src/components/ValuationAnalysisView.tsx`：将未落地的 FFO/EV/SOTP 标签诚实改为实际运行的 PB/PE 估值走廊描述（不使用触发门禁报错的“未接入”字样）；将“价值击球区/溢价高估区”改为“历史估值低位区/高位区（相对参考）”，并标明静态 `PE (FY)`。
2. **对齐黄金真值与升级端到端门禁（BUG-10、BUG-19）**：
   - 核对并统一 `GOLDEN.md` 与 `scripts/eval-golden-18.ts` 中 JPM、BRK、AIA 的真值与口径说明；
   - 在 `eval-golden-18.ts` 中补齐 `acquisitionsAmt` 传参，移除恒真重言式断言，并将 BUG-12（10x 增发）、BUG-13（加权推导股数）、BUG-14（仅 OCF 不补零）、BUG-15（跨样本池并购）、BUG-17（零分红不默认 30%）、BUG-21（价值线日期对齐）、BUG-23（跨币种净负债率）全部写入单元测试回归集。

---

## 八、第三次独立复核：问题真实性、方案有效性与修订建议（2026-10-18）

> **复核结论**：
> 1. BUG-09～23 共 15 条问题均有代码、测试或库内数据证据，问题清单可以保留，未发现纯误报。
> 2. 第七章识别出的 5 个“修复陷阱”是真实的，但其给出的修订方案仍有 4 个关键缺口。尤其 BUG-09 与 BUG-12 的方案按原文实施，会继续产生错误历史序列。
> 3. 原三阶段方案不能整体视为“可直接落地”。BUG-14 与 BUG-15 必须同批上线；BUG-10 的真值对齐必须先拆口径；BUG-18 的标签改名必须同步改测试与文档。
> 4. 建议把本文定位为“缺陷台账 + 方案评审记录”。第七章保留为方向性草案，第八章作为实施前的修订依据。

### 8.1 复核快照与实测证据

本次复核直接阅读了 `upsert-financial-rows.ts`、`backfill-company-financials-fast.ts`、`annual-report-import-core.ts`、`canonical-financial-dictionary.json`、`financial-normalization.ts`、`capital-allocation-metrics.ts`、`financial-math.ts`、`share-count-utils.ts`、`value-line-data.ts`、`ValueLineCard.tsx`、`ValuationAnalysisView.tsx`、`company-financial-dashboard.ts`、`financial-model.ts`、`eval-golden-18.ts` 及相关测试，并运行了数据库查询、最小复现和 BRK-B 单标的黄金审计。

| 核验项 | 本次观察 |
| :--- | :--- |
| 数据库快照（2026-10-18 约 16:00，Asia/Shanghai） | `Financial` 共 1,312,029 条；`rawXbrlTag` 非空 **0** 条；`mappingRule` 非空 3,742 条；`confidence=1` 共 1,308,291 条，`confidence=0.8` 共 3,735 条，`confidence=0.9` 共 3 条 |
| BRK-B 生产数据 | `getValueLineData("BRK-B")` 返回最新价 532.02，但 `marketCap`、`peRatio`、`pbRatio` 均为 `null`，`valueLinePoints` 为 0；2023～2025 年 EPS 与股数均为 `null` |
| BRK-B 黄金审计 | 实际运行 `eval-golden-18.ts --ticker BRK-B` 结果为 **FAIL**，报 `VALUATION_PB_BAND_INVALID`（points=0，pbMin=null）；`GOLDEN.md` 中的 PASS 表已经过期 |
| 相关单元测试 | 7 个相关测试文件、83 项测试全部通过；原台账记录为 82 项。测试通过只说明现有契约被执行，部分测试恰好固化了 BUG-13、BUG-14 的错误行为 |
| 10 倍增发复现 | 输入旧年股数 1 亿、EPS 10；新年股数 10 亿、EPS 20，`detectSplitFactor` 返回 10，旧年 EPS 被改写成 1 |
| 跨样本池资本配置复现 | 只有 1 年完整 OCF/CapEx，FCF 为 80；另一年有净利润 50、并购 200，系统输出 `fcfAfterDistributions = -120` |
| JPM 口径 | 库内 `NetIncome` 为 56.868B，`GOLDEN.md` 写 58.471B；可执行黄金集也是 56.868B |
| BRK 口径 | 库内 `Revenue` 为 371.433B，`GOLDEN.md` 写 424.232B |
| AIA 口径 | 库内 `Revenue` 为 221.704B CNY，`GOLDEN.md` 写 290.687B；库内 2024 年净利润 49.139B、权益 291.058B、资产 2.1957T，与文档也不一致 |
| AIA 额外异常 | 库内 2022 年 `Revenue` 为 **−109,434,759,800 CNY**；这不是单一真值抄错，而是收入口径与映射不稳定的直接证据 |
| 默认补零 | BRK 数据库中没有 `DividendsPaid` 行，但 `getValueLineData` 返回的分红为 0；来源是 `applyOptionalCashFlowZeroDefaults` |

### 8.2 逐条真实性核验

| 编号 | 问题真实性 | 本次核验结论 |
| :--- | :--- | :--- |
| BUG-09 | 确认 | `Financial` 唯一键确实缺少 `periodStart`、context、股类别、维度、披露版本；回填确实跨年报选最新 `filed` 值，却写入当前循环年报的 `sourceId`；upsert 确实会用空值覆盖旧溯源。 |
| BUG-10 | 确认 | `NetIncome` 的标签是“归母”，但标签列表优先包含 `NetIncomeLossAvailableToCommonStockholdersBasic`；JPM 因此取到 56.868B。`Revenue` 同时收录总收入、合同收入、利息与非利息收入等不同概念；BRK、AIA 的漂移与此一致。 |
| BUG-11 | 确认 | 回填确实存在 `TotalLiabilities = TotalAssets - ShareholdersEquity` 和 `IncomeTaxExpense = Math.abs(TotalProfit - NetIncome)`。当权益是归母口径时，前者会把少数股东权益计入负债，后者会混入少数股东损益、优先股股利，并把税收抵免强行变成正税费。 |
| BUG-12 | 确认 | 10 倍增发最小复现成立：股数 1 亿→10 亿、EPS 10→20，被判为 10:1 拆股，旧年 EPS 被改写。现有测试只覆盖约 30% 增发和真实拆股。 |
| BUG-13 | 确认 | `annual.shares` 依次取期末股数、加权股数、`净利润 / EPS` 推导股数；历史 BPS 直接使用该值，缺股数时还回退到当前最新 `secShares`。`getCapitalAllocationShareSeries` 明确接受 `derived`，现有测试也要求接受。 |
| BUG-14 | 确认 | `applyOptionalCashFlowZeroDefaults` 只要发现任一受支持现金流科目，就把分红、回购、资产处置、并购补零；测试明确要求仅凭 Revenue、OCF、CapEx 生成这些零值。 |
| BUG-15 | 确认 | FCF 使用 `flowAnnuals`，并购、分红、回购使用全部 `annuals`，确实跨样本池。`retainedEarnings` 是“累计净利润 − 股东回报”的差额，不是资产负债表留存收益。 |
| BUG-16 | 确认 | 价值线是 `EPS × 历史 PE 中位数`，页面却使用“价值击球区 / 溢价高估区 / 合理估值中枢”；跨币种历史序列统一使用最新汇率；当前 PE 使用最新完整年度 EPS，不是 TTM。 |
| BUG-17 | 确认 | 分红数据缺失或全为 0 时 `payoutRatio` 默认 0.3；分红率被 `Math.min(0.7, ...)` 封顶；只统计净利润为正且分红非空的年份；价格 CAGR 加估算股息率后命名为 TSR。 |
| BUG-18 | 确认 | 估值计算主要收敛为 PE 或 PB；REITs 的 NAV/FFO、保险的 EV/NBV、多元控股的 SOTP 没有实际模型；ROIC 有函数和指标定义，但不在任何模板的 `rowKeys`；BRK-B 生产页面确实为数据不足。 |
| BUG-19 | 确认 | 金融瀑布守恒检查是 `cumNetIncome - (retainedEarnings + shareholderReturnAmt)` 的代数重言式；`capAllocInput` 漏传 `acquisitionsAmt`；PE/PB 门禁只查点位数和下限；离线测试会用 5B 合成值补必现行。 |
| BUG-20 | 确认 | `roeStability === "insufficient"` 会落入“周期性波动”；AAPL 高 ROE 被标为“卓越护城河”；总负债率 79.5% 被标为“高杠杆警惕”；权益增长被标为“内在价值增长”；公用事业有利息覆盖的无依据文案；周期股低 PE 预警的第二个条件几乎恒真。 |
| BUG-21 | 确认 | 价格点和价值点分别按各自数组下标映射 X 坐标，hover 也按下标读取；`minPrice`/`maxPrice` 使用价格与价值点合并极值，标签却写“5年低/高”。负 EPS 也不会被过滤。 |
| BUG-22 | 确认 | 页面传入的是 `tradingCurrency`，组件显示“报告币种”；`roeAvg5Y` 可只用 3 个有效年份求平均，标题仍写“5年”；CAGR 使用最近 5 条记录的首尾有限值，中间缺年也能计算，标题仍写“5年复合增速”。 |
| BUG-23 | 确认 | `NetDebtRatio` 把缺失现金、短期债务、长期债务分别按 0 处理；`normalizeFinancialYears` 只折算 `metrics` 中 `kind === "money"` 的展示行和 EPS，债务、总权益、税前利润、研发、投资收益等公式输入不折算。 |

### 8.3 原方案中的四个关键缺口

#### 8.3.1 BUG-09：保留 `sourceId` 不等于保留披露时点

当前回填逻辑在 `findBestAnnualFactValue` 中跨所有年报选择最新 `filed` 的值，然后把值写入当前循环年报的 `sourceId`。这已经造成“原年报来源 + 后续重述值”的组合。第七章的方案是保留原 `sourceId`，用 `mappingRule = "sec-xbrl:restated_in_<accn>"` 标记重述。这个方案能记录“发生过重述”，但不能回答：**某个历史日期当时能看到的 EPS 是多少？**

如果 FY2022 的值来自 FY2024 10-K 的重述，而 `disclosedAt` 仍是 FY2022 10-K 的披露日，那么 2023 年的历史 PE 会使用 2025 年才披露的重述值，仍然存在前视偏差。保留 `sourceId` 只是让来源字段看起来一致，没有修正值的时间属性。

`COALESCE(EXCLUDED.rawXbrlTag, Financial.rawXbrlTag)` 还有第二个风险：旧行有 `rawXbrlTag=Revenues`，新值来自 yfinance 且没有 tag，`COALESCE` 会把旧 tag 留在新值上，溯源反而变成假的。回填脚本同时引入 yfinance 数据，这个场景是现实存在的。溯源必须和值同一次写入、同一次更新；值变化时不能无条件沿用旧溯源。

修订建议：

- 短期禁止空溯源覆盖，并优先选择 `row.accn === filing.accession` 的原始事实；找不到原始事实时，使用最早可得事实并标记实际 `accn`、`filed`。
- 如果使用后续重述值，历史序列必须显式标注“最新重述口径”，或者另建“当时可得值”序列；两者不能混在同一个历史 PE 中。
- `COALESCE` 只在“新值等于旧值”时保留溯源；值变化且新溯源为空时，应置为未知或标记来源变更，不能把旧 tag 粘到新值上。
- 中期把原始事实层版本化，至少保存 `tag`、`context`、`accn`、`filedAt`、`periodStart`、`periodEnd`、`dimensions`、`shareClass`、`unit`、`value`；查询端按“截至某日可得”或“最新重述”显式选择。
- 不要把 `mappingRule` 同时当作映射规则和版本号。短期可以用结构化字符串过渡，长期应有独立的事实标识或版本字段。

#### 8.3.2 BUG-12：EPS 区间仍然只是启发式，而且仍在自动改写生产序列

第七章建议把正向拆股限制为 `epsRatio ∈ [max(1.35, factor × 0.45), factor × 3.0]`。这个区间能挡住原文的 10 倍增发反例，也能保留 NVDA 和 NVO 的现有测试，但它不能解决这一类问题。

反例一：10 倍股票并购。旧年 1 亿股、净利润 10 亿、EPS 10；新年 10 亿股、净利润 20 亿、EPS 2。`epsRatio = 5`，落在 `[4.5, 30]` 内，仍会被判为 10:1 拆股，旧年 EPS 会被错误改写为 1。

反例二：真实 10:1 拆股叠加净利润增长 5 倍。旧年 EPS 10，新年 EPS 5，`epsRatio = 2`，低于 4.5，会被拒绝，真实拆股反而没有被复权。

单看相邻两年的股数、EPS 和净利润，数学上无法区分“拆股 + 盈利变化”和“增发/换股 + 盈利变化”。原文也承认了这一点，但阶段二仍然让启发式自动改写生产序列，这与 BUG-12 的验收标准“无事件输入时不得改写历史值”直接矛盾。

另一个实现细节：现有测试调用 `detectSplitFactor` 时传了 6 个参数，但函数只接收 4 个，传入的净利润参数被 JavaScript 忽略。这说明“用净利润辅助校验”的设计并没有真正实现。

修订建议：

- 生产链路立即停止无事件自动复权。启发式只生成待复核候选，写入候选表或日志，不改历史值。
- 建立公司行动表：比例、除权日、证券类别、来源、复核状态、适用期间。只有已确认事件才能改写历史序列。
- 在事件表落地前，至少覆盖四类回归：10 倍增发且 EPS 下降 80%、10 倍拆股且净利润增长 5 倍、2 倍换股并购、合股与多重公司行动。
- “同一份 10-K 比较列内部的股数跳变是真实增发/并购”这个判断方向是对的，但当前 `sourceId` 不记录每个值实际来自哪份年报，必须先完成 BUG-09 的来源版本化，才能用它做边界判断。

#### 8.3.3 BUG-14、BUG-15、BUG-17：又把“未披露”当成了“0”

`applyOptionalCashFlowZeroDefaults` 的触发条件只是“存在任一受支持现金流科目”。BRK 有 OCF 和 CapEx，因此没有 `DividendsPaid` 行也会被补成 0。Berkshire 确实不分红，这次结果碰巧正确；换一家因采集缺口没有分红标签的公司，就会被写成“未分红”。

移除补零后，`capital-allocation-metrics.ts` 仍用 `knownBuybacks.length === 0` 推断“全周期没有回购”，用 `knownDividends.length === 0` 推断“全周期没有分红”。这仍然是把“没有记录”当成“没有发生”。`flowAnnuals` 同时有 OCF 和 CapEx，也不能证明现金流量表的筹资章节已经完整解析，这两个科目可能来自不同数据源。

并购的处理也有同样问题。只在 `flowAnnuals` 内汇总已披露的并购，然后输出 `FCF − 已知并购 − 已披露分红/回购` 的总结余，缺失年份在算术上仍然被当成了 0。界面上标注“并购披露 k/n 年”是说明，不是修正；用户仍可能把总结余读成完整覆盖后的结果。

PB-ROE 推演器同样如此。原文写“明确披露为 0 或全周期无分红记录”时取 0，括号里的“全周期无分红记录”正是缺省推断。数据缺口会让股息贡献变成 0，低估股东回报。70% 的派息率封顶也会把高派息、甚至超过 100% 的真实情况压回 70%，掩盖分红压力。

修订建议：

- 统一区分三种状态：明确披露为 0、明确未披露（`null`）、披露为非零。只有第一种可以进入零值计算。
- 增加“现金流量表章节完整”的显式标记，例如 `cashFlowStatementComplete`；OCF 与 CapEx 同时存在不足以证明筹资章节完整。
- 资本配置所有分项使用同一组年份；当分红、回购、并购任一核心分项的覆盖不完整时，只展示分项和“已披露合计”，不输出“完整结余”。
- `retainedEarnings` 改名为“净利润扣除分红与回购后的差额”或“内源资金余额（近似）”，不要与资产负债表留存收益、监管资本混用。
- PB-ROE 推演中，零分红必须有明确证据；缺失分红时不要默认正派息率，也不要默认 0，应显示“分红数据缺失”或让用户输入假设。派息率上限应可见、可调，超过 100% 时给出提示。

#### 8.3.4 阶段拆分、测试与文案改名的冲突

阶段一先移除补零，阶段二再改资本配置，这个顺序不安全。补零移除后，很多公司的分红、回购会变成 `null`，而 `completeFlowDividends`、`shareholderReturnAmt` 仍按旧规则判断，中间状态可能直接触发 `FINANCIAL_WATERFALL_BROKEN`。BUG-14 与 BUG-15 必须同一批上线，并同步修改页面和测试。

BUG-18 的标签改名也会破坏现有测试：

- `tests/value-line-card.test.tsx` 断言页面包含“资产净值与 FFO”。
- `tests/valuation-analysis-view.test.tsx` 断言包含“资产净值与 FFO”和“内含价值与市净率”。

把标签改成“PB / 分红回报”“PB / ROE”后，这些测试会失败。方案需要明确同步更新测试、`financial-model.ts` 的看板注释和 `GOLDEN.md`，否则“可直接落地”不成立。

`eval-golden-18.ts` 中 `/尚未接入|未接入|待后续接入/` 的 P0 门禁是真实存在的。改名可以避开这条门禁，但不能证明 FFO、NAV、SOTP 模型已经存在。多元控股的看板注释目前直接写着“按合并报表计算，未拆分业务分部”，估值锚标签却是“分部估值加总”，这是同一个对象里的自相矛盾。

### 8.4 对原方案的具体修订清单

| 条目 | 第七章原方案 | 第八章修订 |
| :--- | :--- | :--- |
| BUG-09 | `COALESCE` 保留旧溯源；保留原 `sourceId`；用 `mappingRule` 标记重述 | 溯源与值原子写入；优先原始 accession；历史序列显式选择“当时可得值”或“最新重述值”；完整版本化放在中期 |
| BUG-11 | 删除错误派生，其他恒等式统一写入规则库 | 同意删除；`TotalLiabilities` 只能由 `TotalEquity` 推导；所得税不得由利润差倒算；派生规则按模板限定适用范围 |
| BUG-12 | 收紧 EPS 区间，并在 Stage 2 校验 EPS | 停止自动改写；启发式只生成候选；以公司行动表作为唯一生产依据 |
| BUG-14 | 移除 `applyOptionalCashFlowZeroDefaults` 调用 | 同意移除；同时把 UI 的 0 改成“未披露”；只有明确零披露才保留 0 |
| BUG-15 | 锁定同一年份集合；并购披露 k/n 年 | 同意同年份池；覆盖不完整时不输出完整结余；取消“无回购记录即无回购”的推断；改掉留存收益命名 |
| BUG-17 | 零分红取 0；缺失不默认 30%；TSR 改称近似推演 | 明确零披露才取 0；缺失时显示缺失或让用户输入；派息率上限可见可调；亏损年纳入汇总 |
| BUG-18 | 把 FFO/EV/SOTP 标签改为实际 PB/PE 框架 | 同意；同步改测试、看板注释、`GOLDEN.md`；标签必须与真实代码路径一致 |
| BUG-19 | 补齐 `acquisitionsAmt`，移除重言式，增加反例测试 | 同意；黄金测试应直接调用生产函数/页面；所有断言落到具体数值、覆盖率和日期 |

### 8.5 台账未覆盖或需要补充的证据

1. **AIA 收入负值**：库内 AIA 2022 年 `Revenue` 为 −109.4B CNY。若这是“总收入含投资损益”的口径，说明 `Revenue` 字段同时承载经营收入与投资结果；若不是，则是采集错误。两种情况下都需要拆分收入科目，不能只对齐 `GOLDEN.md` 的数字。
2. **少数股东权益差额**：BRK FY2024 的资产减归母权益为 504.513B，库内总负债为 502.226B，差 2.287B；AIA 同类差额约 2.32B。这个量级与少数股东权益一致，说明一旦触发“资产 − 归母权益”的 fallback，确实会把少数股东权益计入负债。
3. **ROIC 的权益口径**：`company-financial-dashboard.ts` 的 ROIC 计算优先使用 `ShareholdersEquity`，再回退 `TotalEquity`。这与 BUG-11 的少数股东权益问题同源；ROIC 应优先使用总权益。
4. **BUG-15 最小复现的条件**：`computeCapitalAllocationStats` 会先过滤掉既无 OCF/CapEx、又无净利润/ROE 的年份。原文的“另一年只有并购 200”会被过滤，必须让该年同时有净利润或 ROE，才能复现 −120。这个条件应在验收用例中写明。
5. **BUG-13 的 `"disclosed"` 来源**：`ValueLineAnnualData` 的 `sharesSource` 类型包含 `"disclosed"`，但 `value-line-data.ts` 实际只产生 `"disclosed_period_end"`、`"weighted_average"`、`"derived"`。修订方案应删除无效分支，或定义清楚 `"disclosed"` 与 `"disclosed_period_end"` 的区别。
6. **BRK-B 黄金审计当前已失败**：这比“23/23 PASS 可能只是假绿灯”更直接。当前 `--ticker BRK-B` 就是 FAIL，说明 `GOLDEN.md` 的 PASS 表需要立即标注为历史快照，不能继续作为当前验收依据。
7. **测试数量漂移**：原台账记录 82 项测试，本次相关 7 个文件为 83 项。测试数量会随分支变化，验收记录应带运行时间和提交号，不能只写一个固定数字。

### 8.6 修订后的实施批次

| 批次 | 内容 | 退出条件 |
| :--- | :--- | :--- |
| 批次 0：停止继续污染 | BUG-09.5 原子溯源；BUG-12 关闭无事件自动复权；BUG-14 + BUG-15 同批修改 | 不再出现空溯源覆盖；无公司行动事件时历史股数/EPS 不变；仅 OCF/CapEx 的年份不再生成分红、回购、并购零值；跨样本池用例不再输出 −120 |
| 批次 1：确定性算错 | BUG-11、BUG-13、BUG-21、BUG-23 | 含少数股东权益样本的负债不增加；50% 增发样本的 BPS 只用期末股数；价格 5 点、价值 3 点的 hover 日期严格一致；CNY 报表/HKD 交易样本的净负债率输入同币 |
| 批次 2：会计语义与展示 | BUG-10 拆科目；BUG-16、BUG-17、BUG-20、BUG-22 的标签与统计期 | JPM 同时保留 58.471B 与 56.868B 两个科目；BRK 同时保留 424.232B 与 371.433B 两种收入；页面分别显示报告币种与展示币种；期限标签使用实际起止年和有效年数 |
| 批次 3：架构演进 | BUG-09 完整原始事实版本化；BUG-12 公司行动表；BUG-18 真正实现 FFO/NAV/EV/SOTP/NIM/CET1 或明确降级为 PB/PE 框架 | 任一展示值可按披露日回溯；拆股/合股/增发由事件驱动；页面标签与真实模型一致；BRK-B 生产页面不再以空值冒充完整估值 |
| 批次 4：验收重建 | BUG-19 黄金测试改为生产链路、独立真值、数值断言和负向用例 | 移除代数重言式；补齐 `acquisitionsAmt`；BRK-B 生产页面缺失必须 FAIL；10x 增发、跨样本池、零分红、日期错位、跨币种净负债率全部进入回归 |

### 8.7 修订后的关键验收标准

- **BUG-09**：任一展示值都能找到唯一原始事实或明确派生输入；查询“截至某日”时只返回该日之前已披露的版本；重述值与原值可以并存；值变化时溯源必须同步变化，不能出现旧 tag 粘新值。
- **BUG-12**：无公司行动事件时不得改写历史股数、EPS、BPS、DPS；10 倍增发且 EPS 下降 80% 的样本保持不变；真实拆股事件才允许应用比例；合股、换股并购和多重行动均有独立用例。
- **BUG-14**：仅含 OCF/CapEx 的年份，分红、回购、并购必须保持 `null`；明确披露的 0 仍为 0；页面必须区分“0”和“未披露”。
- **BUG-15**：跨年份集合混算不得输出总结余；并购、分红、回购任一核心分项覆盖不完整时，只展示分项；银行“无回购”必须有明确零披露或完整现金流量表证据，不能只靠无记录推断。
- **BUG-17**：明确零分红时股息贡献为 0；分红缺失时不生成默认正派息率；亏损年纳入派息率汇总；派息率超过 70% 不被静默截断；页面标明这是情景推演，不是确定 TSR。
- **BUG-18**：页面展示的估值锚名称必须对应真实代码路径；REITs、保险、多元控股未实现专业模型时，不得以 FFO/EV/SOTP 名称包装；BRK-B 等标杆必须验证生产页面，不能只验证审计脚本内部重建结果。
- **BUG-21**：价格 5 点、价值 3 点且日期错开的样本，价值点 X 坐标必须落在同一日期轴上；hover 只能比较同日期；缺失日期不得生成估值差值；“5年低/高”只由股价序列计算。
- **BUG-22**：CNY 报表、HKD 交易的页面必须同时显示报告币种和展示币种；2 个或 3 个有效年份不得显示成完整 5 年；CAGR 的起止年份和有效样本数必须可见。
- **BUG-23**：缺失现金、缺失总债务、只有单边债务时，净负债率返回 `null`；所有债务、权益、税前利润、研发、投资收益输入先统一到展示币种，再进入公式。

### 8.8 最终判断

本文的问题清单质量较高，可以作为后续修复的缺陷台账。第七章的金融原则也基本正确，但它是一份方向性草案，不能按原文直接施工。

如果只允许先做一批，建议顺序是：**BUG-09.5 原子溯源 → BUG-12 关闭自动复权 → BUG-14 + BUG-15 同批 → BUG-11、BUG-13、BUG-21、BUG-23**。这批工作不改 Schema，能先停止继续制造错误事实和确定性算错。

BUG-09 的完整版本化、BUG-10 的科目拆分、BUG-12 的公司行动表、BUG-18 的专业估值模型需要 Schema 和重采配合，应放到架构批次。BUG-19 的黄金测试重写应贯穿始终，最终以生产链路和具体数值断言作为放行依据。

按原文直接实施的主要风险已经明确：历史 PE 仍会有前视偏差，拆股仍会误判，银行和低分红公司的资本配置瀑布可能断链，黄金测试仍可能只证明“有行、有点、有正数”。第八章的修订意见应在动手前先并入实施计划。

---

## 九、第一批修复记录（2026-10-20）

### 9.1 本批范围与状态口径

| 编号 | 状态 | 本批完成的边界 |
| :--- | :--- | :--- |
| BUG-09.5 | 止血完成 | Upsert 不再用空溯源覆盖旧值；值变化时不再继承旧 tag；回填写入实际 tag、filed 和重述 accession。完整原始事实版本化未做。 |
| BUG-11 | 代码已修 | 删除 `TotalLiabilities = TotalAssets - ShareholdersEquity` 和 `IncomeTaxExpense = abs(TotalProfit - NetIncome)`；安全恒等式统一进入 `derived-metrics.ts`。历史派生行未自动删除。 |
| BUG-12 | 止血完成 | 生产链路默认关闭拆股启发式；启发式只在测试/诊断中显式启用。已核验的公司行动事件表尚未建立。 |
| BUG-13 | 代码已修 | BPS、期末股本变化、REIT 每股分红只使用期末股数；删除历史 BPS 回退当前 `secShares` 的逻辑；推导/加权股数在表格中显式标记。 |
| BUG-14 | 代码已修 | 删除现金流缺项自动补零；未披露分红、回购、并购保持 `null`。 |
| BUG-15 | 代码已修 | FCF、并购、分红、回购锁定同一年份池；核心分项不完整时不输出总结余；金融模板要求净利润年度内分红和回购都完整。 |
| BUG-21 | 代码已修 | 价值点按日期映射到价格时间轴；hover 只比较同日期；5 年高低点只取股价；负 EPS 不生成价值点。 |
| BUG-23 | 代码已修 | 净负债率缺现金、缺债务或单边债务时返回 `null`；债务、权益、税前利润、研发、投资收益等公式输入统一折算到展示币种。历史行待重算。 |

“代码已修”表示新的写入和计算路径已按本批契约执行，不代表历史库中已经写错的旧行自动消失。凡涉及历史数据的条目，仍需重采、重算或清理后才满足第六章的完整 DoD。

### 9.2 关键实现位置

- 溯源写入：`scripts/lib/upsert-financial-rows.ts`、`scripts/backfill-company-financials-fast.ts`、`scripts/lib/annual-report-import-core.ts`。
- 派生规则：`scripts/lib/derived-metrics.ts`；`CostOfRevenue` 和 `NetInterestIncome` 进入统一规则库，`TotalLiabilities` 与 `IncomeTaxExpense` 不再派生。
- 拆股：`src/lib/financial-math.ts` 的 `allowHeuristic` 默认关闭；`src/lib/company-data.ts` 和 `src/lib/valuation-metrics.ts` 显式关闭生产启发式。
- 资本配置：`src/lib/capital-allocation-metrics.ts`；页面文案和分项顺序在 `src/components/CapitalAllocationView.tsx`。
- 股数：`src/lib/share-count-utils.ts`、`src/lib/value-line-data.ts`、`src/lib/value-line-metric-profile.ts`、`src/components/ValuationAnalysisView.tsx`。
- 价值线日期轴：`src/components/ValueLineCard.tsx` 的 `buildValueLineSparklineGeometry`。
- 净负债率与币种归一：`src/lib/company-financial-dashboard.ts`。

### 9.3 本批复验

- `npx vitest run`：70 个测试文件通过、4 个跳过；522 项测试通过、14 项跳过。
- `npm run lint`：通过。
- `npm run build`：通过。
- 在线黄金审计：22/23 PASS。唯一失败为 BRK-B 的 `VALUATION_PB_BAND_INVALID`，属于 BUG-18 的既有问题，不是本批引入。

本批新增或更新的回归覆盖包括：upsert 溯源 SQL、10 倍增发默认不改写、跨年份并购不再产生 -120、缺并购披露不输出总结余、分红/回购部分披露不生成合计、推导股数不进入期末股本变化、价值线日期对齐、净负债率缺输入返回 `null`、跨币种净负债率输入同币。

### 9.4 本批后仍需处理

1. **历史库清理**：现有 `TotalLiabilities`、`IncomeTaxExpense` 中的旧派生行仍在；由于历史 `rawXbrlTag` 全为空，无法安全批量删除，需重采或逐公司对账。
2. **BUG-09 完整版本化**：当前 `sourceId` 仍锚定原财年，重述值只通过 `mappingRule` 留痕；历史 PE 的“当时可得值 / 最新重述值”双序列尚未建立。
3. **BUG-12 公司行动表**：生产已停止自动复权，但已知拆股在事件表落地前保持未复权，历史图表可能出现股数/EPS 跳变。
4. **BUG-13/BUG-15 覆盖率下降**：缺期末股数、分红、回购或并购披露的公司改为显示 `—` 或“披露不完整”，不再用推算值补齐。
5. **BRK-B 估值走廊**：PB 点位为空，留待 BUG-18。

---

## 十、后续必须完成项统一清单（2026-10-20）

本章把第五、六、八、九章中仍然必须完成的工作合并成一份清单，作为后续排期和验收的唯一入口。这里的“必须”指：不完成就不能宣称现有数据、估值解释或验收链路已经可靠。产品扩展类工作单独列在 10.3，不计入本清单。

### 10.1 必须项

| 编号 | 对应缺陷 | 必须完成的事项 | 完成标准 | 当前状态 |
| :--- | :--- | :--- | :--- | :--- |
| M01 | BUG-11、BUG-23、BUG-09.5 | 历史派生行审计与清理：重点检查 `TotalLiabilities`、`IncomeTaxExpense`、`NonInterestIncome`；回原始 filing 找直接事实；没有直接事实就置空或标记 `derived:` | 可疑行有逐行结论；直接披露优先；JPM、BRK-B、AIA 和少数股东权益样本通过；全库不再存在“没有溯源却像直接事实”的旧派生行 | 待做 |
| M02 | BUG-09 | 原始事实版本化：保存 tag、context、periodStart、periodEnd、dimensions、shareClass、unit、accession、filedAt、value；区分“当时可得值”和“最新重述值” | 任一展示值可回溯到唯一原始事实或明确派生输入；同一期间原报和重报并存；历史 PE 不因后续重述产生前视偏差 | 待做 |
| M03 | BUG-10 | 会计科目拆分与 KPI 映射：拆开经营收入/总收入、合并净利润/归母净利润/归属普通股净利润、归母权益/总权益；定义每个指标使用哪个口径 | JPM 同时保留 58.471B 和 56.868B；BRK 同时保留 424.232B 和 371.433B 两种收入；AIA 不再出现负营业收入；KPI 映射表可见、可测试 | 待做 |
| M04 | BUG-12 | 建立已核验公司行动表：拆股、合股、换股并购、生效日、比例、证券类别、来源和复核状态；生产只应用已确认事件 | 10 倍增发样本保持不变；真实拆股正确应用；合股和多重行动有回归；无事件时历史值不变；未复权序列有明确标注 | 待做 |
| M05 | BUG-13 | 补齐期末股数数据：为只有加权股数或推导股数的公司补采 `CommonStockSharesOutstanding`，并标记来源 | BPS、PB、每股分红和期末股本变化有足够覆盖率；缺期末股数时显示 `null`，不回退当前股本 | 待做 |
| M06 | BUG-14、BUG-15 | 建立现金流量表完整性标记：区分“明确为 0”“未披露”“有值”；标记经营、投资、筹资章节是否完整 | 仅 OCF/CapEx 不生成分红、回购、并购零值；完整章节内没有并购发生时可合法按 0 处理；不完整时不输出总结余 | 待做 |
| M07 | BUG-16 | 估值语义修正：价值线改称历史相对估值参考；明确静态 FY 与 TTM；移除仅凭历史 PE/PB 中位数给出的“内在价值/击球区”结论 | 页面名称与数学含义一致；跨币种历史序列标注汇率口径；当前 PE 明确是 FY 还是 TTM | 待做 |
| M08 | BUG-17 | 分红与回报修正：分红率三态；去掉缺失分红时的 30% 默认；不静默封顶 70%；按年度现金流计算总回报或明确改名为近似推演 | 零分红公司的股息贡献为 0；缺失分红不生成正派息率；高派息和亏损年有回归；TSR 名称不再冒充严格总回报 | 待做 |
| M09 | BUG-20 | 品质判词修正：`insufficient` 显示“数据不足”；弱化“卓越护城河/高杠杆警惕/内在价值增长”等无依据判断；公用事业和周期股文案必须有实际指标支撑 | 数据不足不再落入周期性结论；高回购公司的 ROE 不被单独解释为护城河；负债率和权益增长判词与依据一致 | 待做 |
| M10 | BUG-22 | 币种与期限标签修正：同时展示法定报告币种和展示币种；ROE 均值、CAGR 使用实际起止年份、有效年数和样本数 | CNY 报表/HKD 交易页面不把 HKD 标成报告币种；2/3 个有效年份不显示成完整 5 年；CAGR 起止年份可见 | 待做 |
| M11 | BUG-18 | 估值锚诚实化：FFO/NAV、EV/NBV、SOTP 未实现时改为实际使用的 PB/PE 框架；修复 BRK-B PB 走廊；专业模型另立项目 | 页面标签对应真实代码路径；测试断言、模板注释和 `GOLDEN.md` 同步；BRK-B 生产页面不再以空值冒充完整估值 | 待做；BRK-B 仍 FAIL |
| M12 | BUG-19 | 黄金门禁重建：生产链路调用、独立真值、数值断言、覆盖率检查、负向用例；移除代数重言式；补齐并购参数 | 10x 增发、跨样本池、零分红、日期错位、跨币种净负债率全部进入回归；BRK-B 缺失必须 FAIL；断言不止“有行、有点、有正数” | 部分基础已修，完整重写待做 |
| M13 | 跨条目 | 全库重算与基线验收：重采受影响期间，保存 AAPL、JPM、BRK-B、REIT、保险、零分红、跨币种公司的前后快照；更新真值台账 | 清理前后差异可解释；页面不出现新的空值或断链；`GOLDEN.md` 标注运行时间和提交号，不再把历史快照当当前结论 | 待做 |

### 10.2 依赖与建议批次

| 批次 | 包含 | 说明 |
| :--- | :--- | :--- |
| A. 数据止血与清理 | M01、M13 的只读审计和试点 | 先确认哪些旧行真的需要处理，再决定全量重采；不做无依据的批量删除。 |
| B. 会计口径与原始事实 | M02、M03 | 需要 Schema、字典、重采和真值台账配合；与 A 可以并行设计，但应在全量重算前完成。 |
| C. 公司行动与股数/现金流完整性 | M04、M05、M06 | 让拆股、BPS、资本配置从“止损”恢复到可用覆盖；需要事件数据和来源完整性标记。 |
| D. 页面语义与判词 | M07、M08、M09、M10、M11 | 以文案、默认假设、标签和估值锚为主；不改变底层事实，但必须在页面验收中逐项核对。 |
| E. 验收重建 | M12、M13 全量复验 | 以生产链路、独立真值和具体数值断言作为放行条件。 |

### 10.3 不计入“必须项”的产品扩展

- **BUG-16 的逐日历史 FX**：当前固定汇率序列只要标注清楚，仍可作为可比分析；逐日 FX 是增强项，除非跨币种历史分位成为核心卖点。
- **BUG-18 的完整 FFO/AFFO/NAV、EV/NBV、SOTP、NIM/NPL/CET1 模型**：属于行业模型建设，不是修 bug 的前置条件；在实现前先完成 M11 的诚实降级。
- **更多市场和更多公司的覆盖扩展**：与数据正确性解耦，不应和本清单混在一起排期。

### 10.4 价值评估口径

后续评估单项价值时，统一看四个维度：

1. **正确性价值**：是否直接修正错误财务事实、错误比率或错误历史序列。
2. **可审计性价值**：是否让数字可回溯到原始事实、口径和披露日期。
3. **产品覆盖价值**：是否恢复因数据缺失而消失的 BPS、PB、资本配置或估值点位。
4. **实施成本与风险**：是否需要 Schema、全库重采、人工复核或大范围页面改造。

不能只看“页面看起来更完整”；没有溯源和口径的完整性不计入价值。

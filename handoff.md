# Handoff: Onboard 核心流程深度审计与重构方案（聚焦存疑点 3 与 5）

## 会话时间
2026-09-30

---

## 一、 核心纲领与两大不可动摇的确定目标

在应用**马斯克五步工程算法 (The Musk Algorithm)** 对整个 Onboard 流程进行审查时，我们确立了两大不可动摇的最高业务公理：

1. **目标 1：支持三大市场（美股 / 港股 / A股）所有的公司，包括新上市公司（IPO / 次新股）**
   - 全库 1.6 万+ 上市公司必须全覆盖，且能够平滑接入每周新增的 IPO 标的；
   - 任何标的在用户检索或大师持仓触发时，系统必须具备端到端建档与深度呈现能力。
2. **目标 2：对公司进行高质量的深度投研分析，切实帮助投资者理解公司**
   - 坚守"买股票就是买公司"的核心哲学，分析必须基于第一层真实披露事实，绝不凭空臆造数据；
   - 交付真正的护城河评估、商业模式画像、资本分配与估值锚点，为投资决策提供高质量依据。

**Step 1（质疑并精简需求 / Make requirements less dumb）的核心原则**：
在目标锁定的前提下，必须以第一性原理彻底击碎在"实现手段"上人为附加的错误假设、过度设计与脆弱约束。以下针对整个流程中负担最沉重、矛盾最集中的 **存疑点 3（年报切片落库）** 与 **存疑点 5（估值模型 LLM 包装）** 展开深度剖析。

---

## 二、 存疑点 3 深度剖析：整本年报全量章节正则切片与数据库落库

### 1. 目标定位
为下游的商业模式画布（Canvas）、护城河雷达（Moat）、治理卡片（Management）提供权威的原始披露依据（Evidence），确保"分析挂在事实之上"，杜绝大模型纯自由幻觉。

### 2. 现状与实现路径
- **当前管线**：
  - 美股调用 [`import:10k`](file:///Users/rafael/R129/buffett-tribe/scripts/import-10k-edgartools.ts)（依托 `edgartools-fetch-filings.py`），港股调用 [`import:hk-annual-report`](file:///Users/rafael/R129/buffett-tribe/scripts/fetch-hk-annual-report.py)，A 股调用 [`import:cn-annual-report`](file:///Users/rafael/R129/buffett-tribe/scripts/fetch-cn-annual-report.py)；
  - 下载整本 10~20MB 的 10-K/20-F HTML 或 PDF 文件；
  - 动用长达 1,200 行正则解析器（[`extract-10k-sections.ts`](file:///Users/rafael/R129/buffett-tribe/scripts/lib/extract-10k-sections.ts)，内含 45 个解析函数），强行切分出 Item 1, 1A, 1B, 2, 3, 5, 7, 7A, 8, 9, 10, 11, 12, 13, 14 等 20+ 个章节；
  - 默认抓取自 2020 年至今 **连续 5~6 年** 的全部年报，生成成百上千条记录写入数据库 `FilingSection` 表；
  - 为防止超时，在 [`onboard-company.ts`](file:///Users/rafael/R129/buffett-tribe/scripts/onboard-company.ts#L658) 中硬性设置了 **15 分钟（900,000ms）** 的超长单步超时。

### 3. 核心问题（第一性原理审视）
1. **下游消费严重断层（切了 100%，实际只吃 5%）**：
   - 审查 [`scripts/lib/company-generation.ts`](file:///Users/rafael/R129/buffett-tribe/scripts/lib/company-generation.ts#L243-L280) 的 `fetchLatestFilingEvidence()` 发现：
     - **时间跨度断层**：下游 LLM 脚本通过 `orderBy: [{ periodYear: "desc" }]` 仅获取 **最近 1 份年报** 的切片，此前连续跑 5 年（2020-2024）下载切片的数十万行记录，LLM 在生成时从未读取！
     - **章节范围断层**：Prompt 实际消费的只有 **Item 1（业务描述）** 和 **Item 7（MD&A 管理层讨论）**；其余如税务递延、股票期权归属、独立审计师签字页等几百页切片，纯属系统冗余噪音。
   - **实际数据验证**（2026-09-30）：
     - 总记录数：29,515 条
     - 有数据的公司：352 家
     - 平均每家公司：83.8 条章节记录
     - Item 1 相关（业务描述）：13,919 条（47.2%）
     - Item 7 相关（MD&A）：2,647 条（9.0%）
     - **其他无用章节：12,949 条（43.9%）** —— exhibits、mine_safety、accountant_fees、staff_comments 等下游从未消费的章节
     - 年份分布：2020-2026 年都在切，其中 2025 年 5,512 条，2024 年 5,180 条
2. **脆弱的"修不完的正则地狱"**：
   - 现实中各大公司的年报排版千差万别（如 Ferrari 20-F 的无序 div、Shopify 40-F 的 EX 附件、Vodafone 的 20MB 超大表格、次新股的招股说明书）；
   - 每次遇到格式异化，切片器即告崩溃，迫使工程师不断在抽取器中追加补丁分支，将确定性工程变成了概率性博弈。
3. **成为 Onboard 最大的耗时卡点**：
   - 该步骤耗费了 Onboard 80% 以上的时间（单家公司动辄 5~15 分钟），直接导致后台不敢做即时生成，只能退缩为每小时跑几家的脆弱 Cron。

### 4. 关键澄清：`search_filings` 工具的实际使用
**修正原始假设**：初步分析时认为"没有真实用户会在自建站逐段查阅 `FilingSection` 碎片"，但这是错误的：
- `/agent` 的 `search_filings` 工具（[`services/pi-gateway/src/tools/search-filings.ts`](file:///Users/rafael/R129/buffett-tribe/services/pi-gateway/src/tools/search-filings.ts)）直接查询 `FilingSection` 表
- 该工具被设计为**当需要原文具体表述、某一年具体数字时的主力工具**
- 从 `get-company-analysis.ts` 的注释看：`get_company_analysis` 用于获取已生成的分析结论，`search_filings` 用于获取原始披露事实
- 虽然前端年报阅读页采用 No-R2 政策（外链官方源），但 agent 对话场景确实需要 `FilingSection` 数据

### 5. 建议与重构方案（精简需求，保留核心能力）
- **需求重新定义**：*"高质量分析需要的不是在自建数据库里完整镜像全套年报章节，而是'精准获取最近 1-2 年核心经营事实（Business & MD&A）'，同时为 agent 对话保留原文检索能力。"*
- **落地动作**：
  1. **收敛时间范围**：停止对 2020 至今所有历史年份进行地毯式全量切片，**仅保留最近 1-2 年**；
  2. **收敛章节范围**：停止切分全部 20+ 章节，**仅切分 Item 1（业务描述）和 Item 7（MD&A）**；
  3. **保留 `FilingSection` 表和 `search_filings` 工具**：agent 对话确实需要原文检索能力，不能简单删除；
  4. **预期收益**：
     - 数据量减少 **~80%**（从平均 83.8 条/公司 → 约 16 条/公司）
     - 切片耗时减少 **~70%**（从 10-15 分钟 → 3-5 分钟）
     - 保留 agent 核心能力的同时，大幅减轻数据库膨胀与 I/O 压力

---

## 三、 存疑点 5 深度剖析：估值模型作为"LLM 生成步骤"的本质矛盾

### 1. 目标定位
为投资者提供客观、严肃、具备安全边际参考的估值研判，包含历史市盈率（PE）估值走廊、当前分位评估、未来成长三情景推演（保守/基准/乐观）与隐含年化回报率。

### 2. 现状与实现路径
- **当前管线**：
  - 执行独立脚本 [`scripts/generate-valuation-analysis.ts`](file:///Users/rafael/R129/buffett-tribe/scripts/generate-valuation-analysis.ts)；
  - 首先通过 TypeScript 函数 [`computeValuationMetrics()`](file:///Users/rafael/R129/buffett-tribe/src/lib/valuation-metrics.ts#L155) 计算 5 年财务数据（营收、利润、FCF、CAGR）及历史价格，推导出当前 PE、历史中位数、最小/最大值及百分位；
  - 随后将这些数字作为上下文塞入庞大的 Prompt，请求 LLM 生成包含 `position`、`quality`、`scenarios`、`conclusion` 的复杂 JSON Payload；
  - LLM 返回后，代码再调用 `computeScenarios()` 校验并计算隐含价格与年化回报率，最终写入 `CompanyAnalysis.valuation`；
  - [`onboard-company.ts`](file:///Users/rafael/R129/buffett-tribe/scripts/onboard-company.ts#L194) 的 `verify` 机制对字段进行严格校验，稍有不符或超时便判死整条 Onboard 流程。

### 3. 核心问题（第一性原理审视）
1. **错把"确定性数学"包装成"大模型生成任务"**：
   - 估值分析的核心灵魂是**数学模型与量化统计**：过去 5 年历史 PE 走廊、分位数位置、营收 CAGR 增速、三情景隐含回报率计算公式（`impliedPrice = EPS * (1+g)^N * exitPE`）是 100% 确定性的闭式数学方程。
   - 让大模型去做数学或输出严格结构化多层 JSON，是 LLM 最容易发生幻觉、格式畸变与超时的反模式。
2. **导致系统死循环与 Schema 崩溃的罪魁祸首**：
   - 历史复盘：此前尝试将分析合并（Unified Analysis）之所以彻底流产，正是因为估值模型格式复杂，大模型一旦输出格式微调，整个 Payload 立即校验失败；
   - 极端标的死循环：对于次新股（SPCX）、微亏股或周期反转股，由于缺乏完整历史 EPS，LLM 频繁输出不合规内容，导致 Worker 连续 3 次失败将其打入死信池，逼得系统不得不开发显式哨兵（`status: "insufficient_data"`）来破除死循环。
3. **无谓的时间与成本消耗**：
   - `computeValuationMetrics()` 本身纯代码计算耗时仅需 **3~10 毫秒**；
   - 但包装进 LLM 后，强行增加了一轮 20~30 秒的高昂网络 I/O，并成为整个 Onboard 流程中最容易超时的瓶颈点之一。

### 4. 前端依赖验证（2026-09-30）
通过审查 [`src/components/CompanyGeneratedSections.tsx`](file:///Users/rafael/R129/buffett-tribe/src/components/CompanyGeneratedSections.tsx) 的 `ValuationAnalysisSection` 组件，确认前端**确实依赖 LLM 生成的定性文本**：
- `position.narrative` - 展示在"估值位置"卡片
- `quality.narrative` - 展示在"质量与增长"卡片
- `conclusion.narrative` + `conclusion.masterContrast` - 展示在结论部分

因此不能完全删除 LLM 调用，但可以大幅简化其职责。

### 5. 建议与重构方案（精简需求，保留必要的定性评述）
- **需求重新定义**：*"高质量估值分析 = 100% 严谨的代码量化公式 + 轻量级的定性文字洞察。"*
- **架构调整**：估值分析整体保留在 Phase 2（与 canvas/moat/management 并行），但内部拆分为两步：
  
  **Step 1: 纯代码计算数值指标（<10ms）**
  ```typescript
  // 完全确定性的数学计算
  const metrics = computeValuationMetrics(financials, prices);
  const scenarios = computeScenarios(metrics);
  ```
  
  **Step 2: LLM 生成定性评述（~20s，schema 大幅简化）**
  ```typescript
  // LLM 只输出 5 个字符串字段，不再输出任何数值
  const narratives = await llm.generate({
    prompt: `基于以下估值数据生成评述...`,
    metrics,    // 喂入代码计算的数值
    scenarios,  // 喂入代码计算的情景
    schema: {
      position: { verdict: string, narrative: string },
      quality: { narrative: string },
      conclusion: { narrative: string, masterContrast: string }
    }
  });
  
  // 合并落库
  await prisma.companyAnalysis.update({
    data: {
      valuation: {
        metrics,      // 纯代码计算
        scenarios,    // 纯代码计算
        ...narratives // LLM 生成的文本
      }
    }
  });
  ```

- **关键收益**：
  1. **数学计算从 LLM 剥离** - PE 走廊、分位数、隐含回报率等数值由纯代码计算，100% 准确，彻底杜绝次新股/微亏股因数值异常导致的死循环
  2. **LLM schema 大幅简化** - 从"输出包含数值的复杂 JSON"降级为"仅输出 5 个字符串字段"，格式崩溃风险大幅降低
  3. **耗时减少 ~33%** - 从 30 秒降至 20 秒（数学计算部分从 LLM I/O 中移除）
  4. **保留用户体验** - 前端仍然展示完整的估值评述文字，不影响产品完整性
  5. **仍在 Phase 2 并行** - 与其他 LLM 步骤（canvas/moat/management）并发执行，不单独阻塞流程

---

## 四、 两大存疑点重构后的 Onboard 架构全景预期

通过在 Step 1 剔除"全本年报全量章节切片"与"估值纯数学模型包装 LLM"两大伪需求，整个 Onboard 架构将迎来根本性蜕变：

```
【重构前（沉重且极度脆弱）】
  Phase 1: 5年财务 + 5年全量日K(1200+天) + 概览生成 (数分钟，极易被 Yahoo 封锁)
    ↓
  Phase 2: 5年整本年报全量下载 + 1200行正则全量章节切片落库(10~15分钟，极易崩)
    ↓
  LLM 四步串行: 画布(20s) -> 护城河(20s) -> 管理层(20s) -> 估值纯数学包装(30s)
  ─────────────────────────────────────────────────────────────
  总耗时：15 ~ 20 分钟/家 | 稳定性：极低（单处报错全盘重跑） | 只能依赖后台 Hourly Cron 挂机

【重构后（极简、坚固、按需即时）】
  Phase 1（基础事实秒级就绪，5秒内完成）：
    - 基础元数据 + 三大报表核心科目（SEC / Akshare 接口直取）
    - 最新行情快照 + 确定性估值走廊数学指标（纯代码 10ms 算完）
    - 3句话公司核心业务概览
    ──> 前台已可完整展现公司名片、核心指标矩阵、估值击球区、官方年报外链！

  Phase 2（深度洞察并行生成，20秒内完成）：
    - 定向按需提取最近 1-2 年 Item 1（业务）& Item 7（MD&A）核心文本
    - 商业模式画布、护城河雷达、资本分配卡片【三路并行发射 (Promise.all)】
  ─────────────────────────────────────────────────────────────
  总耗时：约 20 ~ 25 秒/家 | 稳定性：极高（解耦脆弱正则与数学计算） | 具备全网即点即看（JIT）能力
```

---

## 五、 后续落地与推进路线图

- [ ] **Step 2 (坚决删除)**：
  - 彻底删除 `pipeline-priority-worker.ts` 中的无主大池随机 50% 轮询；
  - 停用 `weekly-sync-new-listings.sh` 定时任务；
  - 废除对历史 5 年非必要财报章节的全量提取与入库逻辑。
- [ ] **Step 3 (简化与优化)**：
  - 将估值模型全面收敛为纯 TypeScript/Python 算法计算，移除对大模型输出数学情景的依赖；
  - 将年报切片范围收敛为"最近 1-2 年 × Item 1/7 only"；
  - 将 Phase 2 的独立 LLM 生成步骤改造为 `Promise.all` 并发。
- [ ] **Step 4 (提速验证)**：
  - 将 Fast-Track 升级为即时响应机制（用户点击加急后，10 秒内前端直出 Phase 1，25 秒内补齐 Phase 2）。
- [ ] **Step 5 (自动化保障)**：
  - 仅针对"大师 13F 季度变动"与"真实用户加急请求"保留健壮的自动化调度守护。

---

## 六、 生产环境实测复盘与 Phase A 落地决策（2026-09-30 18:15）

### 1. mini 机器 Cron 批次 P1→P2 严重超时实测定位
- **现象**：下午各整点批次中，P0→P1（基础建档）100% 成功（1.5~2.5m），而 P1→P2（深度分析）超时熔断率高达 **58.8%**（17 个标的中 10 个超时被杀，如 `ASML`、`002594.SZ`、`0291.HK`、`2388.HK`、`1211.HK`）。
- **根因解剖**：
  1. 14:19 引入了 `--company-timeout-mins 4`（单标的 4 分钟硬性熔断）；
  2. Step 1 切片历史 6 年（2020-2026）年报：港股/A股平均耗时 **231.7s**，美股平均 **200.0s**；
  3. Step 2-5 4 个 LLM 串行调用耗时 **83.4s**；
  4. 两者相加自然耗时 **4.5 ~ 5.5 分钟**，在数学上必然撞线 4 分钟熔断。

### 2. 方案分步落地决策（Phase A 与 Phase B）
为了控制变更风险、不混合变量，决定拆分为两阶段：

#### Phase A（本次实施：聚焦切片收敛，根治生产超时）：
1. **切片收敛为“最新 1 份”**：
   - 港股 (`fetch-hk-annual-report.py`)：检索到年报后仅取最新 1 份 (`reports = reports[:1]`)；
   - A股 (`fetch-cn-annual-report.py`)：检索到年报后仅取最新 1 份；
   - 次新股/刚上市处理：若无年报，首选降级至 **IPO 上市招股说明书**（美股 `us-prospectus` 424B4/S-1，A股 `cn-prospectus` 招股说明书）。招股书包含详尽商业模式与核心优势，是新上市公司最佳投研证据；季报仅用于补充财务数字，不用于切片；
2. **`verify` 校验断言纠正**：
   - 修复原断言要求“全量历史 ExtSource 必须全部有切片”的 Bug；
   - 更正为：只要求“拥有至少 1 份带有切片的有效 ExtSource（`sections: { some: {} }`）”；
3. **LLM 保持串行调用**：
   - 消除 DeepSeek 429 并发限流、Postgres 同行行锁冲突以及 mini 机器瞬时启动 4 个 tsx 编译进程的资源尖峰；
   - 耗时测算：切片降至 25~40s + LLM 串行 80s ≈ **105~120s（约 2 分钟）**，远低于 4 分钟熔断线，且留有翻倍安全垫。

#### Phase B（下一阶段：估值算法重构）：
- 在 Phase A 稳定生效后，启动估值分析解耦：三情景推演与量化指标 100% 由纯代码算法完成，LLM 仅保留 5 个定性叙述字段，并独立进行单测与前端回归。

### 3. 生产环境 18:15 Cron 批次实测验收与状态闭环（2026-09-30 18:37）
- **批次表现（10 标的实测）**：
  - **总成绩**：`Succeeded=9, Failed=1`，总耗时 21m 27s；
  - **超时原因确认**：唯一的失败项 `0883.HK` 发生在 18:19（早于 Phase A 代码分发的 18:23），仍执行了老版 6 年年报切片（3m01s）导致撞线；
  - **新代码生效后的 P1→P2 表现（100% 成功）**：
    - `600276.SS`（恒瑞医药 - A股）：**2m 07s**（切片由 2m+ 降至 15s）
    - `XOM`（埃克森美孚 - 美股）：**1m 31s**（切片由 3m+ 降至 18s）
    - `0175.HK`（吉利汽车 - 港股）：**2m 28s**（切片由 3m+ 降至 54s）
  - 结合此前的单测回归（`603288.SS` 2m04s、`0291.HK` 1m57s、`ASML` 1m58s），**美、港、A 三个市场的 P1→P2 全流程耗时已彻底收敛至 1.5 ~ 2.5 分钟**，距离 4 分钟熔断线留有 1.5 ~ 2.5 分钟的安全裕量。
- **环境对齐与死信清理**：
  - mini 机器代码已执行 `git reset --hard origin/main`，干净对齐 commit `73f8abdc`；
  - 对此前因 4 分钟硬熔断记录失败的 8 家 Phase 1 标的（`002415.SZ`, `0941.HK`, `ALLE`, `2388.HK`, `1211.HK`, `3968.HK`, `DEO`, `0883.HK`）执行了清理，重置其 metadata 中的 `onboardPhase2Attempts` 计数，使其在后续的整点轮询中正常晋级。

---

## 七、 投研闭环下一里程碑：从静态画像（P2）到态势感知与决策闭环（P3）

> 记录时间：2026-10-01

### 1. 为什么需要定义 P3？
当前自动化管线正在稳步推进全库 1.6 万+ 公司达成 P2：
* **P0（存根）**：标的存在，待入水；
* **P1（第一层 · 事实 Facts）**：5 年财报三大表、5 年量价历史走廊、官方年报外链、基础概览画像 —— 确立真实可核验的事实底座；
* **P2（第二层 · 框架 Framework）**：商业模式画布（Canvas）、护城河五维雷达（Moat）、资本配置与诚信治理（Management）、估值走廊（Valuation） —— 用大师框架完成静态定性定量的“买公司”画像。

**P2 回答的是“这是一家怎样的公司、当前好不好、处于历史估值的什么位置”（静态照片）**。  
但真实投资是面向未来与动态演进的。对应 `PRODUCT.md` 核心准则中的 **“第三层 · 态势感知（Situational Awareness）”**，**P3 要回答的是：“如果要持续跟踪或持有它，核心变量是什么？发生什么事实说明我看错了？未来该盯什么？”（动态电影）**。

### 2. P3 的四大核心构件

#### 构件 1：可证伪的投资论点清单（Thesis Tracker）
> *“买入时必须知道自己买的是什么，以及什么情况下证明自己错了。”*
* **核心支撑支柱（Core Pillars）**：
  * 拒绝几十条平庸优点的罗列，提炼支撑该公司超额回报最关键的 **2~3 个核心命题**（如：拼多多海外 Temu 单位经济模型拐点、茅台直销渠道收回经销商寻租空间、苹果服务业务毛利率扩张）。
* **证伪与破灭条件（Invalidation / Kill Criteria）**：
  * **严肃投资与业余投资的分水岭**。明确设定可核验的事实判据：“发生什么事实，意味着逻辑彻底推翻？”（如：客户集中度连续两季超 40%、毛利率跌破警戒线、高管在顶峰回购后随即大额稀释性减持）。
* **论点健康度状态（Thesis Status）**：
  * 结构化状态标签：`Intact（稳固）` | `Weakening（承压/弱化）` | `Broken（破灭）`。

#### 构件 2：连续跨期差分与危险信号（Filing / Financial Diffs & Red Flags）
> *“管理层往往不会在公告里大声承认危机，但文字和会计科目的微小异动从不撒谎。”*
* **年报核心披露文字 Diff（What Changed in Disclosures）**：
  * 对比连续两期年报的 **Item 1（业务模式）** 与 **Item 7（MD&A 管理层讨论与风险）**：
  * **新增了哪些风险提示**（如新增“海外反垄断审查”、“核心客户单一依赖”）；
  * **删除了哪些信心陈述**（如删除了前一年的“在手订单充足”）；
  * 捕获管理层叙事基调由攻转守的细微转变。
* **会计与质量危险信号（Red Flag Detector）**：
  * 纯确定性数学规则检测 5 大基本面异常（零自由幻觉）：
    * **背离**：营收持续增长，但经营现金流连续两季/年萎缩；
    * **塞货**：应收账款增速大幅超越营收增速；
    * **积压**：存货周转天数异常飙升；
    * **虚胖**：商誉及无形资产占净资产比重超警戒线；
    * **资本黑洞**：持续极高 Capex 却换不来 FCF 增量。

#### 构件 3：巴菲特“一美元检验”与资本分配总账（Capital Allocation Scorecard）
> *“管理层为股东赚到的每一美元留存收益，是否在市场上创造了至少一美元的市值？”*
* **一美元留存收益检验（The $1 Rule Test）**：
  * 统计过去 5~10 年公司赚取的所有净利润，扣除现金分红后，留在公司的留存资金总额；
  * 对比同期公司市值的实际净增额；
  * 判定 $\frac{\Delta \text{市值}}{\text{留存利润总额}} \ge 1$，直接检验管理层是在**创造财富还是在平庸消耗股东资本**。
* **资本去向瀑布图（Capital Allocation Waterfall）**：
  * 累积自由现金流的五向切分：**研发再投资 %**、**现金分红 %**、**股份回购 %**、**外延并购 %**、**账面现金闲置 %**；
  * **回购纪律严审**：是在估值走廊底部大举注销股本，还是在历史高位回购抵消管理层期权稀释。

#### 构件 4：前瞻催化剂与关键追踪日历（Catalyst & Milestone Watchlist）
> *“不看宏观新闻热点，只看能够影响第二层框架的确定性事件。”*
* **下阶段关键检验事件（Upcoming Milestones）**：
  * 下一次定期财报披露日；
  * 关键产能爬坡放量节点、核心专利到期窗口、重大反垄断或合规监管听证。
* **核心追踪指标（Single Metric to Watch）**：
  * 为读者排除次要噪音，锚定未来 1~2 个季度**最核心的 1 个观察指标**（如特定业务的 SSSG 同店增速、海外毛利率、算力折旧比例）。

---

### 3. P0 → P1 → P2 → P3 全生命周期递进对照

| 阶段 | 阶段定位 | 对应产品哲学 | 解决的核心问题 | 交付形态 |
| :---: | :---: | :---: | :---: | :---: |
| **P0** | **存根入池** | 宇宙发现 | 标的是否存在？代码与市场是否对齐？ | 代码、中英文名、市场归属 |
| **P1** | **第一层 · 事实底座** | Facts | 财报数字和量价历史是否完整？不是空壳？ | 5 年三大表走廊、5 年 K 线走势、官方年报直链、基础概览 |
| **P2** | **第二层 · 研报框架** | Framework | 按大师框架看，它是一家怎么赚钱的公司？护城河多宽？管理层如何？现在贵不贵？ | 商业模式画布、护城河五维雷达、资本配置治理分析、估值走廊 |
| **P3** | **第三层 · 态势与决策** | Situational Awareness | **如果要跟踪它，核心逻辑是什么？怎么证明看错了？年报改了什么？资本分配及格吗？** | **可证伪 Thesis 清单、年报披露差分、1 美元检验、催化剂日历** |

### 4. 工程与落地原则（马斯克算法约束）
1. **不抢跑、不虚假繁荣**：P3 严禁在 P1/P2 未扎实落地的标的上空转，必须严格建在第一层（真实披露）和第二层（结构化分析）基座之上；
2. **纯算法与轻 LLM 结合**：跨期科目差分（Red Flags）与一美元检验 100% 由纯 TypeScript 代码计算，LLM 仅负责归纳论点支柱与证伪判据；
3. **宁缺毋滥，保持沉默**：没有实质性论点动摇或差分信号时，P3 保持平静，不为刷存在感推送无意义的市场噪声。

---

## 八、 Insights 文章与 Company 标的关联管线分析与建议

> 记录时间：2026-10-01 16:00

### 1. 发现的问题与修复状态
1. **数据库查询超时**：一次性加载 152 篇文章的完整 `contentRaw` 会导致连接超时。
   - ✅ **已修复**：在 `scripts/tag-insight-companies.ts` 中改为分页批量处理（`BATCH_SIZE = 10`），避免瞬时大字段 I/O 挤爆连接池；
2. **LLM 输出截断**：`maxTokens: 6000` 对长文和推理过程不够，导致很多文章打标失败。
   - ✅ **已修复**：将推理输出上限提高到 `maxTokens: 32000`。

### 2. 当前状态快照
* **总发布文章**：152 篇已发布文章；
* **已关联标的**：14 篇已有 `entityIds`（手动或通过 `tag-insight-masters` 设定）；
* **待处理文章**：138 篇待打标关联。

### 3. 成本与耗时估算
* 处理 138 篇文章 × 每篇一次 LLM 调用（使用 reasoning 模型，长上下文输出，成本较高）≈ 需考虑 API Token 预算。
* 耗时测算：138 篇单线程执行约需要 30 ~ 60 分钟。

### 4. 建议操作路线
* **选项 1：小批量测试（推荐先做）**
  手动测试单篇/几篇，确认抽取效果与打标准确度：
  ```bash
  cd ~/R129/buffett-tribe
  node --env-file=.env.local ./node_modules/.bin/tsx scripts/tag-insight-companies.ts --slug opendoor-q1-2026-财报解读-kaz-nejatian --dry-run
  ```
* **选项 2：全量 dry-run（确认单篇效果稳定后）**
  完整走一遍 138 篇 dry-run，排查是否有特定文章因超长或特殊格式引发异常。
* **选项 3：正式执行写入**
  去掉 `--dry-run` 标志，实际将提取出的 `entityIds` 写入数据库，打通 `/insights` 文章与 `/company` 标的的双向链接。

---

## 九、 美股场外柜台交易（OTC Markets / Pink Sheets）全量排查与池子治理方案

> 记录时间：2026-10-01 20:00

### 1. 背景与问题定位
mini 机器 Hourly Cron 批处理近期偶发的 P0 失败案例，经排查全部集中在美股 OTC（场外柜台/粉单）标的（如 `RBGLY`、`TKOMY`、`MGCLY`）。
* **根本原因**：美国 SEC EDGAR 对 OTC Markets（特别是 Pink Sheets 粉单市场的外国普通股和无赞助 ADR）免除递交 10-K/20-F 标准电子财务年报的法定义务；
* **现状后果**：这类标的在 P0 阶抓取财务和 SEC 年报时 100% 报错，白白消耗批处理网络与计算开销。

### 2. 深度排查：”只是避开 endsWith('Y') 吗？”
针对代码规则是否只避开 `endsWith('Y')`，我们对全库 8,072 家美股公司进行了全量数据交叉验证，**明确结论：绝对不能只避开 `endsWith('Y')`**。

#### (1) 致命误杀风险（单纯判断 `endsWith('Y')`）
若代码中简单使用 `ticker.endsWith('Y')`，会严重误杀正规在纽约证券交易所（NYSE）和纳斯达克（Nasdaq）主板上市的优质巨头：
* **`OXY`**（Occidental Petroleum，**西方石油 —— 沃伦·巴菲特的核心前五大重仓股之一！**）
* **`ALLY`**（Ally Financial，**伯克希尔持有银行股**）
* **`EBAY`**（eBay）、**`WDAY`**（Workday）、**`CHWY`**（Chewy）、**`ORLY`**（O'Reilly 汽车配件）
* **`BMY`**（百时美施贵宝）、**`SONY`**（索尼）、**`INFY`**（印孚瑟斯）、**`SYY`**（Sysco）
👉 **如果直接过滤 `endsWith('Y')`，巴菲特的头号持仓 `OXY` 会被直接误杀出局。**

#### (2) 严重漏网之鱼（OTC 标的远不止 `...Y`）
根据 FINRA 命名标准与全量数据库扫描，美股 OTC 标的构成为：
| 标的代码特征 | 典型示例 | 库内数量 | 属性与 SEC 年报状态 |
| :--- | :--- | :--- | :--- |
| **5 位且以 `Y` 结尾** | `TCEHY` (腾讯), `NTDOY` (任天堂), `RBGLY` | **327 家** | OTC ADR（存托凭证），**无 SEC 年报（必挂）** |
| **5 位且以 `F` 结尾** | `BYDDF` (比亚迪), `GELYF` (吉利), `CKHGF` (长和), `RHHBF` (罗氏) | **577 家** | OTC 外企普通股（Foreign Ordinary），**无 SEC 年报（必挂）** |
| **4 位或其他代码 OTC** | `FNMA` (房利美), `FMCC` (房地美), `NLST`, `FMCB` | **857 家** | 粉单/破产重整/退市/小型未上市地方银行，无规范 SEC 结构 |
| **库内 `exchange = 'OTC'` 总计** | —— | **1,786 家** (占美股22.1%) | **其中 1,771 家滞留于 Phase 0 待处理大池** |

👉 **结论**：以 `Y` 结尾的仅 327 家，不足 OTC 总量的 18%！若仅过滤 `Y`，剩下 **1,459 家 OTC 标的（包括 577 家 `...F` 外企和 857 家 4 位 OTC 粉单）** 依然会在批处理中频频报错。
*(且此前代码中因包含 `ticker.length <= 4 => priorityScore += 20`，导致 `FNMA`、`FMCC` 这类 4 位粉单反而被系统误当成主板优质蓝筹加分优先跑！)*

### 3. 大师持仓交叉核验
对全库 `Holding`（大师持仓表）执行联合查询：
* **大师对这 1,786 家 OTC 标的的持有记录为 0！**
* 顶级价值投资大师从不通过美股场外粉单持有外企或壳公司（例如段永平、李录等持有腾讯、比亚迪均直接在港股主板持有），因此全量剥离 OTC 标的**对大师追踪功能 0 影响**。

### 4. 落地治理方案与工程实施

#### 第一步：代码层双层防护（立即在 Worker 中生效）
在 `scripts/pipeline-priority-worker.ts` 中增强候选池过滤逻辑：
1. **主防线（元数据级精确拦截）**：
   直接排除 `metadata.exchange === 'OTC'`。瞬间拦截全部 1,786 家标的，0 误杀、0 漏网；
2. **兜底防线（规则级防御）**：
   排除 `ticker.length === 5 && (ticker.endsWith('Y') || ticker.endsWith('F'))`，避免个别新入库元数据 `exchange` 为 null 或 `US` 的外资场外标的漏网；
3. **修复 4 字符 OTC 虚高优先级**：
   确保 4 位及以内的 OTC 标的不能享受 `+20` 主板股票加分。

#### 第二步：数据库大池彻底剥离与单独标识（挤出 P0 水分）
编写一次性回填清理脚本：
1. 将全库 `metadata.exchange === 'OTC'` 的公司元数据标记 `{ isOtc: true }`；
2. 将其 `onboardPhase` 状态置为 `-2`（表示场外跳过）；
3. **核心收益**：
   - **P0 待处理池虚胖总数瞬间减少 1,771 家**（从 16,463 降至 14,692 家真实正规公司），大盘进度真实可控；
   - 彻底根除批处理中的无效网络 I/O 与超时报错；
   - 未来若为 OTC/ADR 标的定制直连原产国（港股/欧股）底层数据源时，可通过 `isOtc: true` 随时调出。

---

## 十、 价值线（Value Line）前端用户体验与金融内核深度审计（经第一性原理复核）

> 记录时间：2026-10-01 21:00（初始审计） / 2026-10-02 12:30（工程与哲学复核对齐）

### 1. 评估维度与审计方法
针对公司详情页的”价值线”核心模块（`/company/[id]` 的 `valueline` tab，实现于 [`ValueLineCard.tsx`](file:///Users/rafael/R129/buffett-tribe/src/components/ValueLineCard.tsx) + [`value-line-data.ts`](file:///Users/rafael/R129/buffett-tribe/src/lib/value-line-data.ts) + [`globals.css`](file:///Users/rafael/R129/buffett-tribe/src/app/globals.css)），从真实投资决策与工程第一性原理四维交叉复核：
1. **价值密度** - 该要素对价值投资决策是否真正有用？
2. **事实准确性** - 计算逻辑是否严谨？是否坚守“第一层真实事实”而非模型幻觉与粗暴假设？
3. **首屏必要性** - 核心击球区决策依据是否在首屏立即触达，还是被静态冗余信息淹没？
4. **移动端适配与交互** - 在 320-375px 小屏设备上是否顺畅可用？触控交互是否完整？

### 2. 核心发现与评分（经实测与代码复核纠偏）

| 维度 | 评分 | 核心问题与事实核对 |
|------|:---:|------------------|
| **价值密度** | **9/10** | 核心指标（四宫格体检、价格价值走廊图、大师持仓）极具深度；**5年 CAGR 增速是识别“低 PE 价值陷阱”的第一安全绳，属于高价值密度指标，应予保留**；但公司概览段落为静态常识，不宜占据首屏。 |
| **事实准确性** | **6/10** | 财务统计计算准确；但 **benchmark PE 全行业一刀切（统一 18x）严重失真**，**AI 生成内容存在通用 Fallback 模板**（无分析时用套话冒充个股护城河/风险，存在“误导性真实”风险）。 |
| **首屏必要性** | **5/10** | **公司概览长文本**（200-300px）+ **大师持仓 6 张大卡片**严重侵占垂直空间，导致最核心的**走廊图与四宫格**被挤出首屏，用户需大幅下滑才能看到关键决策信息。 |
| **移动端适配** | **6/10** | **事实纠偏**：初始审计称“未见响应式断点、布局崩溃”与代码事实不符——`globals.css` 早已实现四宫格在 640px 下单列、持仓卡片单列、财务表格粘性表头横向滑动。**真实硬伤在于：Sparkline 缺少触控拖拽事件（Touch Scrubbing），以及 SVG 固定 viewBox 等比缩放导致小屏文字缩小至 4.5px 无法辨识**。 |

---

### 3. 第一性原理裁决：认同与坚决否决的反模式

#### ✅ 深度认同并必须采纳的项：
1. **AI Fallback 模板去伪存真（信誉红线）**：
   - [`value-line-data.ts:1153-1183`](file:///Users/rafael/R129/buffett-tribe/src/lib/value-line-data.ts#L1153-L1183) 中，个股未生成 `moatJson` 时会自动套用行业通用文案（如银行显示“稳固的特许经营牌照壁垒...”）。这会误导用户以为是个股深度分析。
   - **裁决**：坚守“事实与推论严格区分”原则。未生成时明确标识“个股深度分析待生成”或留白，绝不拿通用模板冒充个股洞察。
2. **Benchmark PE 行业差异化校准（常识修复）**：
   - 银行/周期/科技共用 18.0x PE 基准是荒谬的（导致银行永远“极度低估”、科技永远“极度溢价”）。必须将 `sectorModelType` 真正接入估值计算中。
3. **首屏信息架构重构（价值优先）**：
   - 用户打开价值线是为了看“价格与价值的位置”和“四宫格体检”。概览段落默认折叠收敛，大师持仓在首屏收敛为概要胶囊，让走廊图和四宫格挺进首屏。
4. **移动端触控交互补齐**：
   - Sparkline 补齐 `onTouchStart` / `onTouchMove` / `onTouchEnd`，并解决 SVG 在小屏下的文字微缩问题。

#### ❌ 坚决否决并废弃的反模式：
1. **坚决废弃 P3“接入 Shiller PE / VIX 动态调整低估/高估阈值”**：
   - **否决理由 1（违背价值投资常识）**：“买股票就是买公司”。市场恐慌大跌、VIX 飙升时，好公司被打折甩卖，**它本身就是实打实的低估，这正是价值投资者的黄金击球区**！绝不能因为全市场恐慌反而人为抬高门槛，把便宜资产判定为“不低估”。
   - **否决理由 2（混淆宏观择时与公司内在价值）**：根据大盘情绪水位漂移估值标准，是宏观对冲或趋势动量流派的做法，与巴菲特自下而上关注个股内在价值的哲学背道而驰。
   - **否决理由 3（违反 Musk Algorithm 第 1 步）**：无端引入复杂的宏观外部数据管线，徒增脆弱依赖与维护成本。
2. **坚决废弃“类似 TradingView 的 BUY / SELL 交易信号”**：
   - **否决理由**：平台定位是严肃的深度基本面投研体系（Facts → Framework → Situational Awareness），绝不做短线炒股机或荐股喊单软件。给出 BUY/SELL 信号不仅具有极高合规风险，还会彻底破坏产品的专业调性。现有的“价值击球区（折价 ~X%）/ 溢价高估区”客观中立，完全契合巴菲特棒球击球区哲学。
3. **纠偏“5年 CAGR 属于低优先级”的判断**：
   - 复合增速绝非次要指标，它是避免“低 PE 价值陷阱（业务萎缩导致的假便宜）”的核心过滤器。保留在报表上方单行呈现，信息密度高且不占空间。

---

### 4. 关键技术债务与落地重构方案

#### P0 - 移动端 Sparkline 触控手势与文字适配（高优先级）
* **触控手势补齐**：
  - 在 [`ValueLineSparkline`](file:///Users/rafael/R129/buffett-tribe/src/components/ValueLineCard.tsx#L97) 中增加 Touch 事件，通过 `e.touches[0].clientX` 计算最近坐标点索引，实现手机上按住左右拖拽查看历史某日股价与估值差：
  ```typescript
  const handleTouch = (e: React.TouchEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const touchX = e.touches[0].clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, (touchX - paddingLeft) / chartW));
    const idx = Math.round(ratio * (points.length - 1));
    setHoverIdx(idx);
  };
  ```
* **SVG 字体小屏微缩根治**：
  - 在小屏设备下，Y 轴参考线与 X 轴年份文字改用 CSS 响应式或分离的 HTML 标签，避免因 SVG 等比缩放导致文字缩水至 4.5px 不可读。

#### P1 - 首屏信息架构层次重组（高优先级）
* **视觉层级重排**：
  ```
  【当前布局（主次倒置）】
    1. 标题与核心报价
    2. 公司概览长文本 (200-300px)
    3. 大师持仓 6 张大卡片 (300-400px)
    4. 价格与价值走廊图 (被挤至第二屏)
    5. 巴菲特四宫格 (被挤至第三屏)

  【重构后布局（价值与击球区直达）】
    1. 标题、当前报价与价值击球区状态 Badge
    2. 价格 vs 价值走廊图 (首屏核心视觉焦点)
    3. 巴菲特四宫格体检 (首屏核心基本面抓手)
    4. 大师持仓概要 (首屏仅展示紧凑摘要胶囊，点击平滑展开明细卡片)
    5. 业务概览 (默认 2 行截断 + 展开全文)
    6. 核心护城河与风险 (AI 洞察，带诚实生成状态)
    7. 5年复合增速与多期财报矩阵 (底部深度查验)
  ```

#### P1 - AI Fallback 诚实标识机制（高优先级）
* **改造逻辑**：
  ```typescript
  // value-line-data.ts
  const isMoatGenerated = Boolean(coreMoatNote?.value);
  const aiMoat = isMoatGenerated 
    ? coreMoatNote!.value 
    : "个股深度护城河分析生成中，待补充...";
  const aiMoatStatus: "analyzed" | "pending" = isMoatGenerated ? "analyzed" : "pending";
  ```
* **前端展示**：若 `status === "pending"`，以微弱文字与待生成 Badge 呈现，坚决杜绝“无真实分析却显示高度自信行业模板”的欺骗性体验。

#### P2 - Benchmark PE 行业差异化校准（中优先级）
* **分层校准算法（历史中位数优先，行业基准兜底）**：
  ```typescript
  let benchmarkPe = 18.0;
  if (historicalPes.length >= 2) {
    // 优先采用公司自身历史有效 PE 中位数（最尊重该资产长期的市场真实定价）
    benchmarkPe = median(historicalPes);
  } else {
    // 次新股、扭亏股、周期反转股无有效历史中位数时，按行业中枢兜底（打破 18x 一刀切）
    switch (sectorModelType) {
      case "bank_insurance":
        benchmarkPe = roeAvg5Y && roeAvg5Y >= 12 ? 8.0 : 6.5;
        break;
      case "utilities":
        benchmarkPe = 14.0;
        break;
      case "real_estate":
        benchmarkPe = 9.0;
        break;
      case "cyclical":
        benchmarkPe = roeAvg5Y && roeAvg5Y >= 18 ? 10.0 : 8.0;
        break;
      default:
        benchmarkPe = roeAvg5Y && roeAvg5Y > 15 ? 22.0 : 18.0;
    }
  }
  benchmarkPe = Math.max(6, Math.min(42, benchmarkPe));
  ```
  *(注：金融/银行板块本质上应看 PB-ROE 模型，未来可进一步在走廊图中针对银行定制 PB 估值走廊)*

---

### 5. 后续落地路线图

- [ ] **P0 - 移动端 Sparkline 触控与文字适配**：
  - 为 SVG 走廊图增加 `onTouchStart`, `onTouchMove`, `onTouchEnd` 触控滑动支持；
  - 优化移动端 Y 轴 reference labels 字号与边距，消除等比缩放导致的文字微缩。
- [ ] **P1 - 首屏信息架构重组**：
  - 将价格走廊图与巴菲特四宫格上提至首屏核心区；
  - 公司概览段落默认 2 行截断（带“展开”按钮）；
  - 大师持仓收敛为紧凑摘要胶囊（如“3位大师重仓持有 · 查看明细”），点击展开卡片网格。
- [ ] **P1 - AI Fallback 诚实标识**：
  - 区分个股真实分析与待生成状态，未生成时明确提示“深度分析生成中”，彻底杜绝行业套话冒充个股结论。
- [ ] **P2 - Benchmark PE 行业校准**：
  - 落实“历史有效中位数优先，行业模型分类兜底”算法，消除银行/公用事业价值线虚高问题。
- [x] **反模式剔除（已明确否决）**：
  - 废弃 Shiller PE / VIX 动态估值阈值方案（违背自下而上价值投资哲学）；
  - 废弃 TradingView 式 BUY/SELL 信号建议（坚守严肃投研定位与合规底线）。

---

## 十、 Phase 3 态势感知极速同步更新与连接池性能根治（2026-10-02）

### 1. 背景与目标
在 Phase 2 静态研报底座之上，用户需要在公司详情页具备即时刷新的能力（查看最新股价走势、最新估值差、财务危险信号），且明确要求：
1. **轻量极速同步等待**：不进入异步任务队列，在 2~8 秒内返回结果；
2. **多 Ticker 协同**：支持同个实体名下的多代码同步刷新（如 GOOG/GOOGL、BRK-A/BRK-B）；
3. **零连接池饥饿**：彻底杜绝高并发或多组件挂载下的 Prisma 连接超时。

### 2. 核心架构与落地项
1. **Phase 3 极速更新引擎 (`src/lib/phase3-update.ts`)**：
   - 提取实体全量挂钩 Security（`securitiesAsCompany`），并发获取所有活跃 Ticker 的最新日级行情；
   - 采用快速 Python yfinance fixture 机制（Python 脚本落盘临时 JSON 约 1.5s，Node 端直接批量事务写入 `StockPrice`），杜绝子进程嵌套与超时；
   - 执行 5 大确定性基本面异常检测（背离、塞货、积压、虚胖、资本黑洞）；
   - 对齐选中 Ticker 测算估值走廊击球区偏离度，生成 1~2 句高密度中文简评，持久化存入 `GeneratedContentVersion` (`phase3_snapshot`) 与 `AnalysisRun`。
2. **同步 API 与 CLI 入口**：
   - `POST /api/company/phase3`：同步接口，支持 `ticker` 或 `cik` 参数，直接返回最新快照；
   - `scripts/update-company-phase3.ts`：终端一键更新脚本 `npm run update:phase3 -- --ticker XXXX`。
3. **前端交互与按键布局 (`src/components/CompanySectionTabs.tsx` & `page.tsx`)**：
   - 对 `onboardPhase >= 2` 的标的，在原“⚡ 深析”位置挂载 `⚡ 更新` 按钮；
   - 支持多 Ticker 动态传参 (`selectedTicker`)，点击后展示平滑 loading 动效，成功后呈现 `✓ 已更新` 并自动刷新页面视图。
4. **数据库连接池饥饿与 N+1 瓶颈根治**：
   - `src/lib/prisma.ts`：URL 解析与动态参数加固，将 `.env.local` 硬编码的 `connection_limit=3` 防御性调优至 `10`，`pool_timeout` 提升至 30s；
   - `src/lib/company-data.ts`：根治 `getRecentHolders` 中 30 次循环查询机构主体的 N+1 级联风暴，收敛为单次 `where: { filerEntityId: { in: holderIds } }` 批量查询；
   - 引入 React 19 `cache()` 消除同一次 Server Component 渲染树中对 `getCompanyByIdentifier` 的重复调用。

### 3. Vercel Serverless Egress 429 根治与 air7 行情中继落地
- **排查案例（万豪国际 MAR）**：
  - 用户在网页端点击更新，但股价依然停留在 9月21日。排查确认**不是 Cloudflare 缓存**，而是：
    1. 数据库底表在更新前确实只记录到 9月21日；
    2. 线上网页运行在 Vercel Serverless（AWS 数据中心 IP），直接向 Yahoo Finance 发起请求被边缘网关拦截返回 `HTTP 429 Too Many Requests`；
    3. Vercel 是纯 Node.js 容器，不存在 `.venv/bin/python`，导致本地 yfinance 降级静默失效，回退读取了 DB 老数据。
- **架构级解决方案（air7 专属行情中继）**：
  - 在拥有原生独立公网 IP 的 `air7` 机器上配置 Python `yfinance` 与 `curl_cffi`；
  - 在 [`services/pi-gateway/src/server.ts`](file:///Users/rafael/R129/buffett-tribe/services/pi-gateway/src/server.ts) 暴露 `/chart/:ticker` 高性能中继接口；
  - [`src/lib/phase3-update.ts`](file:///Users/rafael/R129/buffett-tribe/src/lib/phase3-update.ts) 将行情拉取优先路由至 `https://relay.air7.fun/pi/chart/:ticker`；
  - **实测验收**：在生产环境 Vercel（`vt.air7fun.com`）上触发 `POST /api/company/phase3`，万豪国际（MAR，849ms）、亚马逊（AMZN，1254ms）、阿里巴巴（BABA，1165ms）均在 1 秒左右完成最新日线抓取、批量事务落库与估值重算，彻底摆脱 429 困扰。

### 4. Phase 3 用户侧价值闭环深度审计（已体现 vs 待呈现）
用户在页面端点击 `⚡ 更新` 后，底层系统共执行了 5 件事，但在前端展示层存在“后端算得深、前端漏体现”的脱节：
1. **全 Ticker 实时行情抓取并入库**：**✅ 页面有体现**。页面重载后，顶部最新市价、报价日期、走廊图线即刻刷新；
2. **5 项基本面红旗体检（纯算法）**：**❌ 页面无直接体现**。现金流背离、塞货、积压、商誉虚胖、高负债率等检测结果已存入后端快照，但前端页面目前未挂载红旗预警卡片；
3. **动态测算估值走廊偏离度**：**✅ 页面有体现**。依据最新市价动态重算当前 PE，并在首屏 Badge 显示“折价 ~X% 击球区”或“溢价区”；
4. **态势感知 1~2 句高密度简评落库**：**❌ 页面无体现**。生成的简评只存入了 `Entity.metadata.p3`、`GeneratedContentVersion` 与 `AnalysisRun`，前端没有专门渲染展示的文字插槽；
5. **按钮状态切换与页面重载**：**✅ 交互闭环**。Loading 动效 → `✓ 已更新` → 自动重载刷新视图。

### 5. 后续演进待办（P1 优先级）
- [ ] **Phase 3 前端展示插槽挂载**：
  - 在公司详情页 / 数字价值线页面顶部或估值走廊旁，增加“态势简评”文字胶囊（直接读取 `metadata.p3.summary`）；
  - 若存在触发的红旗预警（`metadata.p3.redFlags`），以醒目的警戒色标签展示（如 `⚠️ 现金流背离`、`⚠️ 负债率高企`），真正把 Phase 3 的核心投研价值直观交付给用户。






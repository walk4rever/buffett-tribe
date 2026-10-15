# 财务数据体系治理与自动化重构执行计划 (handoff.md)

> **版本**：v2026-10-15 (工程可执行与安全加固版)  
> **核心原则**：**拒绝虚假命令与不可控写入；数据防污染先行；测试集收敛聚焦；先单点核验再全量回填**  
> **关联设计规范**：[DATA.md](file:///Users/rafael/R129/buffett-tribe/DATA.md)

---

## 目录

1. [执行原则与安全红线](#一执行原则与安全红线)
2. [黄金测试集重塑方案（30 家全场景双轨测试矩阵）](#二黄金测试集重塑方案30-家全场景双轨测试矩阵)
3. [五阶段工程任务拆解与可执行清单](#三五阶段工程任务拆解与可执行清单)
4. [存量脏数据定点审计与修复方案](#四存量脏数据定点审计与修复方案)
5. [批次追踪与精准回滚技术方案](#五批次追踪与精准回滚技术方案)
6. [全流程质量门禁与验收 Checklist](#六全流程质量门禁与验收-checklist)
7. [审阅反馈问题与定点修复台账（来自 bug.md）](#七审阅反馈问题与定点修复台账来自-bugmd)
8. [远程主机 (mini) 全量回填运维与监控指南（来自 backfill.md）](#八远程主机-mini-全量回填运维与监控指南来自-backfillmd)

---

## 一、执行原则与安全红线

为了彻底杜绝“方案看着漂亮，实际执行缺乏支撑甚至引发数据灾难”的问题，本次重构执行严格遵守以下四大红线：

1. **不可回滚，严禁写入**：
   在批次追踪参数（`--batch-id`）与精准回滚机制开发并测试通过之前，**严禁执行任何带有 `--all --execute` 的全库写入命令**。
2. **拒绝盲目补齐冲突 ID**：
   晨星快照中的净额项（如 `IFIS002367` 利息收支净额、`IFIS001917` 营业外收支净额）严禁同时粗暴填入毛额收入与毛额支出；未经核实确认的映射宁缺毋滥，保持留空。
3. **区分三级股数用途，严禁金额当股数**：
   * 彻底拔除 A/H 股资产负债表“实收资本/股本金额”映射为发行股数的隐患；
   * 明确三级股数梯队：①期末披露股数（`disclosed_period_end`，优先用于估值基准日市值） $\rightarrow$ ②期间加权股数（`weighted_average`，用于 EPS 联动与历史趋势） $\rightarrow$ ③公式估算股数（`derived` = NetIncome/EPS，仅作无披露时的兜底估算，正常参与趋势，内部打上来源标记，不在前台展示混淆标签）。
4. **测试集服务于业务价值，而非服务于晨星**：
   将测试集从 100 家盲目对账缩减为 **30 家全场景典型标的**，重心聚焦于：**① 财务数据是否采集正确；② 前台 6 大 Tab 页面展示是否如期望**。

---

### 二、黄金测试集重塑方案（30 家全场景双维测试矩阵）

### 1. 30 家标的遴选矩阵（覆盖 6 模板 × 适用市场 × 热门+冷门极限）

* **归档路径**：`scripts/lib/golden-benchmark-30.json`
* **双集并存说明**：保留原有 100 家 Morningstar 基准集（`morningstar-benchmark-suite.json`，供 `eval-financials-against-morningstar.ts` 进行字段抽取与校准回归）；本 30 家基准为**独立的产品链路与官方年报真值验收集**。
* **市场覆盖说明**：覆盖三大市场所有适用的模板组合（A 股无巴菲特式多元控股实业，多元控股聚焦美股与港股代表）。

| 模板代码 (`FinancialTemplate`) | 市场 | 标的代码及名称 | 子模型 (`subModel`) | 遴选考点与业务特征 |
| :--- | :---: | :--- | :---: | :--- |
| **`industrial`**<br>*(工商业通用 - 8家)* | **US** | **AAPL** (苹果)<br>**MSFT** (微软)<br>**CAT** (卡特彼勒)<br>**NEE** (新纪元能源) | 通用制造<br>企业软件<br>周期机械<br>公用事业 | • 苹果：巨额持续回购、多次拆股历史、净资产为负（资本配置极限用例）。<br>• 微软：高毛利软件平台、极充沛净现金。<br>• 卡特彼勒：强周期制造重工，曾发生营业成本抓取错位千分之一（冷门硬核防线）。<br>• 新纪元能源：公用事业重资产、高负债运营典型。 |
| | **CN** | **600519** (贵州茅台)<br>**300750** (宁德时代)<br>**600019** (宝钢股份) | 高端消费<br>新能源制造<br>周期材料 | • 茅台：超高毛利（90%+）、无有息债、高分红、零回购（A股消费标杆）。<br>• 宁德时代：高端制造、高 CapEx、产业链上下游占款模式。<br>• 宝钢股份：强周期钢铁材料，低估值、周期性亏损与恢复。 |
| | **HK** | **0700.HK** (腾讯控股) | 互联网科技 | • 腾讯：大额联营投资、回购+分红双轮、跨币种（CNY/HKD）报告对齐。 |
| **`bank`**<br>*(商业银行 - 5家)* | **US** | **JPM** (摩根大通)<br>**USB** (合众银行) | 综合大行<br>纯零售信贷 | • 摩根大通：全能大行标杆，存贷款与非利息综合收益。<br>• 合众银行：美股纯区域零售信贷银行（冷门纯存贷业务，无毛利）。 |
| | **CN** | **600036** (招商银行)<br>**601398** (工商银行) | 零售之王<br>特大国有行 | • 招商银行：零售之王，高净息差，资产质量与拨备指标验证。<br>• 工商银行：国有特大行，巨人体量存贷款，账面权益资产比测试（与 CET1 解耦）。 |
| | **HK** | **2388.HK** (中银香港) | 商业信贷 | • 中银香港：港股成熟商业银行体系，高派息与信贷周期。 |
| **`insurance`**<br>*(保险精算 - 4家)* | **US** | **PGR** (前进保险)<br>**MET** (大都会人寿) | `property_casualty`<br>`life_health` | • 前进保险：美股纯财产险（P&C）标杆，**验证生效专属赔付率（ClaimsRatio）**。<br>• 大都会人寿：典型寿险，**验证严格屏蔽财险专属赔付率**，测试准备金负债。 |
| | **CN** | **601318** (中国平安) | 综合金控/人身险 | • 中国平安：综合金融与人身险，浮存金与投资收益双轮驱动。 |
| | **HK** | **1299.HK** (友邦保险) | `life_health` | • 友邦保险：跨国纯寿险巨头，新业务价值与内含价值典型。 |
| **`financial_services`**<br>*(金融服务 - 5家)* | **US** | **BX** (黑石集团)<br>**CME** (芝加哥交易所) | `asset_mgmt`<br>`broker_exchange` | • 黑石：轻资产资管，**核验 AUM 与平均管理费率**。<br>• 芝加哥交易所：交易平台，**测试严禁强加 AUM 考核与费率**。 |
| | **CN** | **600030** (中信证券)<br>**300059** (东方财富) | `broker_exchange`<br>`broker_exchange` | • 中信证券：综合券商投行，佣金、承销与自营投资收益。<br>• 东方财富：零售互联网券商与公募基金代销双轮驱动。 |
| | **HK** | **0388.HK** (香港交易所) | `broker_exchange` | • 港交所：轻资产特许垄断交易平台，高净利率，非 AUM 逻辑。 |
| **`real_estate`**<br>*(地产/REITs - 5家)* | **US** | **SPG** (西蒙地产)<br>**PLD** (安博) | `reit_property`<br>`reit_property` | • 西蒙地产：商业持有型 REIT，重资产折旧，**测试投资性物业与 FFO/NAV**。<br>• 安博：物流仓储 REIT，高分红派息率。 |
| | **CN** | **000002** (万科 A)<br>**600048** (保利发展) | `developer`<br>`developer` | • 万科：典型开发商，**测试巨额合同负债预售款与净负债率，不套用 FFO**。<br>• 保利：央企开发商，土地储备存货周期。 |
| | **HK** | **0016.HK** (新鸿基地产) | `developer` | • 新鸿基地产：港股龙头地产旗舰（开发+持有双轮），测试投资性物业与合同负债。 |
| **`conglomerate`**<br>*(多元控股 - 3家)* | **US** | **BRK.B** (伯克希尔) | 多元控股 | • 伯克希尔：跨行业多元控股典范，测试 BPS 复合增长与 SOTP 逻辑。 |
| | **HK** | **0001.HK** (长和)<br>**0019.HK** (太古股份) | 多元控股<br>多元实业 | • 长和：李嘉诚多元控股（港口+零售+基建+电讯），测试控股折价。<br>• 太古：老牌多元实业控股（航空+地产+饮料）。 |

### 2. 双维独立验收机制（拒绝混淆，落地可执行）

1. **维度一：官方年报真值核验 (Report Ground-Truth Verification)**：
   * 建立明确的真值台账（Ground-Truth Ledger），固定记录具体财年、核心科目数值、币种、容差（$0.1\% \sim 0.5\%$）与官方年报来源出处（如 `Apple 2024 10-K Item 8` / `茅台 2024 年报合并利润表`）；
   * 股数：期末股数与加权股数分立，严格排除实收资本金额；
   * 回购分红：来源于现金流量表真实已实施支出，合并项未拆解时不伪造零值；
   * 不适用科目（如银行毛利、券商 AUM）明确留空，不作虚假判定。
2. **维度二：产品链路与 6 大 Tab 端到端渲染验收 (Product E2E & UI Verification)**：
   * 测专业性与鲁棒性，而非强行填满；
   * **价值线 (Value Line)**：EPS/BPS/DPS 曲线计算结果有限（无 NaN/Infinity），PB 通道下限非负（$PB > 0$）；
   * **财务看板 (Financial Dashboard)**：六类模板专属报表行自适应呈现（银行无毛利、资管有费率、券商无 AUM、地产开发商展示合同负债、REIT 展示投资性物业与 FFO）；
   * **竞争优势 (Competitive Advantage)**：杜邦三项乘积恒等式成立（$|\text{ROE} - (\text{净利率} \times \text{周转率} \times \text{权益乘数})| \le 0.5\%$）；ROIC 在投入资本 $\text{IC} \le 0$ 时安全返回 `null`；
   * **资本配置 (Capital Allocation)**：总账客观对比 FCF 与股东回报总额，单分红场景正常渲染，无未证实的举债掏空断言；
   * **估值推演 (Valuation Analysis)**：情景预期年化回报率（Projected Annualized Return）计算正常，折现/增长边界安全；
   * **商业模式 (Business Profile)**：模板判定为 6 类之一，子模型（subModel）精准推断（万科为 developer，西蒙为 reit，黑石为 asset_mgmt，CME 为 broker_exchange）。

---

## 三、五阶段工程任务拆解与可执行清单

---

### 第一阶段：防污染拦截、字典对齐与存量脏数据审计 (P0 - 已完成并推送到 main)

* [x] **任务 1.1：字典与采集脚本股数清理（三立分立）**
* [x] **任务 1.2：晨星 ID 逐项甄别核准（剔除冲突项）**
* [x] **任务 1.3：存量脏数据定点审计脚本**

---

### 第二阶段：模板重构、子模型规则与前端边界纠偏 (P0/P1 - 已完成并推送到 main)

* [x] **任务 2.1：`financial-model.ts` 升级 6 大标准模板与子模型判定**
* [x] **任务 2.2：财务看板与专属报表行重构**
* [x] **任务 2.3：资本配置总账与估值指标修正**

---

### 第三阶段：30 家黄金基准构建与产品双维自动化评测 (P0 测试先行 - 已完成)

* [x] **任务 3.1：固化 30 家标的黄金基准与真值台账**
  * 产出文件：`scripts/lib/golden-benchmark-30.json`
  * 严格覆盖 6 模板 × 适用市场 30 家代表性标的，配置官方年报真值台账与 6 大 Tab 规则。
* [x] **任务 3.2：编写独立产品全链路双维评测脚本**
  * 产出文件：`scripts/eval-golden-suite-30.ts`
  * 执行年报真值核验与 6 大 Tab 端到端渲染验收，库内 25 家公司 100% 通过 UI 验收，13 家 100% 对齐官方年报真值。
* [x] **任务 3.3：修复审阅反馈问题 (bug.md 修复)**
  * **P1 股数审计报告生成**：`scripts/audit-polluted-financials.ts` 循环外维护累计 `totalScanned`，全量扫描 36,079 行成功落盘 `logs/polluted-shares-report.json`；新增单元测试 `tests/audit-polluted-financials.test.ts`。
  * **P1 地产价值线增长指标细分**：`ValueLineCard.tsx` 与 `value-line-data.ts` 细化地产子模型，持有型 REITs 彻底屏蔽受折旧扭曲的净利润 CAGR 与工业 FCF CAGR，呈现真实的营收/资产/权益增长；开发商保留交付净利润与资产规模增长。
  * **P2 移除“尚未接入”开发状态横幅**：全面清理 `ValueLineCard.tsx` 和 `CapitalAllocationView.tsx` 中的“专项指标未接入”、“FFO/AFFO 与 NAV 尚未接入”等占位文案，转为专属估值锚说明与自适应卡片展示。
  * **投入资本安全保护**：`calculateInvestedCapital` 在有息债务或现金缺失时返回 `null`，严禁偷换债务为零；新增 13 项单元测试，全绿通过。

---

### 第四阶段：批次追踪、精准回滚机制与存量清洗受控回填 (P1/P2 标的全覆盖)

> **标的范围**：库内全量 Phase 1 与 Phase 2 公司，共计 **3,678 家**（美股 1,678、A 股 926、港股 1,024）。  
> **核心原则**：**存量有效法定数据严禁废弃**（现有 3,622 家合法定三大表保留，仅做 56 家断点补漏与缺失派生科目增补）；**不可回滚，严禁写入**（强制 `--batch-id`，严格定界防前缀碰撞）。

#### 任务 4.1：增强 `backfill-derived-metrics.ts` 参数与性能安全
* **涉及文件**：`scripts/backfill-derived-metrics.ts`
* **具体动作**：
  1. **参数解析加固**：增加 `--phase <1,2>`、`--market <us|cn|hk>`、`--dry-run`；若传入 `--execute`，强制要求显式提供 `--batch-id <string>`，否则抛错阻断；未知参数严格抛出错误拒绝静默吞并；
  2. **批次标签定界**：写入 `mappingRule` 必须采用严格定界格式 `...|batch:<batchId>|`，杜绝 `contains` 匹配时发生前缀碰撞（如 `bf-1` 误伤 `bf-10`）；
  3. **分批读取与短事务写入**：将 entity 查询拆解为 50 家/批的 chunk 获取，规避大型 `in: [...]` 导致的数据库连接关闭（P1017）；写入使用批量短事务 `upsertFinancialRows`（带 5s 超时保护），将数千次网络 roundtrip 压缩为数十次。

#### 任务 4.2：编写精准回滚脚本与回滚单元测试
* **新建脚本**：`scripts/rollback-batch-financials.ts`
* **新建测试**：`tests/backfill-rollback.test.ts`
* **具体动作**：
  * 实现通过 `--batch-id <id>` 精准匹配 `|batch:<id>|` 定界标签；
  * 提供 `--dry-run` 预览受影响的记录数、涉及 Entity 清单，必须人工确认后方可执行 `--execute`；
  * 编写单元测试验证安全回滚能力与隔离性（不误伤其他批次数据）。

#### 任务 4.3：基础法定财报 56 家缺漏标的定向补齐
* **涉及文件**：`scripts/batch-backfill-phase12-financials.ts`
* **具体动作**：
  * 提取库内财务记录为 0 或少于 20 行的 56 家 P1/P2 标的清单；
  * 运行定向补录，自动套用最新的防实收资本股数污染与港币/人民币汇率校验逻辑，入库三大表基础事实。

#### 任务 4.4：P1/P2 派生指标分市场受控回填
* **执行步骤**：
  1. 分市场先执行 Dry-run 抽验，核查可派生行数、缺失情况与样例：
     ```bash
     npx tsx scripts/backfill-derived-metrics.ts --phase 1,2 --market us --dry-run
     npx tsx scripts/backfill-derived-metrics.ts --phase 1,2 --market cn --dry-run
     npx tsx scripts/backfill-derived-metrics.ts --phase 1,2 --market hk --dry-run
     ```
  2. 抽验通过后，分市场带批次号依次执行受控落库：
     ```bash
     npx tsx scripts/backfill-derived-metrics.ts --phase 1,2 --market us --execute --batch-id "bf-p1p2-20261015-us"
     npx tsx scripts/backfill-derived-metrics.ts --phase 1,2 --market cn --execute --batch-id "bf-p1p2-20261015-cn"
     npx tsx scripts/backfill-derived-metrics.ts --phase 1,2 --market hk --execute --batch-id "bf-p1p2-20261015-hk"
     ```

#### 任务 4.5：评测脚本加固与全链路回归验收
* **涉及文件**：`scripts/eval-golden-suite-30.ts`
* **具体动作**：
  1. 修复评测器假绿灯：模型缺失或模板不匹配时置 `uiPass = false`；增加 `requiredDashboardRows` 必需报表行硬断言；
  2. 明确区分“未建档缺失”、“数值偏差”与“币种口径偏差”三类统计产物；
  3. 执行 30 家黄金集回归与全套测试（`npx vitest run`），确保回填后全站数据与页面 100% 正常。

#### 阶段四耗时预算与执行周期预估

| 执行项 | 涉及范围 / 标的量 | 预期动作 | 预估耗时 |
| :--- | :--- | :--- | :---: |
| **代码与单测开发** | 任务 4.1 & 4.2 | 回填参数改造、回滚脚本、单元测试编写 | **15 - 20 分钟** |
| **56 家基础财报补漏** | 56 家缺失 P1/P2 公司 | 官方三大表定向抓取与短事务写入 | **3 - 5 分钟** |
| **美股 P1/P2 派生回填** | 1,678 家美股公司 | 50-chunk 分批读取 + 派生毛利/加权股数批量写入 | **1.5 - 2.5 分钟** |
| **A 股 P1/P2 派生回填** | 926 家 A 股公司 | 分批读取 + 派生毛利批量写入 | **1.0 - 1.5 分钟** |
| **港股 P1/P2 派生回填** | 1,024 家港股公司 | 分批读取 + 汇率/派生科目批量写入 | **1.0 - 2.0 分钟** |
| **黄金集与全量回归** | 30 家黄金集 + Vitest 全集 | 运行 eval 脚本与 56 个测试文件 | **2 - 3 分钟** |
| **合计纯执行耗时** | 3,678 家公司全链路 | 脚本与测试净运行时间 | **约 10 - 15 分钟** |
| **合计端到端交付周期** | 完整第四阶段 | 含开发、单测、分批运行与验收复核 | **约 25 - 35 分钟** |

---

### 第五阶段：Mini 机器核查与增量 Cron 飞轮激活 (P2)

#### 任务 5.1：Mini 机器运行状态核查
* **具体动作**：
  * SSH 登录 Mac mini 机器，检查现有 crontab 与后台进程：
    ```bash
    crontab -l
    ps aux | grep node
    ```
  * 核实 `scripts/cron/hourly-priority-worker.sh` 是否仍在运行或处于暂停状态；
  * 检查最近的日志文件（`logs/`），确认无卡死孤儿进程。

#### 任务 5.2：单标的手动增量测试与自动化恢复
* **具体动作**：
  1. Mini 机器 `git pull` 同步最新代码；
  2. 手动指定 1 家新公司跑一次单点建档（Phase 1 抓取入库）；
  3. 核查该新公司入库数据是否自带正确模板、Tag 与派生标记；
  4. 验证通过后，正式恢复 mini 上的 hourly priority worker 定时任务。

---

## 四、存量脏数据定点审计与修复方案

```mermaid
flowchart LR
    S1["1. 扫描审计 (audit)<br>扫描 CommonStockSharesOutstanding<br>识别数量级突变或等于实收资本的行"]
    S2["2. 产出报告 (preview)<br>导出受影响的 Entity/Ticker/年份清单<br>人工抽样抽检 10 家确认无误"]
    S3["3. 定点隔离/清洗 (fix)<br>清空被污染的股数行<br>重新关联主档核准股数或保持 null"]
    S4["4. 前端复验 (verify)<br>验证茅台、宁德时代等 A 股每股指标恢复正常"]

    S1 --> S2 --> S3 --> S4
```

---

## 五、批次追踪与精准回滚技术方案

#### 1. 批次写入机制（无须改动 Prisma Schema）
利用现有 `Financial.mappingRule` 字符串字段存储定界批次标签，末尾必须带有定界符 `|`：
* 派生毛利写入格式：`mappingRule = "derived:Revenue - CostOfRevenue|batch:bf-20261015-v2|"`
* 派生股数写入格式：`mappingRule = "derived:NetIncome / EPS|batch:bf-20261015-v2|"`

### 2. 精准回滚实现逻辑 (`scripts/rollback-batch-financials.ts`)
```ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export async function rollbackBatch(batchId: string, options: { dryRun?: boolean } = {}) {
  if (!batchId || batchId.trim() === "") {
    throw new Error("必须提供明确的 batchId，严禁全量清空！");
  }
  // 采用两端封闭定界符，杜绝 'batch:bf-1' 误匹配 'batch:bf-10' 等前缀碰撞
  const strictTag = `|batch:${batchId}|`;
  const count = await prisma.financial.count({
    where: { mappingRule: { contains: strictTag } }
  });
  console.log(`找到批次 [${batchId}] 相关的派生财务记录共 ${count} 行。`);

  if (options.dryRun) {
    console.log(`[DRY-RUN] 预览安全，未执行删除。传入 --execute 确认回滚。`);
    return { count, rolledBack: false };
  }

  const result = await prisma.financial.deleteMany({
    where: { mappingRule: { contains: strictTag } }
  });
  console.log(`✅ 成功回滚批次 [${batchId}]，共删除 ${result.count} 行新增派生数据。未影响任何官方原始数据。`);
  return { count: result.count, rolledBack: true };
}
```

---

## 六、全流程质量门禁与验收 Checklist

在任何代码合并或全库执行前，必须依次通过以下门禁：

- [ ] **门禁 1：类型安全与代码规范**
  * `npx tsc --noEmit` 0 错误通过
  * `npm run lint` 0 报错通过
  * `npm run build` 成功通过
- [ ] **门禁 2：字典一致性与单测**
  * TS 字典与 JSON 字典完全同步，无遗漏别名
  * `npx vitest run tests/derived-metrics.test.ts` 全部通过
  * `npx vitest run tests/backfill-rollback.test.ts` 回滚测试全部通过
- [ ] **门禁 3：数据防污染核验**
  * 确认 A/H 股资产负债表“实收资本/股本”已移出期末发行股数映射（已全量审计通过，0 行污染）
  * 确认未采集的分红回购保持 `null`，无任何伪造零值写入
- [ ] **门禁 4：30 家黄金测试集双轨验收**
  * **当前基线状态**：库内 25 家在库标的 100% 通过 UI 验收（0 NaN、指标有效隔离、ROIC 防护通过）；13 家 100% 对齐官方年报真值；5 家待建档，12 家在库标的待财年增补与币种换算对齐。
  * **最终放行标准**：30 家标的全量在库，UI 验收 100% 通过，年报真值 100% 对齐。
- [ ] **门禁 5：受控分批回填执行 (P1/P2)**
  * 回填脚本具备 `--phase`、`--market`、强制 `--batch-id` 与分批 chunk 读取能力；
  * US、CN、HK 分市场 dry-run 抽样核对无误；
  * 带明确 `--batch-id` 执行受控回填，记录各市场回填日志与写入行数。
- [ ] **门禁 6：Mini 机器恢复验收**
  * Mini 现有 crontab 与后台进程已做排查，无历史僵死进程；
  * 单公司增量测试建档成功，数据符合 6 模板新规；
  * Hourly Priority Worker 恢复运行，增量飞轮转动。

---

## 七、审阅反馈问题与定点修复台账（来自 bug.md）

> 审阅提交：`04bb1f91` 及后续黄金基准实现。  
> 本节完整归档审阅检出的 4 项关键问题、排查结论、具体改动与验证状态。

### 1. P1：股数污染审计脚本无法生成报告
* **原问题位置**：`scripts/audit-polluted-financials.ts:136-145`
* **问题本质**：脚本在 `while` 循环内声明 `rows`，循环结束后又在报告生成处引用 `rows.length`，运行至写报告阶段会因作用域引用失败触发 `ReferenceError`，且最后一批数量不能代表全量扫描行数。
* **修复动作**：
  1. 在 `while` 循环外维护累计扫描变量 `totalScanned = 0`，每批增量累加 `rows.length`；
  2. 报告落盘结构写入真实的累计扫描总行数：`totalScanned: totalScanned`；
  3. 解耦提取核心批次处理逻辑 `processShareBatches`，支持外部注入 mock batch fetcher；
  4. 新增单元测试 `tests/audit-polluted-financials.test.ts`，多批次 mock 累计断言 100% 通过；
  5. 全库实测扫描 36,079 行，生成 `logs/polluted-shares-report.json`，检出异常 0 行。
* **解决状态**：✅ **已完全解决**

### 2. P1：地产价值线沿用普通公司增长指标
* **原问题位置**：`src/lib/financial-model.ts:123-128`、`src/components/ValueLineCard.tsx:510-511,713-777`
* **问题本质**：新增地产模板关闭了工业现金流，但价值线的资产负债型判断此前只包含银行和保险。地产公司进入普通非金融公司的增长展示路径，显示营收增长和净利润增长。对于持有型 REITs，GAAP 巨额折旧和投资性物业重估会严重扭曲净利润，该组指标不能反映真实经营能力。
* **修复动作**：
  1. 细化地产子模型：在 `financial-model.ts` 和 `value-line-data.ts` 中明确区分 `reit_property`（持有型 REITs）与 `developer`（地产开发商）；
  2. 对于 `reit_property`：彻底排除受折旧扭曲的净利润增长（`netIncomeCagr5Y`）和工业自由现金流增长，替换为符合物业重资产特性的**“营收增长”**、**“总资产增长”**（物业资产组合扩张）和**“股东权益增长”**；
  3. 对于 `developer`：保留反映交付结算的营收增长、净利润增长、总资产规模扩张与股东权益增长，彻底屏蔽工业 FCF 增长；
  4. 优化 `globals.css` 中 `.vl-card-quadrant` 为 `repeat(auto-fit, minmax(200px, 1fr))` 自适应网格，3 张或 4 张卡片均能均匀对齐美观呈现；
  5. 新增单元测试断言 REITs 场景下绝对不出现“净利润增长”与“自由现金流增长”卡片。
* **解决状态**：✅ **已完全解决**

### 3. P2：前台页面显示“尚未接入”实现状态文案
* **原问题位置**：`src/components/ValueLineCard.tsx:520-522,564-565`、`src/components/CapitalAllocationView.tsx:361-370`
* **问题本质**：前台价值线和资本配置页面会渲染“FFO/AFFO 与 NAV 尚未接入”、“专项指标未接入”、“数据未接入”等内部开发状态提示，属于开发阶段噪音，不符合专业投资产品呈现要求。
* **修复动作**：
  1. **价值线 Sparkline 估值锚说明**：彻底移除“尚未接入”语句，非 P/E 估值锚统一呈现专业业务口径：`估值锚：${financialModel.valuationAnchorLabel}。本行业采用专属估值框架，暂不绘制通用 P/E 参考线。`
  2. **价值线四宫格指标 2**：仅在指标适用且有有效数值时才渲染卡片，银行、保险、地产等非工业造血模板不再显示“专项指标未接入”及“—”死卡；
  3. **价值线四宫格指标 3**：彻底删除第四个灰色死卡（“专项经营指标 / 数据未接入 / —”）；
  4. **资本配置视图**：移除全部带有“尚未接入”的横幅（银行/保险/地产未接入横幅全清），保留清晰客观的股东回报指标表格与走廊图。
* **解决状态**：✅ **已完全解决**

### 4. 投入资本计算保护（IC 与 ROIC 安全防线）
* **原问题位置**：`src/lib/financial-math.ts:99-114`、`src/lib/company-financial-dashboard.ts:550-579`
* **问题本质**：原投入资本计算在债务或现金缺失时默认为 0，会导致在必要组成项不完整时算出看似有效的伪造投入资本和伪造 ROIC。
* **修复动作**：
  1. 在 `calculateInvestedCapital` 中严格执行必填约束：若 `totalEquity == null` 或 `cashAndEquivalents == null`，直接返回 `null`；
  2. 若 `totalDebt` 为空且（`shortTermDebt` 或 `longTermDebt` 任一缺失），判定债务信息不完整，直接返回 `null`，严禁无中生有默认债务为 0；
  3. 在 `tests/financial-math.test.ts` 中补充针对权益缺失、现金缺失、负债全部缺失与部分缺失的单元测试用例，13 项单测全部绿灯通过。
* **解决状态**：✅ **已完全解决**

---

## 八、远程主机 (mini) 全量回填运维与监控指南（来自 backfill.md）

> 本节完整融合原 `backfill.md`，记录统一批量回填脚本（`scripts/batch-backfill-phase12-financials.ts`）在远程主机 `mini` 上的运行状态、路径配置以及常用监控与运维命令，作为长期运维参考。

### 1. 任务概述
* **任务内容**：回填美股、A 股、港股全量 Phase 1 和 Phase 2 标的的法定财务报表（资产负债表、利润表、现金流量表全部标准化指标）并落库。
* **执行脚本**：`scripts/batch-backfill-phase12-financials.ts`（通过 `npm run backfill:phase12-financials` 触发）
* **覆盖市场**：美股 (1,678 家)、A 股 (926 家)、港股 (1,024 家)，总目标 3,678 家
* **断点机制**：基于 `.cache/batch-backfill-phase12-financials.json`，已处理完成的公司会自动跳过，支持随时无损恢复执行。

### 2. 运行环境与关键路径 (`mini` 主机)
该任务以持久后台守护方式运行在主机 `mini` (Mac mini) 上：

| 配置项 | 路径 / 说明 |
| :--- | :--- |
| **项目工作目录** | `/Users/rafael/buffett-tribe` |
| **Node 可执行路径** | `/Users/rafael/node/bin/node` |
| **PID 记录文件** | `/Users/rafael/logs/buffett-tribe/backfill-phase12-financials.pid` |
| **任务标准日志** | `/Users/rafael/logs/buffett-tribe/backfill-phase12-financials.log` |
| **断点缓存状态** | `/Users/rafael/buffett-tribe/.cache/batch-backfill-phase12-financials.json` |

### 3. 查阅与监控常用命令速查
任何 Agent 可直接在本地执行以下 SSH 命令查看实时状况：

#### 3.1 查看进程活跃状态与资源占用
```bash
ssh mini "if [ -f /Users/rafael/logs/buffett-tribe/backfill-phase12-financials.pid ]; then \
  PID=\$(cat /Users/rafael/logs/buffett-tribe/backfill-phase12-financials.pid); \
  echo \"PID: \$PID\"; \
  ps -p \$PID -o pid,stat,%cpu,%mem,time,command; \
else \
  ps aux | grep batch-backfill-phase12-financials | grep -v grep; \
fi"
```

#### 3.2 查看完成统计（已完成 vs 失败）
```bash
ssh mini "/Users/rafael/node/bin/node -e 'const d = require(\"/Users/rafael/buffett-tribe/.cache/batch-backfill-phase12-financials.json\"); console.log(\"已完成:\", Object.keys(d.completed||{}).length, \"失败:\", Object.keys(d.failed||{}).length)'"
```

#### 3.3 查看最近处理日志（实时尾部 30 行）
```bash
ssh mini "tail -n 30 /Users/rafael/logs/buffett-tribe/backfill-phase12-financials.log"
```

#### 3.4 检查失败标的列表及错误原因
```bash
ssh mini "/Users/rafael/node/bin/node -e 'const d = require(\"/Users/rafael/buffett-tribe/.cache/batch-backfill-phase12-financials.json\"); console.log(JSON.stringify(d.failed||{}, null, 2))'"
```

### 4. 任务控制与异常处理
#### 4.1 停止后台任务
```bash
ssh mini "kill \$(cat /Users/rafael/logs/buffett-tribe/backfill-phase12-financials.pid)"
```
> 脚本会将 `SIGTERM` 传递给当前公司的子进程组，等待子进程退出并保留检查点；不要只杀父进程或直接清理检查点文件。

#### 4.2 重新启动 / 断点续跑
任务恢复前先确认本地修复代码已同步到 `mini`，并核对数据库迁移及检查点状态。获得恢复安排后，再在 `mini` 上拉起任务；脚本会读取断点缓存并跳过已成功条目：
```bash
ssh mini "cd /Users/rafael/buffett-tribe && nohup npm run backfill:phase12-financials > /Users/rafael/logs/buffett-tribe/backfill-phase12-financials.log 2>&1 & echo \$! > /Users/rafael/logs/buffett-tribe/backfill-phase12-financials.pid"
```

### 5. 数据库连接与锁等待排查及防护
#### 5.1 历史事故复盘（2026-10-12 17:52）
在人工终止 `mini` 上的 backfill 脚本后，主站点曾出现“搜索任何公司无限挂起卡死超时”现象：
* **根本原因**：
  1. **子进程未优雅退出**：脚本执行链条为 `TS orchestrator -> Python (akshare) -> Node (import TS)`。仅终止父进程可能遗留子进程及未完成的数据库写入。
  2. **写入事务粒度过大**：财务批量写入曾使用长事务，锁等待可能拖慢其他数据库请求。
  3. **Prisma 实例重复创建**：子脚本各自创建客户端会增加连接池压力。

#### 5.2 紧急自愈操作（精准排查与定点解除）
若再次发生写锁冲突或查询挂起卡顿，**严禁无差别杀除所有活跃连接**（会误伤正常用户的 Web 访问请求），必须采用“先诊断阻塞者、再定点杀 PID”的安全流程：

1. **第一步：诊断长时间占用行锁或事务的阻塞进程 (SQL Editor)**：
   ```sql
   SELECT 
     pid, 
     now() - xact_start AS duration, 
     query, 
     state, 
     wait_event_type, 
     wait_event 
   FROM pg_stat_activity 
   WHERE (query LIKE '%Financial%' OR query LIKE '%INSERT%' OR query LIKE '%UPDATE%')
     AND state != 'idle' 
     AND pid != pg_backend_pid()
   ORDER BY duration DESC;
   ```
2. **第二步：定点终止特定阻塞进程**：
   在核实具体的阻塞 `pid` 后，定点释放：
   ```sql
   -- 将 <BLOCKED_PID> 替换为上述诊断出的具体数字 PID
   SELECT pg_terminate_backend(<BLOCKED_PID>);
   ```
3. **彻底自愈方案（仅在数据库完全失联时使用）**：
   在 Supabase Dashboard -> **Project Settings** -> **General** -> 页面底部的 **Restart project** 重启数据库，所有未提交事务会自动安全回滚。

#### 5.3 已实施的系统防护
* **优雅退出**：批处理脚本捕获 `SIGINT` / `SIGTERM` 并向子进程组传递信号；收到停止信号后保留检查点，子脚本在 `finally` 中断开 Prisma。
* **客户端生命周期**：财务导入路径复用 Prisma 单例，并在退出时统一断开连接。
* **短批次增量写入**：财务事实按复合唯一键排序，每批最多 50 行，通过 `INSERT ... ON CONFLICT ... DO UPDATE` 写入，不删除本次数据源未包含的旧行。
* **数据库等待上限**：写入批次设置 `lock_timeout = 5s` 和 `statement_timeout = 30s`；其他短写事务也设置超时保护，避免无限等待。
* **迁移状态**：`reportingCurrency` / `FxRate` 迁移已在生产数据库完成。

### 6. 港股「非港币报表」与汇率链路防错要点
1. **主链路逻辑**：币种按「交易市场 → 交易币种」×「实体 `reportingCurrency`」逐对推导，取两侧中所有非 USD 币种进行汇率换算。
2. **港股 40% 非港币报表**：生产库实测 1,038 家有财务数据的港股中，379 家为人民币报表（CNY），41 家为美元报表（USD），HKD 为 618 家。
3. **严禁静默 `assume HKD` 兜底**：`resolveHkCurrencyFromAnnualReport`（`scripts/lib/cn-hk-currency-resolve.ts`）严格向上抛出异常，绝不吞异常兜底为 HKD；被误标 HKD 的人民币报表公司会导致 PE/PB 估值比率系统性偏差约 +17%。
4. **可审计性要求**：解析币种必须打印明确的来源标记日志，落入任务日志，便于复核校验。


> 🔒 内部文件，不对外公开。

# 巴菲特部落 · Buffett Tribe — 产品设计文档

> 最后更新：2026-06-04（v0.37.0）

---

## 文档治理

本仓库文档按“内部决策”和“外部展示”分层，避免产品、技术、设计判断散落到多个文件。

| 文件 | 角色 | 维护原则 |
|------|------|----------|
| `PRODUCT.md` | 内部唯一产品/技术/设计决策源 | 产品定位、路线图、架构原则、数据口径、设计系统、实施计划都收口到这里 |
| `README.md` | 外部展示与快速开始 | 保持简洁，面向用户/开发者介绍产品、运行方式和技术栈，不承载内部规划 |
| `CHANGELOG.md` | 发布记录 | 只记录已经发布的用户可见变化和重要修复 |
| `APPLE-DESIGN.md` | 设计参考资料 | 可保留为参考，但设计决策和项目落地规范应摘要进 `PRODUCT.md` |

原则：以后讨论“要做什么、为什么做、怎么做、数据从哪里来、设计口径是什么”，默认更新 `PRODUCT.md`；对外只更新 `README.md` 和 `CHANGELOG.md`。`NEXT.md` / `TODOS.md` / `DATA_GLOSSARY.md` 的内容已经合并进本文档，不再作为单独入口维护。

---

## 目录

1. [产品定位](#产品定位)
2. [产品体验与核心页面](#产品体验与核心页面)
3. [文档系统路线图](#文档系统路线图)
4. [公司覆盖模型](#公司覆盖模型冷热演进)
5. [公司研究闭环路线图](#公司研究闭环路线图)
6. [A股与港股覆盖扩展](#a股与港股覆盖扩展)
7. [设计与技术基线](#设计与技术基线)
8. [当前实现状态](#当前实现状态v0370)
9. [数据字典与工程口径](#数据字典与工程口径)
10. [公司页财务看板](#公司页财务看板truth-of-source-设计)
11. [数据与脚本](#数据与脚本)
12. [运维速查表](#运维速查表)

---

## 产品定位

**买股票就是买公司。巴菲特部落用价值投资大师的框架帮你理解一家公司。**

用户来这里不是为了读懂巴菲特，而是为了用巴菲特的方式看一家公司：
护城河在哪里？管理层可信吗？现在的价格有安全边际吗？

大师原文、13F 持仓、财务数据——这些是分析的燃料，不是产品的终点。

---

## 产品体验与核心页面

```
/master   大师         核心大师（巴菲特、李录、段永平）与 Alpha 投资人的资料、持仓
/company  公司         任意一家公司的研究画布（Canvas）
/idea     对话研究室    与大师思想对话，自动触发公司分析
```

### /master — 大师

价值投资大师的原始资料库：股东信、合伙人信、演讲、访谈。每位大师有独立页面，展示材料列表与 13F 持仓快照。材料全文可阅读，可跳转到 /idea 继续追问。

Alpha 投资人作为独立分类展示，不进入核心大师主导航。第一位 Alpha master 是 Gavin Baker / Atreides Management, LP，用于承载科技成长、AI、半导体、crossover 等现代投资风格；其 13F 持仓页需要明确说明 13F 不代表完整组合。

### /company — 公司

任意一家公司的研究画布。当前页面已经从早期 Canvas 形态演进为公司研究工作台，用 6 个 tab 结构化呈现：

| Tab | 内容 |
|-----|------|
| 业务分析 | 业务概览 + 商业画布 |
| 财务分析 | 行业感知核心财务指标 + 5 年趋势 |
| 价值分析 | 十维评分、护城河摘要、强弱项 |
| 管理分析 | 当前为占位，后续接管理层、资本配置、治理证据 |
| 估值分析 | 当前为占位 + 价格历史图，后续接估值模型 |
| 年度报告 | 10-K / 20-F / 40-F 年报列表与阅读入口 |

Canvas 的数据来自两个渠道：
- 结构化事实层（财务数据，来自 EDGAR / 市场数据 API）
- 对话沉淀层（Company Brain，随用户对话写回积累）

当前公司页已经接通真实数据源与批处理入库流程，不再是纯 Mock 页面。

### /idea — 对话研究室

全站唯一的对话界面。左侧与大师思想对话，右侧实时显示对应公司的研究画布。

**默认状态**：右侧展示 Apple 画布（冷启动占位），左侧空对话等待提问。

**对话触发 Canvas 更新**：用户在对话中提到公司名（泡泡玛特、比亚迪、Apple…），右侧 Canvas 自动切换到该公司。

**原文跳读**：对话引用原文时，点击来源芯片可展开原文阅读模式。

---

## 文档系统路线图

公司财报、大师资料、问答录、PDF、Markdown、访谈和逐字稿最终都应该落到同一套 Document System，而不是按页面和文件类型继续分裂。这个路线图分三层推进：先把特殊结构识别出来，再把原文阅读能力跑稳，最后统一成可复用的文档对象。

### 问答 / 逐字稿结构层

我们现在已经有了年会 PDF 和初步提取出的 md，但这类资料的本质不是普通长文，而是“按主题组织的问答/逐字稿索引”。

以 `Buffett-and-Munger-Unscripted` 为例，资料里同时包含：
- 主题分组
- 年份 / 场次
- 说话人
- 视频时间点
- 原始段落文本

这意味着它不适合只作为普通 `Source -> Chunk` 文本直接吞入。更合理的方向是新增一个通用的结构层，用来承载“对话 / 问答 / 访谈 / 逐字稿”这类内容形态，而不是做成 Buffett 年会专用表。

#### 设计原则

- `Source` 继续表示原始资料文件
- `Chunk` 继续负责全文检索和语义检索
- 新增一张通用结构表，负责“问答片段 / 逐字稿片段”的导航信息
- 这个结构层要同时兼容：
  - 巴菲特股东大会
  - 段永平问答录
  - 访谈
  - 公开视频字幕 / 逐字稿

#### 新表要表达的信息

- 属于哪个源文档
- 属于哪个人物 / 活动
- 哪一年 / 哪一场
- 主题
- 说话人
- 问题 / 回答 / 陈述
- 时间点或页面位置
- 原始内容文本

#### 下一步建议

1. 先抽一版通用 schema，优先覆盖 `annual_meeting` 和段永平这类问答材料。
2. 导入时保留 raw md，另写结构化片段表，不要把元数据继续塞进普通正文。
3. 页面层再决定怎么展示主题目录、时间锚点和跳转能力。

### PDF 原文阅读层

未来产品的大头会落在**公司的年度报告**，所以 PDF 阅读不是附属功能，而是底层能力。我们需要先把“原始 PDF 能在 Web 上稳定阅读”这件事跑通，再往上叠加 transcript、章节索引和中文辅助层。

#### 设计原则

- 先支持原始 PDF 直读，再做结构化抽取
- PDF 阅读器负责“看原文”
- transcript / 逐字稿表负责“主题、说话人、时间点、页码锚点”
- 这两层可以并行推进，不互相阻塞

#### 最小可用目标

- 能在 Web 上打开 PDF
- 能翻页、缩放、适配桌面与手机
- 能保留浏览器原生的复制 / 选择能力，后续再考虑 `pdf.js`
- 先用 `Buffett-and-Munger-Unscripted.pdf` 做样例

#### 后续扩展方向

- 年度报告 PDF 阅读
- 章节索引与页码跳转
- 中文辅助阅读层
- 与 `TranscriptSegment` / `QAItem` 的联动导航

### 统一 Document System

我们现在面对的不是单一 PDF，而是两大类内容体系：

1. **公司研究文档**
   - 未来的大头是每年的财报，通常是 PDF。
   - 用户需要阅读原文，AI 需要做结构化解读。
   - 重点能力是章节、页码、表格、脚注、风险因素、MD&A。

2. **大师资料文档**
   - 现在 `master` 下的资料来源比较杂：股东信、年会问答录、书籍 PDF、文章、访谈、Markdown。
   - 用户同样需要阅读原文，AI 也需要深度解读，但不同文档类型的阅读方式不一样。

所以下一步不应该继续按“页面类型”拆，而应该统一成一个 **Document System**。

#### 分层定义

- `library`：书架和目录，负责找资料
- `document`：资料对象，负责读原文和看 AI 解读
- `source`：原始文件层，负责真相和溯源
- `segment`：结构化片段层，负责理解和跳转
- `analysis`：AI 解读层，负责摘要、论点、主题、待追问问题

#### 核心原则

- 不要让 `library` 承担正文渲染责任
- 不要把文件路径当成公开路由的核心对象
- 不要把不同资料类型硬塞进同一种正文展示逻辑
- 文档对象要统一，渲染方式可以多样

#### 两大类文档怎么落地

##### 公司研究文档

- 原文 PDF 是 source of truth
- 自动抽章节和页码锚点
- 表格单独识别
- AI 解读按章节进行，而不是整份文件一锅炖

##### 大师资料文档

- 股东信、年会、问答录、访谈、书籍、文章都归到 `Document`
- Markdown 是一种 rendition，PDF 也是一种 rendition
- 问答录需要额外保留 speaker / topic / timecode / page 这类结构信息
- AI 解读要按文档类型切换 prompt，而不是一套 prompt 走天下

#### 用户路径

1. 先在 `library` 找到资料
2. 点进去进入 `document`
3. `document` 左边看原文，右边看目录和 AI 解读
4. `source` 只作为溯源和原始文件入口，不直接成为主要用户路径

#### 目标效果

- 公司财报和大师资料用同一套底层
- 不会因为文件类型多就越做越乱
- AI 深度解读可以复用同一套结构化上下文
- 后续加新资料类型，不需要再发明新页面

#### 建议 schema

先不要急着推翻现有 `Source` / `Chunk`，而是按“逻辑对象”和“物理文件”分层过渡：

- `Document`
  - 逻辑上的资料对象，是资料库和阅读页的主入口
  - 例子：`2024 Berkshire Hathaway Annual Report`、`段永平投资问答录 · 商业篇`
- `DocumentRendition`
  - 文档的具体载体或展示形式
  - 例子：`pdf`、`markdown`、`html`、`ocr-text`
- `DocumentSegment`
  - 文档的结构化片段
  - 例子：章节、问答、段落、页码锚点、时间点
- `DocumentAnalysis`
  - AI 生成的解读结果
  - 例子：摘要、核心论点、风险、待追问问题、章节级要点
- `Source`（过渡层）
  - 现有实现里的原始内容容器
  - 短期继续承担导入和正文存储
  - 后续再逐步拆成 `DocumentRendition` 或挂到 `Document` 下

#### 关系约束

- 一个 `library` 包含多个 `document`
- 一个 `document` 可以有多个 `rendition`
- 一个 `document` 可以拆成多个 `segment`
- 一个 `document` 可以有多份 `analysis`
- `segment` 不负责展示整份原文，只负责导航、理解和高亮

#### 迁移原则

1. 先让新文档系统并行出现，不要先做全库重构。
2. 先把公司财报和段永平问答录接入统一文档对象。
3. 再把既有 `Source` 逐步迁成 `Document` 的一种实现方式。
4. 最后再考虑是否把老的 `letter` / `article` 页面归并到同一文档阅读器。

---

## 公司覆盖模型：冷→热演进

```
第 1 个用户引入新公司
  ↓
系统新建 company 记录 → LLM 基于实时搜索回答 → 对话结束写回首批 Claim
  ↓（同时）
Cron Job 触发 Fact Fetch Pipeline
  → 财务数据 / 基本面写入（次日生效）

第 2 个用户
  ↓
已有初始 Fact 层 + 第 1 轮沉淀 Claim → Canvas 有初始内容
  ↓
对话结束再次写回 → Brain 进一步丰富

第 N 个用户
  ↓
多轮沉淀：Claim/Evidence/Counter-Evidence
置信度随讨论次数收敛，Canvas 开箱即用
```

覆盖范围不限于大师持仓——任何用户引入的公司都成为 Brain 节点。

---

## 公司研究闭环路线图

下一阶段的核心不是继续堆数据，而是把现有数据变成更强的公司研究体验。优先推进三件互相咬合的能力：

1. `10-K / 20-F / 40-F 年报阅读`
2. `company 页面 tab 化`
3. `价格历史图 / 价格上下文`

这三件事的关系是：

- `10-K / 20-F / 40-F` 提供原文与事实层。
- `tab` 提供结构化阅读路径。
- `价格图` 提供估值和市场上下文。

### 公司页结构

公司页不再继续纵向堆内容，而是改成：

- 顶部固定概览区
- 中部主内容 tabs
- 底部资料与原文入口

顶部概览区只做“快速判断”，不占一个独立 tab。建议包含公司名、ticker、行业、交易所、一句话结论、关键事实卡片、最近更新时间和资料覆盖情况。价格图目前已经落在 `估值分析` tab，后续如果首屏空间允许，再抽出价格小图放到概览区作为快速上下文。

### 公司页 Tab 顺序

| Tab | 内容 |
|-----|------|
| 业务分析 | 公司如何赚钱、商业模式、商业画布、护城河、竞争格局 |
| 财务分析 | 5 年财务趋势、核心财务指标、同比、CAGR、行业 KPI |
| 价值分析 | 十维评分、护城河类型、最强项、相对短板 |
| 管理分析 | 资本配置、管理层诚信、长期执行能力、股东利益一致性 |
| 估值分析 | 价格历史图、当前估值位置、安全边际、情景分析 |
| 年度报告 | 10-K / 20-F / 40-F 原文、年份切换、标准目录、附件、来源链接 |

### 年报阅读

年报阅读不是资料库功能，而是公司研究功能。用户进入年报阅读，通常是为了核对业务描述、风险因素、MD&A、财务口径，或跳到原文章节追溯细节。

主入口放在：

- `company` 页面
- 顶部概览区
- `年度报告` tab

推荐路由结构：

- `/company/[cik]/annual-report`
- `/company/[cik]/annual-report/[year]`

年报阅读页至少要支持：

- 按年份切换

### 待办：13F 历史证券承接页

当前 13F 历史持仓中仍存在少量 `Security.ticker = null` 且 `companyEntityId = null` 的证券记录。它们有 CUSIP、issuer/titleOfClass 和真实持仓事实，但未被解析成标准 company entity，因此无法进入公司页。

产品口径：只要出现在大师历史持仓里，就应该有可访问页面，不能只停留在表格文本里，也不能在 UI 中泄露内部 `securityId`。

后续处理：

- 可解析为运营公司的历史证券，补齐 company shell，并标记 `status: acquired / delisted / private`、`historicalTicker`、`cusip`。
- ETF / Trust / fund 类证券不要强行进入普通公司页，应承接到 fund/security 页面。
- 大师持仓表证券展示优先级统一为 `security.ticker -> company.ticker -> historicalTicker -> issuer short name -> cusip`，永远不显示内部 id。
- 新增 `/security/[id]` 或等价承接页，用于无法归并到标准 company 的历史证券。
- 将 orphan security 巡检纳入 `check:security:integrity`，并通过脚本化 backfill 修复，不手工改库。
- 10-K / 20-F / 40-F 标准目录
- 右侧展示对应原始内容
- 页码或章节锚点
- 附件链接
- 与财务数据联动跳转

数据前提吃现有库里的 `ExtSource`、`FinancialFact`、`FilingSection`、`FilingAttachment`、`Financial`，不另起一套孤立模型。

### 价格数据

价格图不是交易工具，而是研究上下文：

- 当前价格在历史里处于什么位置
- 过去一段时间市场怎么重新定价这家公司
- 价格变化是否和基本面、年报节点、持仓变化有关

当前实现：

- 已有 `StockPrice` 表，以 `(ticker, date)` 唯一约束存储日线 OHLCV。
- 已有 `/api/price/[ticker]`，支持 `1d / 1w / 1m / 3m / 6m / 1y / 5y / max` 查询。
- 已有 `StockPriceChart`，使用 `lightweight-charts` 展示 K 线、成交量和均线，支持日 / 月 / 季维度切换。
- 已有 Yahoo Finance 导入脚本：`npm run import:stock-prices:yf` 与 `npm run import:company-stock-prices:yf`。
- 公司页会在存在入库价格数据时，在 `估值分析` tab 展示价格历史。

后续目标：

- 优先接外部市场数据 provider，早期可用免费层验证，长期切付费源。
- 将 `StockPrice` 从 ticker 口径逐步升级到 `securityId` 口径，处理多 share class、换 ticker、跨市场 ticker 冲突。
- 增加服务端周 / 月 / 年聚合或缓存，避免前端重复聚合大窗口数据。
- 加财报日 / 10-K / 20-F / 40-F 日 marker。
- 评估是否把价格小图放到概览区，估值 tab 保留完整图表。

### 实施顺序

#### Phase 1

- 改公司页信息架构。
- 把业务 / 财务 / 价值 / 管理 / 估值 / 年度报告拆成 tabs。（已完成）
- 在估值 tab 加入价格图。（已完成）
- 评估是否在概览区加入价格小图占位。

#### Phase 2

- 做 10-K / 20-F / 40-F 阅读页。
- 接公司页年度报告入口。
- 支持年度切换和章节目录。（已完成）

#### Phase 3

- 接市场价格数据。（已完成 Yahoo Finance 导入链路）
- 落库日线 OHLCV。（已完成 ticker 口径）
- 做价格图。（已完成日 / 月 / 季 K 线）
- 加财报日 / 10-K / 20-F / 40-F 日 marker。

#### Phase 4

- 价格图与估值分析联动。
- 公司页形成完整研究闭环。

### 非目标

短期不建议做的事：

- 再把内容继续堆成超长单页。
- 把价格图单独做成一个主 tab。
- 把年报阅读放到大师资料库入口里。
- 先做全量价格历史再想怎么展示。

---

## A股与港股覆盖扩展

当前系统深度绑定 SEC EDGAR 体系（CIK、XBRL、10-K/20-F/40-F），公司页路由、Entity 模型、财务导入链路、年报阅读器都围绕这一体系构建。下一阶段需要扩展支持 A 股和港股公司，首批以贵州茅台（600519.SS）和泡泡玛特（9992.HK）为验证目标。

### 扩展动机

- 价值投资框架不局限于美股。A 股和港股有大量符合价值投资标准的标的。
- 用户对话中已频繁出现中概股、A 股和港股公司名称，当前系统只能依赖 LLM 实时搜索回答，没有结构化数据层支撑。
- 股价数据方面，Yahoo Finance 已原生支持 A 股（后缀 `.SS`/`.SZ`）和港股（后缀 `.HK`），`StockPrice` 表和现有价格导入链路可以复用。

### 核心挑战

| 挑战 | 美股（当前） | A 股 / 港股（目标） |
|------|------------|-------------------|
| **标识体系** | CIK（唯一，SEC 分配） | A 股数字代码（600519，需后缀区分沪深）；港股数字代码（9992，后缀 .HK） |
| **财务来源** | SEC CompanyFacts API + inline XBRL | 无 XBRL 体系；需从东方财富/新浪财经等第三方获取表格化财务数据 |
| **年报格式** | 标准化 HTML（inline XBRL），有固定章节标签 | PDF 为主，无统一章节标签，结构不固定 |
| **货币单位** | USD | CNY / HKD |
| **财年定义** | 各公司自行定义（如 Apple 为 Sep） | 日历年度为主（1-12 月） |
| **持仓披露** | 13F-HR（标准化季度申报） | A 股十大流通股东（不完整）；港股披露权益（event-driven，非标准化） |
| **AI 分析语料** | 10-K/20-F/40-F 英文原文 + 大师信件 | 中文年报 PDF + 中文研报 + 公开访谈 |

最大瓶颈是**标识体系**：当前 `Entity.cik` 有 `@unique` 约束，URL 路由为 `/company/[cik]`，公司页查询逻辑、持仓关联、财务读取都假设 CIK 存在。A 股和港股没有 CIK，需要让 Entity 模型和路由层支持无 CIK 的公司。

### 数据源评估

#### akshare（Python 库）

[akshare](https://github.com/akfamily/akshare) 是基于东方财富、新浪财经等源的免费中文金融数据接口库。

| 数据类型 | A 股 | 港股 | 备注 |
|---------|------|------|------|
| 公司基本信息 | ✅ 丰富 | ⚠️ 一般 | `stock_individual_info_em()` / `stock_hk_ggt_components_em()` |
| 历史 K 线/股价 | ✅ | ✅ | `stock_zh_a_hist()` / `stock_hk_hist()` |
| 财务报表（三大表） | ✅ 较全 | ⚠️ 有限 | `stock_financial_report_sina()` / `stock_financial_analysis_indicator()` |
| 业绩快报/预告 | ✅ | ❌ | `stock_yjbb_em()` / `stock_yjkb_em()` |
| 年报原文 PDF | ❌ | ❌ | 需从巨潮资讯网/港交所披露易单独获取 |
| XBRL 结构化财务 | ❌ | ❌ | 中国股市不采用 XBRL 披露体系 |

**结论**：akshare 足以支撑**阶段 1（基础信息）和阶段 2（财务数据）**。年报原文需要单独处理，不作为首批目标。

#### 备选数据源

| 数据源 | 优势 | 劣势 | 适用阶段 |
|--------|------|------|---------|
| **Tushare Pro** | 更专业稳定，财务指标覆盖全 | 需积分/付费 token | 阶段 2 长期替代 |
| **Yahoo Finance** | 股价已在使用，A 股/港股 ticker 支持 | 财务数据粒度不够 | 阶段 1 股价复用 |
| **巨潮资讯网 API** | A 股年报 PDF 官方来源 | 无标准化 API，需爬虫 | 阶段 3 年报原文 |
| **港交所披露易** | 港股公告/年报官方来源 | 无 API，需爬虫 | 阶段 3 年报原文 |

### 实施阶段

#### Phase 1：基础信息 + 股价（最短路径，1-2 天）

**目标**：让贵州茅台、泡泡玛特能在网站上展示基本信息和股价走势图。

**改动点**：
1. **Entity 模型扩展**：`cik` 改为 nullable，新增 `market`（`'us' | 'cn' | 'hk'`）和 `code`（A 股/港股数字代码）字段。
2. **URL 路由扩展**：支持多市场标识格式：
   - `/company/CIK0000320193` → SEC 公司（向后兼容）
   - `/company/cn-600519` → A 股
   - `/company/hk-9992` → 港股
3. **公司信息获取**：新增 akshare 脚本获取公司中文名、行业、交易所等基础信息，写入 `Entity.metadata`。
4. **股价**：复用现有 Yahoo Finance 导入脚本
   - 茅台：`600519.SS`
   - 泡泡玛特：`9992.HK`
   - 已有 `npm run import:stock-prices:yf` 可直接使用

**公司页适配**：
- 概览区 `CIK` 字段对非美市场显示为 `—` 或替换为市场代码。
- `交易所` 字段展示对应市场（上交所/深交所/港交所）。
- 财务分析 tab 显示 "暂无数据" 占位，不报错。
- 年度报告 tab 显示 "A 股/港股年报原文暂未接入" 占位。

#### Phase 2：财务数据（中等复杂度，3-5 天）

**目标**：展示财务报表趋势。

**改动点**：
1. **新增 akshare 财务导入脚本**：获取三大报表数据，建立中文财务指标 → `LINE_ITEMS` 映射：

   | 中文报表指标 | LINE_ITEM |
   |-------------|-----------|
   | 营业收入 / 营业总收入 | Revenue |
   | 毛利润 / 营业毛利 | GrossProfit |
   | 营业利润 / 营业利润（亏损） | OperatingIncome |
   | 净利润 / 归属于母公司净利润 | NetIncome |
   | 经营活动产生的现金流量净额 | OperatingCashFlow |
   | 资产总计 / 总资产 | TotalAssets |
   | 负债合计 / 总负债 | TotalLiabilities |
   | 所有者权益合计 / 归属于母公司股东权益 | ShareholdersEquity |
   | 基本每股收益 | EPSBasic |
   | 稀释每股收益 | EPSDiluted |

2. **货币单位处理**：`Financial.unit` 增加 `'CNY'` / `'HKD'`，前端展示时标注货币。
3. **财年对齐**：A 股/港股以日历年度为准，`periodEnd` 统一为 `12-31`。
4. **存储**：复用现有 `Financial` 表结构，不新建表。

**数据源优先级**：akshare 为主，Tushare Pro 作为备选。

#### Phase 3：年报原文（较复杂，可选，暂缓）

**目标**：年度报告 tab 能阅读年报。

**方案 A（轻量，推荐）**：直接外链到巨潮资讯网/披露易的 PDF，不做本地存储和解析。

**方案 B（重量）**：
- A 股：下载 PDF → OCR/文本提取 → 按章节切分（需 NLP 或规则匹配，因为 A 股年报结构不统一）。
- 港股：类似处理。

**建议**：Phase 1 和 2 完成后上线。A 股用户更习惯直接看东方财富/同花顺的年报，本地阅读体验不是刚需。

### 技术方案

#### 数据库改造（最小改动）

```prisma
model Entity {
  id            String   @id @default(cuid())
  type          String   // 'company' | 'security' | 'master' | 'concept'
  market        String   @default("us") // 'us' | 'cn' | 'hk'
  canonicalName String
  aliases       String[] @default([])
  cik           String?  @unique // SEC 特有，A 股/港股为 null
  code          String?  // A 股/港股数字代码，如 '600519'、'9992'
  // ... 其他字段不变
}
```

- `cik` 保持 unique，但改为 nullable。
- 新增 `code` 字段（不设置 unique，因为同一公司可能在多个市场上市）。
- 新增 `market` 字段区分市场，用于路由解析和展示逻辑。

#### URL 路由改造

公司页路由从 `/company/[cik]` 泛化为 `/company/[id]`，解析逻辑：

```typescript
function parseCompanyId(raw: string): { market: string; identifier: string } | null {
  if (raw.startsWith("CIK")) {
    return { market: "us", identifier: raw.replace(/^CIK0*/, "") };
  }
  const cnMatch = raw.match(/^cn-(\d{6})$/);
  if (cnMatch) return { market: "cn", identifier: cnMatch[1] };
  const hkMatch = raw.match(/^hk-(\d{4,5})$/);
  if (hkMatch) return { market: "hk", identifier: hkMatch[1] };
  return null;
}
```

查询逻辑：
- US：`where: { cik: identifier }`
- CN/HK：`where: { market, code: identifier }`

#### 财务数据导入（新增脚本）

新增 `scripts/import-cn-financials.ts`：

```typescript
// 伪代码
const MAPPING = {
  "营业收入": "Revenue",
  "营业总收入": "Revenue",
  "净利润": "NetIncome",
  // ...
};

// 1. 用 akshare 获取三大报表
// 2. 按年份归集
// 3. 映射到 LINE_ITEMS
// 4. 写入 Financial 表（unit = 'CNY' 或 'HKD'）
```

#### 前端适配

- 公司页概览区：根据 `market` 动态展示字段（US 显示 CIK，CN/HK 显示市场代码）。
- 财务分析 tab：货币单位展示为 `¥ xxx 亿`（CNY）或 `HK$ xxx 亿`（HKD），与 USD 区分。
- 年度报告 tab：CN/HK 公司显示 "年报原文暂未接入" 占位，附外链到巨潮/披露易。

### 首批目标公司

| 公司 | 市场 | 代码 | Yahoo Ticker | 选择理由 |
|------|------|------|-------------|---------|
| 贵州茅台 | A 股（上交所） | 600519 | 600519.SS | 品牌价值极高，财务数据完整，akshare 接口稳定 |
| 泡泡玛特 | 港股（港交所） | 9992 | 9992.HK | 新消费代表，港股数据验证 akshare 港股能力 |

### 成功标准

- Phase 1：能访问 `/company/cn-600519` 和 `/company/hk-9992`，页面不报错，展示中文公司名、行业、交易所、股价走势图。
- Phase 2：财务分析 tab 展示 5 年财务趋势，指标与美股公司统一口径，货币单位正确标注。
- Phase 3（可选）：年度报告 tab 至少提供外链到官方 PDF。

### 与现有系统的兼容性

- 所有改动向后兼容：US 公司的 CIK 路由、查询逻辑、财务导入链路完全不受影响。
- `Financial` 表已有 `unit` 字段，支持多货币无需改表。
- `StockPrice` 表以 `ticker` 为 key，Yahoo Finance 的 A 股/港股 ticker 可直接入库。
- 公司页 6-tab 结构不变，仅内容层根据 `market` 做条件渲染。

---

## 设计与技术基线

### 设计语言

Apple HIG 精简风格：
- 白色卡面 `#ffffff`，浅灰底 `#f5f5f7`，header/tabbar 用 `#fbfbfd`
- `0.5px` border，无重阴影
- 6 等分 Tab 网格，文字居中，蓝色底线标记激活态
- 全站单一字体栈：`system-ui, -apple-system, Helvetica Neue`

### 技术栈

| 层 | 选型 |
|----|------|
| 前端 | Next.js 16 App Router · TypeScript · React |
| 样式 | 手写 CSS（globals.css），无 Tailwind |
| 数据库 | PostgreSQL via Prisma (Supabase) |
| AI | OpenAI-compatible Chat API（对话 + 分析生成）· Langfuse 观测 |
| 持仓数据 | SEC EDGAR 13F-HR |
| 财务数据 | SEC EDGAR XBRL（CompanyFacts + filing-level inline XBRL fallback） |
| 原始文件 | Cloudflare R2（PDF、SEC filing HTML、index、附件、data files） |
| 图谱 | Neo4j（关系检索与检索对比实验） |
| 市场数据 | Yahoo Finance 导入脚本 + `StockPrice` |
| 产品分析 | PostHog（前端事件，仍在补齐事件体系） |
| 认证 | NextAuth.js |
| 部署 | Vercel |

### 路由结构

```
/                   首页（信号流 + 大师入口 + Hero Search）
/master/[id]        大师主页（资料库卡片 + 持仓）
/master/[id]/library  资料阅读（左侧年份/文章列表，右侧正文）
/master/[id]/holdings 持仓快照
/company/[id]       公司研究画布（id 格式：CIK... / cn-600519 / hk-9992）
/company/[id]/annual-report  年度报告默认入口（跳转到最新可读年份）
/company/[id]/annual-report/[year]  年度报告阅读
/idea               对话研究室（左：对话，右：Canvas）
/login              登录
/reset-password     重置密码
/retrieval-compare  检索对比实验页
/documents/*         PDF 全屏阅读器（年度会议、书籍、演讲、文章）
```

---

## 当前实现状态（v0.37.0）

### v0.37.0 变更（计划中）

- **A 股与港股覆盖扩展**：新增 `Entity.market` 和 `Entity.code` 字段，支持 A 股（cn-600519）和港股（hk-9992）公司接入。
- **公司页路由泛化**：`/company/[cik]` 改为 `/company/[id]`，支持 `CIK...`、`cn-...`、`hk-...` 三种标识格式。
- **akshare 数据接入**：新增 A 股/港股公司基础信息和财务数据导入脚本。
- **多货币财务展示**：`Financial` 表支持 `CNY` / `HKD` 单位，前端按市场展示对应货币符号。

### v0.36.7 变更

- **40-F 附件章节分类修正**：`scripts/import-10k-xbrl.ts` 不再用整份附件正文做章节分类，避免 AIF / 认证附件中的交叉引用被误判为 MD&A、披露控制或内控报告。
- **40-F 重导入清理**：重新导入时会清理已经不再匹配的 attachment-derived 章节，避免旧错误章节留在库里。
- **BN 40-F 验证**：2020-2025 年 40-F 已重跑导入，目录与右侧内容对齐，仅保留 AIF、MD&A、certifications 等实际附件章节。

### v0.36.6 变更

- **年报阅读体验修正**：10-K / 20-F / 40-F 阅读页始终展示标准目录；右侧只展示对应已抽取原文内容，不再显示“未抽取 / 打开 SEC 原文”。
- **公司页入口改名**：公司页面 `参考资料` tab 改为 `年度报告`。
- **年度报告优先级**：年报入口优先选择非 amended filing，避免默认落到 `/A` 修正版。
- **40-F 附件抽取增强**：导入脚本支持从 40-F 的 `EX-99` 附件抽取年报结构化章节。

### v0.35.28 变更

- **Entity / Security 架构重构完成**：移除 `type='security'` 的冗余 Entity 层，统一通过 `Security` 表管理证券。
  - `Holding.securityEntityId` 列删除，`Holding.securityId` 改为 required（非空）。
  - `Security.entityId` 列删除，Security 只通过 `companyEntityId` 关联 Company Entity。
  - `Holding` 的 relation 从 `securityProfile` 改名为 `security`，`onDelete: SetNull` 改为 `Cascade`。
  - `import-13f.ts` 不再创建 `type=security` Entity，不再写入已删除字段。
  - 删除 5 个旧迁移脚本：`backfill-security-table`、`migrate-company-securities`、`cleanup-duplicate-security-entities`、`cleanup-duplicate-security-profiles`、`cleanup-duplicate-company-entities`。
  - 清理 139 个遗留的 `type=security` Entity。
  - 新增 migration `20260525000100_remove_security_entity`。
  - `scratch/` 和 `scripts/` 排除在 tsconfig 编译外，避免草稿脚本影响 build。
- **关系抽取表下线**：删除未接入运行面的 `Mention` 与 `EntityRelation` 表。
  - Postgres 不再保留一套未使用的关系层。
  - 图谱查询与关系检索统一以 Neo4j 为准。
  - 新增 migration `20260526000100_drop_mention_entity_relation`。

### v0.35.20 变更

- **Master 最新持仓图可点击**：左侧 Top10 横向图的公司名链接到对应 company 页面，并保持与持仓明细一致的紧凑视觉样式。
- **最新持仓图“其他”口径修正**：从第 11 名以后实际持仓占比求和，不再用 `100% - Top10` 吸收四舍五入误差。
- **关键案例名称纠偏**：大师关键案例公司名优先使用最新持仓主数据元信息，修正 EWBC 显示为“华美银行”。

### v0.35.19 变更

- **全站 Header 改版**：桌面端 logo 靠左、登录靠右、三位大师入口居中；移动端保留三位大师入口在第二行。

### v0.35.18 变更

- **公司页持仓活动修正**：重新建仓的股票只与紧邻上一期 13F 比较，避免 Buffett DAL 这类多年后重新买入被误判为减仓。

### v0.35.17 变更

- **PDF 阅读器导航增强**：精简工具栏、持久化 fit width/fit height、页码跳转、缩略图/目录侧栏、目录跟随高亮、返回资料库链接。

### v0.35.6 变更

- **文档路由统一**：Buffett PDF 从 `/documents/annual-meeting/unscripted` 迁到 `/documents/buffett/unscripted`，与 duan/lilu 统一为 `/documents/[owner]/[slug]` 模式
- 删除旧的硬编码 annual-meeting 页面和 API 路由

### v0.35.5 变更

- **PDF 存储迁移到 Cloudflare R2**：文档 PDF 从本地 `data/` 迁移到 R2（`ai-pulse/buffett-tribe/`），API 路由改为 S3 流式代理。解决 Vercel 部署无本地文件的 404 问题，后续加文档不需要重新部署
- **新增 `src/lib/r2.ts`**：封装 S3Client + `uploadToR2()` + `getR2Stream()`
- **新增 `scripts/upload-documents-to-r2.ts`**：一次性迁移脚本

### v0.35.4 变更

- **Master 资料库卡片化**：资料库区域统一使用 `document-card` 卡片，badge 按分类（信件/书籍/演讲/文章/视频），年份区间移入标题括号，点击直达 PDF 全屏阅读器
- **李录资料库上线**：新增 4 份文档 — 2 篇演讲（全球价值投资与时代 2024.12、价值投资在中国 2015.10）、2 篇文章（李录谈现代化 2018.12、李录谈现代化全文 2014.7）
- **首页部落成员卡片改版**："资料库" 和 "最新持仓" 链接统一锚定到 `/master/[id]#library` 和 `/master/[id]#holdings`
- **信件阅读页精简**：移除分类标签（信件/文章/书籍/视频/文档）和 "← 返回" 按钮，sidebar 头部 "大师 · 资料库" 改为可点击返回链接
- **PDF 阅读器统一**：所有 PDF 阅读页（buffett unscripted、duan 书籍、lilu 文档）统一为全屏 iframe，去除 intro 和按钮层

### 功能状态

| 功能 | 状态 |
|------|------|
| /master 大师页面 | ✅ 已上线 |
| /idea 对话界面 | ✅ 已上线 |
| /company/[cik] 公司页 | ✅ 已上线 |
| Company Canvas（6 Tab UI） | ✅ 已实现 |
| 年度报告 Tab | ✅ 已上线 |
| 10-K / 20-F / 40-F 标准目录阅读 | ✅ 已上线 |
| 价格历史图 | 🟡 已上线 ticker 口径，securityId 与事件 marker 待补 |
| ChatMessage 对话记录 | ✅ 已实现 |
| 对话评分 | ✅ 已实现 |
| PostHog 前端埋点 | 🟡 已接入 provider 与 chat_sent，事件体系待补齐 |
| 等候名单 | ✅ 已实现 |
| 数字人 / 语音实验 | 🟡 有 API 与数据模型，入口仍是实验态 |
| Company Analysis 批量入库 | ✅ 已实现 |
| Canvas 实时生成（RAG → AI） | 🟡 部分实现，仍在迭代 |
| Company Brain 写回 | 🟡 部分实现 |
| Fact Fetch Pipeline | 🟡 已有批处理脚本，持续补齐 |
| 持仓数据更新 | 🟡 以季度批处理为主 |

### 已完成基础能力

- Prisma Schema（Letter, Chunk + 用户模型）
- 数据导入：60 封股东信 + 约 30 封合伙人信，1413 chunks
- 主页年份列表 + 动态信件页 `/letters/[type]/[year]`
- NextAuth 认证（Credentials）
- 移动端响应式、暗黑模式持久化、错误边界
- 对话 API `/api/chat`：混合检索 + RAG + 引用来源 + 每日限额
- 巴菲特人格 Prompt
- SSE 流式输出
- 混合检索：tsvector + pgvector (1024-dim HNSW)
- 后端主导引用机制
- ChatMessage 对话记录入库、历史读取、回答后评分
- PostHog 前端 provider 与 `chat_sent` 事件
- WaitlistEntry 候补名单 API
- 阅读页：`contentMd` 直接渲染，中英交替 + 单语过滤
- 代码清理：删除 Section 及依赖代码
- Phase A：数据模型重构 Letter → Source（v0.13.0）
- Phase B：股东大会数据导入（v0.15.0-v0.16.1）
- Phase C：统一工作区（v0.14.0）
- Phase R：检索架构 v2（Query Understanding、并行双路检索、融合重排、query-aware 引用摘取、Evidence Plan、检索范围配置、离线评测集）
- `ExtSource` 同一份 SEC filing 重复 ingest 已根治（2026-05-31）：新增 `accessionNumber` 唯一约束，导入脚本以 `(filerEntityId, accessionNumber)` 去重，历史重复数据已合并清理。
- `FilingArtifact` 已用于 SEC filing 原始 HTML、index、附件和 data files 的 R2 归档。
- `StockPrice`、`/api/price/[ticker]`、`StockPriceChart` 与 Yahoo Finance 导入脚本已形成价格数据最小闭环。

### 当前工作队列

目标：完整的对话 + 阅读体验 + 数据追踪 + 支付链路，可以交给种子用户。

#### 收尾任务

- 对话质量验收：准备 30 个测试问题，验证检索召回率和引用命中率（范围：股东信 + 合伙人信）。
- 移动端体验打磨：阅读页、工作区在手机上的交互细节。

#### 用户数据 + 增长 / 商业化

- 补齐关键事件埋点：`chat_start`、`chat_message`、`source_click`、`annual_report_open`、`price_range_change` 等。
- PostHog Cloud 中国可达性测试。
- LemonSqueezy 订阅集成。
- 订阅状态校验：免费 vs 会员的次数限制。
- 验证完整的免费到付费转化链路。

#### Post-MVP

- 视频播放页：embed 播放器 + 转录文本。
- 首页视频分区。
- 工作区 Canvas 支持视频内容。
- 公开文章 + 采访资料导入。
- 多轮对话上下文。
- 首页对话入口。
- 对话分享。
- 主题时间线。
- 探索页 `/explore`。
- 热门话题标签。
- 数字人 / 语音实验产品化：补齐 `/avatar` 当前跳转目标、实时语音房间入口、失败降级和成本控制。
- 年度背景卡片。
- SEO 优化。
- 测试覆盖率目标 >80%。

#### 待调研

- 虚拟人 API 效果评估。
- 声音克隆合规性。

---

## 数据字典与工程口径

本节是项目内 13F / 10-K / 20-F / 40-F / XBRL / 价格数据导入与展示的统一术语口径。对外术语以 SEC / Investor.gov 等官方定义为准，项目内字段以 `prisma/schema.prisma` 为准。

### 证券与主体标识

| 术语 | 含义 | 示例 | 项目口径 |
|------|------|------|----------|
| `Ticker` | 股票交易代码，用于在交易所识别证券 | `AAPL`, `MCO`, `SPGI` | 主要用于展示、搜索和价格数据初期导入，不作为稳定主键 |
| `CUSIP` | 9 位证券标识码，用于唯一识别多数美加证券 | `037833100` | 存在于 `Security.cusip`，适合 13F 证券归并 |
| `CIK` | SEC 分配给 EDGAR 申报主体的唯一编号 | `0001067983` | 存在于 `Entity.cik`，用于统一 EDGAR / 13F / company 页面 |
| `Market` | 公司所属市场 | `us`, `cn`, `hk` | 存在于 `Entity.market`，决定标识体系和数据来源 |
| `Code` | A 股/港股数字代码（不含后缀） | `600519`, `9992` | 存在于 `Entity.code`，与 `market` 组合查询 |
| `Accession Number` / `accno` | EDGAR 单次申报的唯一受理号 | `0001193125-26-226661` | 存在于 `ExtSource.accessionNumber`，与 `filerEntityId` 组成唯一约束 |

快速辨析：

- `AAPL` 是 `Ticker`，不是 `CUSIP`。
- `CUSIP` 通常是 9 位字母数字组合；`Ticker` 通常是 1-5 位交易代码。
- 同一公司可能存在多个证券代码或多个 share class，分析和去重时应优先用项目内 `securityId`，不要只看 `ticker`。

### 报表与数据来源

| 术语 | 含义 | 项目用途 |
|------|------|----------|
| `13F-HR` | 机构投资管理人季度持仓申报表 | 生成大师持仓、持仓变化、组合权重 |
| `10-K` | 美国上市公司年度报告 | 年报阅读、XBRL 财务事实、章节抽取 |
| `20-F` | 外国私人发行人年度报告 | 年报阅读、XBRL 财务事实、章节抽取 |
| `40-F` | 加拿大公司等外国私人发行人年度报告 | 年报阅读，重点依赖 `EX-99` 附件抽取 AIF / MD&A 等章节 |
| `年报 (A 股)` | A 股上市公司年度报告（PDF） | 年报原文阅读（Phase 3 可选），来源：巨潮资讯网 |
| `年报 (港股)` | 港股上市公司年度报告（PDF） | 年报原文阅读（Phase 3 可选），来源：港交所披露易 |
| `XBRL` | 结构化财报标记语言 | `FinancialFact` 原始事实层和 `Financial` 标准化项目（仅美股） |
| `EDGAR` | SEC 披露系统 | filing discovery、submissions、companyfacts、原文归档 |
| `akshare` | 中文金融数据 Python 库 | A 股/港股公司信息、财务报表、股价数据获取 |

### 时间字段

| 字段 | 含义 | 示例 | 所属模型 |
|------|------|------|----------|
| `asOfDate` | 持仓生效报告日，通常对应报告期末 | `2026-03-31` | `Holding.asOfDate` |
| `filedAt` | 向 SEC 实际提交日期 | `2026-05-15` | `ExtSource.filedAt` / `FinancialFact.filedAt` |
| `periodYear` | 报告期年份 | `2026` | `ExtSource.periodYear` |
| `periodQuarter` | 报告期季度 | `1` | `ExtSource.periodQuarter` |
| `FY` / `Q1..Q4` | 财报周期类型 | `FY`, `Q1` | `Financial.periodType` |
| `date` | 价格数据交易日 | `2026-05-29` | `StockPrice.date` |

### 数值字段

| 字段 | 含义 | 示例 | 所属模型 |
|------|------|------|----------|
| `shares` | 持股数量 | `1200000` | `Holding.shares` |
| `valueUsd` | 持仓市值，美元 | `350000000` | `Holding.valueUsd` |
| `percentOfPortfolio` | 该标的占组合比例 | `12.4` | `Holding.percentOfPortfolio` |
| `value` / `valueRaw` | XBRL 事实数值与原始字符串 | `391035000000` | `FinancialFact` |
| `open/high/low/close/volume` | 日线价格 OHLCV | `open=190.1` | `StockPrice` |

### 稳定主键原则

- 13F 导入与增量对比的工程主键使用 `Holding.securityId`；`ticker` 主要用于展示和价格图早期查询。
- `Security` 通过 `companyEntityId` 关联公司实体；同一公司可以有多个 `Security`。
- `ExtSource` 对 SEC filing 使用 `(filerEntityId, accessionNumber)` 去重，避免同一份 filing 重复入库。A 股/港股暂无 filing 归档，ExtSource 相关表对其不适用。
- 文本关系抽取当前不再落到 Postgres 表；`Mention` 和 `EntityRelation` 已移除，关系检索统一走 Neo4j 图谱链路。
- 原始 filing 文件通过 `FilingArtifact` 归档到 R2，结构化事实和章节通过 `FinancialFact` / `FilingSection` 保留可追溯数据。
- 非美市场公司的查询主键：`{ market, code }` 组合（A 股/港股），`{ cik }` 继续用于美股。URL 路由层统一解析为 `companyId`，下游按 `market` 分发查询策略。

---

## 公司页财务看板：truth-of-source 设计

公司页财务看板要以 SEC 10-K / 20-F / 40-F 的 XBRL 原始事实为事实来源，不把推导值伪装成申报值。目标是专业、可解释、可追溯。

### 当前状态

- 页面数据来自数据库 `Financial` 表，通过 `src/lib/company-data.ts#getCompanyFinancials()` 读取。
- 导入链路为 `scripts/pipeline-10k.ts` -> `scripts/import-10k-from-13f.ts` -> `scripts/import-10k-edgartools.ts`，共享入库逻辑在 `scripts/lib/annual-report-import-core.ts`。
- 数据源优先级：SEC CompanyFacts API -> filing-level inline XBRL fallback。
- 当前 `Financial.lineItem` 已覆盖通用公司常用项目：`Revenue`、`GrossProfit`、`OperatingIncome`、`NetIncome`、`OperatingCashFlow`、`TotalAssets`、`TotalLiabilities`、`ShareholdersEquity`、`EPSBasic`、`EPSDiluted`。
- `—` 不等于全部“没有数据”：可能是导入映射未覆盖、行业不适用、历史不足，或可由已有项目推导但当前尚未推导。

### 分层原则

```text
Raw facts 原始事实
  ↓
Normalized statement items 标准化财务项
  ↓
Derived metrics 派生指标 / 看板指标
```

1. **Raw facts**：SEC 原始 XBRL fact，例如 `us-gaap:NetIncomeLoss`、`us-gaap:InterestAndDividendIncomeOperating`。
2. **Normalized items**：项目统一口径，例如 `Revenue`、`NetIncome`、`TotalAssets`、`InterestIncome`。
3. **Derived metrics**：明确公式的派生指标，例如 `GrossMargin = GrossProfit / Revenue`、`ROE = NetIncome / AverageEquity`。

任何派生指标都必须能说明：公式、输入项目、期间、来源文件、置信度。

### 数据口径规则

- 原始申报值优先于派生值。
- 派生值不能覆盖原始申报值，必须标记为 `derived`。
- 行业不适用的指标应显示为“不适用”或切换为行业专属指标，而不是显示 `—`。
- 如果可从同一期已报告项目稳健推导，例如 `TotalLiabilities = TotalAssets - ShareholdersEquity`，可以派生，但要标记公式。
- ROE / ROA 优先使用平均资产或平均权益；如果历史不足只能用期末值，必须降级置信度或注明。
- 5 年 CAGR 只有在历史期数足够时显示；历史不足不是数据错误。

### 行业感知看板

通用工业/科技/消费公司：

- 营收
- 毛利率
- 营业利润率
- 净利率
- ROE
- 经营现金流
- 5 年营收 CAGR
- 摊薄 EPS

银行：

- 总收入或净收入（按银行口径）
- 净利润
- ROE
- ROA
- 资产负债比
- 非息收入占比
- 效率比率
- 摊薄 EPS

银行优先补充的 XBRL 标签：

- `InterestAndDividendIncomeOperating`
- `InterestIncomeOperating`
- `InterestExpense`
- `NoninterestIncome`
- `NoninterestExpense`
- `ProvisionForLoanLeaseAndOtherLosses`
- `IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest`

保险后续单独建模板，优先考虑保费收入、投资收益、承保利润/Combined Ratio、投资资产、股东权益、ROE、EPS。

### 建议实现路线

#### Phase 1：页面层专业化

- 新增财务指标构建函数，例如 `buildCompanyFinancialDashboard(company, financials)`。
- 根据 SIC / sector / industry 选择 `general`、`bank`、`insurance`、`financial` 模板。
- 页面不再硬编码一套 `cards` 适配所有行业。
- `—` 的内部状态区分为：`missing`、`not_applicable`、`not_enough_history`、`derived_low_confidence`。
- 看板卡片保留简洁展示，但 hover / hint 说明公式和来源口径。

#### Phase 2：扩展 SEC XBRL 映射

- 把 `scripts/lib/annual-report-import-core.ts` 的 line item 映射配置化，按行业选择 mapping rules。
- 补银行、保险、金融服务常见标签。
- 重新跑重点持仓公司 2020 至最新 FY 的导入。
- 扩展 `check:financial:integrity`，从“是否有 FY 数据”升级为“按行业检查核心指标覆盖率”。

#### Phase 3：派生指标层

短期可先在页面/lib 层纯函数计算，不急于建表。中长期新增派生指标记录：

```text
FinancialMetric
- entityId
- metric
- value
- unit
- periodEnd
- fiscalYear
- formula
- inputItemIds
- sourceType: reported | derived
- confidence
- qualityNotes
```

#### Phase 4：原始事实层与血缘

如果要做到可审计，新增原始事实表：

```text
FinancialFact
- entityId
- sourceId
- taxonomy
- concept
- value
- unit
- periodType
- startDate
- endDate
- fiscalYear
- fiscalPeriod
- accession
- filedAt
- contextId
- segmentJson
- rawJson
```

页面上的每个数字最终都应该能解释：来自哪个 10-K、哪个 XBRL tag、哪个期间、是否派生、公式是什么。

### 用户体验原则

- 看板优先显示“对这个行业有意义”的指标，不为了填满而填满。
- 不适用的指标不要以错误感很强的 `—` 呈现。
- 来源解释默认收起，用户需要时可展开。
- 专业性来自“有口径、有来源、有置信度”，不是指标越多越好。

---

## 数据与脚本

脚本现在比较多，按职责分组如下。日常维护优先走这些命令，而不是直接改库。

### 导入

- `npm run import:13f` / `npm run import:13f:range`：导入 13F 持仓
- `npm run import:10k`：按 ticker / 年份导入 10-K、20-F、40-F 财务数据
- `npm run import:cn-financials`：按 code / market 从 akshare 导入 A 股/港股财务报表（新增）
- `npm run import:cn-company-info`：从 akshare 获取 A 股/港股公司基础信息并写入 Entity（新增）
- `npm run import:stock-prices:yf`：按 ticker 从 Yahoo Finance 拉取日线价格，可选择写入 `StockPrice`
- `npm run import:company-stock-prices:yf`：按公司批量补齐价格数据
- `npm run import:10k:from13f`：从 13F 持仓反推需要补齐的公司财务
- `npm run pipeline:13f` / `npm run pipeline:10k`：完整流水线封装

### 回填与修复

- `npm run backfill:security:company-links`：把 security 重新挂到正确 company
- `npm run backfill:company:profiles`：补公司 profile 元数据
- `npm run backfill:names`：补中文名 / 英文短名
- `npm run sync:company-name-map`：让 `company_name_map` 跟实体数据对齐
- `npm run generate:home-signals`：生成首页 3 条信号快照

### 巡检

- `npm run check:security:integrity`：检查 security 关联完整性
- `npm run check:financial:integrity`：检查财务数据完整性
- `npm run check:db`：数据库健康检查
- `scripts/check-all-company-financials.ts`：全量公司财务巡检

### 自动补齐

- `npm run generate:master-profile`：生成并入库大师主页画像 `MasterProfile`
- `npm run generate:portfolio-insight`：生成并入库季度持仓点评 `PortfolioInsight`
- `npm run generate:company-profile`：批量生成并入库公司基本信息
- `npm run generate:business-model`：批量生成并入库业务概览与商业画布
- `npm run generate:value-analysis`：批量生成并入库价值分析
- `scripts/import-10k-edgartools.ts`：用 edgartools 获取 annual filing，支持 `companyfacts + filing-level inline XBRL fallback`，并归档 SEC 原始文件到 `FilingArtifact`
- `scripts/import-cn-financials.ts`：akshare 财务数据导入，含中文指标 → LINE_ITEMS 映射，支持 CNY/HKD 单位写入
- `scripts/import-cn-company-info.ts`：akshare 公司信息导入，创建/更新 A 股/港股 Entity，自动翻译中文名

### 实验与基准

- `scripts/eval-*.ts`：检索与 MVP 评测
- `scripts/neo4j-*.ts`：图谱抽取、导入、演练
- `scripts/bench-live-asr-*.ts` / `scripts/test-volc-asr.mjs`：语音链路实验
- `/api/asr/*`、`/api/tts`、`/api/digital-human/jobs/*`：语音与数字人实验 API

### 维护原则

- 先跑巡检，再跑修复，最后才考虑手工改库
- 只要能写成脚本，就不要在数据库里临时补
- 新脚本优先挂到 `package.json`，避免隐蔽入口继续增加

---

## 运维速查表

### 最常用

- `npm run import:13f`
- `npm run import:10k -- --ticker TME --from 2025 --to 2025`
- `npm run import:stock-prices:yf -- --ticker AAPL --start 2020-01-01 --import-db`
- `npm run import:company-stock-prices:yf -- --batch-size 10 --start 2020-01-01`
- `npm run generate:master-profile -- --master buffett`
- `npm run generate:portfolio-insight -- --master buffett`
- `npm run generate:company-profile -- --company AAPL --force`
- `npm run generate:business-model -- --company AAPL --force`
- `npm run generate:value-analysis -- --company AAPL --force`
- `npm run generate:home-signals`
- `npm run import:cn-company-info -- --market cn --code 600519`
- `npm run import:cn-financials -- --market cn --code 600519 --years 5`

### 数据修复

- `npm run backfill:security:company-links`
- `npm run sync:company-name-map`
- `npm run backfill:company:profiles`
- `npm run backfill:names`

### 巡检

- `npm run check:security:integrity`
- `npm run check:financial:integrity`
- `npm run check:db`
- `scripts/check-all-company-financials.ts`

### 规则

- 先查缺口，再补数据，再做手工修正
- 13F / 10-K / master profile / portfolio insight / analysis / business canvas 的批处理都优先脚本化
- 数据源优先级：`companyfacts` -> filing-level inline XBRL -> 手工修复
- 首页信号由脚本产出快照，页面只读快照，不在页面里现算
- 主入口脚本编号总览见 [scripts/README.md](/Users/rafael/R129/buffett-tribe/scripts/README.md)

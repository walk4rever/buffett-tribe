> 🔒 内部文件，不对外公开。

# 巴菲特部落 · Buffett Tribe — 产品设计文档

> 最后更新：2026-05-22（v0.35.4）

---

## 产品定位

**买股票就是买公司。巴菲特部落用价值投资大师的框架帮你理解一家公司。**

用户来这里不是为了读懂巴菲特，而是为了用巴菲特的方式看一家公司：
护城河在哪里？管理层可信吗？现在的价格有安全边际吗？

大师原文、13F 持仓、财务数据——这些是分析的燃料，不是产品的终点。

---

## 三个核心页面

```
/master   大师         巴菲特、李录、段永平的信件、演讲、持仓
/company  公司         任意一家公司的研究画布（Canvas）
/idea     对话研究室    与大师思想对话，自动触发公司分析
```

### /master — 大师

价值投资大师的原始资料库：股东信、合伙人信、演讲、访谈。每位大师有独立页面，展示材料列表与 13F 持仓快照。材料全文可阅读，可跳转到 /idea 继续追问。

### /company — 公司

任意一家公司的研究画布。Canvas 用五维框架结构化呈现：

| Tab | 内容 |
|-----|------|
| 概览 | 公司名、股票代码、市场、商业模式 |
| 财务 | 核心财务指标（营收、毛利率、ROIC 等）+ 趋势 |
| 好生意 | 护城河 · 可理解性 · 持久性 — 结论 + 支持/反方证据 + 置信度 |
| 好管理 | 资本分配 · 诚信 · 股东利益一致 |
| 好价格 | 内在价值 · 安全边际 · 赔率 |
| 研判 | 当前投资决策状态 + 参考来源 + 待验证问题 |

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

## 下一步：问答 / 逐字稿结构层

我们现在已经有了年会 PDF 和初步提取出的 md，但这类资料的本质不是普通长文，而是“按主题组织的问答/逐字稿索引”。

以 `Buffett-and-Munger-Unscripted` 为例，资料里同时包含：
- 主题分组
- 年份 / 场次
- 说话人
- 视频时间点
- 原始段落文本

这意味着它不适合只作为普通 `Source -> Chunk` 文本直接吞入。更合理的方向是新增一个通用的结构层，用来承载“对话 / 问答 / 访谈 / 逐字稿”这类内容形态，而不是做成 Buffett 年会专用表。

### 设计原则

- `Source` 继续表示原始资料文件
- `Chunk` 继续负责全文检索和语义检索
- 新增一张通用结构表，负责“问答片段 / 逐字稿片段”的导航信息
- 这个结构层要同时兼容：
  - 巴菲特股东大会
  - 段永平问答录
  - 访谈
  - 公开视频字幕 / 逐字稿

### 新表要表达的信息

- 属于哪个源文档
- 属于哪个人物 / 活动
- 哪一年 / 哪一场
- 主题
- 说话人
- 问题 / 回答 / 陈述
- 时间点或页面位置
- 原始内容文本

### 下一步建议

1. 先抽一版通用 schema，优先覆盖 `annual_meeting` 和段永平这类问答材料。
2. 导入时保留 raw md，另写结构化片段表，不要把元数据继续塞进普通正文。
3. 页面层再决定怎么展示主题目录、时间锚点和跳转能力。

---

## 下一步：PDF 原文阅读层

未来产品的大头会落在**公司的年度报告**，所以 PDF 阅读不是附属功能，而是底层能力。我们需要先把“原始 PDF 能在 Web 上稳定阅读”这件事跑通，再往上叠加 transcript、章节索引和中文辅助层。

### 设计原则

- 先支持原始 PDF 直读，再做结构化抽取
- PDF 阅读器负责“看原文”
- transcript / 逐字稿表负责“主题、说话人、时间点、页码锚点”
- 这两层可以并行推进，不互相阻塞

### 最小可用目标

- 能在 Web 上打开 PDF
- 能翻页、缩放、适配桌面与手机
- 能保留浏览器原生的复制 / 选择能力，后续再考虑 `pdf.js`
- 先用 `Buffett-and-Munger-Unscripted.pdf` 做样例

### 后续扩展方向

- 年度报告 PDF 阅读
- 章节索引与页码跳转
- 中文辅助阅读层
- 与 `TranscriptSegment` / `QAItem` 的联动导航

---

## 下一步：统一 Document System

我们现在面对的不是单一 PDF，而是两大类内容体系：

1. **公司研究文档**
   - 未来的大头是每年的财报，通常是 PDF。
   - 用户需要阅读原文，AI 需要做结构化解读。
   - 重点能力是章节、页码、表格、脚注、风险因素、MD&A。

2. **大师资料文档**
   - 现在 `master` 下的资料来源比较杂：股东信、年会问答录、书籍 PDF、文章、访谈、Markdown。
   - 用户同样需要阅读原文，AI 也需要深度解读，但不同文档类型的阅读方式不一样。

所以下一步不应该继续按“页面类型”拆，而应该统一成一个 **Document System**。

### 分层定义

- `library`：书架和目录，负责找资料
- `document`：资料对象，负责读原文和看 AI 解读
- `source`：原始文件层，负责真相和溯源
- `segment`：结构化片段层，负责理解和跳转
- `analysis`：AI 解读层，负责摘要、论点、主题、待追问问题

### 核心原则

- 不要让 `library` 承担正文渲染责任
- 不要把文件路径当成公开路由的核心对象
- 不要把不同资料类型硬塞进同一种正文展示逻辑
- 文档对象要统一，渲染方式可以多样

### 两大类文档怎么落地

#### 公司研究文档

- 原文 PDF 是 source of truth
- 自动抽章节和页码锚点
- 表格单独识别
- AI 解读按章节进行，而不是整份文件一锅炖

#### 大师资料文档

- 股东信、年会、问答录、访谈、书籍、文章都归到 `Document`
- Markdown 是一种 rendition，PDF 也是一种 rendition
- 问答录需要额外保留 speaker / topic / timecode / page 这类结构信息
- AI 解读要按文档类型切换 prompt，而不是一套 prompt 走天下

### 用户路径

1. 先在 `library` 找到资料
2. 点进去进入 `document`
3. `document` 左边看原文，右边看目录和 AI 解读
4. `source` 只作为溯源和原始文件入口，不直接成为主要用户路径

### 目标效果

- 公司财报和大师资料用同一套底层
- 不会因为文件类型多就越做越乱
- AI 深度解读可以复用同一套结构化上下文
- 后续加新资料类型，不需要再发明新页面

### 建议 schema

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

### 关系约束

- 一个 `library` 包含多个 `document`
- 一个 `document` 可以有多个 `rendition`
- 一个 `document` 可以拆成多个 `segment`
- 一个 `document` 可以有多份 `analysis`
- `segment` 不负责展示整份原文，只负责导航、理解和高亮

### 迁移原则

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

## 设计语言

Apple HIG 精简风格：
- 白色卡面 `#ffffff`，浅灰底 `#f5f5f7`，header/tabbar 用 `#fbfbfd`
- `0.5px` border，无重阴影
- 6 等分 Tab 网格，文字居中，蓝色底线标记激活态
- 全站单一字体栈：`system-ui, -apple-system, Helvetica Neue`

---

## 技术栈

| 层 | 选型 |
|----|------|
| 前端 | Next.js 16 App Router · TypeScript · React |
| 样式 | 手写 CSS（globals.css），无 Tailwind |
| 数据库 | PostgreSQL via Prisma (Supabase) |
| AI | Claude API（对话 + 分析生成） |
| 持仓数据 | SEC EDGAR 13F-HR |
| 财务数据 | EDGAR XBRL + 外部市场数据 API |
| 认证 | NextAuth.js |
| 部署 | Vercel |

---

## 路由结构

```
/                   首页（信号流 + 大师入口 + Hero Search）
/master/[id]        大师主页（资料库卡片 + 持仓）
/master/[id]/library  资料阅读（左侧年份/文章列表，右侧正文）
/master/[id]/holdings 持仓快照
/company/[cik]      公司研究画布
/idea               对话研究室（左：对话，右：Canvas）
/login              登录
/documents/*         PDF 全屏阅读器（年度会议、书籍、演讲、文章）
```

---

## 当前实现状态（v0.35.4）

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
| Company Analysis 批量入库 | ✅ 已实现 |
| Canvas 实时生成（RAG → AI） | 🟡 部分实现，仍在迭代 |
| Company Brain 写回 | 🟡 部分实现 |
| Fact Fetch Pipeline | 🟡 已有批处理脚本，持续补齐 |
| 持仓数据更新 | 🟡 以季度批处理为主 |

---

## 数据与脚本

脚本现在比较多，按职责分组如下。日常维护优先走这些命令，而不是直接改库。

### 导入

- `npm run import:13f` / `npm run import:13f:range`：导入 13F 持仓
- `npm run import:10k`：按 ticker / 年份导入 10-K、20-F 财务数据
- `npm run import:10k:from13f`：从 13F 持仓反推需要补齐的公司财务
- `npm run pipeline:13f` / `npm run pipeline:10k`：完整流水线封装

### 回填与修复

- `npm run backfill:security:company-links`：把 security 重新挂到正确 company
- `npm run backfill:security:table`：修正 security 表历史数据
- `npm run backfill:company:profiles`：补公司 profile 元数据
- `npm run backfill:names`：补中文名 / 英文短名
- `npm run sync:company-name-map`：让 `company_name_map` 跟实体数据对齐
- `npm run cleanup:duplicate-companies`：清理重复 company 实体
- `npm run generate:master-profile`：补大师主页 profile
- `npm run generate:portfolio-insight`：生成持仓洞察
- `npm run generate:home-signals`：生成首页 3 条信号快照

### 巡检

- `npm run check:security:integrity`：检查 security 关联完整性
- `npm run check:financial:integrity`：检查财务数据完整性
- `npm run check:latest-holdings:coverage`：检查三位投资者最新季持仓公司的 5 年财务与 analysis 覆盖
- `npm run check:latest-holdings:coverage:json`：机器可读 JSON 输出
- `npm run check:db`：数据库健康检查
- `scripts/check-all-company-financials.ts`：全量公司财务巡检

### 自动补齐

- `npm run fix:latest-holdings:coverage`：按巡检结果自动补齐缺口
- `scripts/run-company-analysis.ts`：批量生成并入库 company analysis
- `scripts/import-10k-xbrl.ts`：现在支持 `companyfacts + filing-level inline XBRL fallback`

### 实验与基准

- `scripts/eval-*.ts`：检索与 MVP 评测
- `scripts/neo4j-*.ts`：图谱抽取、导入、演练
- `scripts/bench-live-asr-*.ts` / `scripts/test-volc-asr.mjs`：语音链路实验

### 维护原则

- 先跑巡检，再跑修复，最后才考虑手工改库
- 只要能写成脚本，就不要在数据库里临时补
- 新脚本优先挂到 `package.json`，避免隐蔽入口继续增加

---

## 运维速查表

### 最常用

- `npm run import:13f`
- `npm run import:10k -- --ticker TME --from 2025 --to 2025`
- `npm run check:latest-holdings:coverage`
- `npm run fix:latest-holdings:coverage`
- `npm run generate:home-signals`
- `node --env-file=.env.local ./node_modules/.bin/tsx scripts/run-company-analysis.ts --all`

### 数据修复

- `npm run backfill:security:company-links`
- `npm run sync:company-name-map`
- `npm run cleanup:duplicate-companies`
- `npm run backfill:company:profiles`
- `npm run backfill:names`

### 巡检

- `npm run check:security:integrity`
- `npm run check:financial:integrity`
- `npm run check:db`
- `scripts/check-all-company-financials.ts`

### 规则

- 先查缺口，再补数据，再做手工修正
- 12F / 10-K / analysis 的批处理都优先脚本化
- 数据源优先级：`companyfacts` -> filing-level inline XBRL -> 手工修复
- 首页信号由脚本产出快照，页面只读快照，不在页面里现算

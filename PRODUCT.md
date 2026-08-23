> 🔒 内部文件，不对外公开。

# 巴菲特部落 · Buffett Tribe — 产品设计文档

> 最后更新：2026-07-17（v0.38.15）

---

## 文档治理

本仓库文档按“内部决策”和“外部展示”分层，避免产品、技术、设计判断散落到多个文件。

| 文件 | 角色 | 维护原则 |
|------|------|----------|
| `PRODUCT.md` | 内部唯一产品/技术/设计决策源 | 产品定位、路线图、架构原则、数据口径、设计系统、实施计划都收口到这里 |
| `README.md` | 外部展示与快速开始 | 保持简洁，面向用户/开发者介绍产品、运行方式和技术栈，不承载内部规划 |
| `CHANGELOG.md` | 发布记录 | 只记录已经发布的用户可见变化和重要修复 |
| `APPLE-DESIGN.md` | 设计参考资料 | 可保留为参考，但设计决策和项目落地规范应摘要进 `PRODUCT.md` |

原则：以后讨论“要做什么、为什么做、怎么做、数据从哪里来、设计口径是什么”，默认更新 `PRODUCT.md`；对外只更新 `README.md` 和 `CHANGELOG.md`。`NEXT.md` / `DATA_GLOSSARY.md` 的内容已经合并进本文档，不再作为单独入口维护。`TODO.md` 承载**活跃工作队列**（按 P0–P3 排优先级）：完成项的结论回写本文档后从清单移除，只保留未完成项和必要背景（2026-07-17 起口径）。

---

## 目录

1. [产品定位](#产品定位)
2. [产品体验与核心页面](#产品体验与核心页面)
3. [文档系统路线图](#文档系统路线图)
4. [打孔（Punch）路线图](#打孔punch路线图)
5. [公司研究闭环路线图](#公司研究闭环路线图)
6. [A股与港股覆盖扩展](#a股与港股覆盖扩展)
7. [设计与技术基线](#设计与技术基线)
8. [测试体系](#测试体系)
9. [当前实现状态](#当前实现状态v0432)
10. [数据字典与工程口径](#数据字典与工程口径)
11. [数据资产清单](#数据资产清单)
12. [公司页财务看板](#公司页财务看板truth-of-source-设计)
13. [数据与脚本](#数据与脚本)
14. [运维速查表](#运维速查表)

---

## 产品定位

**知识库 + Agent 驱动的价值投资研究平台。用价值投资大师的框架，帮助用户更好地理解和分析一家公司。**

用户来这里不是为了读懂巴菲特，而是为了用巴菲特的方式看一家公司：
护城河在哪里？管理层可信吗？现在的价格有安全边际吗？

Agent 是核心入口。三层知识驱动 Agent 自主决定如何回答：
- **`search_wisdom`**：大师说了什么 — 年会记录、股东信、演讲、书（GBrain 知识图谱，语义检索）
- **`search_holdings`**：大师买了什么 — 5 位投资人的 13F 持仓：核心 3 位（巴菲特 / 李录 / 段永平）+ Alpha 2 位（Gavin Baker / Alex Sacerdote）（Supabase SQL，从 `Filer` 表动态读取）
- **`search_filings`**：公司披露了什么 — 10-K / 20-F 年报章节（FilingSection，约 120 家，2020–2025）

大师原文、13F 持仓、财务数据、年报——这些是分析的燃料，不是产品的终点。

### 目标规模（2026-08-06 确认）

不追求覆盖整个上市公司/投资者宇宙，是精选价值投资框架下有意义的标的。这个判断直接影响自动化/规模化投入的取舍——遇到"要不要为规模化预先投入"的问题，按下面这几条基准判断，不要拿"未来可能上万"去过度设计批处理、限流、复杂多对多数据模型等基础设施，也不要反过来把持续增长的部分当成永远的小体量。

- **公司**：中/港/美三个市场合计约 1-1.5 万家上市公司，但项目支持的量级封顶在 **1000 家以内**——稳定上限，不会长期持续增长。
- **投资人（Filer/tribe member）**：巴菲特部落核心成员（有完整 wisdom 库）不超过 10 个；Alpha 部落（13F-only）多一些，顶级的也就数十个，**投资人总数上限在 100 个以内**——稳定上限。
- **/insights 文章**：与前两条性质不同，**没有封顶，持续累积**。粗估一周新增约 10 篇、一年约 500 篇；若项目运营 30 年，累积总量级在 3 万篇。近期（1-2 年内）用简单的逐条处理完全够用，但任何隐含"文章数量不会变"的设计（无分页的列表查询、无索引的按公司反查）需要按最终走向万级的成长轨迹考虑，不能只按当前存量（2026-08-06 为 68 篇已发布）的体感设计。
- **目标用户**：中国价值投资实践者预估几万人，产品目标用户量级也在**几万人这个级别**——对 Next.js（Vercel）+ Postgres（Supabase）这套技术栈是常规规模，不需要为百万级用户设计 CDN/分库分表，但也不是几十人内测的体量，`revalidate` 这类 ISR 缓存是合理的基础优化。

---

## 产品体验与核心页面

```
/agent    投资研究 Agent   三工具驱动，知识库 + 持仓 + 年报联动（主入口）
/master   大师             核心大师（巴菲特、李录、段永平）的资料、持仓
/company  公司             任意一家公司的研究画布（6 Tab Canvas）
/insights 投资洞见         播客 / 栏目文章，按来源过滤
```

### /master — 大师

价值投资大师的原始资料库：股东信、合伙人信、演讲、访谈。每位大师有独立页面，展示材料列表与 13F 持仓快照。材料全文可阅读。

Alpha 投资人作为独立分类展示，不进入核心大师主导航。第一位 Alpha master 是 Gavin Baker / Atreides Management, LP，用于承载科技成长、AI、半导体、crossover 等现代投资风格；第二位是 Alex Sacerdote / Whale Rock Capital Management（科技成长）。Alpha 投资人有 master 页与 13F 持仓页，默认没有 wisdom 资料内容（`Filer.isMasterPersona = false`），个别 Alpha 投资人可按需通过 `Document` 表单独补充原始材料（如 Bill Ackman 的 Pershing Square 股东信，见 `src/app/documents/bill-ackman/`），不影响 `isMasterPersona` 判定；其持仓页需要明确说明 13F 不代表完整组合。

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

Canvas 的数据来自结构化事实层（财务数据，来自 EDGAR / 市场数据 API）+ 批量 LLM 生成内容（GeneratedContentVersion 等）。

> 曾规划的"对话沉淀层"（Company Brain：用户对话写回 Claim，Canvas 越用越厚）已于 2026-07-17 从计划中移除——方向没有想清楚，暂不做。

当前公司页已经接通真实数据源与批处理入库流程，不再是纯 Mock 页面。

### /agent — 投资研究 Agent

全站核心对话入口。SSE 流式输出，实时显示工具调用指示器（工具名 · 参数摘要 · 返回条数）。

Agent 由 pi-gateway（Express SSE，air7，PM2）驱动，使用 `@earendil-works/pi-coding-agent` 框架，LLM 为 DeepSeek。

三个工具：
- **`search_wisdom`** 查询资料库：GBrain 语义检索，DashScope text-embedding-v4 1536d
- **`search_holdings`** 查询持仓明细：Supabase SQL，Holding → Security → Entity 联表，覆盖全部 5 位投资人（从 `Filer` 表动态读取）
- **`search_filings`** 查询公司年报：FilingSection 结构化抽取，section alias 映射，keyword excerpt

AGENTS.md（`services/pi-gateway/AGENTS.md`）定义 Agent system prompt：投研定位、三工具用法、回答格式（分析 + 引用分层）。

**图片输入（2026-08-23 上线）**：所有「AI 解读」对话框（含 `/agent` 本身）的输入框支持直接从剪贴板粘贴图片提问。前端用 `<canvas>` 把图片降采样到长边 ≤1280px、JPEG quality 0.82 后再转 base64（DeepSeek vision 对单张图的有效信息上限约 384 token，原图分辨率没有意义），随消息体一并发到 `/api/pi` → pi-gateway；pi-gateway 只在这一轮消息带图片时用 `AgentSession.setModel()` 切到 `deepseek-v4-flash-vision-exp`（单独一个 provider model，见 `services/pi-gateway/.pi-agent/models.json`），发完这轮再切回默认文本模型——已用真实 DeepSeek API 验证过 vision 模型在同一次请求里仍能正常触发 function calling，不会因为切模型而让五个工具失效。图片仅内联传输（base64 data URI），不落盘、不经 R2，纯本轮对话的临时输入。校验逻辑（mime 白名单、单条消息最多 4 张、单张 base64 长度上限）在 `src/lib/image-attachment.ts` 和 `services/pi-gateway/src/image-attachment.ts` 两处独立维护——两个目录是各自独立部署的服务，不共享代码。对话记录里已发送的图片支持点击放大（`AgentChat.tsx` 内嵌一个极简 lightbox：点击缩略图全屏展示，点击遮罩关闭，不做独立组件）。

**上线时踩的坑**：`services/pi-gateway/.pi-agent/models.json` 里自定义 model 条目不显式声明 `"input": ["text", "image"]` 的话，pi-coding-agent 的 model registry 默认给 `input: ["text"]`——图片会在请求发出**之前**就被 SDK 自己换成 `(image omitted: model does not support images)` 占位文本，DeepSeek 那边完全收不到图，agent 也确实"看不到"（不是幻觉，是真收不到）。加这一个字段就好，两处 `models.json`（本地 dev 模板 + air7 生产环境副本）都要改，改完要重启 pi-gateway 让新配置生效。

### 用户体系与访问控制（2026-08-21 确认）

站点当前对外**完全免费**。此前 backlog 里的商业化条目（LemonSqueezy 订阅集成、免费 vs 会员次数限制、免费到付费转化链路验证）已从计划移除——会员分级/收费是否要做、怎么做，留待未来单独设计，不在当前范围内。

现有的登录/未登录区别是纯**功能门禁**，与付费无关：

| 区域 | 未登录 | 已登录 |
|------|--------|--------|
| `/master`、`/company`、`/insights`、公司页六个 tab | 完全可见 | 完全可见 |
| `/agent` 页面 | 服务端 `getServerSession` 未命中直接 `redirect` 到 `/login?callbackUrl=%2Fagent`，不渲染任何内容 | 正常使用 |
| 各处「AI 解读」入口（公司页、大师页、年报阅读器、洞见页——`CompanyAgentDialog`/`MasterAgentDialog`/`FilingReader`/`PdfFilingReader`/`InsightChatShell`，均经由共享的 `useAgentGate` hook） | 点击触发按钮（含选中原文后的"问 AI 这段"）时当场检测未登录，`router.push` 跳转 `/login?callbackUrl=<当前页面?openAgent=1>`，不打开对话框 | 正常使用 |
| `/punch`（打孔墙）+ `/punch/[slug]`（详情页） | 服务端 `getServerSession` 未命中直接 `redirect` 到 `/login?callbackUrl=...`，不渲染任何内容 | 正常浏览 |
| 「活动」（导航占位，功能未实现） | — | 功能实际上线时应沿用与打孔一致的登录门禁，无需另行讨论 |

**登录后自动继续操作**（2026-08-21 补充，用户要求点击门禁触发点后能跳登录页、登录成功后接着做刚才想做的事）：`useAgentGate`（`src/hooks/useAgentGate.ts`）把 `callbackUrl` 的查询串里带一个 `openAgent=1` 标记，`/login` 页面（`LoginForm.tsx` 原生支持 `callbackUrl` 回跳）登录成功后 `router.push(callbackUrl)` 落回原页面；该 hook 在页面挂载时用一个 effect 检测 `status === "authenticated"` 且 URL 带这个标记，就自动调用传入的 `onReopen`（即重新打开对应的 AI 解读对话框/面板）并把标记从地址栏 `router.replace` 掉，避免刷新后重复触发。`/agent` 页面本身走服务端 redirect，`callbackUrl=/agent` 回跳落地就是页面本身，天然"继续操作"，不需要这个标记机制。`/api/pi` 仍保留服务端 session 校验作为兜底，防止任何绕开这些入口的直接调用。

NextAuth（Credentials Provider，`src/lib/auth.ts`）是现有唯一认证实现，无第三方登录。

**仍待设计（不在本次范围内，2026-08-21 讨论中提出）**：注册用户上传材料（如财报 PDF）的存储方式/repository 设计、对话历史是否落库及如何管理——留待后续单独排期。

### /idea — 对话研究室（旧版，已下线）

旧版对话界面，左侧对话 + 右侧公司 Canvas 联动。2026-08-02 确认导航已无入口、全站无其他引用，页面、`IdeaWorkspace`、`/api/chat*`、`src/lib/chat.ts` 均已删除。`ChatUsage`/`ChatMessage` 表结构保留未做 migration，避免连带丢失历史数据。`src/lib/search.ts`（`searchChunks`）与其依赖的 `Chunk`/`Source` 表未受影响——它们仍在为 `/api/mcp`（对外 MCP server 的 `search` 工具）提供检索，与 /idea 无关。

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

## 打孔（Punch）路线图

（2026-08-20 /office-hours 设计会话产出并当场实现第一版，设计文档见 `~/.gstack/projects/walk4rever-buffett-tribe/rafael-main-design-20260820-114747.md`；状态：**核心页面 + 第一条真实数据已上线（`/punch`），13F 自动化与状态自动刷新待补**，见 TODO.md P0 ⑨）

### 概念

借用巴菲特"一生只有 20 次打孔机会"的投资哲学比喻。**引言已定稿并核实**：原话出自 2001 年 7 月 18 日佐治亚大学特里商学院（University of Georgia, Terry College of Business）演讲问答（非本条目早前 WebSearch 初步找到的 1994 年芒格转述版本——后者是另一场合的独立转述，不是同一句话的出处，已被用户核实的原始出处替换），交叉核对 Speakola/Kingswell 两份独立转录稿确认原文与日期后写入 `src/app/punch/page.tsx`（英文原话 + 中文翻译 + 准确来源标注）。

一个"孔"= 一位大师做出的、被证明是真正 big bet 的重仓/长期持有判断。**孔是精选出来的、面向未来的、持续被验证的判断，不是对历史的回顾性记录**——孔不是"案例陈列柜"，而是一面能追更、能验证对错的判断墙，读者应该能看到"这个判断后来怎么样了"。

页面形态：独立顶级导航页面 `/punch`（与 `/agent` `/master` `/company` `/insights` 同级，`SiteNav` 入口已从禁用态改为真实链接），类似投资 idea 的粘贴墙，卡片点击展开进入 `/punch/[slug]` 详情页。

### 与现有 `MasterProfile.flagshipCases` 的关系（重要澄清）

`MasterProfile.flagshipCases`（thesis/outcome/stillHolding）和 TODO.md P2 里"Thesis Tracker 化投资论点跟踪"的构想，跟"打孔"在概念上高度重叠——都是"大师一次重仓决策 + 一段可验证的叙事"。**明确拍板：暂不合并，两件事独立推进。** 但风险已记录（见 Claude 项目记忆 `punch-vs-flagship-cases`）：未来大概率需要面对"要不要收敛成一套模型"的问题，避免同一类内容在两个地方各写一份、逐渐 drift（`GeneratedContentVersion` 镜像同步率问题、`fetchLatestFilingEvidence` vs `fetchBuybackEvidence` 的证据选取不一致都是同一类风险的先例）。

### 数据来源（两条并行，第三条预留位置）

1. **平台编辑精选**：人工判定的孔，例如段永平公开承认过泡泡玛特算一个孔。**第一条已实现**：段永平 × 苹果，`scripts/seed-punch-duan-apple.ts`（一次性种子脚本，非可复用录入流程——第二条孔要不要照抄这个模式还是做后台表单，未定案）。
2. **13F 自动推导**：从已有 `Holding` 历史数据里，按"连续持有 3 年以上"的规则自动生成候选孔。**注意**："3 年以上"只是**筛选条件**，不是孔本身的性质——孔一旦被选中，后续要跟着 13F 季度重导入的新数据走，状态可能变化。**批量脚本尚未实现**，具体判定算法（如何处理中途小幅加减仓仍算同一次判断这类边界情况）待补。
3. **注册用户分享（未来）**：站点未来的注册用户可以分享自己打的孔。当前用户账号体系只有登录/waitlist，无发布能力，`source` 枚举已预留 `user_submitted` 位置，**本次不实现**。

### 数据模型（已实现）

`Punch` 表（迁移 `prisma/migrations/20260820120000_add_punch_table` + `20260820150000_add_punch_year`，因 shadow DB 历史问题走 CLAUDE.md 记录的手工迁移 workaround 应用）：

- `slug`（唯一，路由用）
- `source`：`curated` / `13f_derived` / `user_submitted`
- `status`：`active`（进行中）/ `exited`（已平仓）/ `thesis_broken`（逻辑被推翻），默认 `active`——目前是**人工设置的静态值**，还没有接自动刷新（见下）
- `punchYear`（可空整数）：我们能确认这位投资人**认真做出这次重仓下注决策**的最早年份——不必是精确的建仓日期，是"有据可查的 conviction 起点"。展示为"20XX年"文案 + 浅灰底纯色胶囊（`.punch-year`，初版曾用虚线圆角边框呼应"打孔"意象，用户反馈不好看后改为跟 `status` 胶囊同一视觉语言的纯色样式）。墙面卡片上与 `status` 徽章一起放在卡片右下角（`.punch-card-footer`，`margin-top: auto` 贴底对齐，避免跟标题/正文同一行挤压掉公司名/ticker）；详情页仍放在身份条右侧（该行宽度够，不需要挪位）
- `filerEntityId` / `companyEntityId`（均可空，直接指向 `Entity`，字段命名对齐 `Holding.holderEntityId`/`Security.companyEntityId` 便于联查，而不是先经过 `Filer`/`Security` 中间层）
- `headline`（墙面卡片一句话判断）、`thesis` / `catalyst` / `valuation` / `risk`（参考 Value Investors Club 核心字段，不搬其评分竞赛机制）
- `quotes`（JSON 数组，`{ text, date, sourceTitle, sourceUrl? }[]`——原话引用，不是复述）
- `entrySummary`（简短的"何时/如何建仓"说明）

**当前位置的持仓数据是实时算的，不是存进 `Punch` 表的**：`src/lib/punch.ts` 的 `getLivePositionSnapshot()` 每次请求时联查 `Security`（按 `companyEntityId`）→ `Holding`（按 `holderEntityId` + `securityId`），取最新一期 13F 快照现算，不持久化——避免"存一个数字，pipeline 忘记刷新就变假"这类本仓库反复出现过的教训（同 `/company` 目录页"完整/待完善"信号的既定原则：能实时算就不存布尔/数字快照）。

**状态自动刷新尚未实现**：设计上，不区分孔的来源，只要一个孔同时有 `filerEntityId` 和 `companyEntityId`，就能用同一套查询判定"进行中/已平仓"——`getLivePositionSnapshot()` 已经证明这条查询路径可行，但目前只用于detail页展示，还没有写回 `Punch.status` 的刷新脚本、也没有接进 `pipeline:13f`。`thesis_broken` 这类主观判断预期仍需人工标注，不指望自动化。

### 详情页（已实现）

`src/app/punch/[slug]/page.tsx`：master/company 身份条（头像用 `getTribeMemberColor()`，与大师主页 `.person-avatar` 同一套配色规则，不引入新的品牌色用法）+ 状态徽标 + headline + 实时 13F 快照条 + 叙事/催化剂/估值/风险四个字段 + 原话引用列表（每条带日期和可点击的站内来源链接）。master 身份解析走 `getTribeMembers()`（`src/lib/tribe.ts`），不猜测 `Entity.metadata` 的字段形状——`Filer.filerEntityId` 指向的 `Entity` 是记账主体（如"H&H国际投资"），不是人物本名，人物中文名/花名/头像色必须经 `Filer`/`getTribeMembers()` 解析。

### 首条真实数据：段永平 × 苹果

`headline`/`thesis`/`catalyst`/`valuation`/`risk` 及 6 条带日期引用，全部来自站内已有文档《段永平投资问答录 · 投资篇》（`Document` id `duan-investment`，"案例 3：苹果"章节，PDF ~page 376 起）——用 `pypdf` 抽取全文后逐条定位真实原话，不是编造或转述。核心事实：2011 年建仓（苹果当时市值约 3000 亿美元、净现金约 1000 亿美元、年利润不到 200 亿美元）；`Holding` 表里段永平对 AAPL 的仓位从 2020Q1 持续至今（2026Q2 数据 41.0%、此前多个季度 60-80%），验证了"连续持有 3 年以上"这条 13F 筛选条件在真实数据上成立。

### 仍未做

1. 13F 自动推导批量脚本（按"连续持有 3 年以上"扫 `Holding` 生成候选孔）。
2. 状态自动刷新接入 `pipeline:13f`（写回 `Punch.status`，目前只有只读的 `getLivePositionSnapshot()`）。
3. 编辑精选孔的正式录入方式（表单 or 脚本模式）——只验证过一次性 seed 脚本这条路。
4. `MasterProfile.flagshipCases` 收敛问题，暂不处理，风险已记录。

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

年报阅读页当前设计（v0.39.12 起）：

- 按年份切换
- 原始 HTML 全文（iframe 直出，不做目录/附件侧栏）
- 字体大小 / 行间距可调（右上角两个循环切换按钮，偏好存 `localStorage`）
- AI 解读：右侧固定宽度分栏面板（非弹窗），带公司/年份上下文
- 与财务数据联动跳转（TODO，未实施）

左侧目录 + 附件清单曾是设计目标，**已确认不可行而移除**：目录原计划扫描 iframe 内 `h1/h2/h3` 生成，但 SEC inline XBRL 渲染的年报几乎不用语义化标题标签（法拉利 2025 20-F 实测 0 个 h1/h2/h3，正文标题靠纯样式 `div`/`span` 模拟）；按 `Item N` 编号扫描对标准格式 filer 可行，但对法拉利这类"欧洲法定年报与 20-F 合并"的版式仍然落空（正文里"Item N"字样完全不出现，只在最前面的监管对照表里出现一次）。这是 iframe 内客户端扫描的问题，跟后端 `FilingSection` 抽取管线（章节数据库化，见下方「v0.39.17 变更」）是两回事——后者已修复。

数据前提吃现有库里的 `ExtSource`、`FilingSection`、`FilingAttachment`、`FilingArtifact`、`Financial`，不另起一套孤立模型。

### 待办：13F 历史证券承接页

当前 13F 历史持仓中仍存在少量 `Security.ticker = null` 且 `companyEntityId = null` 的证券记录。它们有 CUSIP、issuer/titleOfClass 和真实持仓事实，但未被解析成标准 company entity，因此无法进入公司页。

产品口径：只要出现在大师历史持仓里，就应该有可访问页面，不能只停留在表格文本里，也不能在 UI 中泄露内部 `securityId`。

后续处理：

- 可解析为运营公司的历史证券，补齐 company shell，并标记 `status: acquired / delisted / private`、`historicalTicker`、`cusip`。
- ETF / Trust / fund 类证券不要强行进入普通公司页，应承接到 fund/security 页面。
- 大师持仓表证券展示优先级统一为 `security.ticker -> company.ticker -> historicalTicker -> issuer short name -> cusip`，永远不显示内部 id。
- 新增 `/security/[id]` 或等价承接页，用于无法归并到标准 company 的历史证券。
- 将 orphan security 巡检纳入 `check:security:integrity`，并通过脚本化 backfill 修复，不手工改库。

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

当前系统深度绑定 SEC EDGAR 体系（CIK、XBRL、10-K/20-F/40-F），公司页路由、Entity 模型、财务导入链路、年报阅读器都围绕这一体系构建。扩展支持 A 股和港股公司，验证目标为贵州茅台（600519.SS）和泡泡玛特（9992.HK）——两家均已完成，美股/港股/A股三个市场至此全部对等支持。

> **实施状态（2026-07-27 更新）**：**泡泡玛特（hk-09992）与贵州茅台（cn-600519）Phase 1+2+3 均已完成并上线**——路由泛化（`/company/[id]`，`parseCompanyIdentifier`/`formatCompanyUrl`/`getCompanyByIdentifier` 统一入口）、Entity 种子（`scripts/lib/cn-hk-company-seeds.ts`）、股价、财务数据（`akshare` 三大报表 → `Financial`）、年报原文（HKEXnews/cninfo → `FilingSection` evidence + R2 PDF + 本地阅读页，见下方 Phase 3）均已验证；`onboard-company.ts --market hk|cn` 均为完整 9 步，业务/价值/管理/估值分析四个 LLM tab 都已解锁并跑出真实内容，公司页信息完整。详细过程见 TODO.md P0 ②。
>
> **2026-08-06 更新：Entity 种子改为自动查询**，见下方 Phase 1 第 3 点和 TODO.md P0 ④——原「两家公司手工录入，不先建批量管线」是 P0 ② 当时的决定，规模扩大到未来 100+ 家后已不成立，`scripts/fetch-cn-hk-company-profile-ak.py` 用 akshare 自动查询公司名/交易所/行业，`cn-hk-company-seeds.ts` 降级为坏数据兜底的手工覆盖表。A 股路径（五粮液 000858.SZ）端到端真实验证通过；港股路径代码完成、关键环节离线验证过，尚未有真实港股新公司跑过完整端到端。

### 扩展动机

- 价值投资框架不局限于美股。A 股和港股有大量符合价值投资标准的标的。
- 用户对话中已频繁出现中概股、A 股和港股公司名称，当前系统只能依赖 LLM 实时搜索回答，没有结构化数据层支撑。
- 股价数据方面，Yahoo Finance 已原生支持 A 股（后缀 `.SS`/`.SZ`）和港股（后缀 `.HK`），`StockPrice` 表和现有价格导入链路可以复用。

### 核心挑战

| 挑战 | 美股（当前） | A 股 / 港股（目标） |
|------|------------|-------------------|
| **标识体系** | CIK（唯一，SEC 分配） | A 股数字代码（600519，需后缀区分沪深）；港股数字代码（补零，如 09992，Yahoo ticker 后缀 .HK） |
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
| 财务报表（三大表） | ✅ 较全 | ✅ 较全（2026-07-26 实测更正，见下） | `stock_financial_report_sina()`（A股，宽表+中文列名） / `stock_financial_hk_report_em()`（港股，长表+跨 filer 稳定的 `STD_ITEM_CODE` 数字口径，验证过泡泡玛特 09992 与腾讯 00700 同一 code 对应同一科目，映射比 A 股更省事） |
| 业绩快报/预告 | ✅ | ❌ | `stock_yjbb_em()` / `stock_yjkb_em()` |
| 年报原文 PDF | ❌ | ❌ | 需从巨潮资讯网/港交所披露易单独获取 |
| XBRL 结构化财务 | ❌ | ❌ | 中国股市不采用 XBRL 披露体系 |

**结论**：akshare 足以支撑**阶段 1（基础信息）和阶段 2（财务数据）**——港股用泡泡玛特实测验证，比原计划乐观（不是"有限"）。年报原文需要单独处理，不作为首批目标。

**2026-07-26 补充发现**：akshare 港股财报接口不暴露货币字段，且**港股公司未必以 HKD 报表**——泡泡玛特虽在港交所上市，报表货币是人民币（对着真实 FY2024 营收数字核对过），这是常见于内地注册、港股上市公司的情况。货币不能从 `market` 推断，必须逐公司核实（见 `scripts/lib/cn-hk-company-seeds.ts` 的 `currency` 字段）。

#### 备选数据源

| 数据源 | 优势 | 劣势 | 适用阶段 |
|--------|------|------|---------|
| **Tushare Pro** | 更专业稳定，财务指标覆盖全 | 需积分/付费 token | 阶段 2 长期替代 |
| **Yahoo Finance** | 股价已在使用，A 股/港股 ticker 支持 | 财务数据粒度不够 | 阶段 1 股价复用 |
| **巨潮资讯网 API** | A 股年报 PDF 官方来源 | 无标准化 API，需爬虫 | 阶段 3 年报原文 |
| **港交所披露易** | 港股公告/年报官方来源 | 无 API，需爬虫 | 阶段 3 年报原文 |

### 实施阶段

#### Phase 1：基础信息 + 股价 —— ✅ 泡泡玛特已完成，茅台未开始

**改动点（实际实现，见 TODO.md P0 ②）**：
1. **Entity 模型**：`cik` 本来就是 nullable；`market`/`code` 字段与复合索引 2026-06-15 已加。
2. **URL 路由**：`/company/[cik]` → `/company/[id]`，解析逻辑在 `src/lib/company-data.ts`（`parseCompanyIdentifier`/`getCompanyByIdentifier`/`formatCompanyUrl`，见下方「技术方案」），不是本节最初设想的独立 `parseCompanyId` 函数——这套 helper 統一了此前两套已经互相 drift 的 CIK→URL 实现（`company-data.ts` 自己的一套 + 独立的 `src/lib/cik.ts`，后者已删除）。
   - `/company/CIK0000320193` → SEC 公司（向后兼容）
   - `/company/hk-09992` → 港股（注意补零，不是 `hk-9992`——港股代码规范用 `09992`，见「首批目标公司」表）
3. **公司信息**（**2026-08-06 更新，见 TODO.md P0 ④**）：最初（P0 ②）拍板"两家公司手工录入，不先建批量管线"，规模扩大到未来 100+ 家后不再成立——现改为 `scripts/fetch-cn-hk-company-profile-ak.py` 用 akshare 自动查询 canonicalName/nameZh/nameEnShort/exchange/行业原文（A 股 `stock_profile_cninfo`，港股 `stock_hk_security_profile_em`+`stock_hk_company_profile_em`），`sector` 由 `cn-hk-sector-classify.ts` 用 LLM 分类到与美股 `mapSectorFromSic()` 相同的 9 桶英文词表。`scripts/lib/cn-hk-company-seeds.ts` 降级为坏数据兜底的手工覆盖表（ticker 在表里则用手填值，否则自动查），不再是 onboard 新公司的必需前置步骤。
4. **股价**：`npm run import:stock-prices:yf -- --ticker 9992.HK --import-db` 零改动直接用，`StockPrice` 按 ticker 字符串查询，与 CIK/market 完全无关。

**公司页适配（已实现）**：
- 概览区 `market`/`code` 非空时显示市场代码而非 CIK。
- 财务分析 tab 空态、年度报告 tab 空态改市场感知文案（不再提示"运行 import:10k"）。
- 年度报告 tab 空态外链披露易 HKEXnews（`https://www.hkexnews.hk/index.htm`，已用 WebFetch 验证是真实可达的官方页面）。

#### Phase 2：财务数据 —— ✅ 港股 + A 股均已完成

**港股实现**：`akshare.stock_financial_hk_report_em()` 返回的 `STD_ITEM_CODE`——一个跨 HK filer 稳定的数字科目码（验证过泡泡玛特 09992 与腾讯 00700 同一 code 对应同一科目），结构上类似 SEC 那套 `tagsUsGaap`/`tagsIfrs` 数字码映射，不是新模式。12 个 `LINE_ITEMS` 全部有对应 code（含 CapEx、ShareRepurchaseAmt），9 个财年（2017–2025）全部拿到。

**A 股实现（`scripts/fetch-cn-hk-financials-ak.py` 的 `CN_COLUMN_MAP`，2026-07-27 完成）**：`akshare.stock_financial_report_sina()` 没有 HK 那种稳定数字码，是宽表 + 中文列名，且**混杂季度与年度行**——用 `报告日` 字段以 `"1231"` 结尾筛出年度行（HK 接口有 `indicator="年度"` 参数直接过滤，Sina 接口没有）。列名逐一对着贵州茅台（600519）真实公开 FY2024 数字核对：营业收入 ¥170.9B、归属于母公司所有者的净利润 ¥86.2B、基本每股收益 ¥68.64、资产总计 ¥298.9B，全部一致。11/12 `LINE_ITEMS` 有对应列，`ShareRepurchaseAmt` 留空未映射——Sina 这套通用模板（所有 A 股公司共用同一套字段，含大量金融业专属字段）没有可信的股份回购列，宁可空缺也不猜测；`GrossProfit` 不是原始列，是营业收入−营业成本的标准会计恒等式派生值。

实际使用的中文列名映射表：

| 中文报表指标（Sina 列名） | LINE_ITEM |
|-------------|-----------|
| 营业收入 | Revenue |
| 营业收入 − 营业成本（派生） | GrossProfit |
| 营业利润 | OperatingIncome |
| 归属于母公司所有者的净利润 | NetIncome |
| 基本每股收益 | EPSBasic |
| 稀释每股收益 | EPSDiluted |
| 资产总计 | TotalAssets |
| 负债合计 | TotalLiabilities |
| 所有者权益(或股东权益)合计 | ShareholdersEquity |
| 经营活动产生的现金流量净额 | OperatingCashFlow |
| 购建固定资产、无形资产和其他长期资产所支付的现金 | CapEx |

**货币不能从 market 推断**：akshare 港股接口不暴露货币字段，且泡泡玛特虽在港交所上市，报表货币是人民币不是港币（对着真实 FY2024 营收数字核对过）——不是从 market 派生的值。**2026-08-06 更新**：不再靠逐公司手工核实——`scripts/lib/cn-hk-currency-resolve.ts` 里，A 股按监管硬性要求硬编码 CNY（零查询）；港股从已导入的年报正文提取（正则统计 `RMB`/`HK$`/`US$` 等货币单位出现频率，能明确判别时直接用，含糊时退化成一次 LLM 调用读文本确认），因此 `onboard-company.ts` 的港股分支把 `import_annual_report` 排到 `import_financials` 之前。`cn-hk-company-seeds.ts` 里的手填 `currency` 字段仍可作为覆盖值。

**财年对齐**：A 股/港股以日历年度为准，`periodEnd` 统一为 `12-31`（均已验证）。**存储**：复用现有 `Financial` 表结构，未新建表（`ExtSource.kind` 新增 `"akshare"` 值）。

#### Phase 3：年报原文 —— ✅ 港股（泡泡玛特）+ A 股（贵州茅台）均已完成并接入 LLM evidence + 本地阅读页

**目标**：年报文本作为 evidence 支撑业务/价值/管理分析 LLM tab（此前这三个 tab 对港股/A股全部空着，根源就是没有年报原文，`hasUsableFilingEvidence()` 会拒绝生成）。首版（2026-07-27 早）**不做**本地年报阅读器 UI，年度报告 tab 维持外链披露易占位——但同日晚些时候用户要求补上，见下方「本地阅读页」小节；下面这段保留作为决策变更的记录，不代表当前状态。

**港股实现（`scripts/fetch-hk-annual-report.py` + `scripts/import-hk-annual-report-from-file.ts`）**：不照搬 `extract-10k-sections.ts` 的 Item 边界识别逻辑（SEC 编号章节惯例在港股 PDF 上不成立），按页数机械切成 4 段存入 `FilingSection`（`ExtSource.kind = "hk-annual-report"`）——巧的是泡泡玛特这份年报按页数四等分，天然落在"管理层讨论/公司治理报告/ESG报告/财务报表附注"这几个自然区块的边界附近，不需要精细语义切分也能覆盖全文不同部分。

获取机制，两处关键发现（均为实测，非文档假设）：
1. **`GET /search/prefix.do?lang=ZH&type=A&name={code}&market=SEHK&callback=callback`**——披露易搜索框自己用的自动补全接口，把股票代码解析成 HKEX 内部数字 ID（如 `09992` → `1000068054`）。**必须带 `callback` 参数，否则返回空**（JSONP 接口，不需要真的执行回调，字符串随便传一个即可）。
2. **拿到真实 `stockId` 后，`titleSearchServlet.do` 可以用任意宽的日期范围一次查完该公司全部历史公告**（几百条）；不知道 `stockId` 只能传 `-1`（不过滤）时，接口会把查询范围限制在 1 个月内且返回当月**整个港股市场**的公告（2-3 万条/月）——最初按月回溯扫描 19 个月找 2 份年报，跑了 25 分钟没跑完被中止；换成先解析 `stockId`，同样的查询 2-3 秒完成。这是"看起来能用的方案"和"实际可用的方案"之间的典型差距，值得记录。

下载有实测的限速（约 85KB/s，一份 8MB 年报视具体文件可能 1 秒到 100 秒不等），脚本按此设置了 180 秒超时，不是保守冗余。PDF 是原生数字文本，`pypdf` 直接提取，未用 OCR。

**A 股实现（`scripts/fetch-cn-annual-report.py` + `scripts/import-cn-annual-report-from-file.ts`，2026-07-27 完成）**：不是把 HK 脚本改参数复用——获取机制本质不同，符合本节开头「不照搬，按市场格式重新设计」的约束，只共享 `archiveFilingArtifact()`/`buildStoredTextOnlyFilingSectionData()` 两个已有的通用底层 helper。`akshare.stock_zh_a_disclosure_report_cninfo(keyword="年度报告")` 返回的公告标题带 `<em>...</em>` 搜索高亮标记，需要先 strip 再匹配；纯 `"年度报告"` 关键词还会命中"半年度报告"（子串重叠）、"...摘要"、"...（英文版）"，用锚定正则 `^.+?(\d{4})年年度报告$` 精确排除，验证过真实返回结果里这三类变体全部被正确过滤，只保留 6 份年份 2020-2025 的正式中文年报。PDF 直链是可预测的静态 CDN 地址（公告详情页链接里的 `announcementId`+`announcementTime` 拼出 `static.cninfo.com.cn/finalpage/{announcementTime}/{announcementId}.PDF`）——比 HKEXnews 简单得多，不需要 JSF/ViewState 会话周旋，下载速度也快一个数量级（3.6MB 年报实测 0.3 秒，~14MB/s，vs HKEXnews 的 ~85KB/s），因此不需要 HK 那种保守超时设计。`ExtSource.kind = "cn-annual-report"`，`FilingSection` 前缀 `cn_annual_report_1..4`，同样按页数机械四等分。`hasUsableFilingEvidence()`/`fetchLatestFilingEvidence()`（`scripts/lib/company-generation.ts`）、`src/lib/company-data.ts` 四处 kind 过滤、阅读页 `PdfViewer` 分支、`onboard-company.ts` 的 `buildImportAnnualReportStep` 均按 HK 已有模式加一行泛化；`services/pi-gateway` 的 `search_filings` 工具核心逻辑**零改动**自动覆盖（fallback 判断依据是"有没有 primary_html"，不认 kind 名字）——新增贵州茅台 L3 回归用例（`tests/agent-tools/search-filings.test.ts`，同 HK 一样用中文名 + 截断点之后的深层关键词）跑通确认，不只是理论推断。唯一实际要改的是工具 `description`/`company` 参数说明，之前完全没提 A 股，同样有"LLM 因描述不提及而不选用该工具"的风险，照 HK 那次的措辞补上了。

**验证**：`onboard:company -- --ticker 600519.SS --market cn` 一次性跑完全部 9 步（含 5 个 LLM 生成步骤），无需分次补跑；`/company/cn-600519` 六个 tab 截图确认业务/财务/价值分析均为真实生成内容，年度报告 tab 6 张卡片、PDF 阅读页正常渲染（143 页）；Pop Mart（HK）与 AAPL（US）回归截图确认无副作用——详细过程见 TODO.md P0 ②。

**验证**：`onboard:company -- --ticker 9992.HK --market hk` 端到端跑通，业务/价值/管理/估值分析四个 tab 从"构建中"占位变成真实生成内容（业务概览提到 Molly/DIMOO 等真实 IP 名称与真实 FY2025 财务数字，价值分析护城河评分附"年报未提及重大监管壁垒"这类可追溯到原文的具体论据）——详细过程见 TODO.md P0 ②。

**本地阅读页（2026-07-27 追加）**：年度报告 tab 卡片过去对港股恒为空，因为 `getCompanyReferenceFilings`/`getCompanyAnnualFiling` 的 `kind` 过滤硬编码只认 `10k`/`20f`/`40f`——加上 `hk-annual-report` 后卡片直接复用既有 SEC 卡片 UI 出现，无需新写。点进去的阅读页原本只会渲染 `FilingReader`（依赖 `primary_html`），港股年报是纯文本没有这个 artifact；按用户要求复用大师资料库已有的通用 `PdfViewer` 组件（`src/components/PdfViewer.tsx`，纯 `url` prop，不绑定任何数据模型），`annual-report/[year]/page.tsx` 按 `filing.kind === "hk-annual-report"` 分支到它。PDF 原件不再依赖披露易原站（已知限速 ~85KB/s），下载后连同文本一起归档到 R2（`archiveFilingArtifact()`，`kind: "primary_pdf"`，复用 SEC 附件同一套归档/去重逻辑）。年份范围从"最近 2 份"改为 `--from-year`（默认 2020），复用 `onboard-company.ts` 已有的 `--from` 参数贯通，不新增用户可见 flag；泡泡玛特回填至 6 份（2020-2025）。**踩到一个 CORS 坑**：`PdfViewer` 若直接拿 `FilingArtifact.publicUrl`（R2 公开域名）当 `url`，pdfjs 内部的跨域 `fetch` 会被 CORS 拦截（R2 公开桶不带 `Access-Control-Allow-Origin`）——大师资料库的 PDF 从未暴露这个问题，因为它们从不直接把 R2 URL 给客户端，而是走 `/api/documents/*/[slug]` 同源代理（`getR2Stream()` 服务端转发）。照同一模式新增 `/api/filing-pdf/[...key]/route.ts`（用 `FilingArtifact.objectKey`，`@unique`，catch-all 路径还原后查库转发），阅读页改传代理路径而非 `publicUrl`。

### 跨市场扩展的三条结构约束

> 2026-07-26 复盘法拉利（RACE）onboarding 后补充。RACE 的核心教训是**管线把"抽取"当成确定性操作，而它实际是概率性的**（完整复盘见 TODO.md P0 ③）。这三条约束是把该教训前置到跨市场扩展上，避免在新市场重演。

**1. 不要直接照搬美股抽取逻辑到 A 股/港股，要按各自数据格式重新设计。**（2026-07-26 用户订正表述，原文把这条写成了"外链是长期终点"，是误读）

RACE 是在 SEC inline XBRL 这种**已经标准化**的格式上花了数天、把抽取器加到第四条策略（TOC 锚点 / 20-F 交叉引用表 / 页脚锚定 / 块扫描）——这条约束防的是**代码层面的复制粘贴**（直接套用 `extract-10k-sections.ts` 那套 Item 边界识别逻辑去处理格式完全不同的港股/A股 PDF），不是"放弃年报原文接入"。**产品终局是美股/港股/A股三个市场长期对等支持**，年报解析同样在目标范围内，只是港股/A股要用适合各自数据源的方法单独设计——Phase 3「外链巨潮资讯网/披露易」是当前阶段性方案，不是终态；具体年报原文接入的技术路径见下方最新进展。

**2. `market` 只允许在一个地方进入代码。**

即 identifier 的 parse/format helper（`parseCompanyId` 及其对偶的 format 函数）。页面**按能力渲染，不按市场分支**：Entity 对外体现的是"有没有财务数据 / 有没有年报原文 / 有没有持仓披露"，各 tab 据此决定渲染内容还是占位，而不是散落 `if (market === 'cn')` 判断。否则接入第三个市场时又要同步修改 5+ 处（`/insights` 曾按来源硬编码胶囊配色、每加一个来源要同时改 JS 与 CSS 两处，v0.39.23 已按同样思路收敛为单一配色）。

**3. `onboard-company.ts` 不要按市场 fork。**

该脚本真正值钱的是市场无关的骨架——checkpoint、每步查库 verify、断点续跑。跨市场差异只体现在 **steps 列表**：美股是现有七步（10-K 导入 → 股价 → 5 个 LLM 生成），A 股/港股 Phase 1 只有"Entity 种子 → 股价"两步。按 market 选择 steps 列表，而不是复制出 `onboard-cn-company.ts`。

### 技术方案（实际实现，非原计划伪代码）

#### 数据库

未改动 schema（`market`/`code` 2026-06-15 已加，`cik` 本来就 nullable，无需迁移）：

```prisma
model Entity {
  id            String   @id @default(cuid())
  type          String   // 'company' | 'security' | 'master' | 'concept'
  cik           String?  @unique // SEC 特有，A 股/港股为 null
  ticker        String?
  market        String?  // 'us' | 'hk' | 'cn' — cik is us-only
  code          String?  // 'AAPL' (us), '00700' (hk), '600519' (cn)
  // ... 其他字段不变
}
```

`Entity.code`/`market` 都没有 `@@unique`（只有 `@@index([market, code])`），所以按 `{market, code}` 写入时是手工 find-then-create/update，不是 Prisma 的 where-unique `upsert()`。

#### URL 路由（`src/lib/company-data.ts`）

`/company/[cik]` → `/company/[id]`。三个函数是唯一入口，其余代码一律通过它们，不自己判断 `market`：

- `parseCompanyIdentifier(raw)`：`(cn|hk)-(\d+)` 优先匹配（新格式，`\d+` 保留前导零）；否则退回原有的宽松 CIK 解析（`normalizeCompanyCik`，兼容裸数字/`CIK`前缀等历史输入，避免破坏旧 URL 的自动重定向）。
- `getCompanyByIdentifier(raw)`：解析后按 market 分发——US 查 `cik`，CN/HK 查 `{type: "company", market, code}`。
- `formatCompanyUrl(entity)`：唯一的 URL 构造函数，US 走 `/company/CIK{10位}`，CN/HK 走 `/company/{market}-{code}`。取代了原来两套已经互相 drift 的实现（`company-data.ts` 自己的 `formatCompanyCikUrl` + 独立的 `src/lib/cik.ts`，后者已删除）。

#### 财务数据导入（`scripts/fetch-cn-hk-financials-ak.py` + `scripts/import-cn-hk-financials-from-file.ts`）

两阶段：Python 用 akshare 拉数据 + 映射到 `LINE_ITEMS` + 写归一化 JSON，Node/Prisma 脚本读 JSON 写 `Financial`——照抄 `fetch-stock-prices-yf.py` → `import-stock-prices-from-file.ts` 的既有两阶段模式，不是新协调机制。港股映射用 `STD_ITEM_NAME` 中文科目名（`HK_ITEM_NAME_MAP`），不用 `STD_ITEM_CODE`——数字码按行业模板漂移（工商业是 `004xxx`，保险/银行是 `002xxx`，曾导致中国财险 2328 只导入经营现金流一项，2026-07-31 修复）；科目名跨模板共享或按模板设别名。A 股映射用 `CN_COLUMN_MAP` 中文列名，含银行模板别名（如 `归属于母公司的净利润`，见上）。导入前按 `REQUIRED_LINE_ITEMS` 做完整性检查：某科目全年份缺失=模板未覆盖，报错退出不导入；部分年份缺失只警告。`ExtSource` 新增 `kind: "akshare"`，`accessionNumber` 固定为 `"akshare-annual"` 做幂等键（重跑复用同一行，不是每次都新建）。

#### 前端

- 公司页概览区：`company.cik` 非空显示 CIK，否则显示 `${market.toUpperCase()} ${code}`（`src/app/company/[id]/page.tsx` 的 `identityFact`）。
- 财务分析 tab：`src/lib/currency.ts` 的 `formatMoneyInYi(value, currency)`——CNY 前缀 `¥`，HKD 前缀 `HK$`，USD/未知货币走原 `formatUsdInYi` 的无前缀行为（美股页面零回归）。货币来自 `getFinancialsCurrency()`（新函数，从 `Financial.unit` 取值），不是从 `market` 推断。
- 年度报告 tab：CN/HK 公司空态外链披露易 HKEXnews / 巨潮资讯网，文案随 `market` 切换。

### 首批目标公司

| 公司 | 市场 | 代码 | Yahoo Ticker | 状态 |
|------|------|------|-------------|------|
| 泡泡玛特 | 港股（港交所） | 09992 | 9992.HK | ✅ Phase 1+2+3 已完成（2026-07-26/27） |
| 贵州茅台 | A 股（上交所） | 600519 | 600519.SS | ✅ Phase 1+2+3 已完成（2026-07-27） |

### 成功标准

- Phase 1：✅ `/company/hk-09992` 可访问，展示中文公司名、行业、交易所、股价走势图。
- Phase 2：✅ 财务分析 tab 展示 5 年财务趋势（营收/毛利率/净利率/ROE/经营现金流/资产负债比等），货币正确标注为 `¥`。
- Phase 3：维持"外链巨潮/披露易"为长期方案（见「跨市场扩展的三条结构约束」第 1 条），不做本地解析。

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

#### 颜色规则（2026-06-11 设计审查后收口）

- **功能蓝唯一**：交互元素只用 `--apple-blue`（#0071e3），文字链接 `#0066cc`，深色背景链接 `--apple-link-dark`（#2997ff）。禁止再引入 Tailwind 蓝（#2563eb）、iOS 蓝（#007AFF）等第二种功能蓝；`--graphite-accent` 已指向 `--apple-blue`，新样式一律引用 token，不写硬编码色值。
- **阅读正文色统一**：所有阅读界面（股东信 / 财报 / 洞见）正文用 `--apple-near-black`（#1d1d1f）；双语信件中英文原文可用 `--apple-body`（rgba(0,0,0,.8)）做次级层次。
- **阅读行宽**：正文列以 `.md-reader` 的 780px / 财报 74ch 为准，新阅读界面不得超过。
- **大师品牌色豁免**：每位大师可定义一个品牌色（巴菲特 = 伯克希尔深红 #8B0000），**仅用于 master 页 hero 区的身份识别**，不得进入按钮、链接、正文或其他页面。新大师上线时品牌色在此登记，不随手发明。
- **数据语义色**：涨/跌/中性（`--up`/`--dn`/`--nl`）与首页信号 badge 的多彩属于数据语义色，独立于装饰预算，但必须 token 化使用。

### 技术栈

| 层 | 选型 |
|----|------|
| 前端 | Next.js 16 App Router · TypeScript · React |
| 样式 | 手写 CSS（globals.css），无 Tailwind |
| 数据库 | PostgreSQL via Prisma (Supabase) |
| Agent 服务 | pi-gateway（Express SSE，air7 :3456，PM2）· `@earendil-works/pi-coding-agent` |
| Agent LLM | DeepSeek（对话）· Claude API（批量生成分析内容） |
| 知识层 | GBrain（air7 :3457，Supabase 后端，pgvector 1536d）— 大师知识图谱 |
| Agent 工具 | `search_wisdom` → GBrain / `search_holdings` → Supabase SQL / `search_filings` → FilingSection SQL |
| 持仓数据 | SEC EDGAR 13F-HR |
| 财务数据 | SEC EDGAR XBRL（CompanyFacts + filing-level inline XBRL fallback） |
| 原始文件 | Cloudflare R2（PDF、SEC filing HTML、index、附件、data files） |
| 市场数据 | Yahoo Finance 导入脚本 + `StockPrice` |
| 产品分析 | PostHog（前端事件，仍在补齐事件体系） |
| 认证 | NextAuth.js |
| 部署 | Vercel（主站）· air7（pi-gateway + GBrain） |

### Agent 运行时链路

```
用户浏览器
  └─► buffett-tribe.com/agent（Vercel，Next.js）
        └─► /api/pi（Next.js 代理，AGENT_SECRET 留服务端）
              └─► relay.air7.fun/pi/chat（nginx → :3456）
                    └─► pi-gateway（PM2，Express SSE）
                          ├─► @earendil-works/pi-coding-agent → DeepSeek API
                          ├─► search_wisdom → GBrain（air7 :3457，pgvector 1536d）
                          ├─► search_holdings → Supabase（Holding SQL，Filer 表动态投资人清单）
                          └─► search_filings → Supabase（FilingSection SQL + FilingArtifact primary_html 现场解析）
```

关键文件：

| 路径 | 说明 |
|---|---|
| `services/pi-gateway/` | Express SSE 服务，部署 air7 port 3456 |
| `services/pi-gateway/ecosystem.config.cjs` | PM2 配置，`tsx --env-file=.env` 启动 |
| `services/pi-gateway/src/tools/search-*.ts` | 三个工具实现 |
| `services/pi-gateway/src/db.ts` | 共享 pg Pool（DIRECT_URL，SSL，懒加载） |
| `services/pi-gateway/AGENTS.md` | Agent system prompt（投研定位 + 三工具说明 + 回答格式） |
| `services/pi-gateway/deploy.sh` | 部署脚本（sync:shared → rsync → npm install → pm2 restart） |
| `src/app/api/pi/route.ts` | Next.js 代理路由 |
| `src/components/AgentChat.tsx` | React chat 组件（SSE 流、工具调用指示器、Markdown 渲染） |

### 路由结构

```
/                   首页（信号流 + 大师入口 + Hero Search → /agent）
/agent              投资研究 Agent（主入口，三工具 SSE 流）
/master/[id]        大师主页（资料库卡片 + 持仓）
/master/[id]/library  资料阅读（左侧年份/文章列表，右侧正文）
/master/[id]/holdings 持仓快照
/company            公司库（全部有 CIK 的公司，中英文名搜索过滤）
/company/[cik]      公司研究画布（当前仅美股 CIK；cn-/hk- 路由为规划，见「A股与港股覆盖扩展」）
/company/[cik]/annual-report  年度报告默认入口（跳转到最新可读年份）
/company/[cik]/annual-report/[year]  年度报告阅读
/insights           投资洞见（文章列表，?source= 按栏目过滤）
/login              登录
/reset-password     重置密码
/documents/*        PDF 全屏阅读器（年度会议、书籍、演讲、文章）
```

---

## 测试体系

> 2026-07-08 从零设计，L0/L1/L3/L4 已于 v0.38.13~15 落地；设计与落地过程记录见 git 历史（`TODO.md` 2026-07 版本）。

按数据链路风险分层设计，**风险对应优先，不追求覆盖率指标**。这个代码库的风险集中在"数据从外部进来（SEC EDGAR / Supabase / R2 / DeepSeek / GBrain / Yahoo Finance）、流经管线、呈现给用户"这条链路的完整性上，不是纯算法错误；生产数据自身漂移（如 `FilingSection.content` 被无留痕截断的事故）只有对真实数据跑的测试才能抓到——这是 L3/L4 权重高的原因。

### 六层金字塔

| 层 | 状态 | 内容 | 触发 |
|---|---|---|---|
| L0 静态检查 | ✅ | `lint` + `typecheck`（含 `typecheck:scripts`，历史遗留已清零） | 每次 push / PR（`test.yml`） |
| L1 单元测试 | ✅ | 纯函数 + fixture：`valuation-metrics`、`extract-10k-sections`、pi-gateway `search-filings-format` 等 | 每次 push / PR |
| L2 集成测试 | ⏸ 延后 | Prisma 查询 / API route，本地 pglite 影子库 | — |
| L3 Agent 工具契约 | ✅ | `tests/agent-tools/` 三工具各一组 golden case，对生产库只读真跑 | 每次 push（`search_wisdom` 除外，见下） |
| L4 数据管线健康 | ✅ | `data-integrity-check.yml` 每周一 02:00 UTC 跑 4 个只读检查（financial / security / holdings-coverage / filing-section），`--strict` 命中才开 GitHub issue | 每周 + 发版前 |
| L5 E2E 冒烟 | ⏸ 延后 | Playwright 核心用户路径 | — |
| L6 LLM 质量评估 | ✅ 已有 | `tests/evals/` 检索质量基准，非确定性，不进常规 gate | prompt / 检索逻辑变更时 |

### 关键决策

- **数据源策略**：L1 用 fixture 零外部依赖；L2（未来）用 pglite 影子库；L3/L4 直接对生产库只读——这两层存在的意义就是盯真实数据漂移，脱离生产数据就失去价值。
- **`npm run build` 有意不进 CI gate**：build-time 需要 RESEND / NextAuth / R2 / LLM 等生产密钥，不把生产凭证同步进 GitHub Secrets；发版前本地跑。
- **`search_wisdom` 的 L3 case 有意不进 CI**：需要按次计费的 `DASHSCOPE_API_KEY`，留在本地 / 发版前手动跑。`search_filings` / `search_holdings` 只需 `DIRECT_URL`，每次 push 自动跑。
- **`verify-10k-edgartools` 有意排除在每周巡检外**：它会对生产库写入（重导 AAPL/PDD/SU）+ 打真实 SEC API，只作发版前 / 改导入器代码后的手动冒烟。
- **Golden case 锚点**：固定挑覆盖不同 filing kind（10-K/20-F/40-F）和不同投资人的公司作为长期锚点，公司退市或数据结构变化时才更新。
- **测试存放约定**：纯函数 → `tests/*.test.ts`；Agent 工具契约 → `tests/agent-tools/`；数据完整性 → `scripts/check-*.ts` 纳入 L4 清单；Playwright（未来）→ `e2e/*.spec.ts`。

### 工作流约定（防止体系荒废）

- 新增/修改纯函数（解析、计算、格式化）→ 同 PR 补 L1 测试。
- 新增/修改 Agent 工具或参数 → 同 PR 补/更新 L3 case。
- 新增或修改数据导入逻辑 → 补充或跑一次对应 L4 完整性检查。
- 新增 LLM 生成管线 → 至少一个"生成内容非空且含预期字段"断言。
- 大版本（minor/major）发布前跑全量（L2/L5 落地后含集成与 E2E），红了不打 tag；patch 直推的既有版本节奏不变。

---

## 当前实现状态（v0.43.2）

### v0.43.2 变更（2026-08-20）

- **修复持仓历史页顶部投资人姓名没有链接返回大师主页**（`src/app/master/[id]/holdings/page.tsx` 两处——`view=quarter` 和 `view=company` 各一处，`src/app/globals.css` 的 `.holdings-hd`）：用户直接指出这个缺口。原来 `.holdings-hd` 是纯 `<div>`，头像+姓名+机构名是死文本，用户从持仓历史页想回投资人主页只能靠 `SiteNav`「大师」重新点、丢失当前上下文。改成 `<Link href={\`/master/${id}\`} className="holdings-hd">` 包住整块（参照 `/master` 列表页 `home-member-main` 整块可点击的既有模式），加 `.holdings-hd:hover .holdings-name { color: var(--apple-blue); }` hover 反馈。顺带触发了一次全站 23 个路由的只读导航审查（见 TODO.md P1「全站页面跳转/返回路径审查」），确认这不是孤例——`/letters/[type]/[year]`、`/company/[id]` 有类似的真实断链，已记录未实现。

### v0.43.1 变更（2026-08-20）

- **修复持仓历史图表"建仓前"被错误留白的 bug**（`src/components/HoldingsHistoryExplorer.tsx`，用户用段永平 × 莫德纳（MRNA）发现）：`/master/[id]/holdings?view=company` 的图表把"这只股票第一次出现在持仓里"之前的季度画成空白（不画线），但"最后一次持有之后"的季度早就被画成已知的 0——两条规则本该对称却没对称。用真实数据核实：段永平的 13F 记录从 2020Q1 起连续无缺，莫德纳直到 2021Q4 才首次出现，也就是说 2020Q1–2021Q3 这 7 个季度**有完整申报数据、莫德纳就是不在里面**，跟"清仓后缺失=已知的0"是同一种确定性，不是"不知道"。原代码注释把"建仓前"错误归类成"真的不知道"（whitespace），但既有的"13F 导入没有断档"这个不变量（`allQuarterTimes` 范围内任何缺失都是确定值）对建仓前后同样成立。修复：去掉只对"之后"生效的方向限制，改成只要在 `allQuarterTimes` 范围内没有真实持仓行，且这只证券确实有过至少一条真实持仓记录，就统一填 0——不再区分方向。莫德纳这个案例视觉验证：图表从 2020 起贴 0 线，2021Q4 陡起、2025Q2 陡降到 0（清仓），两端对称。影响范围是全站所有大师/投资人的"按公司"持仓图表，不只是这一个案例。

### v0.42.14 变更（2026-08-15）

- **"组合概况"卡片精简 + Alpha 投资人免责声明下线**：卡片下方复述指标的详情文本段（"11只持仓，市值$527.7亿，前五大合计83.99%…"）与上方指标卡片信息完全重复，删除；`最新持仓` 区块下 Alpha 投资人专属的"13F 仅覆盖可披露的美国公开市场多头及部分期权仓位，不代表XX全部组合"提示语一并删除。三个指标卡片（组合市值/持仓数量/前五集中度）文字改为横向居中（`.person-insight-metric` 加 `text-align: center`）。`PortfolioInsightItem.detail` 字段本身未删——仍在生成脚本里计算存库，只是不再渲染，保留给未来可能的用途（如 agent 工具读取）。

### v0.42.13 变更（2026-08-15）

- **Bill Ackman 2026Q2 13F"查不到"排查：基金重组了申报主体，不是导入空档**：`check:13f-quarter-coverage`（v0.42.10 新增）一直显示 bill-ackman 缺 2026Q2，但直接查 SEC `data.sec.gov/submissions` 才发现，老 CIK（1336528，Pershing Square Capital Management, L.P.）在 2026-08-14 按时申报了，只是类型变成了 **13F-NT**（"通知"——本主体持仓已并入另一份合并报告，自己不再单独报数字），真正的 13F-HR 转由新主体 **CIK 2026053（Pershing Square Inc.，2026-04-23 由 "Pershing Square Holdco, L.P." 改名而来）**申报——早有伏笔，v0.42.8 导入的股东信标题就是"Pershing Square, Inc. 2026年第二季度致股东信"，当时没意识到这也意味着 13F 申报主体换了。`edgartools_13f_report_dates.py`/`edgartools_13f_extract.py` 都只认 `form="13F-HR"`，13F-NT 被自然过滤，所以之前"查不到"是正确行为，不是 bug。**修复**：`Filer.filerCik`（bill-ackman）改成 `2026053`，`name` 改成 "Pershing Square Inc."；`upsertFilerEntity()` 按 `tribeId` 匹配 Entity、不靠 CIK，所以换 CIK 不影响已导入的历史 Holding 数据（2020Q1–2026Q1 仍是用老 CIK 导入的，物理上留在库里不受影响）。重跑 2026Q2 导入拿到 14 条持仓（市值 $194.7亿），补跑对应季度 `PortfolioInsight`，`check:13f-quarter-coverage` 复跑显示 `2025Q2–2026Q2, 5/5` 全绿（新 CIK 自己的申报历史只从 2025Q2 开始，检查脚本按新 CIK 的实际起点算基准，不影响库里更早的历史数据）。**这是一个值得记住的模式**：投资人的基金结构可能中途重组（换报告主体、改名等），13F-NT 是识别信号——以后遇到"某投资人某季突然查不到"，先查该 CIK 是否申报了 13F-NT 而非静默假设是导入遗漏。

### v0.42.12 变更（2026-08-15）

- **`PortfolioInsight` 接入 `StockPrice` 与 `MasterProfile` 做真实背景依据**：此前"风格一致性""价格背景"这两个分析维度完全靠 LLM 凭刻板印象编，跟 v0.42.10 修的份额误判是同一类风险（没有依据的判断）。现在：① 每个真实增减持标的会 join 该季度 `StockPrice`（区间高低点、季度涨跌幅），LLM 被明确要求只描述"该季度价格环境"、不得声称知道具体交易日期或"精准抄底/逃顶"（13F 只披露季末快照）；② 接入 `MasterProfile.bio`（纯履历/理念文本，不含 `fundOverview`——后者可能残留旧版本算出的持仓统计口径，风险与份额误判同源，故不用）作为"风格一致性"判断的参考依据，而不是无依据评论。价格数据本身有过期风险（`StockPrice` 周更新但无 cron 兜底，见 v0.42.11 数据节奏梳理）——新增 `STALE_TOLERANCE_DAYS=14` 兜底：某标的价格数据离季末超过 14 天没更新就直接不展示该项，不拿半季度数据冒充全季度。验证：巴菲特/李录重新生成后，narrative 里出现"逢股价回落区间增持""13F 仅披露季末快照，具体交易时点无从确认"这类有据可查的表述，Terry Smith 那份甚至根据 bio 主动识别出本季调仓规模"明显偏离其一贯长期持有纪律"——即用于发现风格背离，不是无脑附和。
- **"组合概况"卡片重构**：原来的"跟踪持仓"字段其实是`top.slice(0,10).length`（展示条数，被截断），"本季变动"是四类各自 `.slice(0,7)` 之后的加总（上限 28，不是真实值）——两个字段口径不同又并排展示，读起来像"只跟踪10只怎么会有24笔变动"的自相矛盾（一次真实复盘案例：Terry Smith 41 只持仓，展示"跟踪持仓10"却"本季变动24"）。改为：`holdingCount`/`newCount`/`addCount`/`trimCount`/`exitCount` 全部用真实未截断计数；新增 `totalValueUsd`（13F 可报告持仓市值，**明确不等于基金 AUM**——这个陷阱 `MasterProfile` 那次已经踩过一次，UI 上用 `title` 属性加了提示）。布局：市值/持仓数量/前五集中度三个指标一行，新进/加仓/减仓/清仓合并成一张长卡片占一行、内部按新进(绿)/加仓(蓝)/减仓(橙)/清仓(红)分栏配色（复用了页面已有但之前未被使用的 `.person-insight-card--new/add/trim/exit` 色值）。金额格式统一为 `$` 前缀 + `formatUsdInYi()`（如 `$136.5亿`），不用"亿美元"这种中文单位+外文货币名混排的后缀写法。2026Q1/Q2 全部 12 位 filer 的 `PortfolioInsight` 已用最终版脚本重新生成。

### v0.42.10 变更（2026-08-15）

- **修复 `PortfolioInsight` 增减持误判**：`generate-portfolio-insight.ts` 此前用 `percentOfPortfolio` 季度差值（阈值 0.08pp）判定"增持/减持"，但这个指标会被股价波动和其他仓位膨胀稀释污染，跟"这个人有没有真的交易"无关。对抗式审查发现两个已生成并展示在线上的真实案例：巴菲特那份 2026Q2 洞察把股数完全未变的可口可乐（400,000,000 股，持有多年从未卖出）、穆迪、西方石油、雪佛龙说成"被小幅减仓"；李录那份把股数同样未变的腾讯音乐说成"减持"、谷歌 A/C 类说成"增持"。改为用真实份额变化判定（复用持仓表已有的 `computeShareDeltaPct`，阈值 1%），`percentOfPortfolio` 只用于展示占比，不再参与分类。顺带接入真实的 `Entity.sector` 字段做行业标注（没有数据的标的不让 LLM 瞎猜，堵住了把 H&R Block 误标"金融能源"的口子），删掉了 `src/lib/master-data.ts` 里从未被调用、带着同样 bug 的重复实现（`buildHoldingInsights`/`buildStructuredPortfolioInsight`，`getLatestHoldingChangeSet` 精简为只返回实际被用到的 `latest/base/top`）。修复后用李录、巴菲特两份重新逐条核对份额数据全部通过；2026Q1、2026Q2 全部 filer 的 `PortfolioInsight` 已用修复后的脚本重新生成（Q1 因为是 Q2 的对比基准，即使不展示也需要保证数据正确）。
- **新增 13F 季度覆盖巡检**（`scripts/check-13f-quarter-coverage.ts`，`npm run check:13f-quarter-coverage`）：13F 导入没有定时任务、全靠手动触发，某位投资人某一季被漏掉不会有任何提示——用 SEC EDGAR 的真实 report date 列表（新增 [edgartools_13f_report_dates.py](/Users/rafael/R129/buffett-tribe/scripts/edgartools_13f_report_dates.py)，只读 `filing.report_date`、不调用 `.obj()`，快且不会踩到 SGML 解析崩溃）当基准，核对每位 filer 从 2020Q1（或其自身首份 13F 更晚的话，以那份为准）到 EDGAR 最新 filing 是否连续无缺。首次跑就抓出两个此前完全没人发现的静默空档：alex-sacerdote 缺 2026Q1（filing 早在 2026-05-15 就已披露，只是没人导入过）、leopold-aschenbrenner 缺 2024Q4 和 2025Q1；均已排查确认 EDGAR 数据本身完好（不是 v0.42.9 修的那个 SGML 崩溃 bug）、补齐导入并补跑对应季度的 `PortfolioInsight`，复跑巡检 12/12 全绿。

### v0.42.9 变更（2026-08-15）

- **修复 `--quarter-list` 模式下 edgartools 13F 提取器的崩溃**：`edgartools_13f_extract.py` 此前对扫描窗口内每一份 filing 都无条件调用 `filing.obj()`（完整解析 SGML/XML info table）来读取 `report_period`，季度过滤反而放在 TS 侧、等全部解析完之后才做——为了要一个季度，实际上把 filer 的全部历史 filing 都解析了一遍。Terry Smith（Fundsmith）、Chris Hohn（TCI Fund Management）各有一份 2018/2020 年的老 filing，edgartools 当前版本解析不动其 SGML，直接把整个 CIK 的导入进程崩溃退出。根因是解析顺序反了：`filing.report_date` 其实是 filing 列表自带的免费字段，不需要 `.obj()` 就能读到。修复为两层：① `import-13f-edgartools.ts` 把目标季度换算成 report-date（新增 `quarterEndDate()`，`scripts/lib/13f-import-core.ts`）传给 Python，脚本先用免费的 `report_date` 筛出目标季度再调用 `.obj()`，避免解析任何不需要的历史 filing；② 单份 `.obj()` 调用包 try/except，解析失败 warn 并跳过而不是让整批崩溃。修复后 terry-smith/chris-hohn 的 2026Q2 提取从崩溃变为 ~3 秒（只解析 1 份而不是上百份）。
- **2026Q2 13F 全量导入 + `PortfolioInsight` 补齐**：12 位 tracked filer 里 11 位已导入 2026Q2 持仓（含前述修复解锁的 terry-smith/chris-hohn），Bill Ackman（Pershing Square）截至发布时 SEC 上仍无 2026Q2 filing，非 bug；随后为这 11 位补跑 `generate:portfolio-insight`（此前遗漏——持仓导入不会自动触发这一步，两者是分开的手动环节）。
- **`/master/[id]` 移除"重大持仓披露"（`BeneficialOwnership` / 13D-13G）表格**：仅去掉展示层（`src/app/master/[id]/page.tsx` 的 `#ownership` section 及其数据获取），原因是这块的产品逻辑和数据处理都还不成熟，不适合展示给用户。`BeneficialOwnership` 数据表、`import:beneficial-ownership` 导入脚本、`getBeneficialOwnershipFilings()` 均保留不动——是独立数据管线，等展示逻辑想清楚后可以随时重新接回。

### v0.42.8 变更（2026-08-14）

- **Bill Ackman 资料库新增一份原始文档（Pershing Square, Inc. 2026 Q2 致股东信）**：作为一次性例外写入 `Document` 表（`ownerId=bill-ackman`），不改变 `Filer.isMasterPersona=false`——Alpha 投资人默认仍无 wisdom 资料内容，仅个别投资人可按需补充单篇原始材料。为此照搬 buffett/duan/lilu 既有的"每个 owner 一份阅读路由文件夹"模式，新增 `/documents/bill-ackman/[slug]` 和 `/api/documents/bill-ackman/[slug]`，并放宽 `DocumentOwnerId` 类型联合与 `getLibraryItems()`（`src/lib/master-data.ts`）的 owner 白名单。评估过是否借此机会把 4 个 owner 路由收成一份动态路由 + `Document` 表加 `slug` 字段，从第一性原理判断为过早抽象（目前只出现过一次，真正的"持续、零代码"扩展场景已有 `InsightPost` + `tag-insight-masters.ts` 承担），故按既有风格复制而非重构；等这类需求再出现 2–3 次后再收敛。

### v0.42.7 变更（2026-08-14）

- **`MasterProfile` 改为纯公开知识总结，不再读任何持仓/13F 数据**：v0.42.6 曾让 `fundOverview` 引用真实计算的 13F 可报告持仓总市值当"基金规模"，但这个口径本身就窄于基金真实 AUM（13F 只覆盖美股多头且过披露门槛的部分，不含空头/现金/非美股/私募），把内部统计冒充成整体规模是误导——已撤回。现在 `generate-master-profile.ts` 的 prompt 只传投资人姓名，等价于直接问 LLM"总结一下这个人和他的基金公司"；system prompt 也从"价值投资分析师"改成中性的"研究助理"，避免把非价值投资风格的大师（如成长股/VC 出身的 Gavin Baker、Micky Malka）统一套上价值投资腔调。
- **`/master/[id]` 资料库区改为统一渲染，替换掉三套互不兼容的实现**：此前 buffett 硬编码 3 张卡、lilu/duan 走 `Document` 表、（v0.42.6 新增的）Alpha 投资人访谈走 `InsightPost` 表，三条路径各自处理、样式易失衡（比如某篇文章 `description` 为空时卡片会明显变矮）。新增 `getLibraryItems()`（`src/lib/master-data.ts`）统一成 `{badge, title, subtitle, date, href}`，合并三个数据源：`Source` 表信件（信件）、`Document` 表（演讲/文章/书籍，已有真实数据，非占位）、`InsightPost` 表（访谈/文章/信件，按 `source` 播客/媒体名分类，如 Acquired 是双主持人商业解构不算访谈、Ribbit Capital 那篇是致 LP 信不是文章——分类前逐个读了实际正文，不是按栏目名猜的）。顺带删除了确认为死代码的 `getMasterClassSummary`（`masterClass` 预设的 lilu/duan 分支从未真正取数，buffett 分支被硬编码分支抢先短路，从未被执行到）。`description` 为空时用文章正文生成摘要兜底，卡片不再高矮不一。
- **新增 `tag-insight-masters.ts`**：把 `/insights` 里实质讨论某位大师的文章关联到其 `entityIds`，供资料库区展示。标题含人名或 `tags` 命中人名即匹配，不需要 LLM（这批译文标题本身就是"标题 (英文人名)"的可靠格式，与 `tag-insight-companies.ts` 需要语义判断公司提及是否成立不同）。首次运行覆盖 9 位大师：Gavin Baker 7 篇、Alex Sacerdote/Leopold Aschenbrenner/Micky Malka 各 1 篇，其余大师暂无匹配。

### v0.42.6 变更（2026-08-13）

- **Bill Ackman（Pershing Square Capital Management, L.P., CIK 1336528）onboard 为 Alpha 大师**：`tribeId=bill-ackman`，13F 覆盖 2020Q1–2026Q1 全季连续（27 份 filing），持仓 4 家公司（UBER/HHH/SEG/HTZ）全部补齐公司页；SEG 因 2024 年中分拆、暂无可用于 P/E 估值的正 EPS 历史，`valuation_analysis` 暂缺（数据层面正常，非 bug）。
- **修复 `percentOfPortfolio` 跨文件披露的错误计算**：`importFiling()` 此前把单份 accession 内的持仓总值当成整季度总值来算份额，一个季度若跨多份 13F 文件披露（Pershing Square 常见的保密期满补报模式）就会把补报的单一仓位错算成 100%。新增 `reconcilePercentOfPortfolio()`（`scripts/lib/13f-import-core.ts`），按 `(holderEntityId, asOfDate)` 重新计算整季度真实份额，导入顺序无关。已用 Bill Ackman 2021Q4（CP：100%→1.87%）、2024Q4（HTZ：100%→0.36%）验证修复，其余 261 个已有 `(filer, quarter)` 组合本就未跨文件披露，不受影响。
- **修复多个 LLM 生成脚本的 reasoning 模型 token 截断**：当前 `AI_MODEL=deepseek-v4-flash` 是推理模型，`reasoning_content` 会与 `content` 抢占同一份 `max_tokens` 预算；`generate-portfolio-insight.ts`（800）与 `scripts/lib/company-generation.ts` 的共享 `callJsonLLM()`（各调用方原为 1500–10000 不等）在推理耗时较长的 prompt 上会把预算耗尽在 reasoning 阶段，导致 `content` 截断成非法 JSON。全部统一提到 16000（经 API 实测：同一 prompt 推理消耗曾达 4700–9000+ token，16000 留有余量）。
- **`MasterProfile` 的 `bio`/`fundOverview` 分工收紧**：`fundOverview` 此前会复述持仓集中度/行业分布/季度调仓，与 `PortfolioInsight` 内容重复，且这些数字曾出现模型自行估算（如"资产规模曾达百亿美元级别"这类无法核实的模糊描述）。现在 `bio` 专注人物经历与投资理念，`fundOverview` 只写基金背景+规模（规模改用真实计算的最新一期 13F 可报告持仓总市值，不再由模型猜测），两者都不再涉及具体持仓——已对全部 9 位 Alpha 大师重新生成验证。

- **Ferrari (RACE) onboarding 收尾**：补跑 `import:stock-prices:yf`（501 天股价）和 `generate:valuation-analysis`（此前因缺 `StockPrice` 被脚本判定"数据不足"跳过），RACE 的 5 个生成物（company_profile / business_overview / value_analysis / management_analysis / valuation_analysis）现已全部齐全。
- **修复 10-K 印刷体标题（尾随句号）导致的 item 边界扫描全军覆没**（`isLikelyHeadingText()`，`scripts/lib/extract-10k-sections.ts`）：v0.39.17 新增的 `check:filing-section:integrity` 静默失败检测上线后命中 65 家 filing，逐个排查后发现主因——该函数在检查"是否以 ITEM/NOTE 开头"之前，先无条件拒绝"以句号/冒号结尾"的文本；但"Item 1. Business."这种把句号也印在标题里的格式在 SEC inline-XBRL filer 里很常见（GE/JPMorgan 优先股/Kraft Heinz/P&G 等都是这个格式），导致这条判断顺序把真正的 Item 标题当句子误杀，10-K 的 block-scan 兜底路径（`extractTargetSections()` 里 `preferTocAnchors`/20-F 交叉引用表都不适用时的最后一层）因此完全找不到任何 item 边界。改成先判 ITEM/NOTE 模式再判尾标点。本地对 12 家公司的真实原文重跑验证：CHTR/DPZ/FND/HPQ/JEF/JPM-PM/KHC/MCK/MDLZ/MTB/NVR/PG 全部从 0 section 恢复到 20–23 个；反向验证法拉利/GOTU/JOYY 三家不受影响（它们走 20-F 专属路径，不经过这个函数）。**代码已修复，生产库尚未回填**，详见 `TODO.md`。
- 剩余 65 家名单里另外三类，均非本次代码 bug 范畴：GE/C-PR(Citigroup)/SYF(Synchrony) 是 10-K 正文本身"incorporated by reference"到单独 exhibit，没有可抽取的正文；BN/GOLD 2021/PG 2020 的一份是 10-K/A 等修正案，0 章节属正常；INOD 2020 是旧式 SGML 格式的孤例。详见 `TODO.md`。

### v0.39.17 变更（2026-07-23）

- **Ferrari (RACE) 20-F `FilingSection` 抽取修复**（`scripts/lib/extract-10k-sections.ts`，解决 v0.39.12 遗留的"未解决"项）：根因是 EU 合并版 20-F（Dutch 法定年报 + SEC 20-F 合一）用居中 `<span>` 渲染裸页码（如 `<div style="text-align:center"><span>44</span></div>`），不含"Page 44"这类上下文文字，原有 `parsePageNumber()` 的文本正则完全命中不到；且该版式一页内容平均跨 ~18 个顶层 `<div>`，不满足既有"一个顶层 div = 一页"的假设。新增 `collectPageFooterMarkers()`：扫描每个顶层 div 内是否有"叶子 `<span>` + 纯数字文本 + 父级 `<div style="text-align:center">` + 不在 `<table>` 内"的居中页码 span，建立 `页码 → 顶层 div 索引` 映射（对法拉利 2022/2024 两份原文实测：299/296 个候选页码，4→302 / 4→299 严格递增，0 异常 0 重复）；再用 `resolvePageDivRange()` 把"某页码"解析成"上一个已知页码的 div 之后 → 本页码 div（含）"的顶层 div 区间，拼接区间内所有顶层 div 的 HTML 作为该 section 的原文片段。作为 `extractVia20FCrossReferenceTables()` 里逐 section 的 fallback（原有基于文本页码的路径失败时才触发），不影响 GOTU/JOYY 等已工作的 20-F filer（回归验证：两家 2024 年报仍分别抽出 29/30 个 section，和修复前一致）。修复后法拉利 2022–2025 四年 `FilingSection` 从 0 个恢复到 18–21 个，`onboard-company.ts` 剩余的 4 个生成脚本（company_profile / business_overview / value_analysis / management_analysis）已补跑完成；`generate:valuation-analysis` 因 RACE 缺 `StockPrice` 数据被跳过，见 `TODO.md`。
- **`check:filing-section:integrity` 补上"静默抽取失败"检测**（同一次排查发现的监控盲区，见 v0.39.12 的 P2 记录）：原巡检只检查"已有 section 的 filing 是否缺 `primary_html` artifact"，一个 filing 抽取返回 0 个 section（无异常，纯静默）完全不在检查范围内。新增第二个查询：有 `primary_html` artifact 但 `sections: { none: {} }` 的 filing，计入 `--strict` 判定。上线即命中 **65 个此前不可见的历史静默失败**（10-K 和 20-F 都有，样例含 GE/DEO/KHC/CHTR/DPZ/LEN/NVR/JEF/C-PR/INOD），根因未逐一排查，记入 `TODO.md` P2 待处理；`data-integrity-check.yml` 周检从这次起会因此持续标红开 issue，直到清掉积压或加豁免清单。

### v0.39.12 变更（2026-07-21）

- **年报阅读页重做**：移除左侧目录 + 附件侧栏（原因见「年报阅读」节）；新增字体大小 / 行间距可调控件（iframe 内用 `zoom` 缩放字体、`!important` 覆盖内联 `line-height` 且排除 `<table>`，偏好 `localStorage` 持久化，用 `useSyncExternalStore` 读取以避免 SSR/客户端首屏文字不一致的 hydration mismatch）；新增 AI 解读入口，不复用大师页的居中弹窗（`MasterAgentDialog`），改为新建 `FilingAgentPanel` 左右分栏停靠（右侧固定 420px），`AgentChat` 的 `context` 类型从只认 `{masterId,masterName}` 扩展为联合类型，新增 `{companyName,ticker?,periodYear?}` 分支。
- **两个真实 bug 修复**（均为浏览器实测发现，非猜测）：
  - 字体/行间距控件原挂在 iframe 的 `load` 事件上；法拉利这份年报内嵌 40 张图片，全部经 `/api/filing-image` 代理转发，部分单张耗时 1–3.5 分钟，导致 `load` 事件迟迟不触发、控件长时间"点了没反应"。改为轮询 iframe `contentDocument.readyState`，DOM 解析完即生效，不等图片。`/api/filing-image` 本身的代理延迟未处理，可能值得单独排查（未纳入本次改动）。
  - 双栏模式下宽表格（SEC 年报常见 `display:inline-table;width:100%` 但内容撑破容器）导致正文横向滚动：只在 `<body>` 设 `overflow-x:hidden` 不够，实测该内联 XBRL 文档的滚动元素是 `<html>`，body 的 overflow 未按预期传导到 viewport；改为 `html,body{overflow-x:hidden}` 同时锁定 + `table{max-width:100%;overflow-x:auto}`。
- **20-F 目录表识别修正**（`scripts/lib/extract-10k-sections.ts`）：`is20FTocTable`/`normalize20FItemCell` 支持 EU 合并版年报（法拉利等）用"Cross Reference"作表头、`Item 1.`带前缀的写法，向后兼容，未影响现有 GOTU/JOYY 两家 20-F filer。当时**未解决**法拉利 2022–2025 四年 `FilingSection` 抽取仍为 0（正文标题与 `Item N` 编号完全脱钩，TOC 表格页码也定位不到内容）——已在 v0.39.17 修复，见上方「v0.39.17 变更」。

### v0.38.16–v0.39.11 变更（未记录）

版本号已推进但此区间的逐条变更未回写本文档，如需还原请查 git 历史（`git log v0.38.15..v0.39.11`）。

### v0.38.9–v0.38.15 变更（2026-06-26 ~ 2026-07-14）

- **Filer / Company 身份拆分**（v0.38.15）：新增 `Filer` 表（`tribeId` / `filerEntityId` / `companyEntityId` / `isMasterPersona`）作为"这个投资人是不是也是一家公司"的唯一权威来源。修复 Berkshire 双 Entity（filer 身份 + 公司身份）导致李录/段永平持仓里 BRK-A/BRK-B 链到空实体的问题；5 处把 `type="master"` 当公司候选的查询/打分逻辑全部收口为只认 `type="company"`；`search_holdings` 等 3 处硬编码 3 投资人清单改为从 `Filer` 表动态读取。
- **13F 追踪范围核准为 5 位投资人**：核心 3 位（buffett / lilu / duan）+ Alpha 2 位（gavin-baker = Atreides、alex-sacerdote = Whale Rock）。2020Q1–2026Q1 每季连续无缺（3 处历史异常已排查修复：Atreides 2022Q2 缺失重导、2 条 13F-HR/A 空重复行删除）。
- **测试体系 L0/L1/L3/L4 落地**（v0.38.13~15）：CI push gate（`test.yml`：lint + vitest）、pi-gateway 纯函数单测、三个 Agent 工具 golden case 契约测试（`tests/agent-tools/`，对生产库只读真跑）、每周数据完整性巡检 workflow（`data-integrity-check.yml`）+ 新增 `check:filing-section:integrity`。`typecheck:scripts` 历史遗留错误清零——顺带发现并修复 `import-10k-edgartools.ts` 自 FinancialFact 删表后完全跑不通的问题（死代码调用点删除）。详见「测试体系」节。
- **search_filings 全文修复**（v0.38.12）：`FilingSection.content` 曾被一次无留痕手工操作截断到 3000 字，命中章节改为从 `FilingArtifact(kind=primary_html)` 现取原文、`extractTargetSections()` 现场解析，`content` 降级为 fallback-only。
- **注册用户邮件公告**（v0.38.10）：`npm run send:announcement` 批量邮件脚本。
- **pi-gateway 运维收口**（v0.38.14）：air7 目录与 PM2 进程名按项目命名空间化，移除遗留 systemd unit；`tests/` 排除出 app tsconfig 修复 Vercel build。

### v0.38.0–v0.38.8 变更（2026-06）

- **投资研究 Agent 上线**（`/agent`）：pi-gateway（Express SSE）+ `@earendil-works/pi-coding-agent`，DeepSeek LLM，PM2 管理，nginx 代理。
- **三工具架构**：`search_wisdom`（GBrain 语义检索）、`search_holdings`（13F 持仓 SQL）、`search_filings`（年报章节 SQL）全部上线验证。
- **工具调用指示器**：AgentChat 实时显示工具名 · 参数摘要 · 返回条数，三个工具各有独立 label 和细节格式。
- **GBrain 知识库**：巴菲特年会 1994–2023（503 chunks）、股东信 1965–2025 + 合伙人信（1712 chunks）、段永平问答录（290 chunks）、李录 PDF（151 chunks），OpenAI text-embedding-3-large 1536d。
- **FilingSection 覆盖**：约 120 家公司 2020–2025，10-K / 20-F / 40-F 标准 SEC item 章节，`search_filings` 支持 section alias、keyword excerpt、公司名/ticker 检索。
- **首页跳转统一**：首页 Hero 区域点击任意位置跳转 `/agent`，Hero 为纯装饰组件。
- **Insights 过滤**：`/insights?source=` 按播客/栏目过滤，URL 参数驱动，服务端渲染。
- **deploy.sh**：`services/pi-gateway/deploy.sh`，rsync → npm install → pm2 restart，支持 `--restart-only`。

### v0.37.5 变更（2026-06-13）

- **管理分析 / 估值分析 LLM 化**：55 家公司全部生成管理分析 + 估值分析，公司页 tab 渲染真实 LLM 内容。
- **CapEx / FCF lineItem 规整**：`backfill:capex` 回填，valuation-metrics 切换真 FCF / OCF proxy，页面动态标注口径。
- **回购股数序列**：`ShareRepurchaseAmt` lineItem，管理分析"资本配置"卡完整。

### v0.37.0 变更（2026-06-04~15）

- **A 股与港股覆盖前置**：新增 `Entity.market` 和 `Entity.code` 字段与复合索引，为 A 股/港股接入做 schema 准备（路由泛化与 akshare 导入未实施，见「A股与港股覆盖扩展」实施状态）。
- **FinancialFact 删除**：0 行，从 schema 删除，`Financial.sourceFactIds` 注释指向 R2 data_file artifact。
- **Document 表入库**：8 个大师 PDF 从硬编码 `documents.ts` 迁入 `Document` 表。
- **容量治理**：数据库从 333MB 降至 244MB，ExtSource 瘦身、StockPrice 降采样、GCV 保留策略脚本建立。

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
| /agent 投资研究 Agent | ✅ 已上线（v0.38.0+） |
| /master 大师页面 | ✅ 已上线 |
| /company/[id] 公司页 | ✅ 已上线（美股/港股/A股统一路由） |
| A 股/港股覆盖 | ✅ 已上线（贵州茅台 600519、泡泡玛特 09992，2026-07-27） |
| /insights 洞见过滤 | ✅ 已上线（v0.38.x，?source= 过滤） |
| Company Canvas（6 Tab UI） | ✅ 已实现 |
| 管理分析 / 估值分析 Tab（LLM） | ✅ 已上线（v0.37.5，55 家） |
| 年度报告 Tab | ✅ 已上线 |
| 10-K / 20-F / 40-F 标准目录阅读 | 🟡 原文 iframe 阅读可用；侧栏目录靠 h1-h3 启发式抽取常为空、退化为附件列表，改造中（TODOS P0-①） |
| 价格历史图 | 🟡 已上线 ticker 口径，securityId 与事件 marker 待补 |
| search_wisdom 工具（GBrain） | ✅ 已上线 |
| search_holdings 工具（13F SQL） | ✅ 已上线（5 位投资人，Filer 表动态读取） |
| search_filings 工具（年报章节） | ✅ 已上线 |
| GBrain 知识库 | ✅ 已上线（4 位大师，2656 chunks） |
| FilingSection 年报章节 | ✅ 已上线（约 120 家，2020–2025） |
| ChatMessage 对话记录 | ✅ 已实现 |
| 测试体系（L0/L1/L3/L4 + CI） | ✅ 已上线（v0.38.13~15，L2/L5 延后） |
| Filer / Company 身份拆分 | ✅ 已完成（v0.38.15，Filer 表） |
| PostHog 前端埋点 | 🟡 已接入 provider 与 chat_sent，事件体系待补齐 |
| 等候名单 | ✅ 已实现 |
| Company Brain 写回（Claim） | ❌ 已从计划移除（2026-07-17 决策：方向未想清楚，暂不做） |
| 数字人 / 语音实验 | ❌ 已下线（2026-06-11 范围收缩） |
| 持仓数据更新 | 🟡 以季度批处理为主 |
| /idea 对话研究室 | ❌ 已下线（2026-08-02，代码已清理，见「/idea — 对话研究室」一节）|

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

**活跃工作队列与优先级以 `TODO.md` 为准**（当前 P0：年报阅读器导航修复、A 股/港股 Phase 1；P1：Agent 接入公司页等 Agent 主线三项）。以下为产品层 backlog，未纳入当前排期：

#### 体验收尾

- 对话质量验收：准备 30 个测试问题，验证 Agent 三工具的召回与引用质量。
- 移动端体验打磨：阅读页、公司页在手机上的交互细节。

#### 用户数据 + 增长

- 补齐关键事件埋点：`chat_start`、`chat_message`、`source_click`、`annual_report_open`、`price_range_change` 等。
- PostHog Cloud 中国可达性测试。

> 商业化（LemonSqueezy 订阅集成、免费 vs 会员次数限制、免费到付费转化链路）已于 2026-08-21 从计划移除，全站暂不收费；登录门禁只是功能访问区分，见本文档「用户体系与访问控制」一节。未来若要收费再另行设计排期。

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
| `Code` | A 股/港股数字代码（不含 Yahoo 后缀；港股补零） | `600519`, `09992` | 存在于 `Entity.code`，与 `market` 组合查询 |
| `Accession Number` / `accno` | EDGAR 单次申报的唯一受理号 | `0001193125-26-226661` | 存在于 `ExtSource.accessionNumber`，与 `filerEntityId` 组成唯一约束 |
| `Security.kind`（2026-08-21 新增） | 13F 申报里该证券的工具类型，非"公司/非公司"二元判断 | `equity`, `etf`, `fund_trust`, `right_warrant`, `convertible_bond`, `option`, `unclassified` | 13F 只按 §13(f) securities 披露，不只是运营公司——同一份 13F 里混有 ETF/REIT信托单位/权证/可转债/期权。`scripts/lib/security-kind-classify.ts` 按 `titleOfClass`/`putCall` 关键词分类（不读发行人名字，避免把 Northern Trust 这类真公司误判成信托）；`/company` 目录只排除"该 entity 全部 Security 都是非 equity kind"的条目（如 INVESCO QQQ TR），持仓明细表对应行加类型徽标且不再可点击进公司页；模糊值一律落 `unclassified`，不猜 |
| `Holding.putCall`（2026-08-21 新增） | 这一条 Holding 记录本身是不是期权仓位；与 `Security.kind` 是两个不同维度——期权的底层证券仍是 `equity` | `NONE`（默认）/ `PUT` / `CALL` | 13F 对期权持仓复用底层正股的 CUSIP（不单独分配），此前 `importFiling()` 按 `securityId` 聚合时会把同 CUSIP 下的 shares/value 直接相加，导致期权名义股数/市值被悄悄并入正股持仓（实测 Leopold Aschenbrenner 2026Q2：Bloom Energy 正股 6,272,808 股 + Call 期权 145,800 股被合并显示成 6,418,608 股；Infosys 全部持仓其实是一份 Put，却显示成"持有50万股正股"）。修复后聚合/唯一约束都改为 `(security, putCall)` 复合维度，`Holding.@@unique` 从 `(holder, security, asOfDate)` 扩到 `(holder, security, asOfDate, putCall)`；SEC 13F 只强制披露多头（买入）期权仓位，卖出/写出的仓位（如段永平常用的 sell put 策略）规则上不用报，所以这个字段出现即代表买入 |

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
| `XBRL` | 结构化财报标记语言 | `Financial` 标准化项目（仅美股）；原始 facts 归档为 R2 data_file artifact（`FinancialFact` 表已于 2026-06-15 删除） |
| `EDGAR` | SEC 披露系统 | filing discovery、submissions、companyfacts、原文归档 |
| `akshare` | 中文金融数据 Python 库 | A 股/港股公司信息、财务报表、股价数据获取 |

### 时间字段

| 字段 | 含义 | 示例 | 所属模型 |
|------|------|------|----------|
| `asOfDate` | 持仓生效报告日，通常对应报告期末 | `2026-03-31` | `Holding.asOfDate` |
| `filedAt` | 向 SEC 实际提交日期 | `2026-05-15` | `ExtSource.filedAt` |
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
| `open/high/low/close/volume` | 日线价格 OHLCV | `open=190.1` | `StockPrice` |

### 稳定主键原则

- 13F 导入与增量对比的工程主键使用 `Holding.securityId`；`ticker` 主要用于展示和价格图早期查询。
- `Security` 通过 `companyEntityId` 关联公司实体；同一公司可以有多个 `Security`。
- 投资人（filer）身份与公司（company）身份通过 `Filer` 表拆分（`tribeId` / `filerEntityId` / `companyEntityId` / `isMasterPersona`），它是"这个投资人是不是也是一家公司"的唯一权威来源。Berkshire 是目前唯一 filer=company 的特例；公司候选查询一律只认 `type="company"`，禁止把 `type="master"` Entity 当公司候选（2026-07-10 收口，v0.38.15）。`Holding.holderEntityId` / `ExtSource.filerEntityId` 的物理指向不变。
- `percentOfPortfolio` 的正确计算范围是 `(holderEntityId, asOfDate)`，不是单份 `ExtSource`/accession——一个季度的真实持仓有时会跨多份 13F 文件披露（常见于对新建仓位申请保密处理、保密期满后单独用 13F-HR/A 补报一个仓位，Pershing Square 属实践此类操作的典型基金）。`importFiling()` 写入 Holding 后会调用 `reconcilePercentOfPortfolio(holderEntityId, asOfDate)`（`scripts/lib/13f-import-core.ts`），按该 `(holder, asOfDate)` 分组重新计算所有行的份额，与导入顺序无关（2026-08-13 修复；此前 Bill Ackman 2021Q4/2024Q4 各有一个仓位因跨文件披露被错误算成 100%）。
- `ExtSource` 对 SEC filing 使用 `(filerEntityId, accessionNumber)` 去重，避免同一份 filing 重复入库。A 股/港股暂无 filing 归档，ExtSource 相关表对其不适用。
- 文本关系抽取当前不落任何存储；`Mention` / `EntityRelation`（Postgres）与 Neo4j 图谱链路均已下线。结构化知识沉淀路径：大师内容走 GBrain（Takes / Links / Timeline）；公司维度无对话沉淀层（Company Brain / Claim 方向已于 2026-07-17 从计划移除）。
- 原始 filing 文件通过 `FilingArtifact` 归档到 R2，结构化章节通过 `FilingSection` 保留可追溯数据；原始 XBRL facts 以 R2 data_file artifact 形式归档。
- 非美市场公司的查询主键：`{ market, code }` 组合（A 股/港股），`{ cik }` 继续用于美股。URL 路由层统一解析为 `companyId`，下游按 `market` 分发查询策略。

---

## 数据资产清单

按「大师/持仓」「公司」「原始文档」三块列出每种 artifact 的来源、落库表、生产脚本与当前状态（原 `DATA.md`，2026-08-07 并入本文件；`DATA.md` 已退役）。规则：**页面一律读各自的"latest"权威表，不读 `GeneratedContentVersion`**（历史版本表，目前全项目没有任何功能消费它——见下方「LLM 生成内容版本表现状」）。

### 大师 / 持仓数据

本项目里 `fund` 特指 master 关联的 SEC 13F 申报人/基金主体，不是独立通用 fund 数据库。链路：`master` → 关联 `fund/filer` → 历史 `13F filings` → 季度 `holdings` → 生成的 `portfolio insight`。

| 数据 / artifact | 来源 | 权威表 / 文件 | 脚本 | 状态 |
|---|---|---|---|---|
| Master 实体（`buffett`/`lilu`/`duan`/`gavin-baker` 等） | 代码/种子数据 | `Entity(type=master)` | `npm run import:13f` | 核心大师是主力部落；Gavin Baker 是首个 `alpha` 大师，单独展示分组 |
| Fund/filer 身份 | SEC filer 元数据 + 项目映射 | `Entity(type=master)`, `ExtSource.filerEntityId` | `npm run import:13f` | 当前模型把申报 filer 直接当成 master 关联的 fund/filer 身份 |
| 13F 申报 | SEC EDGAR 13F | `ExtSource(kind=13f)`, `Holding`, `Security`, `Entity` | `npm run import:13f`, `npm run pipeline:13f` | 核心链路已跑通 |
| 13F 公司关联 | 13F + ticker/name 映射 | `Security.companyEntityId`, `CompanyNameMap` | `npm run backfill:security:company-links`, `npm run sync:company-name-map` | 已有修复脚本，13F 导入后按需跑 |
| 证券类型分类（ETF/信托/权证/可转债/期权 vs 真实公司股权） | `titleOfClass`/`putCall` 关键词分类 | `Security.kind` | `import:13f`（新增行自动打标），`npm run backfill:security-kind` | 2026-08-21 新增。历史 639 条 Security 里 632 条（98.9%）分类成功；7 条 unclassified 待人工review（多是ETF发行人未在titleOfClass写"ETF"，如SPLV/EWL/BSV/VOE）。历史行无 `putCall`（导入时就被丢弃，这次才开始存），所以历史期权仓位无法回溯识别，只有之后重新 import 才会补上 |
| 期权仓位与正股仓位分离（同 CUSIP 不再合并） | 13F `<putCall>` 字段 | `Holding.putCall`，聚合/唯一约束改为 `(security, putCall)` 复合维度 | `import:13f`（`importFiling()` 已修复，含 `deleteStaleHoldings()` 顺带清理"这次 reimport 里已不存在的旧仓位"这个此前一直存在的通病） | 2026-08-21 新增，用 Leopold Aschenbrenner 全部 7 个季度（2024Q4–2026Q2）reimport 验证：Bloom Energy/TSM 的 Call 腿与正股腿拆回两条独立记录，Infosys 的 Put 腿不再显示成"持有正股"，reimport 顺带清掉 14 条历史脏数据。`/master/[id]` 主页 + `/master/[id]/holdings` 持仓明细表都拆成"持仓明细"/"期权等衍生品操作"两个子区块（而非按%内联排序区分），Top10 集中度柱状图对含期权腿的公司加"含期权"徽标（hover 显示正股/期权各自占比），`HoldingsHistoryExplorer`（"按公司"变化图）的列表项与图表标题同样标了 `Put期权`/`Call期权` 徽标，避免同一家公司的正股和期权在列表里显示成两条一模一样的行 |
| 13F-HR/A RESTATEMENT 识别（同期多份文件不再一律叠加） | 13F 封面文件（primary_doc.xml）的 `isAmendment`/`amendmentType` | `scripts/lib/thirteenf-restatement.ts` 的 `dropSupersededByRestatement()` | `import:13f`（`edgartools_13f_extract.py` 读取封面文件，`amendmentType==="RESTATEMENT"` 时只导入该份、原始/其他同期文件从导入队列丢弃，并对 `(holder, asOfDate)` 做跨 sourceId 的宽范围 stale 清理作为自愈兜底） | 2026-08-22 新增。起因：段永平 2024Q4 原始 13F-HR 把8个仓位误标成 Put，同日一份 13F-HR/A 去掉标记更正——此前 pipeline 把同期两份文件一律当"互相补充"处理（对 Bill Ackman 那种保密期满补报仓位是对的语义），两份都导入导致仓位翻倍。SEC 13F 封面页的 `amendmentType` 本就区分 `NEW HOLDINGS`（补充，应叠加）与 `RESTATEMENT`（整体替换，不应叠加）；edgartools 的 `CoverPage` 解析模型不暴露这两个字段，改为直接读 `primary_doc.xml` 原始 XML。全量 12 filer × 2020Q1–2026Q2 reimport 验证：除段永平外还揪出4例同类问题（巴菲特2023Q3一次覆盖2份旧文件、李录2025Q4、Gavin Baker 2021Q1、Alex Sacerdote 2021Q2）——这几例原始/更正文件数值本身不同（不是单纯标签错误），此前"两份文件数值完全相同才算重复"的粗筛完全没照到，是否曾经历过"哪份文件导入顺序在后就生效"的不稳定状态无法回溯确认；重跑后 278 个 filer-季度组合仓位占比总和排查 0 异常 |
| 持仓变化信号 | `Holding` 历史 | 脚本/查询内派生 | `scripts/generate-portfolio-insight.ts` | portfolio insight 生成用 |
| 大师主页画像 | 无（纯公开知识总结，不读我们数据库） | `MasterProfile`，镜像至 `GeneratedContentVersion(artifactType=master_profile)` | `npm run generate:master-profile` | 页面读 `MasterProfile`。2026-08-07 查证：11/11 有镜像（大师数量少、基本都被重跑过），但**没有任何代码读取这份镜像**——纯写入成本，见下方「LLM 生成内容版本表现状」。2026-08-14 起 `bio`/`fundOverview` 不再传入任何我们算出的持仓/13F 数据——等价于直接问 LLM"总结一下这个人和他的基金公司"，只传姓名。两者都不涉及持仓集中度/行业分布/季度调仓，那部分与 `PortfolioInsight` 重复，由后者单独承担。（中途曾改成引用真实计算的 13F 总市值当"基金规模"，后发现这个口径本身就窄于基金真实 AUM，把内部统计冒充成整体规模，已撤回） |
| 季度持仓点评 | 持仓变化 + 大师画像 | `PortfolioInsight`，镜像至 `GeneratedContentVersion(artifactType=portfolio_insight)` | `npm run generate:portfolio-insight` | 同上，12/12 有镜像，同样没有消费方 |

### 公司数据

| 数据 / artifact | 来源 | 权威表 / 文件 | 脚本 | 状态 |
|---|---|---|---|---|
| 公司实体（CIK/ticker/元数据） | SEC submissions + ticker 映射 | `Entity(type=company)` | `npm run import:10k`, `npm run backfill:company:profiles` | CIK 作为主要身份；重复 ticker/share class 需人工核对。2026-08-16 发现一类新根因：13F 导入 ticker 解析失败时会新建重复空壳公司实体而不核对已有同名/CIK 实体（SpaceX 等 5 组重复），已人工合并，脚本层面待修，见 TODO.md「13F 导入公司实体去重缺口」 |
| 年报（10-K/20-F/40-F，2020 至今） | SEC EDGAR | `ExtSource(kind=10k/20f/40f)`, `FilingArtifact`, `FilingSection`, `FilingAttachment` | `npm run import:10k -- --ticker AAPL --from 2020 --to 2026` | 抽取器覆盖 10-K/20-F/40-F 目标章节；新公司缺 pre-IPO 年报要与真实缺失区分 |
| XBRL 原始事实 | SEC CompanyFacts + inline XBRL | `FinancialFact` | `npm run import:10k` | 已按 filing accession 过滤 |
| 财务标准化行项 | `FinancialFact`/CompanyFacts/inline XBRL | `Financial` | `npm run import:10k`, `npm run check:financial:integrity` | 核心指标层已维护，行项按页面需求扩展 |
| 年报章节 | 主文档 HTML / 40-F 附件 | `FilingSection` | `npm run import:10k` | 抽取器覆盖 10-K/20-F/40-F 目标 section |
| 年报归档 | SEC EDGAR + R2 | `FilingArtifact`, R2 object key | `npm run import:10k` | 按 object key 复用，避免重复上传 |
| 股价 | Yahoo Finance | `StockPrice` | `npm run import:company-stock-prices:yf` | 已有脚本，按 ticker 跟踪覆盖范围 |
| 公司概览（profile） | SEC filings + 元数据 + 财务看板 | `CompanyAnalysis.profile` | `npm run generate:company-profile` | `/company` 页面与 `/agent` 的 `get_company_analysis` 工具都直接读这个权威字段（2026-08-08 起，退休了此前的 `GeneratedContentVersion` 镜像，见下方「LLM 生成内容版本表现状」） |
| 业务概览与画布（business） | SEC filings + 财务数据 | `CompanyAnalysis.business`（`{ narrative, canvas }`） | `npm run generate:business-model` | 同上；`BusinessCanvas`/`BusinessCanvasVersion` 表已物理删除（见下） |
| 价值分析（moat） | SEC filings + 财务数据 + 持仓 | `CompanyAnalysis.moat` | `npm run generate:value-analysis` | 同上 |
| 管理分析（management） | SEC filings + 财务数据 + 大师信件 | `CompanyAnalysis.management` | `npm run generate:management-analysis -- --all` | 2026-08-08 起有专属字段（此前唯一存储是 `GeneratedContentVersion`）。148 家已 onboard 公司里 77 家已生成，71 家是真实生成缺口（非存储问题），重跑有 LLM 成本，待批量补 |
| 估值分析（valuation） | SEC filings + 财务数据 | `CompanyAnalysis.valuation` | `npm run generate:valuation-analysis -- --all` | 同上，77 家已生成，71 家生成缺口 |

### 原始文档数据

| 数据 / artifact | 来源 | 权威表 / 文件 | 脚本 | 状态 |
|---|---|---|---|---|
| Berkshire 股东信 | 本地 markdown / Berkshire 原始材料 | `data/shareholder/*.md`, `Source`, `Chunk` | `scripts/import-markdown.ts` | 本地语料覆盖到 2025 |
| Buffett 合伙人信 | 本地 markdown | `data/partnership/*.md`, `Source`, `Chunk` | `scripts/import-markdown.ts` | 本地语料已有 |
| 股东大会逐字稿 | 本地 markdown | `data/annual_meeting/raw_en/*.md`, `Source`, `Chunk` | `scripts/import-markdown.ts` | 覆盖多个年份 |
| 大师 PDF | Li Lu / 段永平 / Buffett PDF | `data/documents/raw/**`, document 路由 | `scripts/upload-documents-to-r2.ts` | 已有上传脚本 |

### LLM 生成内容版本表现状

**2026-08-07 发现问题，2026-08-08 设计并实施完成**（起因：onboard SAP 时发现 `get_company_analysis` 报"无分析"，但网页上明明有内容）：

原问题：6 个 LLM 生成 artifact 全部走"双写"——生成脚本在同一个事务里，既写各自的权威表，又另外写一份进 `GeneratedContentVersion`（一条不覆盖、只追加的历史版本行）。搜了整个 `src/` 应用代码，**没有找到任何读取 `GeneratedContentVersion` 非最新版本的代码**（没有回滚 UI、没有版本对比、没有审计页），版本历史这套机制完整实现了，但从未被任何产品功能用起来。公司数据镜像同步率只有 15%（149 家里只有 23 家有镜像），`get_company_analysis` 只读镜像表，导致 85% 已有真实分析的公司被报"无分析"，是这份冗余拷贝变成单点故障的直接后果。

**已实施（方案 B）**：`CompanyAnalysis` 扩到 5 个可空字段，退休 `BusinessCanvas`/`BusinessCanvasVersion`，`GeneratedContentVersion` 退出公司数据：

```
CompanyAnalysis {
  profile       // { title, content } —— generate-company-profile.ts
  business      // { narrative: { title, content }, canvas: {...9项...} } —— generate-business-model.ts 一次调用的完整输出
  moat          // { summary, dimensions, notes } —— generate-value-analysis.ts（不叫 value——同对象里有 valuation 字段，一字之差易读混/敲错）
  management    // generate-management-analysis.ts，之前只存在 GeneratedContentVersion
  valuation     // generate-valuation-analysis.ts，之前只存在 GeneratedContentVersion
}
```

划分标准：**一个字段 = 一个能独立重新生成的单元**（对应一个 `generate-*.ts` 脚本 / 一次 LLM 调用），不按内容形态（叙述文本 vs 结构化数据）分——`BusinessCanvas` 之前单独建表的理由（"数据形状不一样"）站不住脚，它跟 `business` 字段的叙述部分来自同一次 LLM 调用、同一个事务写入，从无独立更新节奏。字段命名不重复 `CompanyAnalysis` 已经隐含的 `company`/`Analysis`（`profile` 而非 `companyProfile`），字段内部也不重复嵌套同义 key（`profile` 直接是 `{title, content}`，不再包一层 `overview`）。原 `narrative` 字段把 `profile`/`business` 两次独立调用的产出混装在同一 JSON 列，靠 `mergeNarrative()`（读旧值、拼另一半、整体覆盖写回）合并——是镜像同步率低的病灶之一，一次调用失败会污染另一次已写好的数据；拆成独立字段后 `mergeNarrative()` 已整段删除。更新时间只用 `CompanyAnalysis.updatedAt`（Prisma `@updatedAt` 自带）一个字段，不按字段单独加时间戳（没有功能需要这个粒度）。

**Schema 迁移分两阶段**：阶段 A（`prisma/migrations/20260808120000_split_company_analysis_fields`）只新增 4 列 + `moat`/旧 `narrative` 列改可空，不删任何东西；阶段 B 是应用层回填脚本（`backfill-company-analysis-fields.ts`），把旧 `narrative`/`BusinessCanvas`/`GeneratedContentVersion` 数据搬进新字段。跑完实测：profile/business 149/149、moat 148/149（1 家 IPO 无 10-K 属预期）、management 77、valuation 71，与生成缺口数字完全吻合。**同日完成清理**（`prisma/migrations/20260808130000_drop_business_canvas_and_narrative`）：`BusinessCanvas`/`BusinessCanvasVersion` 表、`CompanyAnalysis.narrative` 列、`GeneratedContentVersion` 里公司数据那 238 行历史行全部物理删除，回填脚本本身也已删除；`prisma migrate diff` 复核 schema 与 DB 完全一致。

读取路径改动：`getBusinessCanvas()`/`getGeneratedArtifact()`（`src/lib/company-data.ts`）整个删除，`company/[id]/page.tsx` 改成直接从 `CompanyAnalysis` 已取到的字段派生；`getRecentlyUpdatedCompanies()`（`src/app/company/page.tsx`，`/company` 页"最近更新" section）从 `GeneratedContentVersion.groupBy(scopeId)` 简化成 `companyAnalysis.findMany({ orderBy: { updatedAt: "desc" } })`；`services/pi-gateway/src/tools/get-company-analysis.ts` 改成直接查 `CompanyAnalysis` 5 个字段，已部署上线。公司页头部的 CIK/行业/交易所/证券代码信息（来自 `Entity`/`Security`）不在这次范围内，未改动。

实施中意外发现：`scripts/onboard-company.ts` 的 checkpoint 校验函数原来读 `GeneratedContentVersion`，公司数据停写后会一直误报生成步骤失败，已改名 `wasCompanyAnalysisFieldUpdatedSince()` 直接检查 `CompanyAnalysis` 对应字段。详见 `TODO.md` 条目⑦。

跟踪见 `TODO.md`「数据架构：停止 `GeneratedContentVersion` 镜像」。

---

## 数据更新节奏与自动化现状（2026-08-15）

背景：v0.42.9/v0.42.10 修 13F 导入 bug 时发现，"每季度更新"这个节奏完全没有自动化兜底——全靠人记得手动跑，已经连续两次悄悄漏掉某个 filer 某一季（alex-sacerdote 漏 2026Q1、leopold-aschenbrenner 漏 2024Q4/2025Q1），靠新建的 `check:13f-quarter-coverage` 才发现。借这次机会把全站数据的更新节奏梳理一遍，目的不是马上接 cron，是先把每类数据的**权威触发命令**和**完整性巡检**理清楚、记录下来——没有这两样，接不接 cron 都会继续悄悄漏数据。

### 设计原则

1. **一类数据只有一个权威触发命令**，不允许"默认参数"和"显式参数"两条路径行为不一致地并存（13F 那个 bug 的诱因之一：不传 `--quarter-list` 时默认只拉"最近 4 份"，跟显式指定季度是两套逻辑，容易让人以为默认命令能兜住历史）。
2. **命令必须显式声明目标范围**（`--quarter-list`/`--from`/`--to`/等价参数），不依赖隐式默认值——cron 场景没有人在旁边纠偏。
3. **幂等**：所有更新脚本按 upsert 设计，可以放心重跑，不会因为重复执行产生脏数据。
4. **退出码必须真实反映成败**——`npm run pipeline:13f | tee xxx.log` 这种写法会让 shell 拿到 `tee` 的退出码而不是真正命令的退出码，今天排查 13F 崩溃就踩过一次；接 cron 前所有多步骤 pipeline 都要过一遍这条。
5. **每类"更新脚本"配一个对应的"覆盖度巡检脚本"，巡检的基准是外部权威数据源（SEC EDGAR / Yahoo Finance），不是自己库里的数据自证自洽**——这是 `check-latest-holdings-company-coverage.ts`（拿 SEC 年报清单核对）和新的 `check-13f-quarter-coverage.ts`（拿 EDGAR report date 核对）已经在用的模式，之后新建的巡检脚本都应该照此设计，而不是只检查"库里数据内部是否自洽"。

### 节奏与自动化现状一览

| 数据类型 | 权威触发命令 | 建议节奏 / 锚点 | 完整性巡检 | Cron 就绪度 |
|---|---|---|---|---|
| 13F 持仓 | `npm run pipeline:13f -- --quarter-list <当季>` | 季度，锚定 13F-HR 法定截止日（季末+45天：约 2/14、5/15、8/14、11/14） | ✅ `check:13f-quarter-coverage`（2026-08-15 新增） | 基本就绪；仍需解决 ④ 那个 `tee` 吞退出码的问题，以及"当前该跑哪个季度"这层判断目前是人算的，cron 化要补 |
| 季度持仓点评 `PortfolioInsight` | `npm run generate:portfolio-insight -- --all --quarter <当季>` | 紧跟在 13F 导入之后，**不是独立周期**——本次就是因为这两步被当成两个独立环节，导致 11 位大师的 2026Q2 持仓点评漏生成了一整轮才被发现 | ❌ 待建（比对每位 filer 的 13F 季度集合 vs `PortfolioInsight` 季度集合，缺口即报） | 幂等 upsert，脚本本身就绪；应该直接串进 `pipeline:13f` 变成第 4 步，而不是继续靠人手动补跑第二条命令 |
| 公司股价 `StockPrice` | `npm run import:company-stock-prices:yf` | 每周 | ❌ 待建（"每家公司最新价格日期是否在 7 天内"） | 已经是本站设计最好的一个——不需要传 ticker，默认批量遍历全部公司、带 checkpoint 文件可断点续跑，是其他脚本应该看齐的模板 |
| 10-K/20-F/40-F 年报 | `npm run import:10k -- --ticker X --from Y --to Z` | 每年，锚定**各公司自己的**财年结束+法定截止日（不是统一日历日期，148 家公司各不相同） | ❌ 待建，也是设计上最复杂的一个（锚点因公司而异，需要先按财年结束时间算出"哪些公司到期该有新年报了"） | 未就绪——目前逐家公司手动传 ticker 触发，没有批量入口，也没有"到期提醒"逻辑；建议优先级最高，因为它是财务/估值分析链路的源头，源头不更新，下游全部悄悄过时 |
| `CompanyAnalysis` 五个 LLM 字段（profile/business/moat/management/valuation） | `npm run generate:company-profile -- --all` 等（各脚本自带 `--all`） | 跟着上一行的年报更新走，不是独立周期；`valuation` 额外可考虑在股价大幅波动后单独触发（P/E 分子分母任一变了都可能使结论过时） | ❌ 待建（`CompanyAnalysis.updatedAt` 是否早于该公司最新一次 10-K 的 `filedAt`） | 未就绪，同上一行 |
| 大师资料库 · 访谈（`InsightPost` 打标） | `npm run tag:insight-masters` | 定期（例如每次 `/insights` 有新文章发布后），不锚定日历日期 | 不需要额外巡检——打标本身幂等，不存在"漏更新"风险，只有"还没打"的滞后 | 就绪 |
| 大师资料库 · 信件/文章/书籍（`Document`/`Source` 表） | `scripts/import-markdown.ts` / `scripts/upload-documents-to-r2.ts` + 手动加 seed 条目 | 不定期，有新材料才做；但 Buffett 年度股东信（每年 2 月末）、股东大会（每年 5 月）是可预期的日历事件，可以只对这两个固定窗口设"提醒"而非自动导入 | 无 | 不适合无脑 cron——"这是不是真的新材料"需要人工判断，自动化空间有限 |
| GBrain 语义索引（`search_wisdom`） | `scripts/export-letters-gbrain.ts` + GBrain 侧 ingest | 跟着上一行走，**不是独立周期**——新信件进 Postgres 的 `Source`/`Chunk` 后，如果忘了导出同步进 GBrain，`search_wisdom` 检索到的内容会和网页上展示的落后一整代 | ❌ 待建（比对 `Source`/`Chunk` 条目数 vs GBrain `pages` 条目数，按 `master` 分组） | 未就绪；这条链路是本次梳理才第一次被系统性记录下来的空档 |
| `BeneficialOwnership`（13D/13G） | `npm run import:beneficial-ownership` | 本质是事件驱动（越过披露阈值才会有新 filing），不是日历节奏——"多久检查一次有没有新披露"才是节奏参数，不是"数据多久变一次" | 无 | 暂缓——展示层（`/master/[id]` 的"重大持仓披露"表格）v0.42.10 之前已下线（逻辑与数据处理都不成熟），先不投入自动化 |
| 大师主页画像 `MasterProfile` | `npm run generate:master-profile -- --master X` | 很慢，季度到半年一次，或有重大新闻时手动触发；纯公开知识总结，没有独立数据源可比对 | 无法有效巡检"是否过时"——没有 ground truth 可对比 | 手动为主，不建议 cron |
| 巡检脚本本身 | 各 `check:*` 命令 | 应配合它所巡检的数据节奏跑（13F 巡检每季度，未来的 10-K 巡检每年） | — | 目前只有 4 个巡检（`security`/`financial`/`filing-section`/`holdings-company-coverage`）接进了 `data-integrity-check.yml`（周度 + 发布前跑），新增的 `check:13f-quarter-coverage` 还没接进去 |

### 已知空档（按优先级）

1. `pipeline:13f` 缺"目标季度自动判断"+ 缺退出码可靠性（`tee` 吞码问题）——是 13F 这条能不能真正 cron 化的前置阻塞项。
2. `generate:portfolio-insight` 没有和 13F 导入绑定成一步，是本次已经实际发生过的漏跑根源。
3. 10-K 年报没有批量入口、没有到期提醒、没有覆盖度巡检——链路最长、影响最大（下游连着 5 个 LLM 生成字段），但目前完全靠人记得逐家公司手动触发。
4. GBrain 与 Postgres 信件表之间没有一致性巡检，两边可能已经在悄悄 drift。
5. 全站没有任何真正的定时任务（cron/GitHub Actions schedule）——所有"节奏"目前都只是约定，不是强制执行的机制。

以上是本轮梳理的结论，尚未实施；后续排期见 `TODO.md`。

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

- `npm run onboard:company -- --ticker XXXX`：给全新美股公司（不在任何大师持仓里）一键建立完整公司页，编排导入 10-K/20-F/40-F + 股价 + 5 个 LLM 生成脚本共 7 步，每步验证真实写入、按 ticker checkpoint 支持断点续跑。用法见 `scripts/README.md`「00. 新公司一键 onboarding 入口」。
- `npm run import:13f` / `npm run import:13f:range`：导入 13F 持仓
- `npm run import:10k`：按 ticker / 年份导入 10-K、20-F、40-F 财务数据
- `npm run import:10k:all -- --from 2020 --to 2026 --concurrency 1 --filing-concurrency 1`：全量公司年报批量回填，checkpoint 存 `.cache/import-10k-all.json`，保守并发避免 SEC/R2/DB 限流；失败年份重试加 `--no-edgartools-html --extract-timeout-ms 1800000 --company-timeout-ms 5400000 --retries 5 --retry-delay-ms 30000`
- `npm run import:stock-prices:yf`：按 ticker 从 Yahoo Finance 拉取日线价格，可选择写入 `StockPrice`
- `npm run import:company-stock-prices:yf`：按公司批量补齐价格数据
- `npm run import:10k:from13f`：从 13F 持仓反推需要补齐的公司财务
- `npm run pipeline:13f` / `npm run pipeline:10k`：完整流水线封装（注意：`pipeline:10k` 只封装 13F 反推导入 + 财务巡检，不是任意新公司的入口，任意新公司请用 `onboard:company`）

### 回填与修复

- `npm run backfill:security:company-links`：把 security 重新挂到正确 company
- `npm run backfill:company:profiles`：补公司 profile 元数据
- `npm run backfill:names`：补中文名 / 英文短名
- `npm run sync:company-name-map`：让 `company_name_map` 跟实体数据对齐
- `npm run generate:home-signals`：生成首页 3 条信号快照

### 巡检

- `npm run check:security:integrity`：检查 security 关联完整性
- `npm run check:financial:integrity`：检查财务数据完整性（默认覆盖全部 5 位投资人）
- `npm run check:filing-section:integrity`：检查有抽取内容的 FilingSection 背后 primary_html 归档是否齐全（search_filings 全文来源）
- `npm run check:db`：数据库健康检查
- `node --env-file=.env.local ./node_modules/.bin/tsx scripts/check-latest-holdings-company-coverage.ts`：最新一期持仓里缺财务/分析数据的公司覆盖率
- `scripts/check-all-company-financials.ts`：全量公司财务巡检
- `npm run backfill:filing-section-jobs -- --kinds 10k --sample 20 --seed-only`（只入队）/ `--run-only --limit 20 --delay-ms 60000`（只执行）：source 级别 v3 结构化章节回填的低 QPS 队列，用于观测 Supabase Disk IO 时分两步跑
- `.github/workflows/data-integrity-check.yml`：每周一自动跑上述只读巡检，`--strict` 命中才开 issue

### 自动补齐

- `npm run generate:master-profile`：生成并入库大师主页画像 `MasterProfile`
- `npm run generate:portfolio-insight`：生成并入库季度持仓点评 `PortfolioInsight`
- `npm run generate:company-profile`：批量生成并入库公司基本信息
- `npm run generate:business-model`：批量生成并入库业务概览与商业画布
- `npm run generate:value-analysis`：批量生成并入库价值分析
- `scripts/import-10k-edgartools.ts`：用 edgartools 获取 annual filing，支持 `companyfacts + filing-level inline XBRL fallback`，并归档 SEC 原始文件到 `FilingArtifact`
- `npm run send:announcement`：给注册用户批量发邮件公告

> A 股/港股 akshare 导入脚本（`npm run import:cn-hk-financials`、`npm run import:hk-annual-report`、`npm run import:cn-annual-report`）均已实现并验证，方案与实施状态见「A股与港股覆盖扩展」。

### 实验与基准

- `scripts/eval-*.ts`：检索与 MVP 评测

> 语音（ASR/TTS）与数字人实验已于 2026-06-11 移除（产品范围收缩为纯文字对话）。相关代码、relay 服务、数据模型（`DigitalHumanProfile` / `DigitalHumanJob`）均已删除，历史实现见 git 历史。
>
> Neo4j 图谱实验已于 2026-06-12 退役（Aura 实例长期不可达，chat 一直在静默降级运行）。`neo4j-*` 脚本、graph-retrieval、retrieval-compare 实验页、MCP graph 工具、`neo4j-driver` 依赖均已删除，检索统一为 pgvector + tsvector。历史实现见 git 历史。

### 维护原则

- 先跑巡检，再跑修复，最后才考虑手工改库
- 只要能写成脚本，就不要在数据库里临时补
- 新脚本优先挂到 `package.json`，避免隐蔽入口继续增加

---

## 运维速查表

### 最常用

- `npm run onboard:company -- --ticker XXXX`（新公司一键 onboarding，全新美股 ticker 首选入口）
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

### 数据修复

- `npm run backfill:security:company-links`
- `npm run sync:company-name-map`
- `npm run backfill:company:profiles`
- `npm run backfill:names`

### 巡检

- `npm run check:security:integrity`
- `npm run check:financial:integrity`
- `npm run check:filing-section:integrity`
- `npm run check:db`
- `scripts/check-all-company-financials.ts`

### 规则

- 先查缺口，再补数据，再做手工修正
- 13F / 10-K / master profile / portfolio insight / analysis / business canvas 的批处理都优先脚本化
- 数据源优先级：`companyfacts` -> filing-level inline XBRL -> 手工修复
- 首页信号由脚本产出快照，页面只读快照，不在页面里现算
- 主入口脚本编号总览见 [scripts/README.md](/Users/rafael/R129/buffett-tribe/scripts/README.md)

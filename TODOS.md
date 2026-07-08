# TODOS — 数据架构优化清单

## 测试体系设计（2026-07-08，从零搭建——重启 session 请先看这里）

> 这个项目从第一行代码开始就没有设计过测试体系：13F/10-K 导入管线、7 条 LLM 生成内容管线（公司概览/
> 商业模式/价值分析/管理分析/估值分析/大师画像/持仓洞见）、Agent 三工具、财务计算、两套独立部署的运行
> 环境（Vercel + air7 PM2）——没有一处有系统性的测试覆盖。现有的 5 个 vitest 文件是零散补的，从未接入
> CI；`tests/evals/` 是检索质量基准，不是正确性测试；`@playwright/test` 装了依赖但零测试文件。这不是
> 某次事故才暴露的问题，是结构性缺口，要按整个系统的风险面重新设计，不是针对某个 bug 打补丁。
>
> 案例参考（不是设计的起因，只是一个已发生、能说明"为什么某些层比其他层更重要"的真实例子）：
> `search_filings` 曾经长期只能搜到章节前 3000 字——`FilingSection.content` 被一次没有留痕的手工操作
> 截断，且章节级 R2 归档从未在生产真正生效过，静默运行了一个多月没人发现。这类"生产数据自己漂移、代码
> 逻辑本身没问题"的失败模式，只有对着真实数据跑的测试才能抓到——这是下面 L3/L4 权重高的原因。修复本身
> 记在「接入 pi-coding-agent」节的已完成清单里。

### 这个项目的风险面（先枚举完整，再决定测什么）

| 风险类别 | 具体指什么 | 一旦出错的后果 |
|---|---|---|
| 财务计算正确性 | `valuation-metrics.ts`（PE 分位、FCF/OCF 口径切换、情景回报数学） | 直接影响用户看到的数字；合规要求"不输出买入/卖出/目标价"，算错是严重问题 |
| 数据导入管线 | 13F（`import-13f-edgartools.ts`）、10-K/20-F/40-F（`import-10k-edgartools.ts` 等）、股价（yfinance）、CapEx/回购回填 | 源头到入库任一环悄悄失败，下游财务/估值/管理分析全部基于错误数据生成 |
| 数据关联完整性 | `Entity`/`Security`/`Holding`/`CompanyNameMap` 图谱一致性 | 持仓链接错公司、重复实体、ticker 冲突 |
| LLM 生成内容 | 7 条生成管线（company_profile/business_overview/value_analysis/management_analysis/valuation_analysis/master_profile/portfolio_insight），`GeneratedContentVersion` 版本化 | 输出格式漂移、prompt 版本和实际内容对不上、静默生成空/占位内容 |
| Agent 工具契约 | `search_wisdom`/`search_holdings`/`search_filings`——产品唯一的实时交互面 | 用户直接看到工具返回错误/残缺结果，且不报错，只是"答得不对" |
| 双部署环境一致性 | Vercel（Next.js 主站）与 air7（pi-gateway + GBrain，PM2 管理）各自独立发布 | "主站能跑、pi-gateway 那边没同步"——这次修复靠手动跑 air7 冒烟才验证到，不然会误以为部署完就万事大吉 |
| 数据库容量/成本 | Supabase 存储、R2 对象存储 | 已有 `db-size-check.yml` 部分监控 |

### 测试设计原则（风险对应优先，不是覆盖率优先）

不追求"80% 覆盖率"这类抽象指标。这个代码库的核心特征是：大量代码在和外部系统交互（SEC EDGAR、
Supabase、R2、DeepSeek、Yahoo Finance、GBrain），真正的风险集中在**数据从外部进来、流经管线、最终
呈现给用户**这条链路的完整性和正确性，不是纯算法逻辑错误。测试设计要按这条链路的每一环分层，不是
无差别堆单元测试。

### 六层测试金字塔——4 层必需，2 层延后

不是六层同等重要。按这个项目的实际风险（数据管线漂移 + Agent 是产品唯一交互面），L0/L1/L3/L4 是
**必需**的核心骨架；L2/L5 是**明确延后**的可选项，不在当前这一轮里做（L2 要先从零搭测试库基础设施，
成本明显更高且边际风险低于 L3/L4；L5 是内容展示型网站，E2E 边际价值和维护成本比不上抓数据/工具层
问题划算）。L6 已存在，不算新建。

| 层 | 状态 | 测什么 | 触发时机 | 现状 |
|---|---|---|---|---|
| L0 静态检查 | **必需** | `tsc --noEmit`（主应用 + scripts）、`eslint`、`prisma validate` | 每次 push | lint 能跑但没进 CI；`typecheck:scripts` 有历史遗留错误（`financialFact` 等，见下方步骤 4），需先清掉才能当真 gate |
| L1 单元测试 | **必需** | 纯函数 + fixture：解析类（`extract-10k-sections` 等）、计算类（`valuation-metrics`，合规敏感区，优先级最高）、格式化类（`search-filings.ts` 的 `resolveSectionKeys`/`extractExcerpt`） | 每次 push | 5 个 vitest 文件，没进 CI；覆盖零散，很多纯函数（如 `search-filings.ts`）零覆盖 |
| L2 集成测试 | 延后 | Prisma 查询（`CompanyNameMap` 同步、`Security↔Entity` 回填幂等性、`GeneratedContentVersion` 版本递增）、API route（`/api/filing-section` 等） | 每次 push / PR | 无——需先定测试库方案（本地 pglite / Supabase 分支），成本高于 L3/L4，边际风险更低 |
| L3 Agent 工具契约测试 | **必需** | `search_wisdom`（GBrain 语义检索）/`search_holdings`（13F SQL）/`search_filings`（10-K SQL+R2），各挑跨管线的真实 case 断言 | 每次 push 或每日 | 无——产品唯一实时交互面完全没有回归测试，最高优先级 |
| L4 数据管线健康检查 | **必需** | 已有零散脚本：`check-financial-integrity`、`check-security-integrity`、`check-latest-holdings-company-coverage`、`verify-10k-edgartools`、`check-db-size`；待补：`FilingSection.content` 完整性 | 每周定时（统一进一个 workflow，仿 `db-size-check.yml`）+ 大版本发布前 | 每个脚本各自为战，没有统一定时/告警，也不是发版门槛 |
| L5 E2E 冒烟 | 延后 | Playwright：`/agent` 问答 + 工具指示器、`/company/[cik]` 六 tab、年报阅读器 iframe、`/master/[id]` | 大版本发布前 | `@playwright/test` 已装依赖，零测试文件——写起来最贵、维护成本最高，此项目边际价值低于 L3/L4 |
| L6 LLM 质量评估 | 已存在 | `tests/evals/` 检索质量基准 | prompt/检索逻辑变更时 | 已有，维持现状，不进常规 gate（有成本、非确定性） |

### 测试基础设施决策（"从一开始该定好"但至今没定的部分）

搭建测试体系前必须先拍板，不然每加一个测试都要重新纠结：

- **测试数据源策略**：三个选项——① 本地 pglite/sqlite 影子库（快、可重复、CI 免费，但需要维护 schema
  同步和种子数据，测不出真实数据漂移）② Supabase 分支（结构和生产一致，但有额外配置/维护成本）③ 直接对
  生产库只读查询（零维护成本，能测出真实数据问题，但和生产数据强耦合）。**决定：L1 用 fixture，不依赖
  任何真实库；L2 用本地 pglite 影子库；L3/L4 直接对生产只读查询**——L3/L4 存在的意义就是盯着真实数据，
  脱离它就失去了这两层的价值。
- **Golden case 维护**：L3 的"已知 case"挑选标准和更新责任要明确，不能挑一次就不管。建议固定挑 3-5 家
  覆盖不同 filing kind（10-K/20-F/40-F）和不同大师（巴菲特/李录/段永平/Gavin Baker）的公司作为长期锚点，
  变化频率低，公司退市/数据结构变化时才需要更新。
- **外部依赖 mock 边界**：SEC EDGAR/R2/DeepSeek/Yahoo Finance/GBrain 在哪层该 mock、哪层该打真实——
  L1/L2 一律 mock（纯逻辑/DB，不该依赖外部服务可用性），L3/L4 一律打真实（否则测不出这类问题），
  L5 打真实但只在发版前跑（慢、有外部依赖，不适合每次 push）。
- **测试存放约定**（映射到现有目录结构，新代码照此放）：
  - `src/lib/*.ts`、`scripts/lib/*.ts` 纯函数 → `tests/*.test.ts`（沿用现状，如 `extract-10k-sections.test.ts`）
  - Agent 工具契约 → 新建 `tests/agent-tools/*.test.ts`
  - 数据完整性检查 → `scripts/check-*.ts`，纳入 L4 定时任务清单
  - Playwright → 新建 `e2e/*.spec.ts`

### 开发工作流集成（不然测试体系会重新荒废）

搭完不是终点，要变成日常习惯，否则半年后又回到今天的状态：

- 新增/修改纯函数（解析、计算、格式化）→ 必须同 PR 补 L1 测试
- 新增/修改 Agent 工具或工具参数 → 必须同 PR 补/更新 L3 case
- 新增数据导入脚本或修改现有导入逻辑 → 必须补充或跑一次对应 L4 完整性检查
- 新增 LLM 生成管线 → 至少要有一个"生成内容非空且包含预期字段"的最低限度断言，挂在 L3 或 L4
- 大版本（minor/major）发布前 → `npm run test:release` 跑 L2+L3+L4+L5，红了不打 tag（patch 直推、
  minor/major 由用户决定的既有版本节奏不变）

### CI 编排

- 每次 push main：L0 + L1（免费、秒级）
- 每周定时：L4
- 大版本（minor/major）发布前，手动 `npm run test:release`：L2 + L3 + L4 + L5 全跑，红了不许打 tag
- prompt 变更时：L6

### 落地路线图——按投入产出比排的 4 个必需步骤

1. [x] **L0**：`.github/workflows/test.yml`，push main / PR 自动跑 `npm run lint` + `npm run test`。
      **`build` 有意不进这个 gate**：实测过（临时移开 `.env.local`，只给 `DATABASE_URL`/`DIRECT_URL`
      两个已配置的 GH secret）`npm run build` 在 `/api/auth/forgot-password` 报
      `Missing API key`（`RESEND_API_KEY` 缺失，build-time collect page data 阶段实例化 Resend 客户端），
      后面大概率还有更多密钥缺口（NextAuth/R2/LLM 相关）。把生产凭证同步进 GitHub Secrets 是有安全影响的
      操作，用户决定先不做——`build` 继续留在发版前手动跑（`npm run build` 本地验证）。
2. [x] **L1**：`search-filings.ts` 的纯函数（`resolveSectionKeys`/`extractExcerpt`/`formatSectionLabel`）
      拆到零依赖的 `services/pi-gateway/src/tools/search-filings-format.ts`（不再 import `../db.js`，
      避免测试时因为 `DIRECT_URL` 未设置而在 import 阶段就抛错），补了 12 个 vitest 用例
      （`search-filings-format.test.ts`）。**意外发现**：根目录 `vitest.config.ts` 默认扫描整个仓库，
      `services/pi-gateway/` 下的测试文件会被根目录 `npm run test` 自动捡到，不需要给 pi-gateway 单独接
      CI 步骤（`services/pi-gateway/package.json` 仍补了自己的 `vitest`/`test` script，方便单独在该目录
      开发时跑）。全程验证零环境变量依赖。
      顺带发现原 45 秒（原 15 秒）R2 全文拉取超时在网络变慢时可能不够（本地测试遇到过 6MB 文件读了 2
      分钟），已放宽超时并重新部署 air7 验证 "Aspire" 仍正确命中。
3. [ ] **L3**：新建 `tests/agent-tools/` harness + 3-5 个跨管线 golden case——不只 10-K，至少各挑一个
      `search_holdings`/13F、`search_wisdom`/GBrain 的已知 case，覆盖面对应全部三个工具（最高优先级，
      直接堵住这次这类问题重演）
4. [ ] **L4**：现有零散脚本（`check-financial-integrity`/`check-security-integrity`/
      `check-latest-holdings-company-coverage`/`verify-10k-edgartools`）统一纳入一个每周定时 workflow，
      顺带新增 `FilingSection.content` 完整性检查；同时清掉 `typecheck:scripts` 的历史遗留错误
      （`financialFact` 相关，`FinancialFact` 表已从 schema 删除但
      `cleanup-financial-facts.ts`/`dedupe-ext-source-filings.ts`/`merge-duplicate-entity.ts` 等脚本仍
      引用），否则 L0 的 typecheck gate 一直是红的没有意义

### 明确延后（不在当前这轮）

- [ ] L2 集成测试：先决定测试库方案（本地 pglite 影子库），再实际编写 Prisma 查询 + API route 测试
- [ ] L5 Playwright 冒烟：覆盖 5-6 个核心用户路径（`/agent` 问答、公司页六 tab、年报阅读器、大师主页）
- [ ] 重写 `tests/README.md`：现在引用的是另一个仓库（`talk-with-buffett`）的路径，内容完全过时，
      和这个项目现在的功能面（13F/10-K/Agent/insights）对不上——次要，不阻塞上面 4 步

## 接入 pi-coding-agent（v0.38.0，2026-06-22 完成；三工具 v0.38.x 完成）

### 运行时架构

```
用户浏览器
  └─► buffett-tribe.com/agent（Vercel，Next.js）
        └─► /api/pi（Next.js 代理，AGENT_SECRET 留服务端）
              └─► relay.air7.fun/pi/chat（nginx → :3456）
                    └─► pi-gateway（PM2，Express SSE）
                          ├─► @earendil-works/pi-coding-agent → DeepSeek API
                          ├─► search_wisdom → GBrain（air7 :3457，pgvector 1536d）
                          ├─► search_holdings → Supabase（Holding SQL）
                          └─► search_filings → Supabase（FilingSection SQL）
```

### 关键文件

| 路径 | 说明 |
|---|---|
| `services/pi-gateway/` | Express SSE 服务，部署 air7 port 3456 |
| `services/pi-gateway/ecosystem.config.cjs` | PM2 配置，`tsx --env-file=.env` 启动 |
| `services/pi-gateway/src/tools/search-wisdom.ts` | GBrain 语义检索 tool |
| `services/pi-gateway/src/tools/search-holdings.ts` | 13F 持仓 SQL tool |
| `services/pi-gateway/src/tools/search-filings.ts` | 年报章节 SQL tool |
| `services/pi-gateway/src/db.ts` | 共享 pg Pool（DIRECT_URL，SSL） |
| `services/pi-gateway/AGENTS.md` | Agent system prompt（投研定位 + 三工具说明 + 回答格式） |
| `services/pi-gateway/deploy.sh` | 部署脚本（rsync → npm install → pm2 restart） |
| `src/app/agent/page.tsx` | `/agent` 页面 |
| `src/components/AgentChat.tsx` | React chat 组件（SSE 流、工具调用指示器、Markdown 渲染） |
| `src/app/api/pi/route.ts` | Next.js 代理路由 |

### 已完成

- [x] `services/pi-gateway/` 搭建与本机冒烟（修复 pg SSL 证书验证）
- [x] gateway 部署 air7，PM2 管理，开机自启
- [x] nginx `relay.air7.fun/pi/` → `:3456` 路由
- [x] `/agent` 页嵌入主站，SiteNav "对话" 链接指向 `/agent`
- [x] Next.js 代理路由 `/api/pi`，AGENT_SECRET 不暴露给浏览器
- [x] v0.38.0 发布，代码推送 GitHub，Vercel 自动部署触发
- [x] `search_wisdom` 工具（GBrain 语义检索，master 过滤）
- [x] `search_holdings` 工具（13F 持仓 SQL，最新季度默认）
- [x] `search_filings` 工具（FilingSection SQL，section alias，keyword excerpt）
- [x] 三工具调用指示器（label + 参数摘要 + 返回条数，v0.38.8）
- [x] AGENTS.md 完整定义三工具用法和回答格式
- [x] deploy.sh 可重复运行部署脚本
- [x] **`search_filings` 全文修复**（v0.38.12，2026-07-08）：`FilingSection.content` 曾被一次没有留痕的
      手工操作截断到 3000 字，且章节级 R2 归档从未在生产真正生效，命中章节现改为从
      `FilingArtifact(kind=primary_html)`（从未被截断）现取原文，用 `extractTargetSections()` 现场解析，
      `content` 降级为 fallback-only。不复活章节级 R2 归档（已确认阅读页走 iframe 不需要）。pi-gateway
      新增 `scripts/sync-shared-lib.sh` 把 `scripts/lib/extract-10k-sections.ts` 同步进
      `src/shared/`（git-ignored，deploy 前自动跑，源头仍是仓库根目录那份）。air7 部署后验证：DIS 2020
      10-K `item_1_business` 关键词 "Aspire"（原文接近末尾）现在能正确命中。现有数据无需批量修复。

### 关键决策

| 决策点 | 结论 |
|---|---|
| UI 位置 | 嵌入 Next.js 主站 `/agent`，用户不离开 buffett-tribe.com |
| 进程管理 | PM2（非 systemd），`ecosystem.config.cjs` |
| 认证 | `X-Agent-Secret` header，secret 仅存 Vercel 环境变量 |
| LLM | DeepSeek（直连 api.deepseek.com） |
| 工具命名 | 统一 `search_` 前缀：search_wisdom / search_holdings / search_filings |
| 工具隔离 | `noTools: "builtin"` 禁用 bash/read/write，只开放三个自定义工具 |
| 现有 `/idea` | 保留不动，后续视情况迁移或下线 |

### 后续方向

- [ ] 接入公司页："用 Agent 分析此公司" 按钮，带 company context 初始化对话
- [ ] 会话持久化：登录用户跨刷新保留对话历史（当前 sessionStorage，30min TTL）
- [ ] 流量监控：PM2 logs + Langfuse 观测 pi-gateway 调用情况
- [ ] search_filings 覆盖扩展：finer-grained 财务报表 / notes 章节，HK/A 股年报

## Agent 工具终态设计（2026-06 决策，三工具已上线 v0.38.x）

### 三工具架构

```
search_wisdom   → GBrain          大师说了什么
                                   信件 / 年会 / 书 / 文章
                                   语义搜索，master 过滤，1536d pgvector

search_holdings → Supabase SQL    大师买了什么
                                   Holding → Security → Entity 联表
                                   默认最新季度，支持 master/company/year/quarter 过滤

search_filings  → Supabase SQL    公司披露了什么
                                   FilingSection，section alias 映射，keyword excerpt
                                   覆盖约 120 家公司，2020–2025
```

### 大师范围（当前）

| master slug | 内容来源 |
|---|---|
| `buffett` | 年会记录（1994–2023，巴菲特 + 芒格共同回答）、股东信、合伙人信 |
| `munger` | 无独立 slug；芒格回答包含在 `buffett` 内容中，搜索时用 `master: buffett` 即可覆盖 |
| `lilu` | 李录书籍与演讲 PDF（5 份） |
| `duanyongping` | 雪球问答录商业/投资逻辑篇 |

> 未来新增大师时，只需导入内容并添加对应 master slug frontmatter，工具层无需改动。

### GBrain 知识层建设（已完成）

- [x] air7 初始化 GBrain，Supabase 后端，hosts 绑定绕过 IPv6
- [x] HTTP 服务（port 3457），PM2 管理，nginx `/gbrain/` 代理
- [x] Embedding：OpenAI text-embedding-3-large 1536d
- [x] 导入巴菲特年会记录 1994–2023（503 chunks）— 来源：《Unscripted》（Alex Crippen 编）；精选问答，非完整官方记录；巴菲特 + 芒格共同回答，frontmatter 标 `master: buffett`
- [x] 导入段永平问答录·商业 + 投资逻辑篇（290 chunks）
- [x] `search_wisdom` 工具接入 pi-gateway，验证通过
- [x] 导入李录 PDF（5 份，151 chunks，全部 embed）
- [x] 导入巴菲特股东信（1965–2025）+ 合伙人信（1958–1970，94 封，1712 chunks，全部 embed）→ 废弃 `search_letters`
- [x] 新增 `search_holdings` 工具（Supabase Holding 表 SQL，v0.38.x）
- [x] 新增 `search_filings` 工具（FilingSection SQL，section alias，keyword excerpt，v0.38.x）
- [x] 三工具工具调用指示器（tool label + 参数摘要 + 返回条数，v0.38.8）
- [ ] agent 扩展验收：跨大师对比 / 时间线 / 观点 + 公司持仓 + 年报联动

### 关键决策

| 决策点 | 结论 |
|---|---|
| GBrain 定位 | 知识层（大师文字内容），不存结构化数据 |
| 年报 / 持仓 | 留在 Supabase，分别由 search_filings / search_holdings 访问 |
| Embedding 模型 | OpenAI text-embedding-3-large 1536d |
| 年报入 GBrain？ | 否：体量过大，已有 FilingSection SQL，结构化数据更精准 |
| 工具命名 | 统一 search_ 前缀：search_wisdom / search_holdings / search_filings |

## 公司页生成内容 — 管理分析 / 估值分析 LLM 化（2026-06-12 评估，MCO 试点）

> 现状：两个 tab 是占位卡。业务/价值 tab 已有成熟管线（scripts/generate-* → callJsonLLM →
> CompanyAnalysis / GeneratedContentVersion），新 tab 复用同一模式。
> 核心原则：**数字由代码算，文字由 LLM 写**（估值 tab 最大风险是 LLM 算错数）；
> **动静分离**（价格实时算，LLM 叙事按季报/年报触发重生成）；每条结论带 sourceRef（衔接 Claim 表方向）。

### P0 — MCO 试点闭环

- [x] **valuation-metrics 计算层**（`src/lib/valuation-metrics.ts`）：从 Financial + StockPrice 计算当前 PE、
      历史 PE 区间与分位、P/OCF（轻资产公司 OCF≈FCF 需注明）、ROE/营收/净利趋势、
      情景回报数学（增长率 × 退出倍数 → 隐含年化）。纯 TS 可单测，MCO 数字对照公开数据验证。（v0.37.4 2026-06-13）
- [x] **管理分析生成**（`scripts/generate-management-analysis.ts` → artifactType `management_analysis`）：
      不做高管名册（缺 proxy 数据），做资本配置行为分析。数据：财务 6 年 + 10-K item_5（回购）/item_7（MD&A）
      + 股东信提及 chunks（MCO 有 36 封信，1962–2024，独家素材）+ 13F 大师动作。
      输出：资本配置记录卡 / 大师视角卡 / 股东利益一致性，每条带 sourceRef。（v0.37.4 2026-06-13）
- [x] **估值分析生成**（`scripts/generate-valuation-analysis.ts` → artifactType `valuation_analysis`）：
      metrics 先算 → LLM 解读估值位置 + 质量调整叙事；情景分析由 LLM 出假设（growth/exitPE/理由）、
      代码算隐含回报。合规：不输出"买入/卖出/目标价"，只输出区间与假设。（v0.37.4 2026-06-13）
- [x] **公司页渲染**：management/valuation tab 读 GeneratedContentVersion 最新版渲染，
      标注"AI 生成 + 生成时间 + 数据来源"；无数据回退占位卡。（v0.37.4 2026-06-13，MCO 浏览器验收通过）
- [x] **MCO 验收后扩量**：55 家部落成员（5 位）最新季度持仓公司全部生成，管理分析 55 家、估值分析 51 家
      （SNOW/TEM/CRCL/CRWV/LLYVK 无正 EPS 或缺价格数据，回退占位卡）。OXY 抽查验证 FCF 口径
      （P/OCF 8.22 vs P/FCF 21.08，重资产公司口径修正显著）。（v0.37.5 2026-06-13）

### P1 — 数据缺口

- [x] **CapEx / FCF lineItem 规整**：LINE_ITEMS 新增 CapEx（us-gaap PaymentsToAcquirePropertyPlantAndEquipment 等），
      `backfill:capex` 用 companyfacts API 回填存量 618 行（106 个年度无 capex facts，多为银行类，自动回退 OCF 口径）；
      valuation-metrics 切换真 FCF（`fcfBasis: fcf | ocf_proxy`），页面与 LLM 提示词随 basis 动态标注。（2026-06-13）
- [x] **回购股数序列**：LINE_ITEMS 新增 `ShareRepurchaseAmt`（us-gaap PaymentsForRepurchaseOfCommonStock 等），
      `backfill:share-repurchase` 用 companyfacts API 回填，MCO 验证 6 年数据完整。（2026-06-15）

### P2 — 数据缺口（不阻塞试点）

- [ ] **DEF 14A（proxy）抓取**：10-K item_10/11 只有 incorporated-by-reference 占位，
      管理层薪酬/董事会结构要 proxy。接入后管理分析补"管理层与董事会"卡。
- [ ] **同业估值对比**：需外部数据源，远期。

## P0 — 决策与飞轮

- [x] **Neo4j 图谱层退役**：Aura 实例已不可达，chat 静默降级运行已久。完全移除 neo4j-driver、graph-retrieval、retrieval-compare 实验页、11 个 neo4j npm scripts。检索统一为 pgvector + tsvector。（2026-06-12 执行）
- [ ] **Company Brain 最小闭环**：产品愿景（对话→写回→Canvas 越用越厚）在 schema 中无任何承接表。新建 `Claim` 表起步：`entityId / statement / sourceType / sourceRef / confidence / chatMessageId / status`，对话结束异步写回，Canvas 生成时读取。这是飞轮的轴，优先级高于继续堆 10-K 数据。

## P1 — 扩展前置与容量

- [x] **Entity 标识层泛化（A股/港股前置）**：新增 `market` + `code`（`@@index([market, code])`），
      CIK 降级为美股专属属性（注释更新）。（2026-06-15，已 prisma db push）
- [x] **容量治理小包 ①-⑤（2026-06-13~15 执行完毕）**：实际 333MB → **244MB**（ExtSource 53→1MB、
      StockPrice 49→18MB、FilingSection VACUUM、Chunk 122 个补嵌完成）。
      GCV 保留策略脚本 `db:prune-gcv` 已建立（keep=2，当前 106 行均为 versionSeq=1，无需裁剪）。
      全功能验证通过：年报阅读器 R2 全文、K线图、PE 分位、embedding 检索。
      - [x] ① 告警先行（2026-06-13）
      - [x] ② ExtSource 瘦身（2026-06-13，864KB）
      - [x] ③ 膨胀回收 + VACUUM（2026-06-13）
      - [x] ④ StockPrice 降采样（2026-06-13，18MB）
      - [x] ⑤ GeneratedContentVersion 保留策略：`scripts/prune-gcv.ts` + `npm run db:prune-gcv`（2026-06-15）
      可选后续：FilingSection.outlineJson 与 FilingArtifact（35MB 指针表）进一步瘦身，优先级低。

## P2 — 一致性收口

- [x] **生成内容版本管理统一**：三套并存（CompanyAnalysis 128行、BusinessCanvas 129行、GCV 106行）。
      决策：新内容全走 GCV（management_analysis/valuation_analysis 已接入）；
      CompanyAnalysis 与 BusinessCanvas 维持原读路径，不迁移（迁移成本高于收益）。（2026-06-15）
- [x] **FinancialFact 模型去留**：0 行，已从 schema 删除，Entity/ExtSource 关联关系同步清理，
      `Financial.sourceFactIds` 注释更新为指向 R2 data_file artifact objectKeys。
      migration: `20260615000100_entity_market_code_drop_financial_fact_add_document`。（2026-06-15）
- [x] **documents.ts 硬编码清单入库**：8 个大师文档迁移到 `Document` 表（`scripts/seed-documents.ts` 一次性种子）；
      `src/lib/documents.ts` 改为从 DB 异步读取；所有调用方（3 个 page + 3 个 API route + 2 个 master page）
      更新为 `await`。（2026-06-15）
- [ ] **文档系统四轨合一（长期）**：信件（Source/Chunk）、大师 PDF（Document 表）、年报（FilingSection/Artifact）、
      洞见（InsightPost）四套模型，按 PRODUCT.md 文档系统路线图收敛为统一 Document 对象。

## P3 — 小项

- [x] Chunk 补 embedding：122 个缺 embedding 的 chunk 全部完成（`scripts/backfill-chunk-embeddings.ts`，0 失败）。（2026-06-15）
- [ ] R2 与 pi-matrix/posts 共用 ai-pulse bucket，确认 lifecycle 与备份策略；考虑独立 bucket。
- [ ] `ChatMessage.sourceIds` 为无外键软引用，Brain 落地时一并规范化。

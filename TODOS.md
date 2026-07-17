# TODOS — 活跃工作队列

> 更新：2026-07-17（v0.38.15）。本文件只保留**未完成项**，按 P0–P3 排优先级；完成项的结论回写 `PRODUCT.md` 后从这里移除（详细过程见 git 历史）。产品定位、架构、数据口径、测试体系设计一律以 `PRODUCT.md` 为准。
>
> 当前队列于 2026-07-17 与用户讨论后重排：P0 两项是用户点名的紧急项（带完整现状诊断，可直接开工），P1 三项是围绕"Agent 是核心入口"主线的既定建议。

## P0 — 下一步就做（用户点名，2026-07-17）

- [ ] **① 年报阅读器左侧导航修复**（~1-2 天，纯前端 + 数据现成）
  - **现状诊断**：阅读页把 SEC 原始 HTML 整份塞 iframe，左侧目录靠扫描 iframe 内 `h1/h2/h3` 自动生成（`src/components/FilingReader.tsx:84` `handleFrameLoad`）。SEC filing HTML 几乎不用语义化标题标签，目录大概率抽不出来，侧栏退化成"附件 & 文件"——把 EX-31/32 认证函、XBRL schema、图片等低价值 exhibit 全列出来（`supplementalFiles`，`FilingReader.tsx:123`）。
  - **关键资产**：标准章节数据已存在但阅读器没用——`FilingSection` 表每份 filing 有结构化章节（`item_1_business` / `item_1a_risk_factors` / `item_7_mda` / `item_8_notes`…，含 `outlineJson` 目录树），`search_filings` 工具用的就是它；中文章节标签映射在 pi-gateway `search-filings-format.ts` 已有现成实现可参考。
  - **方案**：左侧导航改为标准章节目录（Part I/II 分组 + 中文标签，读该 filing 的 `FilingSection`）；点击章节 → iframe 内定位滚动，定位复用 `scripts/lib/extract-10k-sections.ts` 的章节标题匹配规则在 iframe DOM 找锚点；附件列表默认折叠 + 过滤噪音（XBRL/图片/认证函），只留 EX-99 AIF、EX-21 等有阅读价值的，或整体挪回公司页年度报告 tab；现有 h1-h3 抽取降级为 fallback。
- [ ] **② A 股/港股 Phase 1：茅台（cn-600519）+ 泡泡玛特（hk-9992）**（~2-3 天）
  - **现状**：只有 schema 前置落地（`Entity.market`/`code`，2026-06-15）；路由、导入、页面适配全部未开始。完整方案见 PRODUCT.md「A股与港股覆盖扩展」。
  - **四步最小路径**：
    1. 路由与查询泛化（大头，~1 天）：`src/app/company/[cik]` 目录改 `[id]`；`src/lib/company-data.ts` 的 `formatCompanyCikSlug` / `getCompanyByCik` / `formatCompanyCikUrl` 泛化为 market-aware（`cn-600519` / `hk-9992`，按 `{market, code}` 查询），这套 helper 被公司页/年报页/持仓链接等 5+ 处引用；`/company` 列表页从"只列有 CIK"放宽。
    2. Entity 种子（~半天）：两家公司写小种子脚本手工录入（中文名/行业/交易所/ticker），**不先建 akshare 公司信息管线**，等链路验证后再决定批量化。
    3. 股价（~半小时）：`npm run import:stock-prices:yf -- --ticker 600519.SS` / `9992.HK`，`StockPrice` 表和 K 线图组件零改动，Entity 上配好 ticker 即可。
    4. 公司页 tab 适配（~半天）：概览区按 `market` 显示市场代码而非 CIK；财务/估值 tab 优雅占位；年度报告 tab 占位 + 外链巨潮资讯网/披露易。
  - **Phase 2（财务数据，另 3-5 天）先不做**：akshare 三大表 → LINE_ITEMS 映射 + CNY/HKD 标注，看完 Phase 1 效果再决定。
  - **待拍板**：(a) 业务/价值分析 LLM tab 要不要给这两家先跑生成（能跑但无年报 evidence，来源标注与美股不同质）；(b) 港股代码规范用 `9992` 还是 `09992`（Yahoo 用 9992.HK，港交所官方 09992），路由与展示定一个。

## P1 — 近期排队（Agent 主线，2026-07-17 讨论确认）

- [ ] **Agent 接入公司页**："用 Agent 分析此公司"按钮，带 company context（ticker/CIK/公司名）初始化对话。把 `/agent`（三工具已稳定 + L3 契约测试护航）和公司研究闭环连起来，是现有能力的低成本组合。（~1-2 天）
- [ ] **Agent 会话持久化**：登录用户跨刷新保留对话历史（当前 sessionStorage，30min TTL）。可复用已有 ChatMessage 表思路，把 pi-gateway 会话落库、按用户读取。做完上一项紧接着做，"在公司页发起的分析"才能积累下来。（~1 天）
- [ ] **Agent 质量验收：30 组真实投研问题**：L3 契约测试只保证"工具能返回数据"，不保证"答得好"。用 30 组覆盖三工具和跨工具联动的问题（单一大师观点 / 持仓对比 / 年报细节 / 观点+持仓+年报组合）人工验收一轮，暴露检索缺口和 `AGENTS.md` prompt 问题。放在前两项之后做，正好覆盖新引入的公司页对话场景。（~半天到 1 天）

## P2 — 待评估 / 择机

- [ ] **13F 历史证券承接页**（2026-07-17 从 P1 顺延）：`Security.ticker = null` 且 `companyEntityId = null` 的历史证券无可访问页面。产品口径与处理方案见 PRODUCT.md「待办：13F 历史证券承接页」（company shell 补齐 / `/security/[id]` 承接页 / orphan 巡检纳入 `check:security:integrity`）。
- [ ] **L2 集成测试**（2026-07-17 从 P1 顺延）：Prisma 查询（CompanyNameMap 同步、Security↔Entity 回填幂等性、GCV 版本递增）+ API route。测试库方案已定：本地 pglite 影子库。落地后 `test:release`（发版前全量跑 L2+L3+L4+L5）才成立。
- [ ] **Whale Rock / Atreides 组合 375 家公司 Financial/10-K 缺口**（2026-07-10 排查发现）：两家成长股基金加入 13F 追踪后从未同步扩展公司数据 pipeline（gavin-baker 212 家持仓仅 27 家有 FY 数据，alex-sacerdote 211 家仅 21 家）。**用户已决定先不处理，只记录**；若要补，先评估 SEC EDGAR 请求量与时间成本，再决定是否批量 `import:10k`。
- [ ] **A 股/港股 Phase 2（财务数据）**：akshare 三大报表导入 + 中文指标 → LINE_ITEMS 映射 + CNY/HKD 货币标注，方案见 PRODUCT.md。Phase 1 验证后再决定。
- [ ] **search_filings 覆盖扩展**：finer-grained 财务报表 / notes 章节；HK/A 股年报（依赖 A 股/港股接入进度）。
- [ ] **DEF 14A（proxy）抓取**：10-K item_10/11 只有 incorporated-by-reference 占位，管理层薪酬/董事会结构要 proxy。接入后管理分析补"管理层与董事会"卡。
- [ ] **Agent 扩展验收**：跨大师对比 / 时间线 / 观点 + 公司持仓 + 年报联动的组合查询质量验收。
- [ ] **pi-gateway 流量监控**：PM2 logs + Langfuse 观测调用情况。
- [ ] **L5 Playwright E2E 冒烟**：5-6 个核心用户路径（`/agent` 问答、公司页六 tab、年报阅读器、大师主页）。写起来最贵、维护成本最高，边际价值低于 L3/L4，明确延后。
- [ ] **重写 `tests/README.md`**：现在内容指向另一个仓库（talk-with-buffett），完全过时。

## P3 — 长期 / 低优先

- [ ] **文档系统四轨合一**：信件（Source/Chunk）、大师 PDF（Document 表）、年报（FilingSection/Artifact）、洞见（InsightPost）四套模型，按 PRODUCT.md「文档系统路线图」收敛为统一 Document 对象。
- [ ] **价格数据升级**：`StockPrice` 从 ticker 口径升级到 `securityId` 口径；财报日 / 年报日 marker；服务端周/月/年聚合。见 PRODUCT.md「价格数据」后续目标。
- [ ] **同业估值对比**：需外部数据源，远期。
- [ ] **R2 bucket 策略**：与 pi-matrix/posts 共用 ai-pulse bucket，确认 lifecycle 与备份策略；考虑独立 bucket。
- [ ] **`ChatMessage.sourceIds` 规范化**：无外键软引用，择机规范化（原计划随 Claim 表一并做，该方向已移除）。
- [ ] **Filer 完全物理拆分**（条件触发，默认不做）：`Holding`/`ExtSource` 的 FK 从 `Entity` 改指向 `Filer`、`Entity.type` 去掉 `"master"`。只有出现第二个"大师本体=公众公司"特例，或 filer 需要专属字段时才值得做。

## 已移除的方向（记录决策，防止无意识捡回）

- **2026-07-17 · Company Brain 最小闭环（Claim 表）**：原 P0（2026-06-12 定），"对话→写回 Claim→Canvas 越用越厚"的飞轮方向**没有想清楚，从计划中移除，暂不做**。PRODUCT.md 中的冷→热演进章节已一并撤下；若将来重新立项，需要先重新论证再进队列。

## 已完成归档（结论已回写 PRODUCT.md，过程见 git 历史）

- **2026-07-10 · Filer / Company 身份拆分**：`Filer` 表 + Berkshire 双 Entity 修复 + 5 处查询收口 + 3 处硬编码投资人清单动态化 → PRODUCT.md「稳定主键原则」「v0.38.9–15 变更」。
- **2026-07-10 · 13F 数据完备性排查**：确认追踪 5 位投资人（不是 3 位），2020Q1–2026Q1 每季连续无缺，3 处异常（Atreides 2022Q2 缺失、2 条 13F-HR/A 空重复行）已修复。
- **2026-07-08~10 · 测试体系 L0/L1/L3/L4 落地**：`test.yml` push gate、pi-gateway 纯函数单测、`tests/agent-tools/` 三工具 golden cases、`data-integrity-check.yml` 每周巡检 + `check:filing-section:integrity`、`typecheck:scripts` 清零（顺带修复 `import-10k-edgartools.ts` 自 FinancialFact 删表后跑不通的问题）→ 设计与决策全文见 PRODUCT.md「测试体系」。
- **2026-07-08 · search_filings 全文修复**（v0.38.12）：命中章节从 `FilingArtifact(kind=primary_html)` 现取原文现场解析 → PRODUCT.md「v0.38.9–15 变更」。
- **2026-06-22~25 · pi-coding-agent 三工具上线**（v0.38.0~8）：运行时架构、关键文件、关键决策 → PRODUCT.md「Agent 运行时链路」「/agent」。
- **2026-06 · GBrain 知识层**：4 位大师 2656 chunks，text-embedding-3-large 1536d → PRODUCT.md「技术栈」「当前实现状态」。
- **2026-06-12~15 · 管理/估值分析 LLM 化（55 家）、CapEx/FCF 规整、回购序列、容量治理（333→244MB）、Neo4j 退役、FinancialFact 删表、documents.ts 入库、Chunk 补 embedding、Entity market/code 前置、GCV 保留策略** → PRODUCT.md 对应章节。

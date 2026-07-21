# TODOS — 活跃工作队列

> 更新：2026-07-21（v0.39.12）。本文件只保留**未完成项**，按 P0–P3 排优先级；完成项的结论回写 `PRODUCT.md` 后从这里移除（详细过程见 git 历史）。产品定位、架构、数据口径、测试体系设计一律以 `PRODUCT.md` 为准。
>
> 当前队列于 2026-07-17 与用户讨论后重排：P0 项是用户点名的紧急项（带完整现状诊断，可直接开工），P1 三项是围绕"Agent 是核心入口"主线的既定建议。2026-07-18 新增两项来自 `anthropics/financial-services` 仓库调研的建议（P2）。

## P0 — 下一步就做（用户点名，2026-07-17）

- [ ] **① 年报阅读页重新设计 — 仅剩"一键切换中文"未做**（2026-07-21，v0.39.12 已发布左侧目录/附件删除 + 字体行距控件 + AI 解读分栏，结论见 `PRODUCT.md`「年报阅读」「v0.39.12 变更」）：
  - **2) 一键切换中文**（保留年报原样式结构，只译文字）——两个方案未拍板，讨论中倾向认为该做小样本效果对比再定：
    - 方案 A：iframe 加载后遍历文本节点原地替换，CSS/表格/排版原样不动，最贴合"保留原样式"的字面要求；风险是 SEC inline XBRL HTML 极度碎片化（Ferrari 那份文件顶层就有 4814 个 div，一句话常被拆成多个 `<span>`），逐节点翻译缺上下文，译文质量堪忧，金额/代码等不该翻译的内容也需要小心跳过。
    - 方案 B：解析成段落/标题块 → 按块翻译（有完整上下文，质量高）→ 用自己的样式重新渲染；代价是不是原始 CSS 像素级还原，是"结构保留、样式重做"。
    - 两个方案都不应做成"用户点一下现翻现付"——应在 onboarding 阶段预生成并缓存为新 artifact（如 `primary_html_zh`），页面上的"一键切换"只是换一个已翻译好的静态 URL，避免逐次访问的翻译延迟和重复成本。
  - **下一步**：跟用户过一轮翻译方案的小样本对比（同一份 filing 分别跑方案 A/B 看效果），再定最终方案和排期。
- [ ] **①-c `/api/filing-image` 代理延迟严重**（2026-07-21 排查字体/行间距控件失效时发现）：法拉利这份 20-F 内嵌 40 张图片全部经该接口代理转发 SEC.gov 原图，单张最长 3.5 分钟（`race-20251231_g5.jpg`），多张超过 1 分钟，无缓存。当前已通过"控件不再等 iframe `load` 事件"绕开了它对本功能的影响，但代理本身的延迟没有处理，值得单独排查是否要加缓存层（R2/CDN）或加超时+占位图。

- [ ] **①-b Ferrari (RACE) onboarding 卡在 20-F 章节抽取，概念验证中断**（2026-07-19/20 发现，2026-07-21 补充排查，源于给 /company 页面设计"用户自助 onboarding"功能时的真实测试）：
  - **现状**：Entity + Financial 已建（6 年，2020–2025，60 行财务数据完整）；`FilingSection` 只有 2020/2021 两年（55 个），2022–2025 四年是 0——不是报错，是静默抽不到。4 个依赖 filing 文字证据的 LLM 生成脚本**尚未跑**（`onboard-company.ts` 流程中断在这一步，等结论）。
  - **根因**：Ferrari 从 2022 年报起把 Dutch 法定年报和 SEC 20-F 合并成一份文件。① 正文 TOC 不再超链接官方 Item 标签，标题匹配法失效；② 文件里有"Item→页码"对照表，但表头写法（"Cross Reference"）和 item 单元格格式（"Item 1."带前缀）跟代码原本认的三个固定短语/纯数字格式都不一致——**已修复并提交**（`scripts/lib/extract-10k-sections.ts` 的 `is20FTocTable` / `normalize20FItemCell`，改动小、向后兼容，未影响现有 GOTU/JOYY 两家 20-F filer）；③ 对照表读对了之后，"页码 → 具体 HTML 内容"这一步仍失败——`collectPageFragments` 假设"一个顶层 div = 一页"，Ferrari 这份文件是细粒度 inline XBRL 渲染，body 下 4814 个顶层 div，没有可识别的页码标记文本，定位不到内容。
  - **2026-07-21 补充排查**（用户追问"为什么不直接用文件里那张真正的目录"引出）：法拉利文件里其实有**两张不同的表**——① 上面①提到的"Item→页码"监管对照表（已支持解析）；② 一张真正给读者看的目录（`Risk Factors | 13`、`Overview of Our Business | 44` 这种有意义的章节标题+页码），结构比①干净很多。但两张表最终都卡在同一个"页码 → HTML 位置"瓶颈上：`parsePageNumber()` 的正则只认"Page 44"这种带上下文的写法，实测该文件的页码是**裸露渲染的纯数字元素**（无任何前后文字），现有正则命中 0 次；但页码数字本身确实以孤立元素形式存在于文档里（1105 个"纯数字"叶子元素，其中包含与目录页码完全对应的 5/6/8/9/11/13/38/40/44/85/115/118/168/178...序列），另外章节标题本身也会作为运行页眉重复出现（如"Overview of Our Business"出现 11 次）——这两条线索理论上可以做确定性锚定（拿目录已知的页码序列去顺序匹配裸数字元素，或者直接用运行页眉首次出现位置定位章节起点），但**没有验证到底能不能完整跑通、首尾相接**，是否可靠仍需要实测。另外验证过"按 Item 编号扫描正文"这条路：对 GOTU 等标准格式 filer 有效（正文有 107 处"Item N. 标题"字样），但对法拉利完全无效——正文里"Item N"字样出现次数是 **0**，只在监管对照表里出现，说明这份文件的问题不是"扫描方法不够聪明"，是数据源本身在正文里就没有这个锚点。
  - **讨论中的方向**：如果"已知页码序列锚定裸数字"或"运行页眉定位"两条确定性路径验证后跑不通，再退到 LLM 兜底——把清洗后的纯文本（或 block 列表）喂给 LLM，只要它标出"章节边界在哪个 block 序号"（不要复述内容，避免幻觉污染原文），真正摘取文字仍由确定性代码从原文切片；只在冷门排版触发，正常公司零成本、零额外调用。法拉利实测：清洗后全文约 27 万 token（3596 个 block），若不做候选预筛选、把全部 block 预览喂给 LLM，一次性调用量级可控。
  - **待拍板**：a) 先花时间验证"页码序列锚定 / 运行页眉定位"这两条更便宜的确定性路径，还是直接跳到 LLM 兜底（工作量都是中等，前者收益是零成本但可能验证后发现此路不通，后者更通用但每次要花一次 LLM 调用）；b) Ferrari 当前"财务数据齐全但近 4 年无文字证据"的半成品状态，是先搁置、还是接受现状跑生成脚本（会导致"2025 年财务数字 + 2021 年文字叙述"拼在一个发布页面上，读者无感知——已在讨论中确认过这个风险）。
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

- [ ] **Thesis Tracker 化投资论点跟踪**（来源：2026-07-18 读 `anthropics/financial-services` 仓库 `thesis-tracker` skill 后讨论）：现在 `MasterProfile.flagshipCases`（thesis/outcome/stillHolding）和 `generate-portfolio-insight.ts` 的季度点评都是每次让 LLM 重新写一段叙事文字，没有版本化的"论点是否还成立"记分卡。`thesis-tracker` skill 的纪律是"thesis 必须可证伪"——建仓时写清楚支撑 pillar + 会推翻论点的 risk，之后每次更新都要判断新数据是强化/削弱/推翻了哪个 pillar，并像追踪确认证据一样认真追踪证伪证据。改造思路：`generate-master-profile.ts` 的 flagshipCases schema 加 `invalidationCriteria` 字段；`generate-portfolio-insight.ts` 生成时对照检查本季持仓变化对每个 thesis 的影响，输出结构化的 `thesisStatus`（intact/weakening/broken）而不只是一段叙事。只改两个已有生成脚本的 prompt/schema，不需要新数据源，三个建议里成本最低、见效最快。
- [ ] **Catalyst Calendar 重仓股事件日历**（来源同上，`catalyst-calendar` skill）：现在网站完全被动——13F 季度披露后约 45 天延迟才能看到调仓，两次披露之间没有新内容。可以给每位投资人的前 10 大重仓股维护一个"未来两周有什么"小模块（财报日、行业会议、监管决定等），填补季度空窗，让网站从纯回顾变成有前瞻性。需要新数据源（财报日历/新闻），项目目前没有接入渠道，是三项里成本最高的一个，需要先确认数据源再评估。
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
- [ ] **`FilingSection` 抽取失败监控盲区**（2026-07-20 Ferrari onboarding 排查发现）：每周巡检 `check-filing-section-integrity.ts` 只检查"有 section 的 filing 是否有 `primary_html` artifact"，不检查"导入的 filing 有没有成功抽出任何 section"——像 Ferrari 那样抽取失败返回 0 而不是报错，巡检完全看不见，只能靠人工偶然发现（这次是因为要 onboard 新公司才撞见）。应该加一条"有 `primary_html` artifact 但 0 个 section"的检测，纳入现有巡检脚本。
- [ ] **生成脚本 filing evidence 选取行为不一致**（同上排查发现）：`fetchLatestFilingEvidence`（`scripts/lib/company-generation.ts`，company-profile/business-model/value-analysis 三个生成脚本共用）只认最新一年 `ExtSource`，若该年 section 为空，evidence 文本里 Sections 块直接留空、不回退旧年份；`generate-management-analysis.ts` 自己另写的 `fetchBuybackEvidence` 则会往旧年份回退，且诚实标注具体年份（`[10-K FY2021 ...]`）。同一套数据两种不统一的处理方式，值得决定一个统一策略（回退 + 标注年份 vs 不回退但提示证据缺失）。

## P3 — 长期 / 低优先

- [ ] **文档系统四轨合一**：信件（Source/Chunk）、大师 PDF（Document 表）、年报（FilingSection/Artifact）、洞见（InsightPost）四套模型，按 PRODUCT.md「文档系统路线图」收敛为统一 Document 对象。
- [ ] **价格数据升级**：`StockPrice` 从 ticker 口径升级到 `securityId` 口径；财报日 / 年报日 marker；服务端周/月/年聚合。见 PRODUCT.md「价格数据」后续目标。
- [ ] **同业估值对比**：需外部数据源，远期。
- [ ] **R2 bucket 策略**：与 pi-matrix/posts 共用 ai-pulse bucket，确认 lifecycle 与备份策略；考虑独立 bucket。
- [ ] **`ChatMessage.sourceIds` 规范化**：无外键软引用，择机规范化（原计划随 Claim 表一并做，该方向已移除）。
- [ ] **Filer 完全物理拆分**（条件触发，默认不做）：`Holding`/`ExtSource` 的 FK 从 `Entity` 改指向 `Filer`、`Entity.type` 去掉 `"master"`。只有出现第二个"大师本体=公众公司"特例，或 filer 需要专属字段时才值得做。

## 已移除的方向（记录决策，防止无意识捡回）

- **2026-07-18 · `anthropics/financial-services` 仓库调研，三项评估后不做**：读了 Anthropic 官方给金融机构的 agent/skill 库（pitch deck、DCF 建模、KYC、GL 对账等），评估对 buffett-tribe 的可吸收点。**决定不做**：① 公司页接入 DCF/comps 估值 skill——需要实时股价、WACC 假设等现在没有的数据管道，且给内容网站读者一个"合理估值"容易越界成投资建议，与网站"讲清楚大师在想什么"的定位不符；② LSEG/S&P Global 数据连接器——机构级付费数据订阅，个人项目不划算，SEC EDGAR 现有免费路径已够用；③ xlsx-author/pptx-author/KYC/GL 对账全套——面向机构内部合规/财务团队工作流，与内容网站场景无关。采纳的两项见 P2「Thesis Tracker 化投资论点跟踪」「Catalyst Calendar 重仓股事件日历」。
- **2026-07-17 · Company Brain 最小闭环（Claim 表）**：原 P0（2026-06-12 定），"对话→写回 Claim→Canvas 越用越厚"的飞轮方向**没有想清楚，从计划中移除，暂不做**。PRODUCT.md 中的冷→热演进章节已一并撤下；若将来重新立项，需要先重新论证再进队列。

## 已完成归档（结论已回写 PRODUCT.md，过程见 git 历史）

- **2026-07-17 · 新公司一键 onboarding 脚本**：`scripts/onboard-company.ts` / `npm run onboard:company -- --ticker XXXX`，把「导入 10-K → 导入股价 → 5 个 LLM 生成脚本」共 7 步编排为一条命令，每步跑完查库验证真正写入（不只看退出码，`generate:*` 脚本内部会捕获单公司错误仍退出 0），按 ticker checkpoint 到 `.cache/onboard-company/<TICKER>.json` 支持断点续跑。端到端验证：`--ticker ODFL` 从零创建 Entity + 10 条 Financial + 22 个 FilingSection，checkpoint 断点续跑验证通过（生产库真实数据，用户决定保留）。用法见 `scripts/README.md`「00. 新公司一键 onboarding 入口」。
- **2026-07-10 · Filer / Company 身份拆分**：`Filer` 表 + Berkshire 双 Entity 修复 + 5 处查询收口 + 3 处硬编码投资人清单动态化 → PRODUCT.md「稳定主键原则」「v0.38.9–15 变更」。
- **2026-07-10 · 13F 数据完备性排查**：确认追踪 5 位投资人（不是 3 位），2020Q1–2026Q1 每季连续无缺，3 处异常（Atreides 2022Q2 缺失、2 条 13F-HR/A 空重复行）已修复。
- **2026-07-08~10 · 测试体系 L0/L1/L3/L4 落地**：`test.yml` push gate、pi-gateway 纯函数单测、`tests/agent-tools/` 三工具 golden cases、`data-integrity-check.yml` 每周巡检 + `check:filing-section:integrity`、`typecheck:scripts` 清零（顺带修复 `import-10k-edgartools.ts` 自 FinancialFact 删表后跑不通的问题）→ 设计与决策全文见 PRODUCT.md「测试体系」。
- **2026-07-08 · search_filings 全文修复**（v0.38.12）：命中章节从 `FilingArtifact(kind=primary_html)` 现取原文现场解析 → PRODUCT.md「v0.38.9–15 变更」。
- **2026-06-22~25 · pi-coding-agent 三工具上线**（v0.38.0~8）：运行时架构、关键文件、关键决策 → PRODUCT.md「Agent 运行时链路」「/agent」。
- **2026-06 · GBrain 知识层**：4 位大师 2656 chunks，text-embedding-3-large 1536d → PRODUCT.md「技术栈」「当前实现状态」。
- **2026-06-12~15 · 管理/估值分析 LLM 化（55 家）、CapEx/FCF 规整、回购序列、容量治理（333→244MB）、Neo4j 退役、FinancialFact 删表、documents.ts 入库、Chunk 补 embedding、Entity market/code 前置、GCV 保留策略** → PRODUCT.md 对应章节。

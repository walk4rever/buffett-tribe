# TODOS — 活跃工作队列

> 更新：2026-07-26（v0.39.23）。本文件只保留**未完成项**，按 P0–P3 排优先级；完成项的结论回写 `PRODUCT.md` 后从这里移除（详细过程见 git 历史）。产品定位、架构、数据口径、测试体系设计一律以 `PRODUCT.md` 为准。
>
> 当前队列于 2026-07-17 与用户讨论后重排：P0 项是用户点名的紧急项（带完整现状诊断，可直接开工），P1 三项是围绕"Agent 是核心入口"主线的既定建议。2026-07-18 新增两项来自 `anthropics/financial-services` 仓库调研的建议（P2）。2026-07-26 复盘法拉利（RACE）onboarding 全过程后新增 P0 ③ 并补充 ② 的设计约束。

## P0 — 下一步就做（用户点名，2026-07-17）

- [ ] **① 年报阅读页重新设计 — 仅剩"一键切换中文"未做**（2026-07-21，v0.39.12 已发布左侧目录/附件删除 + 字体行距控件 + AI 解读分栏，结论见 `PRODUCT.md`「年报阅读」「v0.39.12 变更」）：
  - **2) 一键切换中文**（保留年报原样式结构，只译文字）——两个方案未拍板，讨论中倾向认为该做小样本效果对比再定：
    - 方案 A：iframe 加载后遍历文本节点原地替换，CSS/表格/排版原样不动，最贴合"保留原样式"的字面要求；风险是 SEC inline XBRL HTML 极度碎片化（Ferrari 那份文件顶层就有 4814 个 div，一句话常被拆成多个 `<span>`），逐节点翻译缺上下文，译文质量堪忧，金额/代码等不该翻译的内容也需要小心跳过。
    - 方案 B：解析成段落/标题块 → 按块翻译（有完整上下文，质量高）→ 用自己的样式重新渲染；代价是不是原始 CSS 像素级还原，是"结构保留、样式重做"。
    - 两个方案都不应做成"用户点一下现翻现付"——应在 onboarding 阶段预生成并缓存为新 artifact（如 `primary_html_zh`），页面上的"一键切换"只是换一个已翻译好的静态 URL，避免逐次访问的翻译延迟和重复成本。
  - **下一步**：跟用户过一轮翻译方案的小样本对比（同一份 filing 分别跑方案 A/B 看效果），再定最终方案和排期。
- [ ] **①-c `/api/filing-image` 代理延迟严重**（2026-07-21 排查字体/行间距控件失效时发现）：法拉利这份 20-F 内嵌 40 张图片全部经该接口代理转发 SEC.gov 原图，单张最长 3.5 分钟（`race-20251231_g5.jpg`），多张超过 1 分钟，无缓存。当前已通过"控件不再等 iframe `load` 事件"绕开了它对本功能的影响，但代理本身的延迟没有处理，值得单独排查是否要加缓存层（R2/CDN）或加超时+占位图。

- [ ] **② A 股/港股 Phase 1：茅台（cn-600519）+ 泡泡玛特（hk-9992）**（~2-3 天）
  - **现状**：只有 schema 前置落地（`Entity.market`/`code`，2026-06-15）；路由、导入、页面适配全部未开始。完整方案见 PRODUCT.md「A股与港股覆盖扩展」。
  - **四步最小路径**：
    1. 路由与查询泛化（大头，~1 天）：`src/app/company/[cik]` 目录改 `[id]`；`src/lib/company-data.ts` 的 `formatCompanyCikSlug` / `getCompanyByCik` / `formatCompanyCikUrl` 泛化为 market-aware（`cn-600519` / `hk-9992`，按 `{market, code}` 查询），这套 helper 被公司页/年报页/持仓链接等 5+ 处引用；`/company` 列表页从"只列有 CIK"放宽。
    2. Entity 种子（~半天）：两家公司写小种子脚本手工录入（中文名/行业/交易所/ticker），**不先建 akshare 公司信息管线**，等链路验证后再决定批量化。
    3. 股价（~半小时）：`npm run import:stock-prices:yf -- --ticker 600519.SS` / `9992.HK`，`StockPrice` 表和 K 线图组件零改动，Entity 上配好 ticker 即可。
    4. 公司页 tab 适配（~半天）：概览区按 `market` 显示市场代码而非 CIK；财务/估值 tab 优雅占位；年度报告 tab 占位 + 外链巨潮资讯网/披露易。
  - **Phase 2（财务数据，另 3-5 天）先不做**：akshare 三大表 → LINE_ITEMS 映射 + CNY/HKD 标注，看完 Phase 1 效果再决定。
  - **设计约束（2026-07-26 复盘 RACE 后补充，三条，详见 PRODUCT.md「跨市场扩展的三条结构约束」）**：
    1. **不要把美股抽取链路泛化到 A 股/港股**。RACE 的教训恰恰是这条的最强论据——在 SEC inline XBRL 这种**已经标准化**的格式上都花了好几天、加到第四条策略；A 股年报是 PDF 且章节结构根本没有统一标准。因此 PRODUCT.md Phase 3 的"方案 A：外链巨潮/披露易"应从"临时妥协"上升为**长期答案**，除非将来有明确产品理由才重开。
    2. **`market` 只允许在一个地方进入代码**：即 identifier 的 parse/format helper。页面**按能力渲染，不按市场分支**——Entity 体现的是"有没有财务/有没有年报/有没有持仓"，tab 据此决定显示内容还是占位，而不是散落 `if (market === 'cn')`。否则加第三个市场时又要改 5+ 个地方（与 v0.39.23 清掉的硬编码来源胶囊配色是同一个病）。
    3. **`onboard-company.ts` 不要 fork 出 `onboard-cn-company.ts`**：它的骨架（checkpoint / per-step verify / 断点续跑）是市场无关的，值钱的正是这部分；**只有 steps 列表按 market 不同**——A 股/港股就是"Entity 种子 → 股价"两步，美股是现在的七步。
  - **待拍板（2026-07-26 给出建议，待用户确认）**：
    - (a) 业务/价值分析 LLM tab 要不要给这两家先跑生成（能跑但无年报 evidence，来源标注与美股不同质）。**建议不跑**：已存在"证据缺失时静默产出"的存量问题（P0 ③ / P2 evidence 条目），而 A 股/港股是构造上必然零 evidence，跑了就是批量制造同一类内容。等 Phase 2 财务数据进来后，可基于财务数据跑一个明确标注口径不同的版本。
    - (b) 港股代码规范用 `9992` 还是 `09992`（Yahoo 用 9992.HK，港交所官方 09992）。**建议 `09992`（补零）**：不是因为哪个更好看，而是 `prisma/schema.prisma` 的 `Entity.code` 注释**已经写了 `'00700' (hk)`**，跟着已有约定走、别制造第二套；Yahoo ticker 在同一个 helper 里去零派生 `9992.HK` 即可，Phase 1 里价格管线是唯一的自动化消费方。注意 PRODUCT.md 现有示例代码 `parseCompanyId` 与 Phase 1 目标表仍写作 `9992`，拍板后需一并订正。

- [ ] **③ 抽取管线止血：验收粒度 + evidence guard**（2026-07-26 复盘 RACE onboarding 得出，~半天，**建议先于 ② 或与 ② 并行做**）
  - **复盘结论**：法拉利那两个修复（v0.39.17 页脚锚定、v0.39.18 标点判断顺序）表面是两个解析 bug，但放在一起看只有一个根因——**管线把"抽取"当成确定性操作，而它实际是概率性的**。四条证据：
    1. **onboarding 的验收粒度是错的（本次新发现）**：`scripts/onboard-company.ts` step 1 的 verify 用的是 `prisma.filingSection.count({ where: { entityId } }) > 0`，是**整个 entity 的聚合计数**。法拉利 2020/2021 抽取正常、2022–2025 全空，聚合起来仍然 `> 0`，验收当场通过。这套"每步查库验证真正写入"的机制只能发现"一家公司完全失败"，发现不了"一家公司的某几年失败"——这是 RACE 故障拖到几周后才暴露的直接原因。
    2. **监控是单向的**：`check-filing-section-integrity.ts` 原本只查"有 section 但缺 primary_html"，反向的"有 primary_html 但 0 section"（法拉利的确切形态）是盲区；v0.39.17 补上后立刻冒出 65 例存量（见 P2 对应条目），说明这是一个持续静默累积很久的故障类，不是特例。
    3. **修一个 bug 带出 12 家公司**：`isLikelyHeadingText()` 的标点判断顺序一改，CHTR/DPZ/FND/HPQ/JEF/JPM-PM/KHC/MCK/MDLZ/MTB/NVR/PG 全部从 0 恢复到 20+ 章节。法拉利从来不特殊，它只是碰巧被盯上的那一个。
    4. **抽取器在按"每来一个新 filer 就加一个分支"生长**：`scripts/lib/extract-10k-sections.ts` 现已 1192 行 / 45 个函数，并存 TOC 锚点、20-F 交叉引用表、块扫描三条主路径，RACE 又加了第四条（`collectPageFooterMarkers` 页脚锚定，且带"必须排除表格内数字"的补丁）。
  - **方案取向**：不要去追求"写出永不出错的解析器"，那是无底洞。方向是**让抽取结果成为一等公民的记录，而不是从行数反推健康度**。本条只做最便宜的止血两件事：
    - [x] **verify 改 per-filing 粒度**（2026-07-26 完成，`scripts/onboard-company.ts` step `import_10k`）：verify 从 entity 级 `filingSection.count > 0` 改为按 `ExtSource`（`filerEntityId + kind in [10k,20f,40f]`）逐条检查 `sections: { none: {} }`，任一 filing 零 section 即判失败；另加 `totalFilings > 0` 兜底防止"一条 filing 都没导入"被误判通过。生产库验证：RACE 现在 `total=6 withoutSections=0` 会通过；CHTR/DPZ（未回填）分别 `withoutSections=1/5` 会正确拦下。**副作用**：GE/C-PR/SYF 这类"内容 incorporated-by-reference、零 section 本来就是正常结果"的公司（见下方 65 家条目分类②）会被这条 verify **永久拦住**，无法通过 onboarding——目前不在计划内的新 onboard 名单里，暂不影响，但以后要 onboard 这类公司需要先决定豁免机制或接入 exhibit 抓取。
    - [x] **evidence 缺失时拒绝生成**（2026-07-26 完成，用户拍板"拒绝生成"而非"标注无佐证"）：`company-generation.ts` 新增 `hasUsableFilingEvidence()`（`evidence != null && evidence.sections.length > 0`），`generate-company-profile.ts`/`generate-business-model.ts`/`generate-value-analysis.ts` 三个脚本在 fetch 到 filing evidence 后立即检查，为空则打印 SKIP 原因并 `continue`，不再调用 LLM、不产出无依据内容。`--dry-run --company GE` 验证 SKIP 正确触发（不到达 prompt 构建）；`--dry-run --company AAPL` 验证正常公司不受影响。**范围说明**：`generate-management-analysis.ts` 的 `fetchBuybackEvidence` 未改动——它只是资本配置分析里的一个信号源（financials/holdings/letters 三个信号源之外的补充），本来就允许为空并输出"数据不足"，不是"仅靠 evidence 撑起叙事"的场景，与三个改动脚本的风险不同质，不在这次拍板范围内。`generate-valuation-analysis.ts` 完全不用 filing evidence，同样不涉及。
  - **仍未做**：P2 中已修复但未回填的 12 家公司仍未跑 `extract:10k:sections --needs-current-version`；P2「生成脚本 filing evidence 选取行为不一致」（`fetchLatestFilingEvidence` 不回退旧年份 vs `fetchBuybackEvidence` 回退且标注年份）仍未统一，两者都待后续处理。

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
- [ ] **抽取策略注册表化**（2026-07-26 复盘 RACE 提出，~1 天，P0 ③ 止血之后的结构性改进，可选）：`scripts/lib/extract-10k-sections.ts` 现在是嵌套 fallback（TOC 锚点 → 20-F 交叉引用表 → 页脚锚定 → 块扫描）挤在 1192 行一个文件里，"新格式 = 在共享函数里再加一个 if"，RACE 的 `collectPageFooterMarkers` 就是这么加进去的。改成一个**有名字的策略列表**，依次尝试、返回 sections 或 null，并把**命中的策略名随抽取结果入库**。收益有两层：新格式 = 新增一个策略模块而不是改共享函数（`isLikelyHeadingText` 那个 bug 正是因为共享函数被多条路径复用才一次性影响 12 家公司）；命中策略入库后，"哪类 filer 走哪条路、哪条路在退化"变成可查询的，不必再靠人下载原文复现。**注意**：这是纯重构，前提是 `tests/extract-10k-sections.test.ts` 的既有用例（含 RACE/GOTU/JOYY 回归）能全绿护航。
- [ ] **65 家静默抽取失败的根因已查清并部分修复，待回填生产库**（2026-07-23，`check:filing-section:integrity` 新检测发现后逐个排查；**回填是 P0 ③ 的前置**）：下载 20 家代表性公司原文直接跑现有代码复现，分四类：
  - **① 代码 bug，已修复**（`isLikelyHeadingText()`，`scripts/lib/extract-10k-sections.ts`）：判断"是否以 ITEM/NOTE 开头"之前先无条件拒绝"以句号/冒号结尾"的文本，而"Item 1. Business."这种印刷体标题本身就以句号收尾，直接被误杀，导致整份文件的 item 边界扫描全部落空。改成先判 ITEM/NOTE 模式再判尾标点。本地验证覆盖 CHTR/DPZ/FND/HPQ/JEF/JPM-PM/KHC/MCK/MDLZ/MTB/NVR/PG 12 家公司，全部从 0 section 恢复到 20–23 个；反向验证法拉利/GOTU/JOYY 三家不受影响（它们走 20-F 专属路径，不经过这个函数）。**代码已修复，生产库尚未回填**——需要跑一次 `extract:10k:sections --needs-current-version`，范围是这 12 家公司名下几十条 filing，动作比法拉利单一家公司大，回填前需要确认。
  - **② 内容确实"引用不含正文"，非 bug**：GE、C-PR（Citigroup）、SYF（Synchrony）——这几份 10-K 正文里"incorporated by reference"出现 56–175 次，Item 内容本来就没写在主文档里，引用的是单独的年报 exhibit。要修需要新增"抓取被引用 exhibit"的能力，范围完全不同，未着手。
  - **③ 修正案文件，0 章节属正常**：BN（40-F/A）、GOLD 2021（10-K/A）、PG 2020 的 10-K/A 副本——本来就只覆盖局部内容，不需要处理。
  - **④ 旧式 SGML 格式，孤例**：INOD 2020，文档根节点是 `<document>`，不是现代 inline-XBRL 渲染，优先级低。
  - `data-integrity-check.yml` 的 `--strict` 巡检目前仍会因为②③④（以及①回填前）持续标红开 issue；①回填后应该能消掉多数噪音，②③④要么修复要么加豁免清单再评估。
- [ ] **生成脚本 filing evidence 选取行为不一致**（同上排查发现；**与 P0 ③ 的 evidence guard 是同一处代码，建议一并处理**）：`fetchLatestFilingEvidence`（`scripts/lib/company-generation.ts`，company-profile/business-model/value-analysis 三个生成脚本共用）只认最新一年 `ExtSource`，若该年 section 为空，evidence 文本里 Sections 块直接留空、不回退旧年份；`generate-management-analysis.ts` 自己另写的 `fetchBuybackEvidence` 则会往旧年份回退，且诚实标注具体年份（`[10-K FY2021 ...]`）。同一套数据两种不统一的处理方式，值得决定一个统一策略（回退 + 标注年份 vs 不回退但提示证据缺失）。

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

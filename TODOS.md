# TODOS — 活跃工作队列

> 更新：2026-07-26。本文件只保留**未完成项**，按 P0–P3 排优先级；完成项的结论回写 `PRODUCT.md` 后从这里移除（详细过程见 git 历史）。产品定位、架构、数据口径、测试体系设计一律以 `PRODUCT.md` 为准。
>
> 当前队列于 2026-07-17 与用户讨论后重排：P0 项是用户点名的紧急项（带完整现状诊断，可直接开工），P1 三项是围绕"Agent 是核心入口"主线的既定建议。2026-07-18 新增两项来自 `anthropics/financial-services` 仓库调研的建议（P2）。2026-07-26 复盘法拉利（RACE）onboarding 全过程后新增 P0 ③；泡泡玛特（港股）Phase 1+2 端到端完成并上线，② 改为已完成、范围收窄到剩下的茅台（A股）；12 家回填公司里 11 家跑完，MTB 剩 1 条独立问题。

## P0 — 下一步就做（用户点名，2026-07-17）

- [ ] **① 年报阅读页重新设计 — 仅剩"一键切换中文"未做**（2026-07-21，v0.39.12 已发布左侧目录/附件删除 + 字体行距控件 + AI 解读分栏，结论见 `PRODUCT.md`「年报阅读」「v0.39.12 变更」）：
  - **2) 一键切换中文**（保留年报原样式结构，只译文字）——两个方案未拍板，讨论中倾向认为该做小样本效果对比再定：
    - 方案 A：iframe 加载后遍历文本节点原地替换，CSS/表格/排版原样不动，最贴合"保留原样式"的字面要求；风险是 SEC inline XBRL HTML 极度碎片化（Ferrari 那份文件顶层就有 4814 个 div，一句话常被拆成多个 `<span>`），逐节点翻译缺上下文，译文质量堪忧，金额/代码等不该翻译的内容也需要小心跳过。
    - 方案 B：解析成段落/标题块 → 按块翻译（有完整上下文，质量高）→ 用自己的样式重新渲染；代价是不是原始 CSS 像素级还原，是"结构保留、样式重做"。
    - 两个方案都不应做成"用户点一下现翻现付"——应在 onboarding 阶段预生成并缓存为新 artifact（如 `primary_html_zh`），页面上的"一键切换"只是换一个已翻译好的静态 URL，避免逐次访问的翻译延迟和重复成本。
  - **下一步**：跟用户过一轮翻译方案的小样本对比（同一份 filing 分别跑方案 A/B 看效果），再定最终方案和排期。
- [ ] **①-c `/api/filing-image` 代理延迟严重**（2026-07-21 排查字体/行间距控件失效时发现）：法拉利这份 20-F 内嵌 40 张图片全部经该接口代理转发 SEC.gov 原图，单张最长 3.5 分钟（`race-20251231_g5.jpg`），多张超过 1 分钟，无缓存。当前已通过"控件不再等 iframe `load` 事件"绕开了它对本功能的影响，但代理本身的延迟没有处理，值得单独排查是否要加缓存层（R2/CDN）或加超时+占位图。

- [x] **② A 股/港股 Phase 1+2：泡泡玛特（hk-09992）**（2026-07-26 完成，端到端验证）
  - **路由/查询泛化**：`src/app/company/[cik]` → `[id]`；`src/lib/company-data.ts` 新增 `parseCompanyIdentifier`/`formatCompanyUrl`/`getCompanyByIdentifier` 作为唯一入口（US 走 CIK，CN/HK 走 `{market, code}`），替换掉两套已经互相drift 的旧实现（`company-data.ts` 自己的 `formatCompanyCikUrl` + 独立的 `src/lib/cik.ts`，后者已删除）；`/company` 目录页放宽 `cik: { not: null }` 过滤。`CompanyDirectory.tsx` 的 `cik` key 字段改成通用 `key`。
  - **Entity 种子**：`scripts/lib/cn-hk-company-seeds.ts`（从 `onboard-company.ts` 抽出，因为后来 Phase 2 也要用），手工表，泡泡玛特一行。
  - **股价**：`import:stock-prices:yf --ticker 9992.HK` 零改动直接用（Entity.ticker="9992.HK"，StockPrice 按 ticker 字符串查，与 CIK/market 无关）。
  - **公司页 tab 适配**：概览区按 `market` 显示市场代码而非 CIK；财务分析空态/年度报告空态改市场感知文案；年度报告空态外链披露易 HKEXnews（**用 WebFetch 验证过是真实可达的官方页面**，`https://www.hkexnews.hk/index.htm`，不是编的）。
  - **Phase 2 财务数据（原计划另做 3-5 天，实际发现远比预期简单）**：先做了可行性验证再设计——`akshare.stock_financial_hk_report_em()` 的 `STD_ITEM_CODE` 是跨 HK filer 稳定的数字口径（验证过泡泡玛特 09992 与腾讯 00700 同一 code 对应同一科目），比 PRODUCT.md 原计划的中文科目名匹配靠谱得多；三大报表 12 个 LINE_ITEMS 全部有对应 code，9 个财年（2017-2025）全部拿到，FY2024 营收数字与公开披露的真实数字核对一致。新脚本 `scripts/fetch-cn-hk-financials-ak.py` + `scripts/import-cn-hk-financials-from-file.ts`（两阶段 Python fetch → Node/Prisma 写入，照抄 `fetch-stock-prices-yf.py` 的既有模式），`npm run import:cn-hk-financials`。**A 股（`--market cn`）映射表未实现**——akshare 的 A 股接口（`stock_financial_report_sina`）是宽表 + 中文列名，需要单独验证映射，脚本对 `--market cn` 直接报错退出，不会导入未经验证的数据；茅台 onboard 时要先补这个映射表。
  - **意外发现，纠正了 PRODUCT.md 的原假设**：akshare 没有暴露货币字段，且泡泡玛特虽在港交所上市，**报表货币是人民币（CNY）不是港币**（对着真实 FY2024 营收数字核对过）——`unit`/货币不能从 `market` 推断，必须逐公司核实（见 `cn-hk-company-seeds.ts` 里 `currency` 字段的注释）。`src/lib/currency.ts` 新增 `formatMoneyInYi(value, currency)`，CNY/HKD 加 `¥`/`HK$` 前缀，USD/未知货币走原 `formatUsdInYi` 的无前缀行为（美股公司页面零回归，已截图核对 AAPL）。
  - **② 追加：年报原文 evidence 接入，LLM tab 全部解锁（2026-07-27）**：此前"LLM tab 不跑"是因为没有年报原文、evidence guard 会拒绝生成，不是永久决定——用户订正了对"不泛化"约束的理解（不是"不做年报接入"，是"不照搬美股解析逻辑，按各市场数据格式重新设计"，终局三个市场要对等支持），于是把年报接入这块也做了。新增 `scripts/fetch-hk-annual-report.py` + `scripts/import-hk-annual-report-from-file.ts`，从披露易抓年报 PDF、`pypdf` 提取文本、按页数机械切 4 段存入 `FilingSection`（`ExtSource.kind = "hk-annual-report"`）。`fetchLatestFilingEvidence()`（`scripts/lib/company-generation.ts`）新增这个 kind 和对应 section key，业务/价值/管理三个 LLM 脚本**零改动**自动解锁（evidence guard 本来就是通用检查，不认市场）。`onboard-company.ts` 的 CN/HK steps 从 3 步扩到 9 步：`seed_entity → import_price → import_financials → import_annual_report → 5个generate_*`，与美股共用同一套 generate 步骤定义（此前只在 `market==="us"` 分支里，现在提出来给两边复用）。**港股代码补零 `09992` 拍板已落地**（`hk-09992` 路由 slug）。
    - **技术上最有价值的发现**：披露易搜索不认股票代码直接查——先要用 `GET /search/prefix.do?...&name={code}&callback=callback`（必须带 `callback` 参数，否则静默返回空）把代码解析成 HKEX 内部数字 ID，再用这个 ID 查，一次就能拿完该公司全部历史公告（几秒钟）。一开始不知道这条路，只能传 `stockId=-1`（不过滤），接口会把查询限制在 1 个月内、返回当月**整个港股市场**公告（2-3 万条），按月回溯扫描 19 个月找 2 份年报，跑了 25 分钟没跑完，中止后才找到 `prefix.do` 这条路重做。
    - **验证**：`onboard:company -- --ticker 9992.HK --market hk` 端到端跑通（含新的 `import_annual_report` 步骤 + 5 个生成步骤，checkpoint 正确跳过已完成的前 3 步）；`/company/hk-09992` 业务/价值/管理/估值分析四个 tab 截图确认真实内容替换了"构建中"占位（业务概览提到 Molly/DIMOO 等真实 IP、真实 FY2025 数字；价值分析附"年报未提及重大监管壁垒"这类可溯源到原文的具体论据）；顺手发现并修了 `CompanyGeneratedSections.tsx` 里"以上内容由 AI 基于 **SEC** 公开文件…生成"这行硬编码免责声明文案，改成按 `company.cik` 是否存在切换"SEC 公开文件"/"公司年报"；AAPL 回归截图确认无副作用。
  - **验证**：typecheck/lint/build 全绿；`onboard:company -- --ticker 9992.HK --market hk` 端到端跑过三遍（首次全新建、Phase2财务数据补跑、本次年报+生成补跑，checkpoint 均正确跳过已完成步骤）；`/company` 目录、`/company/CIK0000320193`（AAPL 回归）截图确认无副作用。
  - **未做/后续**：茅台（A股）Phase 1+2+3 都还没做——路由/onboard 骨架可直接复用，但财务数据映射（`akshare.stock_zh_a_disclosure_report_cninfo` 已验证可行，见 P2）和年报解析入库（巨潮资讯网机制与披露易不同）都是新工作。`src/lib/valuation-metrics.ts`/`scripts/lib/company-generation.ts` 里的 `Financial.unit` 仍未线上消费（value_analysis/valuation_analysis 目前不靠它，不紧急）。
  - **设计约束（2026-07-26 复盘 RACE 后补充，2026-07-27 订正了第 1 条的表述，详见 PRODUCT.md「跨市场扩展的三条结构约束」）**：不照搬美股抽取逻辑到 CN/HK（不是不做年报接入，是按市场数据格式重新设计——上面追加的年报接入正是这条约束下做成的）；`market` 只在 identifier 的 parse/format helper 一处进代码；`onboard-company.ts` 不按市场 fork，只有 steps 列表变。

- [ ] **③ 抽取管线止血：验收粒度 + evidence guard**（2026-07-26 复盘 RACE onboarding 得出，~半天，**建议先于 ② 或与 ② 并行做**）
  - **复盘结论**：法拉利那两个修复（v0.39.17 页脚锚定、v0.39.18 标点判断顺序）表面是两个解析 bug，但放在一起看只有一个根因——**管线把"抽取"当成确定性操作，而它实际是概率性的**。四条证据：
    1. **onboarding 的验收粒度是错的（本次新发现）**：`scripts/onboard-company.ts` step 1 的 verify 用的是 `prisma.filingSection.count({ where: { entityId } }) > 0`，是**整个 entity 的聚合计数**。法拉利 2020/2021 抽取正常、2022–2025 全空，聚合起来仍然 `> 0`，验收当场通过。这套"每步查库验证真正写入"的机制只能发现"一家公司完全失败"，发现不了"一家公司的某几年失败"——这是 RACE 故障拖到几周后才暴露的直接原因。
    2. **监控是单向的**：`check-filing-section-integrity.ts` 原本只查"有 section 但缺 primary_html"，反向的"有 primary_html 但 0 section"（法拉利的确切形态）是盲区；v0.39.17 补上后立刻冒出 65 例存量（见 P2 对应条目），说明这是一个持续静默累积很久的故障类，不是特例。
    3. **修一个 bug 带出 12 家公司**：`isLikelyHeadingText()` 的标点判断顺序一改，CHTR/DPZ/FND/HPQ/JEF/JPM-PM/KHC/MCK/MDLZ/MTB/NVR/PG 全部从 0 恢复到 20+ 章节。法拉利从来不特殊，它只是碰巧被盯上的那一个。
    4. **抽取器在按"每来一个新 filer 就加一个分支"生长**：`scripts/lib/extract-10k-sections.ts` 现已 1192 行 / 45 个函数，并存 TOC 锚点、20-F 交叉引用表、块扫描三条主路径，RACE 又加了第四条（`collectPageFooterMarkers` 页脚锚定，且带"必须排除表格内数字"的补丁）。
  - **方案取向**：不要去追求"写出永不出错的解析器"，那是无底洞。方向是**让抽取结果成为一等公民的记录，而不是从行数反推健康度**。本条只做最便宜的止血两件事：
    - [x] **verify 改 per-filing 粒度**（2026-07-26 完成，`scripts/onboard-company.ts` step `import_10k`）：verify 从 entity 级 `filingSection.count > 0` 改为按 `ExtSource`（`filerEntityId + kind in [10k,20f,40f]`）逐条检查 `sections: { none: {} }`，任一 filing 零 section 即判失败；另加 `totalFilings > 0` 兜底防止"一条 filing 都没导入"被误判通过。生产库验证：RACE 现在 `total=6 withoutSections=0` 会通过；CHTR/DPZ（未回填）分别 `withoutSections=1/5` 会正确拦下。**副作用**：GE/C-PR/SYF 这类"内容 incorporated-by-reference、零 section 本来就是正常结果"的公司（见下方 65 家条目分类②）会被这条 verify **永久拦住**，无法通过 onboarding——目前不在计划内的新 onboard 名单里，暂不影响，但以后要 onboard 这类公司需要先决定豁免机制或接入 exhibit 抓取。
    - [x] **evidence 缺失时拒绝生成**（2026-07-26 完成，用户拍板"拒绝生成"而非"标注无佐证"）：`company-generation.ts` 新增 `hasUsableFilingEvidence()`（`evidence != null && evidence.sections.length > 0`），`generate-company-profile.ts`/`generate-business-model.ts`/`generate-value-analysis.ts` 三个脚本在 fetch 到 filing evidence 后立即检查，为空则打印 SKIP 原因并 `continue`，不再调用 LLM、不产出无依据内容。`--dry-run --company GE` 验证 SKIP 正确触发（不到达 prompt 构建）；`--dry-run --company AAPL` 验证正常公司不受影响。**范围说明**：`generate-management-analysis.ts` 的 `fetchBuybackEvidence` 未改动——它只是资本配置分析里的一个信号源（financials/holdings/letters 三个信号源之外的补充），本来就允许为空并输出"数据不足"，不是"仅靠 evidence 撑起叙事"的场景，与三个改动脚本的风险不同质，不在这次拍板范围内。`generate-valuation-analysis.ts` 完全不用 filing evidence，同样不涉及。
  - **回填已跑（2026-07-26）**：12 家公司全部跑过 `extract:10k:sections --needs-current-version`。**11/12 完全恢复**（CHTR/DPZ/FND/HPQ/JEF/JPM-PM/KHC/MCK/MDLZ/NVR/PG，`withoutSections` 全部归零）。**MTB 剩 1 条未解决**——FY2022 10-K（`sourceId cmpl0h2lz0xy7rss7sbtd0d0l`，accession `0000950170-23-003804`）单独重跑，症状和另外 11 家不同：不是解析逻辑问题，是 R2 对象抓取本身卡住/极慢（`fetching R2 object ...` 之后长时间无 "extracting from N bytes" 日志），更像 P0 ①-c 那类基础设施延迟问题，不是 `isLikelyHeadingText` 那类 bug。未深挖，待有空排查 R2 fetch 延迟或换用直连 SEC.gov 的 fallback 路径。
  - **仍未做**：P2「生成脚本 filing evidence 选取行为不一致」（`fetchLatestFilingEvidence` 不回退旧年份 vs `fetchBuybackEvidence` 回退且标注年份）仍未统一。

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
- [ ] **A 股 Phase 1+2（茅台）**：港股（泡泡玛特）已完成，见 P0 ②。A 股复用同一套路由/onboard 骨架，但财务数据映射需要新工作——`akshare.stock_financial_report_sina()` 是宽表 + 中文列名，不是港股那种跨 filer 稳定的 `STD_ITEM_CODE`，需要单独验证一遍列名映射（`scripts/fetch-cn-hk-financials-ak.py` 里 `--market cn` 目前直接报错退出）。
- [ ] **search_filings 覆盖扩展**：finer-grained 财务报表 / notes 章节；HK/A 股年报（依赖 A 股/港股接入进度）。
- [ ] **DEF 14A（proxy）抓取**：10-K item_10/11 只有 incorporated-by-reference 占位，管理层薪酬/董事会结构要 proxy。接入后管理分析补"管理层与董事会"卡。
- [ ] **Agent 扩展验收**：跨大师对比 / 时间线 / 观点 + 公司持仓 + 年报联动的组合查询质量验收。
- [ ] **pi-gateway 流量监控**：PM2 logs + Langfuse 观测调用情况。
- [ ] **L5 Playwright E2E 冒烟**：5-6 个核心用户路径（`/agent` 问答、公司页六 tab、年报阅读器、大师主页）。写起来最贵、维护成本最高，边际价值低于 L3/L4，明确延后。
- [ ] **重写 `tests/README.md`**：现在内容指向另一个仓库（talk-with-buffett），完全过时。
- [ ] **抽取策略打点（原「注册表化」，2026-07-26 复议后大幅缩小范围）**：复议后判断完整 registry 重构（`applicable()/run()` 接口）当前不必要——`extractTargetSections()`（`scripts/lib/extract-10k-sections.ts:1105`）实际只有 **3 条顶层策略**（① `preferTocAnchors` 时的 TOC 锚点、② `kind==="20f"` 时的交叉引用表——RACE 加的页脚锚定只是它内部按 section 粒度的二级兜底，不是独立第 4 条、③ 对三种 filing kind 都生效的块扫描兜底），三年多只出现过一次"需要新增顶层策略"的情况（RACE），历史上更常见的故障模式是块扫描这个共享兜底本身的匹配逻辑有 bug（`isLikelyHeadingText` 一次波及 12 家），registry 化并不能防止这类 bug，只是让"加新策略"更好隔离——而这不是当前的增长曲线，且已拍板"美股抽取链路不泛化到 A 股/港股"，近期没有新增顶层策略的驱动力。**改成一个便宜得多的版本**：不引入策略接口，只在 `extractTargetSections` 现有的三个 return 点把命中的策略名（`"toc-anchor" | "20f-cross-reference" | "block-scan"`）带出来，随抽取结果存进 `FilingSection`（或旁边一张小表），拿到"哪类 filer 走哪条路、哪条路在退化"的可查询能力，不用等下次静默失败被撞见才靠人下载原文复现。~1 小时量级。**完整 registry 重构降级为**：等真的出现第三次"需要新增顶层策略"的场景再启动，不预先搭框架。
- [ ] **65 家静默抽取失败的根因已查清并部分修复，待回填生产库**（2026-07-23，`check:filing-section:integrity` 新检测发现后逐个排查；**回填是 P0 ③ 的前置**）：下载 20 家代表性公司原文直接跑现有代码复现，分四类：
  - **① 代码 bug，已修复**（`isLikelyHeadingText()`，`scripts/lib/extract-10k-sections.ts`）：判断"是否以 ITEM/NOTE 开头"之前先无条件拒绝"以句号/冒号结尾"的文本，而"Item 1. Business."这种印刷体标题本身就以句号收尾，直接被误杀，导致整份文件的 item 边界扫描全部落空。改成先判 ITEM/NOTE 模式再判尾标点。本地验证覆盖 CHTR/DPZ/FND/HPQ/JEF/JPM-PM/KHC/MCK/MDLZ/MTB/NVR/PG 12 家公司，全部从 0 section 恢复到 20–23 个；反向验证法拉利/GOTU/JOYY 三家不受影响（它们走 20-F 专属路径，不经过这个函数）。**已回填（2026-07-26）**：11/12 完全恢复，MTB 剩 1 条因不同症状（R2 fetch 慢/卡，非解析 bug）未解决，详见 P0 ③。
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

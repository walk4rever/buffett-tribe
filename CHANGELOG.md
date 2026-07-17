# Changelog

All notable changes to this project will be documented in this file.

## [v0.38.15] - 2026-07-10

### Fixed
- Filer / Company 身份拆分：新增 `Filer` 表（`tribeId` / `filerEntityId` / `companyEntityId` / `isMasterPersona`）作为"投资人是否也是一家公司"的唯一权威来源；修复 Berkshire 双 Entity 导致李录/段永平持仓里 BRK-A/BRK-B 链到空实体的问题；5 处把 `type="master"` 当公司候选的查询/打分逻辑收口为只认 `type="company"`。
- `search_holdings`、`check-latest-holdings-company-coverage`、`check-financial-integrity` 三处硬编码 3 投资人清单改为从 `Filer` 表动态读取，覆盖全部 5 位（含 Atreides、Whale Rock）。
- `typecheck:scripts` 历史遗留错误清零：修复 `import-10k-edgartools.ts` 自 FinancialFact 删表后完全跑不通的问题（删除死代码调用点），顺带清理孤儿基准脚本与类型窄化问题。

### Added
- 每周数据完整性巡检 workflow `data-integrity-check.yml`（周一 02:00 UTC，4 个只读检查，`--strict` 命中才开 GitHub issue）。
- 新增 `check:filing-section:integrity`：检查有抽取内容的 FilingSection 背后 `primary_html` 归档是否齐全（search_filings 全文来源）。
- 13F 数据完备性排查：5 位投资人 2020Q1–2026Q1 每季连续无缺；修复 Atreides 2022Q2 缺失（重导 40 条持仓）、删除 2 条 13F-HR/A 空重复行。

## [v0.38.14] - 2026-07-08

### Fixed
- `tests/` 排除出 app tsconfig，修复 Vercel build。

### Changed
- pi-gateway 的 air7 部署目录与 PM2 进程名按项目命名空间化；移除遗留 systemd unit 文件。

## [v0.38.13] - 2026-07-08

### Added
- 测试体系 L0/L1/L3 落地：CI push/PR gate（`test.yml`：lint + vitest）；`search-filings` 纯函数拆出零依赖模块并补 12 个单测；`tests/agent-tools/` 三个 Agent 工具各一组 golden case 契约测试（对生产库只读真跑，`search_wisdom` 需付费 key 留本地）。

### Fixed
- CI 首跑两处修复：`services/pi-gateway` 独立依赖需单独 `npm ci`；git-ignored 的共享库副本需先跑 `sync:shared`。

## [v0.38.12] - 2026-07-08

### Fixed
- `search_filings` 全文修复：`FilingSection.content` 曾被无留痕手工操作截断到 3000 字，命中章节改为从 `FilingArtifact(kind=primary_html)` 现取原文、现场解析章节，`content` 降级为 fallback-only；R2 拉取加重试。

## [v0.38.11] - 2026-07-03

### Changed
- Insights 来源胶囊：Capital Allocators 独立配色。

## [v0.38.10] - 2026-06-25

### Added
- 注册用户批量邮件公告脚本（`npm run send:announcement`）。

## [v0.38.9] - 2026-06-25

### Changed
- Agent 工具调用指示器显示参数摘要（工具名 · 参数 · 返回条数）。
- README / PRODUCT / TODOS 同步 v0.38.x Agent 架构。

## [v0.38.8] - 2026-06-25

### Added
- `search_filings` 工具：FilingSection 年报章节检索（section alias 映射、keyword excerpt、公司名/ticker 检索），约 120 家公司 2020–2025。

### Changed
- 工具调用指示器按工具名区分 label 与细节格式。

## [v0.38.7] - 2026-06-25

### Added
- `search_holdings` 工具：13F 持仓 SQL 检索（Holding → Security → Entity 联表，默认最新季度，支持 master/company/year/quarter 过滤）。

## [v0.38.6] - 2026-06-24

### Changed
- Agent 回答格式增强（分析 + 引用分层）；新增 `services/pi-gateway/deploy.sh` 可重复部署脚本（rsync → npm install → pm2 restart）。

## [v0.38.3 – v0.38.5] - 2026-06-24

### Changed
- 单工具架构：`search_letters` 并入 `search_wisdom`，统一 GBrain 语义检索入口；接入李录内容并支持 master 过滤。
- Insights 支持 `?source=` 按播客/栏目过滤；首页 Hero 区简化为整体点击跳转 `/agent`。

## [v0.38.1 – v0.38.2] - 2026-06-23

### Added
- `search_wisdom` 工具：GBrain 知识层语义检索（OpenAI text-embedding-3-large 1536d）。
- Agent 会话记忆（sessionStorage，30min TTL）与工具调用指示器。

## [v0.38.0] - 2026-06-22

### Added
- 投资研究 Agent 上线 `/agent`：接入 `@earendil-works/pi-coding-agent`，pi-gateway（Express SSE）部署 air7（PM2 + nginx relay），Next.js `/api/pi` 代理路由（AGENT_SECRET 留服务端），LLM 为 DeepSeek。
- InsightPost 通过 `entityIds` 关联 Entity，洞见详情页展示相关公司。

## [v0.37.9] - 2026-06-15

### Changed
- 洞见列表重排版：左列改为两行日期（"Jun 26 / 2026"，水平居中）；来源胶囊移至与标题同行（baseline 对齐）；移除「第xx篇」编号与阅读时长。

## [v0.37.8] - 2026-06-15

### Added
- 回购数据接入：LINE_ITEMS 新增 `ShareRepurchaseAmt`（XBRL PaymentsForRepurchaseOfCommonStock 等），`backfill:share-repurchase` 脚本用 SEC companyfacts API 回填全部公司（604 条 FY 年度数据，126 个年度无回购事实）。
- Document 表：8 个大师文档（巴菲特/段永平/李录 PDF）从代码硬编码迁移到数据库，新增文档无需发版。
- Chunk 补 embedding：`backfill-chunk-embeddings.ts` 脚本，122 个缺嵌向量全部补齐（0 失败）。
- GCV 保留策略：`prune-gcv.ts` 脚本（keep=2，`npm run db:prune-gcv`），防止重生成累积历史版本。

### Changed
- Entity 标识层泛化：新增 `market`（'us'|'hk'|'cn'）和 `code` 字段及复合索引，为 A 股/港股数据接入做前置准备；CIK 注释降级为美股专属属性。
- FinancialFact 模型删除：表已为 0 行，从 schema 中清理；`Financial.sourceFactIds` 注释更新为指向 R2 data_file artifact objectKeys。
- 生成内容版本管理决策：三套并存（CompanyAnalysis / BusinessCanvas / GCV），新内容统一走 GCV，旧路径维持原状。
- `src/lib/documents.ts` 改为从 DB 异步读取，所有调用方更新为 await。

## [v0.37.6] - 2026-06-13

### Added
- 数据库容量告警：`check:db-size` 脚本（warn 400MB / critical 450MB），GitHub Actions 每周自动检查并在超阈值时开 Issue，批量内容生成前置容量检查（>460MB 拒绝跑批）。

### Changed
- 数据库容量治理：333MB → 209MB。ExtSource 元数据裁剪至必要字段（748 行完整 JSON 归档 R2，53MB→1MB）；FilingSection 预览字段截断至 3KB（全文继续走 R2，阅读器不受影响）；2 年前的股价日线降采样为周线 OHLC（K线图月K/季K与近期日K不变）；PE 历史分位统一为周采样口径，远近期权重一致。
- 股价抓取脚本默认起始日期改为动态 2 年前，避免重新回填已降采样的远期日线。

### Notes
- 远期日线数据已删除（不可逆），如需恢复可从价格源重新抓取。

### Added
- 管理分析 / 估值分析扩量至全部部落成员持仓公司：55 家公司（5 位成员最新季度 13F 持仓）生成管理分析，51 家生成估值分析；无正 EPS 或缺价格数据的公司（SNOW、TEM、CRCL、CRWV、LLYVK）保持「构建中」占位。
- CapEx 数据接入：财务提取管线新增 CapEx 科目（XBRL PaymentsToAcquirePropertyPlantAndEquipment 等），`backfill:capex` 脚本用 SEC companyfacts API 一次性回填存量公司 618 行年度 CapEx。

### Changed
- 估值分析从 OCF 近似切换为真实自由现金流：FCF = OCF − CapEx，指标卡显示 P/FCF；CapEx 数据缺失的公司（如银行类）自动回退 P/OCF 口径并在免责声明中如实标注。重资产公司口径修正显著（如 OXY：P/OCF 8.2 vs P/FCF 21.1）。

## [v0.37.4] - 2026-06-13

### Added
- 公司页「管理分析」tab 上线 AI 生成内容（MCO 试点）：管理层总评 + 资本配置评分、资本配置记录卡（回购与分红 / 并购与投资 / 资本回报纪律）、大师视角（股东信 + 13F 动作）、股东利益一致性，每条结论带数据来源。
- 公司页「估值分析」tab 上线 AI 生成内容（MCO 试点）：当前 PE / 历史 PE 区间与分位 / P/OCF 指标卡、质量与增长解读、5 年情景分析（保守/基准/乐观，假设由 AI 提出、隐含回报由代码计算）、估值判断。不输出买卖建议与目标价。
- 估值计算层 `src/lib/valuation-metrics.ts`：PE 历史分位、P/OCF、ROE/营收/净利 CAGR、情景回报数学全部由代码计算，LLM 只负责叙事解读。
- 生成管线脚本 `generate:management-analysis` / `generate:valuation-analysis`（支持 --dry-run），复用 GeneratedContentVersion 版本化存储。

### Changed
- 公司页两个新 tab 标注「AI 生成 + 生成时间」与免责声明；无生成数据的公司回退到「构建中」占位卡。

## [v0.37.3] - 2026-06-12

### Added
- 公司库独立页面 `/company`：列出全部有 CIK 的公司，顶部搜索框按中文名/英文名实时过滤；顶部导航新增「公司」入口（公司/对话/洞见）。

### Changed
- 首页底部公司库区块移除，职责移交 `/company` 页面；首页以信号卡 + Hero + 部落成员收尾。
- 首页「⇅ 各有判断」信号卡 chips 不再用"N 多头 / N 空头"，改为每侧具体动作与幅度（如"李录 建仓 1.60%"、"巴菲特 减持 -0.50%"）；仓位变化单位从 pp 统一为 %。

## [v0.37.2] - 2026-06-12

### Removed
- Neo4j 图谱层完全退役：Aura 实例已长期不可达，chat 一直在静默降级运行。删除 `neo4j-driver` 依赖、graph-retrieval、`/retrieval-compare` 实验页与 API、`/api/tools/graph`、MCP graph 工具、8 个 neo4j 脚本和 12 个 npm scripts。
- 检索统一为 pgvector 语义 + tsvector 关键词混合。

### Added
- `TODOS.md`：数据架构优化清单（来源：2026-06-12 Postgres/R2/Neo4j 全局 review），含 Company Brain 最小闭环、Entity 标识层泛化、容量治理等 P0–P3 事项。

### Notes
- 后续运维：Neo4j Aura 控制台删除实例、Vercel 删除 `NEO4J_*` 环境变量。
- 结构化关系沉淀的后续方向是 Company Brain（Claim 表），见 TODOS.md P0。

## [v0.37.1] - 2026-06-11

### Changed
- 设计一致性收口（依据 APPLE-DESIGN.md 审查）：全站功能蓝统一为 Apple 蓝 `#0071e3`（替换 Tailwind 蓝 #2563eb/#1d4ed8、iOS 蓝 #007AFF、#93c5fd）。
- 阅读界面正文色统一为 `--apple-near-black`/`--apple-body`，消除信件/财报/中译块四种文字灰。
- 股东信阅读列宽 980px → 780px，与财报阅读器 74ch 行宽对齐。
- 财报阅读器正文字号 0.98rem → 1rem，与信件正文齐平。

### Notes
- PRODUCT.md 新增"颜色规则"段落：单一功能蓝、阅读行宽上限、大师品牌色豁免（仅限 master hero 区）、数据语义色 token 化。
- 遗留项（下一轮）：三个阅读器顶栏/侧栏 chrome 结构统一、圆角体系、青铜金 accent token 化。

## [v0.37.0] - 2026-06-11

### Removed
- 语音与数字人功能整体下线，产品范围收缩为纯文字对话。
- 删除 `/api/asr/*`、`/api/tts`、`/api/digital-human/jobs/*` API 路由和 `/avatar` 跳转页。
- 删除 `src/lib/speech/`（火山引擎 ASR 客户端/协议/浏览器录音）与 `src/lib/digital-human*` 模块。
- 删除独立 ASR relay 服务（`relay/` 目录）及 `bench-live-asr-*`、`test-volc-asr` 实验脚本。
- 移除 `ws` / `@types/ws` 依赖和 `.env.example` 中的 ASR/TTS/relay 环境变量。
- 数据库删除 `DigitalHumanProfile` / `DigitalHumanJob` 表（migration `20260611000100_drop_digital_human`，已应用到生产库）。

### Notes
- 修复迁移历史分叉：将失败的 `20260609000100_add_insight_posts` 记录标记为 rolled back，本地 `add_insight_post` 标记为已应用（DB 实际结构已验证一致），`migrate deploy` 恢复可用。
- 文字对话、检索、embedding 链路不受影响；relay 服务器可停机，火山语音 token 可吊销。

## [v0.36.23] - 2026-06-09

### Added
- 新增 Alpha master 分类，Gavin Baker / Atreides Management, LP 作为第一位 Alpha 投资人，与核心大师导航和首页展示分区区分。
- 新增 Gavin Baker master 页面默认画像、Alpha 标签和 13F 披露限制说明；持仓页复用现有 13F 展示并提示 13F 不代表完整 Atreides 组合。
- `import:13f` 支持 `--filer gavin-baker`，Atreides Management, LP 映射 CIK `0001777813`。

### Changed
- 首页和全站导航只把 Buffett、Li Lu、Duan 作为核心部落成员展示，Alpha 投资人放在独立区域。
- 未配置资料库的 master 不再 fallback 到 Buffett 资料分类，改为显示“资料库建设中”。

### Notes
- Gavin Baker 最近 8 个季度 13F 入库命令已准备好：`npm run import:13f -- --filer gavin-baker --quarters 8`。
- 本轮尝试导入时 Supabase pooler 仍返回 `ECHECKOUTTIMEOUT`，轻量 `entity.count()` 也无法取到连接；因此 Atreides 13F 实际入库需等 Supabase Disk IO / pooler 恢复后再执行。

## [v0.36.22] - 2026-06-08

### Fixed
- 首页 Server Component 的公司列表和成员季度查询增加 DB fallback，Supabase pooler 短暂取不到连接时不再让首页 production render 直接 500。

### Notes
- 本地 production 复现到 digest `1088092378`，真实错误为 Supabase pooler `ECHECKOUTTIMEOUT`。修复后首页返回 200，但请求仍可能受 Supabase Disk IO / pooler 健康影响变慢。

## [v0.36.21] - 2026-06-08

### Added
- 新增 `FilingSectionExtractionJob`，按 source 记录结构化年报 section 回填状态：`pending`、`running`、`success`、`failed`、`no_sections`。
- 新增 `npm run backfill:filing-section-jobs`，支持单 worker、低 QPS、pause file、source 级失败记录和小样本回填。
- 新增 R2 object 直读能力，section backfill 优先通过 R2 SDK 读取已归档 `primary_html`，再 fallback 到 URL。

### Changed
- `extract-10k-sections.ts` 导出 source 级处理函数，失败时回滚本 source 本轮部分写入，避免半份年报被误判完成。
- R2 上传和 artifact DB retry 调整为更适合大 section artifact 的保守配置。

### Notes
- 2026-06-08 先跑 20 份 10-K 小样本：18 `success`、2 `no_sections`、0 `failed`。扩大回填前应先观察 Supabase hourly Disk IO。
- 暂不继续混跑 20-F/40-F；这些 filing 类型需要单独队列和 parser 质量复核。

## [v0.36.14] - 2026-06-04

### Added
- `import:10k` 和 `import:10k:all` 增加 `--skip-attachment-archive`，支持先导入 facts/sections/attachment rows，跳过大附件 R2 归档。
- 年报附件归档阶段增加缓存、缺失数量、单附件开始/完成和耗时日志，便于定位重附件 20-F 的进度。

### Fixed
- 修复 Diageo 这类 3 列 `Cross reference to Form 20-F` 表无法提取 sections 的问题。
- 20-F cross-reference parser 支持 `Page(s)`、页码范围和页面页脚形态，避免重附件 20-F 导入完成后 sections 仍为 0。

## [v0.36.13] - 2026-06-03

### Added
- `FilingSection` 增加 section text / blocks / HTML artifact 引用字段，并新增迁移脚本将旧的大字段内容归档到 `FilingArtifact`。
- 新增 `/api/filing-section`，支持年报正文按需从 artifact 懒加载完整 section 内容。
- 新增 table-rendered 10-K item heading 的提取回归测试。

### Changed
- 10-K 导入和 section 提取流程改为将完整正文、结构化 blocks 和 HTML 片段写入 artifact，数据库保留 preview 和轻量结构。
- 年报阅读器过滤内部 `section_*` artifacts，并将正文内 note/小标题样式调整为更接近年报正文的层级标题。

### Fixed
- 改进 10-K item heading 检测，支持 Apple 这类 compact table heading 的章节切分。

## [v0.36.0] - 2026-05-26

### Changed
- 文档口径统一到当前运行面：
  - 新增 [scripts/README.md](/Users/rafael/R129/buffett-tribe/scripts/README.md) 作为主入口脚本编号总览。
  - `PRODUCT.md` 补充 `generate:master-profile`、`generate:portfolio-insight`、`generate:business-canvas` 的正式运行口径。
  - `README.md` 更新当前状态，明确公司页、批处理导入和生成脚本已接入运行面。
- `scripts/generate-business-canvas.ts` 从实验脚本升级为正式入库脚本，并挂入 `package.json`。
- `scripts/generate-master-profile.ts`、`scripts/generate-portfolio-insight.ts` 恢复为正式主入口，并重新纳入 `typecheck:scripts`。

### Fixed
- `scripts/generate-portfolio-insight.ts` 的 `--dry-run` 不再实际调用 AI，只输出 prompt 预览和 would-upsert 信息。

### Removed
- 删除未接入运行面的 Postgres 关系表：`Mention`、`EntityRelation`。
- 删除历史种子脚本：`scripts/seed-business-canvas.ts`。

## [v0.35.27] - 2026-05-23

### Fixed
- `scripts/import-13f.ts` 核心逻辑重写：
  - 不再创建 `type=security` 的 Entity。
  - 按 CUSIP 查找/复用 Security 记录；按 ticker 查找/复用 `type=company` Entity；都找不到则新建 `type=company` + Security。
  - Holding 的 `securityEntityId` 指向 company entity，`securityId` 指向 Security 记录。
  - `upsertFilerEntity` 改为按 `tribeId` 查找（不再按 CIK），避免与 company entity 的 CIK unique 约束冲突。
- `scripts/import-10k-xbrl.ts` 的 `upsertCompanyEntity()`：
  - 按 ticker 查找兼容所有 type（包括存量 `type=security`），找到非 company 时自动升级为 `type=company`。

### Added
- `docs/handoff-entity-security-refactor.md`：完整的四阶段架构重构方案文档。

## [v0.35.26] - 2026-05-23

### Changed
- **BRK-B Master/Company 分离**：
  - Master entity 保留 `tribeId='buffett'` 和 `MasterProfile`，专用于投资人格。
  - 新建 `type=company` BRK-B entity（CIK=1067983），接收所有 10-K 数据。
  - 迁移 11 条 ExtSources(10k)、15,073 FinancialFacts、35 Financials、79 FilingSections、CompanyAnalysis 到公司 entity。
  - 44 条 Holdings（as security）迁移到公司 entity。
  - **补全 BRK-A Security 记录**（CUSIP=084670108, titleOfClass=Class A），与 BRK-B 共享同一 Company entity。
- **补跑 7 家公司 10-K 数据**：BMY、PNC、TEVA、UAL、MTB、SYF、GOLD。
  - 每家公司写入 4-5 年 10-K 的完整 XBRL facts（12K-28K facts/公司）。
  - 更新对应 Security 记录的 `companyEntityId`，消除 7 条 null 值。
- 剩余 8 条 Security 无 companyEntityId（已退市/合并/ETF），保持 null 为合理状态。

## [v0.35.25] - 2026-05-23

### Fixed
- 清理 BRK-B / AAPL / NVDA / PDD / TSLA 的重复 Entity 记录：
  - 将 Holdings（作为被持股票）从旧的无 CIK entity 迁移到有 10-K 数据的主 entity。
  - 删除 5 个空壳重复 entity，确保每家公司只有一条完整记录。
  - 新增 `scripts/merge-duplicate-entity.ts`，支持按 URL 映射合并重复 entity 的 FinancialFact / Financial / FilingSection 数据。
- **修复 Security 表级联删除导致的 Holdings 关联丢失**：
  - 为 5 家公司重新创建 Security 记录（含 cusip 恢复）。
  - 更新 141 条 Holdings 的 `securityId`，消除所有 dangling reference。
  - 零 dangling securityId，零 null securityId。

## [v0.35.24] - 2026-05-23

### Added
- `scripts/import-10k-xbrl.ts` 改造：导入时同时写入所有 XBRL facts 到 `FinancialFact` 原始事实层。
  - CompanyFacts API 返回的全部 us-gaap/ifrs concepts 批量入库。
  - Inline XBRL 解析补充事实，增量入库。
  - 派生层 `Financial` 表继续保留，不受影响。
- 新增 `scripts/extract-10k-sections.ts`：从 `ExtSource.url` 下载 10-K HTML，提取文本章节。
  - 支持提取 Item 1 Business / 1A Risk Factors / 7 MD&A / 7A Market Risk / 8 Notes 等。
  - 自动跳过已提取的章节，支持并发控制和 `--ticker` / `--limit` 参数。
  - 已验证 AAPL 6 年 10-K，成功提取 42 个章节。

### Changed
- `FinancialFact` 表增加唯一约束 `(sourceId, concept, endDate, unit)`，支持 upsert 去重。

## [v0.35.23] - 2026-05-23

### Added
- Prisma schema 扩展 truth-of-source 层，新增三张表支持 10-K 完整数据入库：
  - `FinancialFact`：原始 XBRL 事实层，保留所有 us-gaap/ifrs/dei/srt concepts 的原始数值、时间维度、context/unit、原始 JSON。
  - `FilingSection`：文本章节层，支持 Item 1 Business / 1A Risk Factors / 7 MD&A / 8 Notes / Exhibits 等完整文本。
  - `FilingAttachment`：附件层，记录 Exhibits 序列号、描述、文档类型、URL。
- `Financial` 派生层保留并增强：新增 `sourceFactIds` / `mappingRule` / `confidence` 字段，支持追溯原始事实。
- `ExtSource` 增强关系：新增 `facts` / `sections` / `attachments` 关联。

## [v0.35.22] - 2026-05-23

### Added
- 公司页新增商业画布（Business Model Canvas）：9 格经典布局，带 Lucide 图标，中英文标题折行。
- 商业画布支持动态加载：数据库有数据则显示真实画布，无数据则显示"构建中"占位。
- 新增 `BusinessCanvas` Prisma 模型与种子脚本，已入库 AAPL / KO / MCO 三家真实画布数据。
- 新增 `scripts/generate-business-canvas.ts`，支持用 LLM 基于公司财务数据生成商业画布。

### Changed
- "业务概览"与"商业画布"合并为同一"商业分析"区域，去掉无意义的英文副标题。
- 商业画布采用 5 列经典 BMC 桌面布局，成本结构与收入来源底部并排，分界线对齐价值主张中线。
- 财务分析区域标题精简：去掉 "Compound annual growth" / "Business Model Canvas" 等装饰性英文。

## [v0.35.21] - 2026-05-23

### Changed
- 公司页财务分析模块重构：
  - 通用类公司与金融类公司分两套 8 KPI，同一口径上下一致。
  - 通用类：营收 / 营收同比 / 毛利率 / 营业利润率 / 净利率 / ROE / 经营现金流净额 / 资产负债比。
  - 金融类：净利润 / ROE / ROA / 资产负债比 / 总资产 / 经营现金流净额 / 净利润同比 / 摊薄 EPS。
  - 5 年趋势表移至同一模块内，年份范围直接标注。
  - 新增长期复合增长摘要（CAGR），放在趋势表下方；通用类含营收 / 营业利润 / 净利润 / 经营现金流 CAGR，金融类含净利润 / 摊薄 EPS / 总资产 / 股东权益 CAGR。
  - 去掉 "口径" 字样，标题更简洁。

## [v0.35.20] - 2026-05-23

### Changed
- Latest holdings chart company names now link to company detail pages while preserving the existing compact visual style.
- Latest holdings chart now calculates "Other" from actual remaining holdings instead of rounding against 100%.

### Fixed
- Master profile case names now prefer current holdings metadata, correcting EWBC to display as 华美银行 on Li Lu's page.

## [v0.35.19] - 2026-05-23

### Changed
- Header now uses wider edge-aligned spacing and adds direct tribe member links for Buffett, Li Lu, and Duan Yongping.
- Mobile header keeps account access on the first row and shows tribe member links on a second row.

## [v0.35.18] - 2026-05-23

### Fixed
- Company pages now only calculate holding change percentages against the immediately previous 13F filing, so re-opened positions like Buffett's DAL in 2026 Q1 show as new buys instead of reductions from years-old holdings.

## [v0.35.17] - 2026-05-23

### Added
- PDF reader toolbar refinements: stronger selected states, fit-width/fit-height modes, and page number jump input.
- PDF sidebar tabs for thumbnails and document outline/bookmarks, including outline selection and scroll-follow behavior.
- Back link from PDF reader titles to the corresponding master library section.

### Fixed
- PDF reader hydration mismatch from persisted view mode.
- Continuous/single mode switching, fit-height persistence, thumbnail follow, and current-page tracking edge cases.

## [v0.34.0] - 2026-05-11

### Added
- 全新首页 v2：信号栏（共识持仓/新动作/各有判断）、HeroSearch、部落成员卡片
- 持仓快照页（`/person/[id]/holdings`）：13F 数据展示
- 13F 数据导入脚本（`scripts/import-13f.ts`）
- Prisma schema 新增 13F 持仓表
- 新品牌资源：logo.svg、Buffett/李录/段永平 avatar

### Changed
- 项目目录与 GitHub 仓库统一更名为 `buffett-tribe`
- 首页内置导航栏，移除全局 Header 组件
- 导航栏删除无意义的硬编码 "2025 Q4" 标签

### Removed
- Live Room 功能（`/live`、`/live/room` 页面及 `LiveRoomWorkspace` 组件）

## [v0.2.0] - 2026-03-19

### 项目重命名
- **learn-from-buffett → talk-with-buffett**
- 产品方向升级：从"穿越式阅读"到"与巴菲特对话"

### 新方向
- 核心愿景：虚拟巴菲特人物，基于 59 年信件知识库进行实时对话
- 三步走实现路径：数据结构化 → 对话引擎 → 虚拟人物
- 新增主题时间线概念：按公司/主题跨年份检索巴菲特言论

### 文档更新
- 重写 README.md — 反映新的产品方向和技术路线
- 重写 PLAN.md — 四个 Phase 实现计划（数据结构化、对话引擎、虚拟人、打磨）
- 重写 TODOS.md — 当前冲刺聚焦全量数据结构化

## [v0.1.0] - 2026-03-16

### 新增功能
- 实现移动端响应式设计，修复小屏幕文本重叠问题
- 添加深色模式切换功能，支持本地存储持久化
- 实现高亮标注的本地持久化，刷新后保持
- 添加错误边界组件，提升错误处理能力
- 创建隐私政策、服务条款、联系我们等页面

### 改进
- 优化AI分析加载状态，添加加载动画
- 改进高亮渲染算法，避免重叠问题
- 增强整体用户体验和界面交互

### 修复
- 修复移动端文本重叠问题
- 改进错误处理和反馈机制

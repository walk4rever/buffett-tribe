# Changelog

All notable changes to this project will be documented in this file.

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

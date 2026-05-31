> 🔒 内部文件，不对外公开。

# TODOS — 当前工作队列

> 功能/决策/架构详见 PRODUCT.md

## ✅ 已完成

- [x] Prisma Schema（Letter, Chunk + 用户模型）
- [x] 数据导入 — 60 封股东信 + ~30 封合伙人信，1413 chunks
- [x] 主页年份列表 + 动态信件页 `/letters/[type]/[year]`
- [x] NextAuth 认证（Credentials）
- [x] 移动端响应式、暗黑模式持久化、错误边界
- [x] 对话 API `/api/chat` — 混合检索 + RAG + 引用来源 + 每日限额
- [x] 巴菲特人格 Prompt
- [x] SSE 流式输出
- [x] 混合检索 — tsvector + pgvector (1024-dim HNSW)
- [x] 后端主导引用机制（杜绝幻觉）
- [x] 阅读页 — contentMd 直接渲染，中英交替 + 单语过滤
- [x] 代码清理 — 删除 Section 及所有依赖代码（-4800 行）
- [x] **Phase A**：数据模型重构 Letter → Source（v0.13.0）
  - [x] Prisma schema 重命名 + 新增字段（videoUrl, videoSource, thumbnailUrl）
  - [x] Chunk.letterId → Chunk.sourceId
  - [x] 代码全量替换（search.ts, prompts/buffett.ts, api/chat/route.ts, 页面组件）
  - [x] import 脚本适配
- [x] **Phase C**：统一工作区（v0.14.0）
  - [x] Chat + Canvas 分屏组件（Workspace.tsx）
  - [x] 共享 chat 类型和 SSE 客户端（lib/chat.ts）
  - [x] /api/source — Canvas 内容 API
  - [x] 引用点击 → Canvas 打开对应内容
  - [x] 独立页面点击"对话" → 进入工作区
  - [x] 工作区 URL（/workspace?source=...&year=...）
  - [x] 移动端全屏切换（Chat ↔ Canvas）
  - [x] 关闭按钮退出分屏
  - [x] 记住各内容滚动位置
- [x] **Phase B**：股东大会数据导入（v0.15.0–v0.16.1）
  - [x] 导入 34 篇大会转录（1985-2024，2556 chunks，总计 4195 chunks）
  - [x] 首页大会分区（股东大会 1985–2024）
  - [x] 大会阅读页（/letters/annual_meeting/:year）
  - [x] data/ 目录重组：shareholder/、partnership/、annual_meeting/
  - [x] import 脚本重写：data/<type>/ 约定目录 + --file 单文件导入

---

## 🚀 MVP（当前阶段）

目标：完整的对话+阅读体验 + 数据追踪 + 支付链路，可以交给种子用户。

### 收尾任务

- [ ] 对话质量验收 — 准备 30 个测试问题，验证检索召回率 + 引用命中率（范围：股东信 + 合伙人信）
- [ ] 移动端体验打磨 — 阅读页、工作区在手机上的交互细节

### Phase R：检索架构 v2（当前最高优先级）

- [x] R1. Query Understanding — 输出结构化 JSON（intent/entities/time/keyword_query/semantic_query/answer_mode）
- [x] R2. 检索执行改为并行双路（keyword + semantic），不再二选一单点路由
- [x] R3. 融合重排（RRF 或加权）+ 去重，统一 top-k 候选
- [x] R4. query-aware 段落级引用摘取，替换固定前缀截断 excerpt
- [x] R5. 生成前 Evidence Plan（内部步骤），证据不足时明确降级回复
- [x] R6. 配置化检索范围（默认仅 shareholder + partnership）
- [x] R7. 建立离线评测集（30-50 题）+ 指标看板（完整性/相关性/可追溯率）

### Phase F：用户数据 + 支付

- [ ] ChatMessage 表 + 对话记录写入
- [ ] 对话评分（👍👎）— 写入 ChatMessage.rating
- [ ] PostHog 接入（posthog-js + Next.js integration）
- [ ] 关键事件埋点（page_view, chat_start, chat_message, source_click 等）
- [ ] LemonSqueezy 订阅集成
- [ ] 订阅状态校验（免费 vs 会员的次数限制）
- [ ] 验证：完整的免费→付费转化链路

---

## 📦 Post-MVP

### Phase D：视频播放支持

- [ ] 视频播放页（embed 播放器 + 转录文本）
- [ ] 首页视频分区
- [ ] 工作区 Canvas 支持视频内容

### Phase E：公开文章 + 采访

- [ ] 收集文章链接 + markdown
- [ ] 文章导入 + 阅读页
- [ ] 采访视频 + 转录导入
- [ ] 首页对应分区

### 对话体验增强

- [ ] 多轮对话上下文 — 加入对话历史摘要，让追问更自然
- [ ] 首页对话入口 — 主页直接提问（HeroChatInput 已有框架）
- [ ] 对话分享 — 生成分享链接或图片，适合社交传播

### 内容探索

- [ ] 主题时间线 — "巴菲特历年怎么看保险？" → 按年份展示相关段落
- [ ] 探索页 `/explore` — 搜索框 + 年份分组结果
- [ ] 热门话题标签 — AI 预标注每个 chunk 的主题

### 虚拟人（差异化）

- [ ] API 选型 — HeyGen / D-ID / 开源方案评估
- [ ] 声音方案 — TTS 选型，合规性确认
- [ ] 视频对话模式 — 对话页面升级，延迟优化 + 成本控制

### 打磨

- [ ] 年度背景卡片 — 每封信配当年经济/市场背景摘要
- [ ] SEO 优化 — meta tags、结构化数据、sitemap
- [ ] 测试覆盖率 >80%

---

## 🔍 待调研

- [ ] 虚拟人 API 效果评估
- [ ] 声音克隆合规性
- [ ] PostHog Cloud 中国可达性测试

---

## 🧹 数据清洗 / Schema

- [x] `ExtSource` 同一份 SEC filing 被重复 ingest 已根治（2026-05-31）：
  - 一次性迁移脚本：`scripts/dedupe-ext-source-filings.ts`（合并 53 个重复组 / 删除 92 行 loser / reparent 76 sections + 9 financials / 修正 63 行 kind 不一致）
  - Schema 变更：`ExtSource` 加 `accessionNumber String?` 列 + `@@unique([filerEntityId, accessionNumber])`
  - Migration：`prisma/migrations/20260601000100_ext_source_accession_unique/`，含 backfill（兼容 metadata.accessionNumber / accession / accno 三种字段名）
  - Ingest 修复：`scripts/import-10k-xbrl.ts` 和 `scripts/import-13f.ts` 去重键改为 `(filerEntityId, accessionNumber)`，同时写入新列
  - 40-F检查结果：40-F 本身没有重复问题（0 duplicate groups），但帬带一起纳入唯一约束 → 以后不可能再重复
  - 前端保留 `dedupeReferenceFilings` 作为 defense-in-depth，但实际已不会触发


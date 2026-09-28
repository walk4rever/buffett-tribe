# Handoff — Value Tribe 运维与管线状态（2026-09-27 清理重写）

> 本文件是跨会话交接的单一入口。只保留「当前状态 + 未解决问题 + 仍需引用的背景」；
> 已完成事项压缩到文末归档。每次会话结束时更新并重写本节日期。

## 一、当前状态快照

### 部署三处（版本对齐情况）

| 位置 | 状态 |
|---|---|
| 本地 `main` | 最新。**有未 commit 改动**（见下） |
| mini（`~/buffett-tribe`） | 已 rsync 到今天最新（含未 commit 改动）。⚠️ mini 不是 git checkout（无 `.git`），代码靠人工 rsync，**跑任何任务前必须先同步** |
| air7（pi-gateway `/agent` 网关） | v0.43.37 已部署。本轮改动不涉及 pi-gateway |

**未 commit 改动（2026-09-27，13 个文件 + 本文件）**：
- `src/lib/valuation-metrics.ts`（哨兵类型）
- `scripts/generate-valuation-analysis.ts`（估值哨兵）
- `scripts/generate-business-model.ts`（canvas 写顶层字段）
- `scripts/migrate-canvas-field.ts`（一次性迁移，已执行）
- `tests/valuation-metrics.test.ts`（哨兵用例）
- `src/app/api/company/search/route.ts`、`src/app/(admin)/admin/universe/page.tsx`、`src/components/admin/AdminUniverseExplorer.tsx`（快速通道筛选修复）
- `scripts/fetch-cn-annual-report.py`（招股书兜底：无年报时搜招股说明书，`require_chapter_heading` 防概览小节误匹配）
- `scripts/import-cn-annual-report-from-file.ts`（支持 `filingKind: cn-prospectus`）
- `scripts/onboard-company.ts`（CN step verify 接受 cn-prospectus）
- `scripts/lib/company-generation.ts`、`src/lib/company-data.ts`、`src/app/company/[id]/annual-report/[year]/page.tsx`（cn-prospectus 接入证据/参考资料/阅读页）
- `scripts/lib/annual-report-import-core.ts`（40-F 附件抽取接受 EX-1.x）

### 优先队列 / Phase 分布

- 优先通道当前只剩 **1 家滞留**：`VOD`（phase=1/priority=100）— 根因见问题 1。
- 长鑫、SHOP、美的今日全部 phase=2（长鑫/SHOP 的 priority=100 残留但 phase=2 已出队，不会再被选中；如需清零：`UPDATE "Entity" SET priority = 0 WHERE ticker IN ('688825.SS','SHOP')`）。
- 今日已完成 13 家 P1→P2（SPCX、CSTAF、BIDU、TCOM、QXO、BSP、300760.SZ、2097.HK、688825.SS、SHOP、000333.SZ 等）。

### Cron（mini）

- ✅ 股价周更两条在跑：周六 12:00 cn,hk / 周日 01:00 us（mini 系统时区北京时间）
- ✅ **Hourly priority worker 已启用（2026-09-27 下午）**：每小时 15 分，`hourly-priority-worker.sh 10 all`（2026-09-27 晚从 15 降为 10：35min 超时才是真实上限，实测一批 13-14 家就顶满；batch 10 更大概率干净跑完不撞截断），日志 `~/logs/buffett-tribe/priority-worker.log`（旧 `phase1-worker.log` 停用）。页面上加快速通道的公司最迟下一个整点 15 分被处理。
  - 行为要点：PID 锁防重入；35 分钟硬超时直接 exit，被中断的公司靠 onboard checkpoint 下次续跑；batch 10 = 快速通道优先 + **standard P0 三市场轮巡补齐**。
  - 前两批实测（17:15/18:15）：快速通道 SHOP✅、美的✅、VOD❌（见问题 1），standard 补位 ~20 家全部成功。

## 二、未解决问题（按优先级）

### 会堵队列

### 会堵队列

（暂无）

### 影响内容质量

**2. SPAC 拿到无意义估值**
CSTAF 生成了「正式」估值（PE 39.55，信托现金利息算的），三情景隐含回报全 null。哨兵门槛「任一可用指标即生成」对空白支票公司太宽。
**修法**：排除 SIC 6726 / 空白支票公司，或要求有实际营收才算「可用指标」。

**3. business/moat 步骤的同款「合法跳过判失败」未修**
`scripts/generate-business-model.ts`「no usable filing section evidence」和 `scripts/generate-value-analysis.ts:170` 的跳过路径仍留 null → verify 判失败。9 家实测没踩到（step 1 重导把 sections 都抽出来了），但 BTGO 这类公司必踩。
**修法**：推广估值哨兵同款 pattern，但 canvas/moat 前端消费面更大，需先评估。

**4. SPCX 财务数据质量存疑**
单季 CapEx $28.5B（营收仅 $4B）、新上市公司 $4.4B 回购，疑似招股书抽数口径错误（可能是累计值）。需对照 S-1 原文核实——否则未来 FY 数据到了自动生成的估值建立在脏底子上。

### 技术债 / 小项

**5. `onboardPhase2Attempts`/`onboardPhase2LastError` 字段不存在**
2026-09-27 上午的 handoff 声称 worker 会记录这两个字段，但 `prisma/schema.prisma` 的 `Entity` 模型里没有。重试计数要么没实现要么记在别处——若没落库，滞留公司的失败历史不可见。需核实。

**6. 估值 tab 对哨兵是隐藏而非占位文案**（产品决策，待拍板）。

**7. `scripts/import-10k-edgartools.ts:260` 日志文案过时**：还写 "section text/blocks"，P1 停写实际生效（DB `section_blocks` 保持 0），改一个字符串的事。

**8. `typecheck:scripts` 有 9 个既有报错**（`backfill-cn-repurchase` / `backfill-company-financials-fast` / `import-cn/hk-interim-report-from-file` / `import-beneficial-ownership`），不在 CI 门禁，一直未修。

**9. `scripts/send-announcement.ts:20` 发件地址 `buffet@air7.fun`（一个 t）与 `.env.local` 的 `RESEND_FROM=buffett@air7.fun` 不一致**，疑似笔误，未动。

## 三、仍需引用的背景

### 执行环境

- **批量/cron 任务都在 mini 跑**（M4/32G，ssh 别名 `mini`）；air7（3.4G 内存）曾因 OOM 硬重启，只留 pi-gateway。air7 到 Cloudflare R2 的延迟约为 mini 的 1/4。
- mini 上 `npm run worker:priority -- --dry-run|--batch-size N [--timeout-mins N]` 手动触发；`worker:phase1` 是 `worker:priority` 的兼容别名。
- 数据库是共享生产库（Supabase），本地/mini 跑的脚本都直接写生产。

### 已知能力缺口（非 bug，立项才能解决）

- **INTC**：10-K TOC 被折叠成单个 table block，6 份 filing 全抽 0 section，抽取器深层结构问题（TODO.md 有同类记录：RACE、INTU）。
- **BTGO**：10-K 主文档无 inline XBRL（传统 XBRL 豁免期），财务推导只认 inline XBRL。
- **645 filing / 4,780 section 回填**（P0，在 TODO.md）：6 月一刀切删 text artifact 的存量，110 家公司 `search_filings` 平均只能看到 27% 正文。当前写入路径是对的，纯历史存量问题。
- **`FULL_TEXT_FETCH_TIMEOUT_MS`（45s×2=90s）偏小**：大 primary_html 现场重解析有真实概率超时降级（P3 警告使其不再静默）。

### 数据架构关键决策（不要回退）

- **section_blocks 已停写并清零**（2026-08-30，v0.43.37）：它零生产消费方。`cleanup-section-artifacts.ts` 的 kind 过滤已收窄为只删 `section_blocks`——**绝不能把 `section_text`/`section_html` 加回 IN 列表**：`section_text` 是 CN/HK 年报唯一全文来源（PDF 路线无 primary_html 可重解析），6 月一刀切已造成过 40-F 静默降级事故。
- **`search_filings` 优先读 text artifact**（P3）：缺失才回退 primary_html 重解析；两条路都失败时输出可见警告而非静默截断。
- **FilingSection 唯一真实消费方是 pi-gateway `search_filings`**；年报阅读器走 primary_html/primary_pdf iframe，不碰 FilingSection。
- **估值分析「数据不足」哨兵**（2026-09-27）：`CompanyAnalysis.valuation = { status: "insufficient_data", reason, missing, checkedAt }` 是「查过、数据不够」的一等状态，不是失败。哨兵被视为无内容，每次生成运行自动重查，FY 数据到了自动补正式分析。前端 `parseValuationPayload` 对哨兵返回 null → tab 隐藏。
- **canvas 写顶层字段**（2026-09-27）：`generate-business-model.ts` 写 `CompanyAnalysis.canvas`；历史 `business.canvas` 已回填（7 行），`business` 旧值保留只读（`value-line-data.ts` 还读 `business.narrative` 做兜底），schema 字段待后续 migration 删除。

### 产品与品牌

- 品牌已改名 **Value Tribe**（v0.45.x，2026-08-30）：单一真源 `src/lib/brand.ts` + `services/pi-gateway/src/brand.ts`（两份手动同步）。刻意未改：R2 key 前缀、PM2 进程名、package name、MCP server name。
- 域名 `vt.air7fun.com`（Cloudflare CDN → Vercel sin1，2026-09-28 迁移）。`vt.air7.fun` 已弃用（阿里云 DNS，无 CDN），`buffett.air7.fun` 已删且**用户明确拍板不设 308 重定向，后续会话不要再提**。`metadataBase` 未设、无 sitemap/robots 是既有缺口。
- **美国市场支线（已对齐未开工）**：英文从源数据独立生成（不翻译中文）；locale 载体 `[locale]` 路由段 + middleware 重写；生成内容用 locale-keyed 行（不用 Chunk 的配对列）；`onboard-company.ts` 不按 locale 分叉。分期 P0✅改名 → P1 locale 骨架 → P2 文案抽取 → P3 schema+管线 → P4 批量生成 → P5 法务页。**P4 前必须先做 LLM 截断检测**（英文 token 密度 1.5-2×，现有 max_tokens 会静默截断）。动手前确认 `valuetribe.com` 可得 + USPTO 无冲突。

## 四、归档（已完成，仅供溯源）

- **2026-08-29~30 批量 onboarding 清理**：259 家待完善美股桩，两批处理后剩 ~175 家；7 个真 bug 全修（v0.43.36：批量容错、P/E 门槛误杀、负 EPS 情景、edgartools 依赖、10-K/A 去重、股价 checkpoint 20h 过期、断点误判）。执行地从 air7 迁到 mini（air7 OOM 硬重启，pi-matrix 已清除）。
- **2026-08-30 P0-P3（v0.43.37）**：40-F 全文修复（BN/SU 42 section 补 artifact + 截断警告）、section_blocks 停写+清理 13,999 个对象、section 并发 6、search_filings text-artifact 优先。DIS 测试根因：artifact 缺失而非 R2 延迟，重导后 101s→9.25s。
- **2026-08-30 改名 Value Tribe + 域名迁移 vt.air7.fun + 删除 `skills/buffett-tribe` 对外 REST skill**（连带删 `/api/tools/search|document`；`src/lib/mcp-tools.ts` 保留，`/api/mcp` 在用）。
- **2026-09-27 统一优先队列上线（v0.45.23）**：Phase 1 详情页「⚡ 完善」按钮、worker 混合调度 P0→P1/P1→P2、batch 15、重试隔离、完成后 priority 自动清零。
- **2026-09-27 估值哨兵修复**：SPCX（新上市仅一季数据）卡死队列的根因；同日 9 家优先通道全量实测 7 成 2 败（失败根因即问题 1/2）。
- **2026-09-27 canvas 字段迁移**：生成器改写顶层 `canvas`，7 行历史回填（`scripts/migrate-canvas-field.ts`）。
- **2026-09-27 admin/universe 快速通道筛选修复**：`/api/company/search`、页面计数、行徽章三处还按旧语义 `onboardPhase = 0 AND priority > 0` 过滤（统一队列上线后 Phase 1 也能进快速通道，旧查询恒返回 0），已改为 `onboardPhase IN (0,1)` 与 worker 语义一致；徽章顺带显示走向（P0→P1 / P1→P2）。
- **2026-09-27 长鑫治本：CN 招股说明书兜底**：`fetch-cn-annual-report.py` 无年报时自动回退搜招股书（标题精确匹配「…招股说明书」结尾，排除提示性公告/意向书/注册稿），新 kind `cn-prospectus` 接入导入器、onboard CN step verify、证据链（company-generation/company-data）、阅读页（PDF 渲染，标题「招股说明书」）。`_find_chapter_range` 提升为模块级并加 `require_chapter_heading`（防招股书「概览」小节抢匹配）。长鑫 2 分钟跑完 Phase 2：招股书 8 sections + 正式估值（三情景 38%/65%/91%）。茅台回归无损。
- **2026-09-27 SHOP 治本：40-F EX-1.x 附件**：Form 40-F 官方 exhibit 类型 EX-1.1（AIF）/EX-1.2（审计财报）/EX-1.3（MD&A），抽取器原来只认 EX-99.*。过滤放宽 + 分类器加 documentType 确定性映射。SHOP 四个 40-F 年份各补 3 sections，17:15 cron 批次 P1→P2 直接跑通。
- **2026-09-27 VOD 治本收官**：逐年导入 7 份 20-F（每年原子落库，绕开 helper 多年连抓超时）→ 发现 FY2020 主文档无 inline XBRL（BTGO 同类缺口）→ `import10kFullStep.verify` 增加「`isInlineXbrl=false` 的 filing 不计入零 section 失败」豁免 + 接线 `--extract-timeout-ms 900000`。VOD Phase 2 全通（正式估值，PE 395.7——微利率年高 PE 属实）。排查期间 cron 临时暂停后已恢复（batch 已降 10）。

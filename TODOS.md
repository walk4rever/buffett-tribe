# TODOS — 数据架构优化清单

## 接入 pi-coding-agent（设计确认 2026-06-16）

> **架构原则**：buffett-tribe 做投资研究平台，pi 做独立 agent 界面，air7 是长进程计算层。
> 代码全部在 buffett-tribe repo；部署分两路：Next.js → Vercel，gateway + SPA → air7。
> 现有 `/idea`（RAG + 火山引擎）完全不动。

### 目标架构

```
buffett-tribe repo（本机开发）
├── src/                        ← Next.js 主应用，部署 Vercel
│   └── components/SiteNav      ←   加 "Agent →" 外链入口
├── services/pi-gateway/        ← Node.js 长进程，部署 air7（port 3456）
└── packages/pi-web-ui/         ← Vite SPA，本机 build → scp dist 到 air7

运行时：
  用户浏览器
    → buffett-tribe.com（Vercel）
    → relay.air7.fun/pi-app/（nginx 静态）
    → relay.air7.fun/pi/chat（nginx proxy → gateway :3456）
    → pi-coding-agent SDK → LLM
    → search_letters tool → Supabase DB
```

### 待完成任务

#### Step 1 — 本机：搭建 services/pi-gateway/

- [x] **新建 `services/pi-gateway/` 目录**（独立 package.json，不影响主应用）
  - 依赖：`@earendil-works/pi-coding-agent` v0.79.6（latest）、`express`、`pg`、`typebox` 1.1.38、`tsx`
  - `src/server.ts`：Express HTTP，端口 3456；`POST /chat`（SSE 流）+ `GET /health`
  - `src/session-manager.ts`：userId → AgentSession Map，TTL 30min 自动驱逐；匿名每次新建
  - `src/tools/search-letters.ts`：pi ToolDefinition，直连 Postgres（DIRECT_URL）向量检索
  - `src/stream.ts`：subscribe → SSE（`event: delta / tool_start / tool_end / done / error`）
  - `src/auth.ts`：校验 `X-Agent-Secret` header
  - `.env.example`、`AGENTS.md`（投研 system prompt）、`pi-gateway.service`（systemd 模板）
  - `noTools: "builtin"` — 禁用 bash/read/write/edit，agent 只有 `search_letters`（安全隔离）
  - TypeScript 编译：零错误
- [x] **本机冒烟**：填写 `.env`，`npm run dev`，`curl -N` 验证 SSE 流通（修复了 pg SSL 证书验证问题）

#### Step 2 — 部署 gateway 到 air7

- [ ] **打包上传**：`rsync -av --exclude node_modules services/pi-gateway/ ubuntu@air7:~/pi-gateway/`
- [ ] **air7 安装依赖**：`cd ~/pi-gateway && npm ci`
- [ ] **写 `.env`**：填入 Supabase 连接串、AGENT_SECRET、LLM API Key
- [ ] **PM2 启动**：`pm2 start ecosystem.config.cjs && pm2 save && pm2 startup`
- [ ] **验证**：`curl -N https://relay.air7.fun/pi/health` 返回 200

#### Step 3 — air7: nginx 路由

- [ ] `relay.air7.fun.conf` 新增一段（只需 gateway，不再需要静态 SPA）：
  ```nginx
  location /pi/ {
      proxy_pass         http://127.0.0.1:3456/;
      proxy_buffering    off;
      proxy_read_timeout 120s;
  }
  ```
- [ ] `nginx -t && systemctl reload nginx`

#### Step 4 — buffett-tribe: 嵌入主站（不再独立部署 SPA）

- [x] **`src/app/agent/page.tsx`**：新 `/agent` 页面，复用 SiteNav + idea-screen 布局
- [x] **`src/components/AgentChat.tsx`**：React chat 组件，SSE 对接 `/api/pi`
- [x] **`src/app/api/pi/route.ts`**：Next.js 代理路由，AGENT_SECRET 留服务端
- [x] **SiteNav**：加 "Agent" 链接 → `/agent`
- [ ] **Vercel 环境变量**：`PI_GATEWAY_URL=https://relay.air7.fun/pi`，`PI_AGENT_SECRET=<secret>`
- [ ] **验证**：`buffett-tribe.com/agent` 能正常对话

### 关键决策（已确认）

| 决策点 | 结论 |
|---|---|
| 代码位置 | 全在 buffett-tribe repo（`services/` 子目录） |
| 部署分路 | Next.js → Vercel；gateway → air7 手动 rsync/PM2 |
| UI 位置 | 嵌入 Next.js 主站 `/agent`，用户不离开 buffett-tribe.com |
| 进程管理 | PM2（`ecosystem.config.cjs`），`pm2 startup` 保证开机自启 |
| pi 包 | `@earendil-works/pi-coding-agent` v0.79.6 |
| Web UI | React 组件（`AgentChat.tsx`），无独立 SPA |
| RAG | 做成 pi tool（`search_letters`），agent 自主调用 |
| DB 连接 | gateway 直连 Supabase（不经 Vercel） |
| 默认工具 | 保留（bash/read/write/grep/find/ls） |
| 会话 | 登录用户持久化，匿名无记忆 |
| 认证 | `X-Agent-Secret` header |
| 现有 `/idea` | 完全不动 |

> 来源：2026-06-12 数据架构全局 review（Postgres / R2 / Neo4j / 本地管线）。
> 完成一项就在条目上标记，并把结论沉淀回 PRODUCT.md 对应章节。

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

# TODOS — 数据架构优化清单

## 接入 pi-coding-agent（v0.38.0，2026-06-22 完成）

### 运行时架构

```
用户浏览器
  └─► buffett-tribe.com/agent（Vercel，Next.js）
        └─► /api/pi（Next.js 代理，AGENT_SECRET 留服务端）
              └─► relay.air7.fun/pi/chat（nginx → :3456）
                    └─► pi-gateway（PM2，Express SSE）
                          ├─► @earendil-works/pi-coding-agent → DeepSeek API
                          └─► search_letters tool → Supabase pgvector（8825 chunks）
```

### 关键文件

| 路径 | 说明 |
|---|---|
| `services/pi-gateway/` | Express SSE 服务，部署 air7 port 3456 |
| `services/pi-gateway/ecosystem.config.cjs` | PM2 配置，`tsx --env-file=.env` 启动 |
| `services/pi-gateway/src/tools/search-letters.ts` | pgvector RAG tool |
| `services/pi-gateway/AGENTS.md` | Agent system prompt（投研助手定位） |
| `src/app/agent/page.tsx` | `/agent` 页面 |
| `src/components/AgentChat.tsx` | React chat 组件（SSE 流、markdown 渲染、⌘Enter 发送） |
| `src/app/api/pi/route.ts` | Next.js 代理路由 |

### 已完成

- [x] `services/pi-gateway/` 搭建与本机冒烟（修复 pg SSL 证书验证）
- [x] gateway 部署 air7，PM2 管理，开机自启
- [x] nginx `relay.air7.fun/pi/` → `:3456` 路由
- [x] `/agent` 页嵌入主站，SiteNav "对话" 链接指向 `/agent`
- [x] Next.js 代理路由 `/api/pi`，AGENT_SECRET 不暴露给浏览器
- [x] `buffett-tribe.com/agent` 本地验证通过（`PI_GATEWAY_URL` 指向 air7）
- [x] v0.38.0 发布，代码推送 GitHub，Vercel 自动部署触发
- [ ] **Vercel 控制台添加环境变量**：`PI_GATEWAY_URL` + `PI_AGENT_SECRET`（待操作）
- [ ] **生产验证**：`buffett-tribe.com/agent` 实际对话测试

### 关键决策

| 决策点 | 结论 |
|---|---|
| UI 位置 | 嵌入 Next.js 主站 `/agent`，用户不离开 buffett-tribe.com |
| 进程管理 | PM2（非 systemd），`ecosystem.config.cjs` |
| 认证 | `X-Agent-Secret` header，secret 仅存 Vercel 环境变量 |
| LLM | DeepSeek（直连 api.deepseek.com），非火山引擎 ark |
| RAG | pi tool `search_letters`，agent 自主决定何时调用 |
| 工具隔离 | `noTools: "builtin"` 禁用 bash/read/write，只开放 `search_letters` |
| 现有 `/idea` | 保留不动，后续视情况迁移或下线 |

### 后续方向

- [ ] 接入公司页："用 Agent 分析此公司" 按钮，带 company context 初始化对话
- [ ] 会话持久化：登录用户跨刷新保留对话历史（当前 sessionStorage，30min TTL）
- [ ] 流量监控：PM2 logs + Langfuse 观测 pi-gateway 调用情况

## Agent 工具终态设计（2026-06 决策）

### 三工具架构

```
search_wisdom   → GBrain          大师说了什么
                                   信件 / 年会 / 书 / 文章
                                   语义搜索，master 过滤

get_holdings    → Supabase SQL    大师买了什么
                                   Holding 表，结构化持仓查询

search_filings  → Supabase SQL    公司披露了什么
                                   FilingSection pgvector + Financial 表
```

### 大师范围（当前）

| master slug | 内容来源 |
|---|---|
| `buffett` | 年会记录（1994–2023，巴菲特 + 芒格共同回答）、股东信、合伙人信 |
| `munger` | 无独立 slug；芒格回答包含在 `buffett` 内容中，搜索时用 `master: buffett` 即可覆盖 |
| `lilu` | 李录书籍与演讲 PDF（5 份） |
| `duanyongping` | 雪球问答录商业/投资逻辑篇 |

> 未来新增大师时，只需导入内容并添加对应 master slug frontmatter，工具层无需改动。

### GBrain 知识层建设（进行中）

- [x] air7 初始化 GBrain，Supabase 后端，hosts 绑定绕过 IPv6
- [x] HTTP 服务（port 3457），PM2 管理，nginx `/gbrain/` 代理
- [x] Embedding：OpenAI text-embedding-3-large 1536d
- [x] 导入巴菲特年会记录 1994–2023（503 chunks）— 来源：《Unscripted》（Alex Crippen 编）；精选问答，非完整官方记录；巴菲特 + 芒格共同回答，frontmatter 标 `master: buffett`
- [x] 导入段永平问答录·商业 + 投资逻辑篇（290 chunks）
- [x] `search_wisdom` 工具接入 pi-gateway，验证通过
- [x] 导入李录 PDF（5 份，151 chunks，全部 embed）
- [x] 导入巴菲特股东信（1965–2025）+ 合伙人信（1958–1970，94 封，1712 chunks，全部 embed）→ 废弃 `search_letters`
- [ ] 新增 `get_holdings` 工具（Supabase Holding 表 SQL）
- [ ] 新增 `search_filings` 工具（FilingSection pgvector + Financial SQL）
- [ ] agent 验收：跨大师对比 / 时间线 / 观点 + 公司联动

### 关键决策

| 决策点 | 结论 |
|---|---|
| GBrain 定位 | 知识层（大师文字内容），不存结构化数据 |
| 年报 / 持仓 | 留在 Supabase，分别由 search_filings / get_holdings 访问 |
| Embedding 模型 | OpenAI text-embedding-3-large 1536d |
| 年报入 GBrain？ | 否：体量过大，已有 pgvector 索引，结构化数据 SQL 更精准 |
| 信件迁移时机 | 李录导入完成后，再迁信件 → 届时废弃 search_letters |

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

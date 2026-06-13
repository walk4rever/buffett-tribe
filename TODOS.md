# TODOS — 数据架构优化清单

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
- [ ] **回购股数序列**：从 item_5_market 或 XBRL 提取逐年回购，资本配置卡需要。

### P2 — 数据缺口（不阻塞试点）

- [ ] **DEF 14A（proxy）抓取**：10-K item_10/11 只有 incorporated-by-reference 占位，
      管理层薪酬/董事会结构要 proxy。接入后管理分析补"管理层与董事会"卡。
- [ ] **同业估值对比**：需外部数据源，远期。

## P0 — 决策与飞轮

- [x] **Neo4j 图谱层退役**：Aura 实例已不可达，chat 静默降级运行已久。完全移除 neo4j-driver、graph-retrieval、retrieval-compare 实验页、11 个 neo4j npm scripts。检索统一为 pgvector + tsvector。（2026-06-12 执行）
- [ ] **Company Brain 最小闭环**：产品愿景（对话→写回→Canvas 越用越厚）在 schema 中无任何承接表。新建 `Claim` 表起步：`entityId / statement / sourceType / sourceRef / confidence / chatMessageId / status`，对话结束异步写回，Canvas 生成时读取。这是飞轮的轴，优先级高于继续堆 10-K 数据。

## P1 — 扩展前置与容量

- [ ] **Entity 标识层泛化（A股/港股前置）**：新增 `market` + `code`，CIK 降级为美股专属属性。必须先于 akshare 数据接入完成，否则每条管线要打两遍补丁。注意：A 股无 XBRL，`Financial` 需接受第三方表格直写（用已有 `confidence` 字段标记低置信来源）。
- [ ] **容量治理小包（设计于 2026-06-13，待定稿后执行）**：目标 318MB → ~170MB，运营水位线 400MB。
      实测构成：Chunk 86MB（逻辑仅 44MB，一半是膨胀）、FilingSection 53MB（content 压缩后 19MB，
      全文已 100% 在 R2 textArtifact）、ExtSource 51MB（893 行 × 平均 43KB metadata）、
      StockPrice 40MB（18.9 万行日线）、FilingArtifact 35MB（3.3 万行指针，暂不动）。
      功能约束（已核实读路径）：pgvector 向量必须留 PG（聊天检索）；生成管线读 FilingSection.content
      只取前 2.4KB（truncateText）；年报 tab 全文走 R2；PE 历史分位是统计量，周线采样结果几乎不变。
      - [ ] ① **告警先行**：`check:db-size` 脚本（per-table + 总量，warn 400MB / critical 450MB 非零退出）
            + GitHub Actions 每周 cron 超阈值自动开/更新 Issue + 批量生成脚本前置检查（>460MB 拒绝跑批）。
      - [ ] ② **ExtSource 瘦身（51→~5MB，最大单笔）**：metadata 裁剪到 app 实际读取字段
            （实现前先 grep 审计，含 tocJson 去向），完整 JSON 下沉 R2 artifact；import 管线同步改写裁剪版。
      - [ ] ③ **膨胀回收（~60MB）**：FilingSection.content 截断至 3KB 上限（无消费方受损）；
            Chunk / FilingSection / ExtSource 跑 VACUUM FULL（表小，低流量窗口执行，注意锁表）。
      - [ ] ④ **StockPrice 降采样（40→~18MB）**：日线留近 2 年，更早聚合周线 OHLC
            （open=首日/high/low=极值/close=末日/volume=求和），月K/季K渲染与 PE 分位不受影响；
            价格抓取脚本写入策略同步修改防回填。`securityId` 关联补齐另行处理（换 ticker/退市断链问题）。
      - [ ] ⑤ **GeneratedContentVersion 保留策略**：每 scope/artifact 留最近 2 版（当前 432KB 不是问题，
            每波重生成 +0.5MB，规则先立）。
      治理后预计 ~170MB，剩 330MB headroom；按每家公司增量 ~0.5MB，全量 126 家 + A股扩展空间充足。
      待定稿问题：metadata/tocJson 精确读字段清单；Supabase 免费档 VACUUM FULL 锁表窗口实测。

## P2 — 一致性收口

- [ ] **生成内容版本管理统一**：CompanyAnalysis（原地覆盖）、BusinessCanvas+Version（双表）、GeneratedContentVersion（通用表，0 行从未接线）三套并存。二选一：全部收口到 GeneratedContentVersion，或删掉这张空表。
- [ ] **FinancialFact 模型去留**：表已被 compact 清空（0 行）但模型还在，`Financial.sourceFactIds` 指向已删除记录，血缘断裂。建议删模型，血缘改指 R2 `data_file` artifact。
- [ ] **documents.ts 硬编码清单入库**：大师 PDF 文档列表写死在代码数组里，加文档需要发版。作为统一 Document 对象的第一步先入库。
- [ ] **文档系统四轨合一（长期）**：信件（Source/Chunk）、大师 PDF（R2+硬编码）、年报（FilingSection/Artifact）、洞见（InsightPost）四套模型，按 PRODUCT.md 文档系统路线图收敛为统一 Document 对象。

## P3 — 小项

- [ ] 439 个 Chunk 缺 embedding（共 8825），补嵌。
- [ ] R2 与 pi-matrix/posts 共用 ai-pulse bucket，确认 lifecycle 与备份策略；考虑独立 bucket。
- [ ] `ChatMessage.sourceIds` 为无外键软引用，Brain 落地时一并规范化。

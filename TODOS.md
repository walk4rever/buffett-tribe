# TODOS — 数据架构优化清单

> 来源：2026-06-12 数据架构全局 review（Postgres / R2 / Neo4j / 本地管线）。
> 完成一项就在条目上标记，并把结论沉淀回 PRODUCT.md 对应章节。

## P0 — 决策与飞轮

- [x] **Neo4j 图谱层退役**：Aura 实例已不可达，chat 静默降级运行已久。完全移除 neo4j-driver、graph-retrieval、retrieval-compare 实验页、11 个 neo4j npm scripts。检索统一为 pgvector + tsvector。（2026-06-12 执行）
- [ ] **Company Brain 最小闭环**：产品愿景（对话→写回→Canvas 越用越厚）在 schema 中无任何承接表。新建 `Claim` 表起步：`entityId / statement / sourceType / sourceRef / confidence / chatMessageId / status`，对话结束异步写回，Canvas 生成时读取。这是飞轮的轴，优先级高于继续堆 10-K 数据。

## P1 — 扩展前置与容量

- [ ] **Entity 标识层泛化（A股/港股前置）**：新增 `market` + `code`，CIK 降级为美股专属属性。必须先于 akshare 数据接入完成，否则每条管线要打两遍补丁。注意：A 股无 XBRL，`Financial` 需接受第三方表格直写（用已有 `confidence` 字段标记低置信来源）。
- [ ] **ExtSource.metadata 瘦身**：893 行占 51MB（平均 57KB/行），完整 EDGAR filing 索引塞在枢纽表的 Json 里。裁剪到必要字段，大 JSON 下沉为 R2 artifact。
- [ ] **StockPrice 容量策略**：189k 行 / 40MB，A股扩展后 ticker 数将 ×3。方案：日线只留近 2 年，更早降采样为周线；或整体挪 R2。同时补 `securityId` 关联（当前只有裸 ticker 字符串，换 ticker/退市会断链）。
- [ ] **Supabase 容量监控**：当前 316MB / free tier 500MB 上限，曾出现 pooler ECHECKOUTTIMEOUT 和 Disk IO 告警。加容量告警，或直接升级 plan。

## P2 — 一致性收口

- [ ] **生成内容版本管理统一**：CompanyAnalysis（原地覆盖）、BusinessCanvas+Version（双表）、GeneratedContentVersion（通用表，0 行从未接线）三套并存。二选一：全部收口到 GeneratedContentVersion，或删掉这张空表。
- [ ] **FinancialFact 模型去留**：表已被 compact 清空（0 行）但模型还在，`Financial.sourceFactIds` 指向已删除记录，血缘断裂。建议删模型，血缘改指 R2 `data_file` artifact。
- [ ] **documents.ts 硬编码清单入库**：大师 PDF 文档列表写死在代码数组里，加文档需要发版。作为统一 Document 对象的第一步先入库。
- [ ] **文档系统四轨合一（长期）**：信件（Source/Chunk）、大师 PDF（R2+硬编码）、年报（FilingSection/Artifact）、洞见（InsightPost）四套模型，按 PRODUCT.md 文档系统路线图收敛为统一 Document 对象。

## P3 — 小项

- [ ] 439 个 Chunk 缺 embedding（共 8825），补嵌。
- [ ] R2 与 pi-matrix/posts 共用 ai-pulse bucket，确认 lifecycle 与备份策略；考虑独立 bucket。
- [ ] `ChatMessage.sourceIds` 为无外键软引用，Brain 落地时一并规范化。

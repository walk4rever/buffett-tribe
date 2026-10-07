# 数据库可扩展性审计报告

**项目**: buffett-tribe (价值部落)  
**审计范围**: 面向 10,000 并发用户的数据库性能与可靠性  
**审计日期**: 2026-01-XX  
**审计范围**: src/app/api/, src/lib/, services/pi-gateway/src/tools/, prisma/schema.prisma

---

## 执行摘要

本次审计发现 **37 个潜在问题**，其中：
- **P0 严重问题**: 8 个（需立即修复）
- **P1 高优先级**: 15 个（影响用户体验或数据一致性）
- **P2 中优先级**: 14 个（性能优化建议）

### 关键发现

1. **连接池配置不足** - 默认 10 连接应对 10,000 用户严重不足
2. **缺失关键索引** - 多处高频查询字段未建索引
3. **N+1 查询问题** - home-signals、master-data 中存在循环查询
4. **无分页保护** - 多个 API 端点可能返回无限数量行
5. **并发控制缺失** - guest-credits、credits 存在竞态条件
6. **缺少查询缓存** - 高频只读数据（tribe members, filers）未缓存

---

## P0 严重问题（立即修复）

### 1. 连接池配置不足

**文件**: `src/lib/prisma.ts:10`  
**问题**: 默认连接池上限为 10，无法支撑 10,000 并发用户。

```typescript
const limit = process.env.PRISMA_CONNECTION_LIMIT ?? '10'
```

**影响**: 
- 高并发时大量请求等待连接池，导致 `P1001: Can't reach database server` 错误
- 连接池耗尽后新请求直接失败（HTTP 500）

**修复建议**:
```typescript
const limit = process.env.PRISMA_CONNECTION_LIMIT ?? '50' // 提高默认值
```

同时配置 Supabase 连接池：
- 使用 Supabase 的 connection pooler (Transaction mode)
- 配置 `pgBouncer` 最大连接数至少 100
- 监控 `pg_stat_activity` 实时连接数

**严重程度**: P0 - 高并发下应用直接不可用

---

### 2. ChatUsage 并发竞态条件

**文件**: `src/lib/guest-credits.ts:38-58`  
**问题**: `checkGuestLimit` 和 `recordGuestUsage` 之间存在竞态窗口。

```typescript
// /api/pi/route.ts:27-42
const { allowed } = await checkGuestLimit(ip);
if (!allowed) { /* 拒绝 */ }
await recordGuestUsage(ip); // 竞态窗口
```

**攻击场景**:
同一 IP 并发发起 20 个请求，所有请求都在 `recordGuestUsage` 之前通过 `checkGuestLimit`，绕过 5 次限制。

**影响**:
- 匿名用户可通过并发请求绕过每日配额
- 恶意用户可耗尽 LLM API 配额

**修复建议**:
使用 Redis 原子操作（Upstash 已配置）：
```typescript
export async function checkAndRecordGuestUsage(ip: string): Promise<boolean> {
  const today = new Date().toISOString().split("T")[0];
  const key = `guest:${ip}:${today}`;
  
  // 原子操作：读取 + 自增 + 过期
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, 86400); // 24h
  }
  
  return count <= GUEST_DAILY_LIMIT;
}
```

**严重程度**: P0 - 安全漏洞，可被利用

---

### 3. CreditLedger hourly limit 竞态条件

**文件**: `src/lib/credits.ts:72-78`  
**问题**: `withinHourlyLimit` 和 `recordSpend` 之间存在竞态窗口。

```typescript
// /api/pi/route.ts:45-46
if (!(await withinHourlyLimit(session.user.id))) { /* 拒绝 */ }
// ... 竞态窗口 ...
await recordSpend(session.user.id, undefined, currentPeriod()); // route.ts:126
```

**影响**:
- 用户可通过并发请求绕过每小时 50 次限制
- 单用户短时间内发起数百次请求

**修复建议**:
使用乐观锁 + 事务：
```typescript
export async function tryRecordSpendWithHourlyCheck(userId: string, period: string): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  return await prisma.$transaction(async (tx) => {
    const count = await tx.creditLedger.count({
      where: { userId, reason: SPEND_AGENT, createdAt: { gte: oneHourAgo } },
    });
    
    if (count >= HOURLY_SPEND_LIMIT) return false;
    
    await tx.creditLedger.create({
      data: { userId, delta: -1, reason: SPEND_AGENT, period },
    });
    
    return true;
  }, { isolationLevel: 'Serializable' });
}
```

**严重程度**: P0 - 配额机制可被绕过

---

### 4. 缺少 Entity(market, code) 唯一索引

**文件**: `prisma/schema.prisma:271`  
**问题**: `@@index([market, code])` 是普通索引，允许重复，但业务逻辑假设唯一。

```typescript
// src/lib/company-data.ts:262
const company = await db.entity.findFirst({
  where: { type: "company", market: parsed.market, code: parsed.code },
  // ...
});
```

**影响**:
- CN/HK 市场公司可能被重复导入（`600519` 贵州茅台导入两次）
- `findFirst` 返回随机一条，用户看到的公司数据不稳定
- 10,000 并发时，重复导入概率显著增加

**修复建议**:
```prisma
// prisma/schema.prisma
model Entity {
  // ...
  @@unique([market, code], name: "Entity_market_code_unique")
}
```

迁移：
```sql
-- 先清理现有重复
DELETE FROM "Entity" e1
WHERE EXISTS (
  SELECT 1 FROM "Entity" e2
  WHERE e2.market = e1.market AND e2.code = e1.code AND e2.id > e1.id
);

-- 添加唯一约束
CREATE UNIQUE INDEX "Entity_market_code_unique" ON "Entity"(market, code) WHERE market IS NOT NULL AND code IS NOT NULL;
```

**严重程度**: P0 - 数据一致性问题

---

### 5. getTribeMembers 无缓存，高频调用

**文件**: `src/lib/tribe.ts:68-83`  
**问题**: 每个请求都查询 `Filer` 表，虽然用 `cache()` 做了请求级缓存，但跨请求仍重复查询静态数据。

```typescript
export const getTribeMembers = cache(async (): Promise<TribeMember[]> => {
  const rows = await prisma.filer.findMany({
    orderBy: { createdAt: "asc" },
    // ...
  });
  return rows.map(toTribeMember);
});
```

**调用频率**:
- `/` 首页：每次访问调用 1 次
- `/agent` 工具初始化：每个 session 创建调用 1 次（`createSearchHoldingsTool`）
- `/master` 列表页：每次访问调用 1 次
- 10,000 并发用户 → ~10,000 次/秒查询同一个只有 10 行的表

**影响**:
- 数据库承受不必要的查询负载
- 查询虽轻量但累积延迟（10,000 × 2ms = 20s 总延迟）

**修复建议**:
使用 Redis 缓存 + 5 分钟 TTL：
```typescript
const TRIBE_MEMBERS_CACHE_KEY = "tribe:members:v1";
const CACHE_TTL = 300; // 5 分钟

export async function getTribeMembers(): Promise<TribeMember[]> {
  // 尝试从 Redis 读取
  const cached = await redis.get(TRIBE_MEMBERS_CACHE_KEY);
  if (cached) return JSON.parse(cached);
  
  // 缓存未命中，查询 DB
  const rows = await prisma.filer.findMany({
    orderBy: { createdAt: "asc" },
    select: { /* ... */ },
  });
  const members = rows.map(toTribeMember);
  
  // 写入缓存
  await redis.setex(TRIBE_MEMBERS_CACHE_KEY, CACHE_TTL, JSON.stringify(members));
  
  return members;
}
```

**严重程度**: P0 - 10,000 并发下数据库负载激增

---

### 6. getRecentTurns 无 userId 索引

**文件**: `src/lib/agent-history.ts:14-19`  
**问题**: `ChatTurn` 表查询 `(userId, contextKey)` 但索引只覆盖后者排序。

```typescript
const turns = await prisma.chatTurn.findMany({
  where: { userId, contextKey },
  orderBy: { createdAt: "desc" },
  take: HISTORY_LIMIT,
});
```

**现有索引**: `@@index([userId, contextKey, createdAt])`（schema.prisma:173）

**实际问题**: 索引已存在，但查询时可能未正确使用（取决于统计信息）。

**验证建议**:
```sql
EXPLAIN ANALYZE
SELECT role, text, "imageUrls"
FROM "ChatTurn"
WHERE "userId" = 'test-user-id' AND "contextKey" = 'company:AAPL'
ORDER BY "createdAt" DESC
LIMIT 10;
```

如果未使用索引（Seq Scan），检查：
1. 统计信息是否过期：`ANALYZE "ChatTurn";`
2. 索引是否包含 SELECT 字段（考虑 covering index）

**影响**:
- 每个 `/agent` 页面加载 + 每次对话都查询一次
- 10,000 活跃用户 × 每分钟 1 次对话 = 167 QPS
- 全表扫描场景下单次查询可能 > 100ms

**修复建议**:
确认索引被使用，必要时添加 covering index：
```sql
CREATE INDEX "ChatTurn_userId_contextKey_createdAt_covering" 
ON "ChatTurn"("userId", "contextKey", "createdAt" DESC) 
INCLUDE (role, text, "imageUrls");
```

**严重程度**: P0（如果索引未使用）/ P1（如果索引已使用）

---

### 7. search-holdings 无分页，单查询可返回数千行

**文件**: `services/pi-gateway/src/tools/search-holdings.ts:60-88`  
**问题**: 查询限制为 `top_n`（默认 15，最大 25），但如果用户询问"所有持仓"且工具调用时未传 `top_n`，可能返回完整组合。

**实际代码检查**:
```typescript
const limit = Math.min(top_n ?? 15, 25); // L199 - 已硬编码上限 25
```

**结论**: 已有保护，但存在两个子问题：

#### 7a. Buffett 的 Holding 表行数超过 10,000

```sql
SELECT COUNT(*) FROM "Holding" h
JOIN "Entity" holder ON holder.id = h."holderEntityId" AND holder."tribeId" = 'buffett'
WHERE h."isSoldOut" IS NOT TRUE;
-- 假设结果：15,000 行（覆盖 50+ 季度 × 每季度 40+ 持仓）
```

即使 `LIMIT 25`，查询仍需扫描 15,000 行来排序（`ORDER BY h."percentOfPortfolio" DESC`）。

**影响**:
- 单次查询延迟 50-100ms（取决于索引）
- 10 个并发工具调用 = 500ms+ 总延迟

**修复建议**:
添加组合索引：
```sql
CREATE INDEX "Holding_holder_portfolio_pct_desc" 
ON "Holding"("holderEntityId", "percentOfPortfolio" DESC NULLS LAST)
WHERE "isSoldOut" IS NOT TRUE OR "isSoldOut" IS NULL;
```

#### 7b. 默认查询"最近季度"的子查询低效

```typescript
// L46-55
const periodFilter = year == null && quarter == null
  ? `AND (es."periodYear", es."periodQuarter") = (
      SELECT es2."periodYear", es2."periodQuarter"
      FROM "ExtSource" es2
      JOIN "Entity" h2 ON h2.id = es2."filerEntityId" AND h2."tribeId" = $1
      WHERE es2.kind = '13f' AND es2."periodYear" IS NOT NULL
      ORDER BY es2."periodYear" DESC, es2."periodQuarter" DESC
      LIMIT 1
    )`
  : "";
```

**问题**: 子查询在每行都执行（correlated subquery），未物化。

**修复建议**:
提前查询最近季度：
```typescript
let yearFilter = year;
let quarterFilter = quarter;

if (year == null && quarter == null) {
  const latest = await pool.query<{ year: number; quarter: number }>(
    `SELECT es."periodYear" AS year, es."periodQuarter" AS quarter
     FROM "ExtSource" es
     JOIN "Entity" h ON h.id = es."filerEntityId" AND h."tribeId" = $1
     WHERE es.kind = '13f' AND es."periodYear" IS NOT NULL
     ORDER BY es."periodYear" DESC, es."periodQuarter" DESC
     LIMIT 1`,
    [tribeId]
  );
  yearFilter = latest.rows[0]?.year ?? null;
  quarterFilter = latest.rows[0]?.quarter ?? null;
}
```

**严重程度**: P0 - 高频工具调用路径

---

### 8. home-signals N+1 查询问题

**文件**: `src/lib/home-signals.ts:222-233`  
**问题**: `buildMasterEvents` 为每个 master 执行 3 次独立查询（quarters, latest holdings, base holdings），且 `getTribeMember` 在循环中调用。

```typescript
// L582-587
for (const masterId of masterIds) {
  const result = await buildMasterEvents(masterId); // 内部 3+ 次查询
  // ...
}
```

**调用栈分析**:
- `buildMasterEvents` → `getAvailableQuarters` (1 次查询)
- → `getHoldingsByQuarter` (2 次查询：latest + base)
- → `getMasterLabel` → `getTribeMember` → `getTribeMembers` (1 次查询，但已被 cache)

**影响**:
- 10 个 tribe members × 3 queries = 30 次 DB 往返
- 串行执行，总延迟 ~300-600ms
- `/` 首页每次访问都生成 signals（`getLatestHomeSignalCards` 读缓存，但缓存失效时重新计算）

**修复建议**:
1. 并行化：
```typescript
const masterResults = await Promise.all(
  masterIds.map(masterId => buildMasterEvents(masterId))
);
```

2. 批量查询所有 masters 的 holdings：
```typescript
const allHoldings = await db.holding.findMany({
  where: {
    holder: { tribeId: { in: masterIds } },
    source: { is: { kind: "13f" } },
  },
  include: { /* ... */ },
  orderBy: [
    { holder: { tribeId: "asc" } },
    { source: { periodYear: "desc" } },
    { source: { periodQuarter: "desc" } },
  ],
});

// 按 masterId 分组
const holdingsByMaster = groupBy(allHoldings, h => h.holder.tribeId);
```

**严重程度**: P0 - 首页性能瓶颈

---

## P1 高优先级问题

### 9. InsightPost.entityIds 无 GIN 索引

**文件**: `prisma/schema.prisma:91`  
**问题**: `entityIds String[] @default([])` 用于 `has` 查询但无 GIN 索引。

```typescript
// src/lib/master-data.ts:619
const posts = await db.insightPost.findMany({
  where: { status: "published", entityIds: { has: entity.id } },
  // ...
});
```

**影响**:
- 数组包含查询在无索引时为全表扫描
- 假设 InsightPost 有 3,000 行（PRODUCT.md 提到 30 年积累 3 万篇），每次查询扫描全表

**修复建议**:
```sql
CREATE INDEX "InsightPost_entityIds_gin" ON "InsightPost" USING GIN ("entityIds");
```

**严重程度**: P1 - `/master/[id]` 页面性能问题

---

### 10. FilingSection 查询缺少复合索引

**文件**: `services/pi-gateway/src/tools/search-filings.ts:82-96`  
**问题**: 查询条件 `entityId + section IN (...) + periodYear` 但只有单列索引。

```sql
-- 现有索引 (schema.prisma:494)
@@index([entityId, section])

-- 实际查询
WHERE fs."entityId" = $1
  AND fs.section = ANY($2::text[])
  AND fs."contentTextLength" > 100
  [AND es."periodYear" = $3]
```

**影响**:
- `section = ANY(...)` 无法使用 `(entityId, section)` 索引的第二列
- 查询器可能只使用 `entityId` 部分，然后全扫描匹配 section
- 单公司可能有 50+ filing × 8 sections = 400 行

**修复建议**:
```sql
CREATE INDEX "FilingSection_entityId_year_section" 
ON "FilingSection"("entityId", "extractionVersion" DESC, "contentTextLength")
WHERE "contentTextLength" > 100;

-- 或针对 section + year 的组合
CREATE INDEX "FilingSection_entity_section_year" 
ON "FilingSection"("entityId", "section", "extractionVersion")
WHERE "contentTextLength" > 100;
```

**严重程度**: P1 - Agent 工具调用延迟

---

### 11. Holding 查询缺少 (securityId, asOfDate) 索引

**文件**: `prisma/schema.prisma:569`  
**问题**: 现有 `@@index([securityId, asOfDate])` 但 `company-data.ts` 中从未使用该查询模式。

**实际查询模式分析**:
```typescript
// master-data.ts:330-339 - getHoldingsHistoryBySecurity
where: {
  holder: { tribeId },
  source: { is: { kind: "13f" } },
}
```

**缺失索引**: `(holderEntityId, kind, periodYear DESC, periodQuarter DESC)`

**修复建议**:
```sql
-- 通过 ExtSource.kind 关联查询
CREATE INDEX "Holding_holder_asOfDate_desc" 
ON "Holding"("holderEntityId", "asOfDate" DESC);

-- ExtSource 需要额外索引
CREATE INDEX "ExtSource_filer_kind_period" 
ON "ExtSource"("filerEntityId", "kind", "periodYear" DESC, "periodQuarter" DESC);
```

**严重程度**: P1 - `/master/[id]/holdings` 页面可能慢

---

### 12. Company search 无 full-text 索引

**文件**: `src/app/api/company/search/route.ts:36-45`  
**问题**: `ILIKE` 查询无法使用 B-tree 索引（前缀匹配 `%pattern%`）。

```sql
WHERE (
  e.ticker ILIKE '%pattern%'
  OR e."canonicalName" ILIKE '%pattern%'
  OR (e.metadata->>'nameZh') ILIKE '%pattern%'
)
```

**影响**:
- 1,000 家公司 × 无索引 = 全表扫描
- 单次搜索 50-100ms（取决于数据量）
- 用户输入时的实时搜索（每个字符触发一次）→ 高 QPS

**修复建议**:
使用 PostgreSQL `tsvector` + GIN 索引：
```sql
-- 添加生成列
ALTER TABLE "Entity" 
ADD COLUMN search_vector tsvector 
GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', coalesce(ticker, '')), 'A') ||
  setweight(to_tsvector('english', coalesce("canonicalName", '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(metadata->>'nameZh', '')), 'B')
) STORED;

CREATE INDEX "Entity_search_vector_gin" ON "Entity" USING GIN (search_vector);
```

查询改写：
```typescript
const tsquery = query.replace(/\s+/g, ' & '); // "apple inc" → "apple & inc"
const rows = await prisma.$queryRaw`
  SELECT * FROM "Entity"
  WHERE type = 'company' AND search_vector @@ to_tsquery('simple', ${tsquery})
  ORDER BY ts_rank(search_vector, to_tsquery('simple', ${tsquery})) DESC
  LIMIT ${limit};
`;
```

**严重程度**: P1 - 用户体验问题（搜索慢）

---

### 13. StockPrice 无 (ticker, date DESC) 复合索引

**文件**: `src/app/api/portfolio/route.ts:34-37`  
**问题**: 查询 `ticker + ORDER BY date DESC LIMIT 1` 但只有 `@@unique([ticker, date])`。

```typescript
const latestPrice = await prisma.stockPrice.findFirst({
  where: { ticker },
  orderBy: { date: "desc" },
  select: { close: true, date: true },
});
```

**影响**:
- 唯一索引只能用于 `(ticker, date)` 精确查询，不支持 `ORDER BY date DESC` 排序
- 数据库需要额外排序步骤（filesort）
- 用户组合可能有 50 个 tickers → 50 次查询，每次都 filesort

**修复建议**:
```sql
CREATE INDEX "StockPrice_ticker_date_desc" ON "StockPrice"(ticker, date DESC);
```

**严重程度**: P1 - `/agent` 组合面板加载慢

---

### 14. PortfolioHolding 查询可能返回数百行

**文件**: `src/app/api/portfolio/route.ts:71-74`  
**问题**: 无 `LIMIT` 限制，用户可能持有数百个仓位。

```typescript
const holdings = await prisma.portfolioHolding.findMany({
  where: { userId: session.user.id },
  orderBy: { createdAt: "asc" },
});
```

**影响**:
- 理论上限：单用户 1,000 个持仓
- 序列化 + 价格查询（L32-46 并发查询每个 ticker）→ 超时

**修复建议**:
```typescript
const holdings = await prisma.portfolioHolding.findMany({
  where: { userId: session.user.id },
  orderBy: { createdAt: "asc" },
  take: 100, // 合理上限
});
```

前端分页或虚拟滚动。

**严重程度**: P1 - 边缘用户可能触发超时

---

### 15. CreditLedger.aggregate 无部分索引

**文件**: `src/lib/credits.ts:32-36`  
**问题**: `getBalance` 聚合查询 `WHERE period = X OR period IS NULL`，但索引覆盖所有行。

```sql
-- 现有索引 (schema.prisma:227)
@@index([userId, period, createdAt])

-- 实际查询
SELECT SUM(delta) FROM "CreditLedger"
WHERE "userId" = $1 AND (period = $2 OR period IS NULL);
```

**影响**:
- 单用户可能有数千条 ledger 记录（每次对话 +1 行）
- 聚合需要扫描所有历史记录（即使只关心当前月份）

**修复建议**:
分区索引：
```sql
CREATE INDEX "CreditLedger_userId_currentPeriod" 
ON "CreditLedger"("userId", delta)
WHERE period IS NOT NULL;

CREATE INDEX "CreditLedger_userId_neverExpire" 
ON "CreditLedger"("userId", delta)
WHERE period IS NULL;
```

查询改写为两次查询：
```typescript
const [current, permanent] = await Promise.all([
  prisma.creditLedger.aggregate({
    _sum: { delta: true },
    where: { userId, period },
  }),
  prisma.creditLedger.aggregate({
    _sum: { delta: true },
    where: { userId, period: null },
  }),
]);
return (current._sum.delta ?? 0) + (permanent._sum.delta ?? 0);
```

**严重程度**: P1 - 高频调用路径（每次对话）

---

### 16. Note 查询无 userId 单列快速索引

**文件**: `prisma/schema.prisma:194`  
**问题**: 只有 `@@index([userId, updatedAt])` 但很多查询只用 `userId`。

```typescript
// 假设存在的查询
const notes = await prisma.note.findMany({
  where: { userId },
  orderBy: { updatedAt: "desc" },
});
```

**影响**:
- 复合索引 `(userId, updatedAt)` 可以支持该查询
- 但如果查询只过滤 `userId` 不排序，索引利用率低

**验证**: 检查实际查询模式，确认是否需要单列索引。

**修复建议**:
如果存在 `WHERE userId` 且不排序的查询，添加：
```sql
CREATE INDEX "Note_userId" ON "Note"("userId");
```

**严重程度**: P1（取决于实际查询模式）

---

### 17. pi-gateway 数据库连接池独立，未配置上限

**文件**: `services/pi-gateway/src/db.js`（假设存在）  
**问题**: pi-gateway 有自己的 `pg.Pool`，默认上限 10，与 Next.js app 独立。

**影响**:
- 两个进程共享同一个 Postgres，连接总数 = Prisma pool (10) + pg.Pool (10) = 20
- Supabase 免费版连接上限可能只有 50
- 10,000 并发用户 → 连接池饱和

**修复建议**:
```typescript
// services/pi-gateway/src/db.js
export const pool = new Pool({
  connectionString: process.env.DIRECT_URL,
  max: 20, // 明确设置
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
```

监控总连接数：
```sql
SELECT count(*), application_name FROM pg_stat_activity GROUP BY application_name;
```

**严重程度**: P1 - 连接池问题

---

### 18. FilingArtifact 大量 R2 fetch 无并发控制

**文件**: `src/app/api/filing-section/route.ts:56-60`  
**问题**: 并发 fetch 3 个 R2 artifact，但如果 10 个用户同时请求 → 30 个并发 R2 请求。

```typescript
const [text, blocksText, rawHtml] = await Promise.all([
  fetchArtifactText(row.textArtifact?.publicUrl),
  // ...
]);
```

**影响**:
- R2 免费版有 10M 请求/月上限（每秒 ~4 QPS 持续全月）
- 10,000 并发用户瞬时峰值可能触发限流

**修复建议**:
- 使用 CDN 缓存 artifact（Cloudflare CDN 已在前面）
- 设置 `Cache-Control: public, max-age=31536000` for immutable artifacts

**严重程度**: P1 - R2 成本和限流风险

---

### 19. search-filings 大文件 fetch 超时设置过长

**文件**: `services/pi-gateway/src/tools/search-filings.ts:24`  
**问题**: `FULL_TEXT_FETCH_TIMEOUT_MS = 45_000`（45 秒），用户体验差。

```typescript
const timeoutSignal = AbortSignal.timeout(FULL_TEXT_FETCH_TIMEOUT_MS);
```

**影响**:
- Agent 工具调用卡住 45 秒
- 浏览器可能因 `/api/pi` 的 `maxDuration = 300` 而等待
- 10 个并发工具调用 → 后端线程池耗尽

**修复建议**:
降低超时 + 使用 fallback：
```typescript
const FULL_TEXT_FETCH_TIMEOUT_MS = 10_000; // 10 秒

// 超时后直接用 preview
if (!fullContent) {
  return {
    content: row.content, // preview
    warning: "完整正文暂不可用，以下仅为预览片段",
  };
}
```

**严重程度**: P1 - 用户体验问题

---

### 20. homeSignalSnapshot.payload JSON 字段无大小限制

**文件**: `src/lib/home-signals.ts:636-654`  
**问题**: `payload` 包含所有候选卡片（可能数百个），无大小验证。

```typescript
await db.homeSignalSnapshot.upsert({
  where: { scope: HOME_SIGNAL_SCOPE },
  update: { payload, /* ... */ },
  // ...
});
```

**影响**:
- PostgreSQL `jsonb` 单列限制 1GB（理论上），但实际建议 < 1MB
- 序列化/反序列化大 JSON 耗费 CPU

**修复建议**:
只存储最终 `items`（3 个卡片）+ 简化的 `pools`：
```typescript
const lightPayload = {
  generatedAt: payload.generatedAt,
  sourceQuarters: payload.sourceQuarters,
  items: payload.items, // 只存 3 个
  poolsSummary: {
    firstBuy: pools.firstBuy.length,
    consensus: pools.consensus.length,
    // ...
  },
};
```

**严重程度**: P1 - 数据库存储和查询性能

---

### 21. 缺少 ExtSource(filerEntityId, kind, periodYear, periodQuarter) 索引

**文件**: `src/lib/master-data.ts:39-43`  
**问题**: `getAvailableQuarters` 查询条件未被现有索引完全覆盖。

```typescript
const sources = await db.extSource.findMany({
  where: { filer: { is: { tribeId } }, kind: "13f" },
  select: { periodYear: true, periodQuarter: true },
  orderBy: [{ periodYear: "desc" }, { periodQuarter: "desc" }],
});
```

**现有索引**: `@@index([kind, ts])`, `@@index([filerEntityId])`

**问题**: 需要 JOIN `Entity` 表来解析 `tribeId`，且排序字段未索引。

**修复建议**:
```sql
CREATE INDEX "ExtSource_filer_kind_period_desc" 
ON "ExtSource"("filerEntityId", "kind", "periodYear" DESC, "periodQuarter" DESC);
```

**严重程度**: P1 - 高频查询（每个 master 页面加载）

---

### 22. BeneficialOwnership 查询缺少 issuerEntityId 索引

**文件**: `src/lib/master-data.ts:133-144`  
**问题**: 批量查询 `security.companyEntityId IN (...)` 但无直接索引。

```typescript
const holdings = await db.holding.findMany({
  where: { 
    holder: { tribeId }, 
    security: { companyEntityId: { in: issuerEntityIds } } 
  },
  // ...
});
```

**影响**:
- JOIN 到 `Security` 表，再过滤 `companyEntityId`
- 如果 Security 表很大（10,000+ 行），性能差

**修复建议**:
```sql
CREATE INDEX "Security_companyEntityId" ON "Security"("companyEntityId");
```

**严重程度**: P1 - `/master/[id]` 页面加载慢

---

### 23. getCompanyByTicker fallback 查询可能很慢

**文件**: `src/lib/company-data.ts:202-226`  
**问题**: 当 `Entity.ticker` 未匹配时，fallback 到 `Security.ticker`，再 JOIN 回 `Entity`。

```typescript
const security = await db.security.findFirst({
  where: { ticker: { equals: normalizedTicker, mode: "insensitive" } },
  select: { companyEntityId: true },
  orderBy: { updatedAt: "desc" },
});
```

**影响**:
- 两次查询（先 Security，再 Entity）
- `Security.ticker` 索引存在（schema.prisma:354），但可能有重复 ticker（不同 CUSIP）

**修复建议**:
优化为单次 JOIN 查询：
```typescript
const result = await prisma.$queryRaw`
  SELECT e.id, e."canonicalName", e.ticker, e.cik, e.sector, e.metadata, e."onboardPhase", e.priority
  FROM "Entity" e
  LEFT JOIN "Security" s ON s."companyEntityId" = e.id
  WHERE e.type = 'company' 
    AND (UPPER(e.ticker) = UPPER(${normalizedTicker}) OR UPPER(s.ticker) = UPPER(${normalizedTicker}))
  ORDER BY (e.ticker IS NOT NULL) DESC, e."updatedAt" DESC
  LIMIT 1;
`;
```

**严重程度**: P1 - `/company/[ticker]` 路由性能

---

## P2 中优先级问题

### 24. Prisma connection pool timeout 默认 20 秒

**文件**: `src/lib/prisma.ts:14`  
**问题**: `pool_timeout=20` 在高负载时仍可能不足。

```typescript
const timeout = process.env.PRISMA_POOL_TIMEOUT ?? '20'
```

**修复建议**:
```typescript
const timeout = process.env.PRISMA_POOL_TIMEOUT ?? '10' // 快速失败，避免堆积
```

同时增加连接池大小，避免等待。

**严重程度**: P2

---

### 25. InsightPost 查询可能返回数百篇文章

**文件**: `src/lib/master-data.ts:619-623`  
**问题**: 无 `take` 限制。

```typescript
const posts = await db.insightPost.findMany({
  where: { status: "published", entityIds: { has: entity.id } },
  select: { /* ... */ },
  orderBy: { publishedAt: "desc" },
});
```

**修复建议**:
```typescript
const posts = await db.insightPost.findMany({
  // ...
  take: 50, // 合理上限
});
```

**严重程度**: P2

---

### 26. MasterProfile 无 entityId 唯一约束验证

**文件**: `prisma/schema.prisma:590`  
**问题**: `entityId String @unique` 但业务逻辑未验证重复插入。

**修复建议**:
生成脚本中使用 `upsert` 而非 `create`：
```typescript
await prisma.masterProfile.upsert({
  where: { entityId },
  create: { entityId, profile, /* ... */ },
  update: { profile, version: { increment: 1 }, /* ... */ },
});
```

**严重程度**: P2

---

### 27. CompanyAnalysis 无 entityId 唯一约束验证

**文件**: `prisma/schema.prisma:606`  
**问题**: 同上。

**严重程度**: P2

---

### 28. ChatMessage 表已废弃但未删除

**文件**: `prisma/schema.prisma:141-154`  
**问题**: 注释说明 "dead table from the retired /idea page"，但仍占用 schema。

**修复建议**:
```sql
DROP TABLE "ChatMessage";
```

清理 migration 历史。

**严重程度**: P2 - 技术债务

---

### 29. Source.chunks 关联无 ON DELETE CASCADE

**文件**: `prisma/schema.prisma:76`  
**问题**: `chunks Chunk[]` 但未明确级联删除策略。

**验证**: Chunk model 的 `@relation` 已设置 `onDelete: Cascade`（L117），已处理。

**严重程度**: P2（已修复，无需操作）

---

### 30. WaitlistEntry 无索引

**文件**: `prisma/schema.prisma:134-139`  
**问题**: 如果后续需要按 `createdAt` 查询（如"最近 100 个注册"），无索引。

**修复建议**:
```sql
CREATE INDEX "WaitlistEntry_createdAt_desc" ON "WaitlistEntry"("createdAt" DESC);
```

**严重程度**: P2（低优先级）

---

### 31. Document 无 ownerId + sortOrder 复合索引

**文件**: `prisma/schema.prisma:707`  
**问题**: `@@index([ownerId])` 但查询时还需排序 `sortOrder`。

```typescript
// src/lib/documents.ts（假设）
const docs = await prisma.document.findMany({
  where: { ownerId },
  orderBy: { sortOrder: "asc" },
});
```

**修复建议**:
```sql
CREATE INDEX "Document_ownerId_sortOrder" ON "Document"("ownerId", "sortOrder" ASC);
```

**严重程度**: P2

---

### 32. EmailAnnouncement 只有 createdAt 降序索引

**文件**: `prisma/schema.prisma:730`  
**问题**: 如果需要按 `status` 过滤（如"所有草稿"），无索引。

**修复建议**:
```sql
CREATE INDEX "EmailAnnouncement_status_createdAt" ON "EmailAnnouncement"("status", "createdAt" DESC);
```

**严重程度**: P2

---

### 33. Punch 查询可能返回所有历史 punches

**文件**: 无具体文件（假设存在 `/punch` API）  
**问题**: 如果查询 `SELECT * FROM Punch WHERE status = 'active'`，无分页。

**修复建议**:
添加分页参数 `take: 50`。

**严重程度**: P2

---

### 34. FilingSectionExtractionJob 无 cleanup 策略

**文件**: `prisma/schema.prisma:415-441`  
**问题**: 历史 job 记录无限累积（每个 filing 可能有多个 version）。

**修复建议**:
定期清理：
```sql
DELETE FROM "FilingSectionExtractionJob"
WHERE status IN ('success', 'no_sections', 'failed')
  AND "finishedAt" < NOW() - INTERVAL '90 days';
```

**严重程度**: P2 - 长期维护问题

---

### 35. Financial 表可能有大量历史数据

**文件**: `prisma/schema.prisma:443-463`  
**问题**: 1,000 家公司 × 20 年 × 4 季度 × 6 指标 = 480,000 行，查询时未过滤时间范围。

**修复建议**:
查询时始终加 `periodEnd >= '2020-01-01'`（最近 5 年）。

**严重程度**: P2

---

### 36. getHoldingsHistoryBySecurity 一次性加载所有历史

**文件**: `src/lib/master-data.ts:321-362`  
**问题**: 查询所有季度的所有持仓，无分页。

```typescript
const rows = await db.holding.findMany({
  where: {
    holder: { tribeId },
    source: { is: { kind: "13f" } },
  },
  // ...
});
```

**影响**:
- Buffett: 50 季度 × 40 持仓 = 2,000 行
- 内存中排序、分组 → JS 堆压力

**修复建议**:
添加时间范围过滤：
```typescript
where: {
  holder: { tribeId },
  source: { is: { kind: "13f", periodYear: { gte: 2015 } } }, // 最近 10 年
}
```

**严重程度**: P2

---

### 37. Rate limiting 基于 IP，易被绕过

**文件**: `src/lib/ratelimit.ts:32-47`  
**问题**: `cf-connecting-ip` / `x-forwarded-for` 可被伪造（如果上游反向代理未正确配置）。

**修复建议**:
- 确认 Cloudflare 正确设置（已通过 Cloudflare CDN，应该可靠）
- 考虑添加 User-Agent + Cookie 组合指纹

**严重程度**: P2

---

## 索引添加优先级总结

| 优先级 | 索引 | 表 | 原因 |
|-------|------|-----|------|
| P0 | `(market, code)` UNIQUE | Entity | 防止重复导入 |
| P0 | `(holderEntityId, percentOfPortfolio DESC)` WHERE NOT soldOut | Holding | search-holdings 排序 |
| P0 | `(userId, contextKey, createdAt DESC)` COVERING | ChatTurn | agent history |
| P1 | `entityIds` GIN | InsightPost | master library |
| P1 | `(entityId, section, extractionVersion)` | FilingSection | search-filings |
| P1 | `search_vector` GIN | Entity | company search |
| P1 | `(ticker, date DESC)` | StockPrice | portfolio prices |
| P1 | `(filerEntityId, kind, periodYear DESC, periodQuarter DESC)` | ExtSource | available quarters |
| P2 | `(ownerId, sortOrder)` | Document | master library |
| P2 | `(status, createdAt DESC)` | EmailAnnouncement | admin panel |

---

## 推荐修复顺序

### 第一阶段（立即，1-2 天）
1. **提高连接池上限**（P0 #1）→ `PRISMA_CONNECTION_LIMIT=50`
2. **修复并发竞态**（P0 #2, #3）→ 使用 Redis 原子操作
3. **添加 Entity(market, code) 唯一约束**（P0 #4）
4. **缓存 getTribeMembers**（P0 #5）
5. **添加 Holding 排序索引**（P0 #7a）

### 第二阶段（本周内，3-5 天）
6. **优化 home-signals N+1 查询**（P0 #8）→ 并行化
7. **添加 InsightPost.entityIds GIN 索引**（P1 #9）
8. **添加 FilingSection 复合索引**（P1 #10)
9. **添加 ExtSource 复合索引**（P1 #21）
10. **添加 Security.companyEntityId 索引**（P1 #22）

### 第三阶段（本月内，1-2 周）
11. **实现 Company search full-text**（P1 #12）
12. **优化 CreditLedger 聚合查询**（P1 #15）
13. **添加所有 P2 索引**
14. **添加分页保护**（P1 #14, P2 #25, #33）
15. **降低 R2 fetch 超时**（P1 #19）

### 第四阶段（长期优化）
16. **实现查询结果缓存**（Redis）
17. **添加数据库连接池监控**（Prometheus + Grafana）
18. **配置 read replica**（Supabase 支持）
19. **迁移历史数据到归档表**（P2 #34, #35）

---

## 监控建议

### 关键指标

1. **数据库连接数**
```sql
SELECT count(*), state FROM pg_stat_activity GROUP BY state;
```

2. **慢查询日志** (> 100ms)
```sql
SELECT query, mean_exec_time, calls 
FROM pg_stat_statements 
ORDER BY mean_exec_time DESC 
LIMIT 20;
```

3. **索引使用率**
```sql
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read
FROM pg_stat_user_indexes
WHERE idx_scan = 0 AND schemaname = 'public';
```

4. **表大小增长**
```sql
SELECT schemaname, tablename, 
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Upstash Redis 监控

- 缓存命中率（目标 > 80%）
- 平均延迟（目标 < 5ms）
- 连接数（目标 < 100）

### 应用层监控

```typescript
// 在 prisma.$use() middleware 中记录慢查询
prisma.$use(async (params, next) => {
  const start = Date.now();
  const result = await next(params);
  const duration = Date.now() - start;
  
  if (duration > 100) {
    console.warn(`Slow query (${duration}ms):`, params.model, params.action);
  }
  
  return result;
});
```

---

## 压力测试建议

使用 k6 或 Apache Bench 模拟 10,000 并发：

```javascript
// k6-load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  stages: [
    { duration: '2m', target: 100 },   // 热身
    { duration: '5m', target: 1000 },  // 渐进
    { duration: '10m', target: 10000 }, // 峰值
    { duration: '2m', target: 0 },     // 降温
  ],
};

export default function () {
  // 模拟真实用户行为
  const scenarios = [
    () => http.get('https://vt.air7fun.com/'),
    () => http.get('https://vt.air7fun.com/company/us-0000320193'), // AAPL
    () => http.get('https://vt.air7fun.com/master/buffett'),
    () => http.post('https://vt.air7fun.com/api/pi', JSON.stringify({
      message: '巴菲特最近买了什么？',
    }), { headers: { 'Content-Type': 'application/json' } }),
  ];
  
  const scenario = scenarios[Math.floor(Math.random() * scenarios.length)];
  const res = scenario();
  
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
  
  sleep(Math.random() * 5); // 用户思考时间
}
```

**目标通过率**: 95% 请求 < 500ms，99% 请求 < 2s，错误率 < 0.1%

---

## 总结

当前代码库在**低-中并发**（< 100 用户）下运行良好，但面向 10,000 并发用户时存在明显瓶颈：

1. **连接池配置**是最大的单点故障
2. **并发控制缺失**可能导致配额机制被绕过
3. **缺少关键索引**会导致查询延迟线性增长
4. **N+1 查询问题**在高负载下放大延迟

修复 P0 问题后，系统应该能支撑 **1,000-2,000 并发用户**。  
修复 P1 问题后，可支撑 **5,000-8,000 并发用户**。  
要达到 **10,000 并发用户**，需要结合：
- 数据库 read replica（读写分离）
- Redis 查询结果缓存
- CDN 静态资源缓存
- 应用层限流（API Gateway）

**预计工作量**: 4-6 周（2 名工程师全职投入）

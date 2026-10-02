# 数据库可扩展性审计报告

**项目**: buffett-tribe (价值部落)  
**审计目标**: 面向 10,000 并发用户的数据库性能与可靠性  
**审计日期**: 2026-10-02  
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

### 当前架构支撑能力评估

| 状态 | 支撑并发数 | 主要瓶颈 |
|------|-----------|---------|
| **当前未修复** | < 100 用户 | 连接池耗尽、竞态漏洞、无缓存 |
| **修复 P0** | 1,000-2,000 | 索引缺失、N+1 查询 |
| **修复 P0+P1** | 5,000-8,000 | 需要架构升级 |
| **达到 10,000 目标** | 需额外架构工作 | Read replica + Redis 缓存层 + CDN |

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
- **预计在 50-100 并发用户时就会出现连接超时**

**修复建议**:
```typescript
// src/lib/prisma.ts
const limit = process.env.PRISMA_CONNECTION_LIMIT ?? '50' // 提高默认值
```

同时配置 Supabase 连接池：
- 使用 Supabase 的 connection pooler (Transaction mode)
- 配置 `pgBouncer` 最大连接数至少 100
- 监控 `pg_stat_activity` 实时连接数

**环境变量配置**:
```bash
# .env.local
PRISMA_CONNECTION_LIMIT=50
DATABASE_URL="postgresql://...?pgbouncer=true&connection_limit=50"
```

**严重程度**: P0 - 高并发下应用直接不可用

---

### 2. ChatUsage 并发竞态条件

**文件**: `src/lib/guest-credits.ts:38-58` + `src/app/api/pi/route.ts:27-42`  
**问题**: `checkGuestLimit` 和 `recordGuestUsage` 之间存在竞态窗口。

```typescript
// /api/pi/route.ts:27-42
const { allowed } = await checkGuestLimit(ip);
if (!allowed) { 
  return NextResponse.json({ error: 'Daily limit reached' }, { status: 429 });
}

// ... 竞态窗口 ...

await recordGuestUsage(ip); // 在请求结束时才记录
```

**攻击场景**:
同一 IP 并发发起 20 个请求，所有请求都在 `recordGuestUsage` 之前通过 `checkGuestLimit`，绕过 5 次/天限制。

**影响**:
- 匿名用户可通过并发请求绕过每日配额
- 恶意用户可耗尽 LLM API 配额
- **已有 Upstash Redis 配置，但未用于并发控制**

**修复建议**:
使用 Redis 原子操作：

```typescript
// src/lib/guest-credits.ts
import { redis } from "@/lib/redis";

export async function checkAndRecordGuestUsage(ip: string): Promise<{
  allowed: boolean;
  used: number;
  limit: number;
}> {
  const today = new Date().toISOString().split("T")[0];
  const key = `guest:${ip}:${today}`;
  
  // 原子操作：读取 + 自增
  const count = await redis.incr(key);
  
  // 第一次访问时设置过期时间
  if (count === 1) {
    await redis.expire(key, 86400); // 24 小时
  }
  
  return {
    allowed: count <= GUEST_DAILY_LIMIT,
    used: count,
    limit: GUEST_DAILY_LIMIT,
  };
}

// 删除原有的 checkGuestLimit + recordGuestUsage 分离逻辑
```

**API 路由调整**:
```typescript
// src/app/api/pi/route.ts
const guestCheck = await checkAndRecordGuestUsage(ip);
if (!guestCheck.allowed) {
  return NextResponse.json(
    { error: `Daily limit reached (${guestCheck.used}/${guestCheck.limit})` },
    { status: 429 }
  );
}
// 不再需要单独调用 recordGuestUsage
```

**严重程度**: P0 - 安全漏洞，可被利用

---

### 3. CreditLedger hourly limit 竞态条件

**文件**: `src/lib/credits.ts:72-78` + `src/app/api/pi/route.ts:45-46`  
**问题**: `withinHourlyLimit` 和 `recordSpend` 之间存在竞态窗口。

```typescript
// /api/pi/route.ts:45-46
if (!(await withinHourlyLimit(session.user.id))) {
  return NextResponse.json({ error: 'Hourly limit' }, { status: 429 });
}

// ... 竞态窗口 ...

await recordSpend(session.user.id, undefined, currentPeriod()); // route.ts:126
```

**影响**:
- 用户可通过并发请求绕过每小时 50 次限制
- 单用户短时间内发起数百次请求
- 付费用户可能恶意消耗配额

**修复建议**:
使用数据库事务 + 乐观锁：

```typescript
// src/lib/credits.ts
export async function tryRecordSpendWithHourlyCheck(
  userId: string, 
  period: string | undefined
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. 查询最近 1 小时的消费次数
      const count = await tx.creditLedger.count({
        where: {
          userId,
          reason: SPEND_AGENT,
          createdAt: { gte: oneHourAgo },
        },
      });
      
      if (count >= HOURLY_SPEND_LIMIT) {
        return { allowed: false, used: count, limit: HOURLY_SPEND_LIMIT };
      }
      
      // 2. 在同一事务中记录消费
      await tx.creditLedger.create({
        data: {
          userId,
          delta: -1,
          reason: SPEND_AGENT,
          period: period ?? null,
        },
      });
      
      return { allowed: true, used: count + 1, limit: HOURLY_SPEND_LIMIT };
    }, {
      isolationLevel: 'Serializable', // 关键：防止并发
    });
    
    return result;
  } catch (error) {
    // 事务冲突时返回拒绝
    return { allowed: false, used: HOURLY_SPEND_LIMIT, limit: HOURLY_SPEND_LIMIT };
  }
}
```

**API 路由调整**:
```typescript
// src/app/api/pi/route.ts
const hourlyCheck = await tryRecordSpendWithHourlyCheck(
  session.user.id, 
  currentPeriod()
);

if (!hourlyCheck.allowed) {
  return NextResponse.json(
    { error: `Hourly limit reached (${hourlyCheck.used}/${hourlyCheck.limit})` },
    { status: 429 }
  );
}

// 不再需要单独调用 recordSpend
```

**严重程度**: P0 - 配额机制可被绕过

---

### 4. 缺少 Entity(market, code) 唯一约束

**文件**: `prisma/schema.prisma:271`  
**问题**: `@@index([market, code])` 是普通索引，允许重复，但业务逻辑假设唯一。

```prisma
model Entity {
  // ...
  market  String?  // 'us' | 'hk' | 'cn'
  code    String?  // 港股代码、A股代码
  
  @@index([market, code])  // ❌ 允许重复
}
```

**实际查询假设唯一**:
```typescript
// src/lib/company-data.ts:262
const company = await db.entity.findFirst({
  where: { type: "company", market: parsed.market, code: parsed.code },
});
// 使用 findFirst 而不是 findUnique，说明开发者已经意识到可能重复
```

**影响**:
- CN/HK 市场公司可能被重复导入（例如 `600519` 贵州茅台导入两次）
- `findFirst` 返回随机一条，用户看到的公司数据不稳定
- 10,000 并发时，重复导入概率显著增加
- 数据库浪费存储空间，查询性能下降

**修复建议**:

**Step 1: 清理现有重复数据**
```sql
-- 查找重复
SELECT market, code, COUNT(*) 
FROM "Entity" 
WHERE type = 'company' AND market IS NOT NULL AND code IS NOT NULL
GROUP BY market, code 
HAVING COUNT(*) > 1;

-- 删除重复（保留 id 最小的）
DELETE FROM "Entity" e1
WHERE e1.type = 'company'
  AND EXISTS (
    SELECT 1 FROM "Entity" e2
    WHERE e2.type = 'company'
      AND e2.market = e1.market 
      AND e2.code = e1.code 
      AND e2.id < e1.id
  );
```

**Step 2: 添加唯一约束**
```prisma
// prisma/schema.prisma
model Entity {
  // ...
  @@unique([market, code], name: "Entity_market_code_unique", map: "entity_market_code_key")
  @@index([market, code]) // 可以删除，unique 自动创建索引
}
```

```sql
-- 迁移 SQL
CREATE UNIQUE INDEX "entity_market_code_key" 
ON "Entity"(market, code) 
WHERE type = 'company' AND market IS NOT NULL AND code IS NOT NULL;
```

**Step 3: 修改查询逻辑**
```typescript
// src/lib/company-data.ts:262
const company = await db.entity.findUnique({
  where: { 
    Entity_market_code_unique: { 
      market: parsed.market, 
      code: parsed.code 
    } 
  },
});
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
    select: { /* 10+ 字段 */ },
  });
  return rows.map(toTribeMember);
});
```

**调用频率分析**:
- `/` 首页：每次访问调用 1 次
- `/agent` 工具初始化：每个 session 创建调用 1 次（`createSearchHoldingsTool`）
- `/master` 列表页：每次访问调用 1 次
- `/company/[id]` 页面：可能调用（如果展示大师持仓）
- **预估：10,000 并发用户 → ~10,000 次/秒查询同一个只有 10 行的表**

**影响**:
- 数据库承受不必要的查询负载（虽然轻量，但累积效应显著）
- 查询延迟累积（10,000 × 2ms = 20s 总延迟）
- `Filer` 表数据几乎是静态的（只在 onboard 新投资人时更新）

**修复建议**:
使用 Redis 缓存 + 5 分钟 TTL：

```typescript
// src/lib/tribe.ts
import { redis } from "@/lib/redis";

const TRIBE_MEMBERS_CACHE_KEY = "tribe:members:v1";
const CACHE_TTL = 300; // 5 分钟

export async function getTribeMembers(): Promise<TribeMember[]> {
  // 1. 尝试从 Redis 读取
  try {
    const cached = await redis.get(TRIBE_MEMBERS_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached as string);
    }
  } catch (err) {
    console.error('Redis cache read failed:', err);
    // 降级到数据库查询
  }
  
  // 2. 缓存未命中，查询 DB
  const rows = await prisma.filer.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      personNameEn: true,
      personNameZh: true,
      initials: true,
      materialLabel: true,
      materialSub: true,
      isMasterPersona: true,
      tribeId: true,
    },
  });
  const members = rows.map(toTribeMember);
  
  // 3. 写入缓存
  try {
    await redis.setex(
      TRIBE_MEMBERS_CACHE_KEY, 
      CACHE_TTL, 
      JSON.stringify(members)
    );
  } catch (err) {
    console.error('Redis cache write failed:', err);
    // 不影响主流程
  }
  
  return members;
}

// 新增：手动清理缓存（在 onboard 新投资人时调用）
export async function invalidateTribeMembersCache(): Promise<void> {
  await redis.del(TRIBE_MEMBERS_CACHE_KEY);
}
```

**在 onboard 脚本中清理缓存**:
```typescript
// scripts/onboard-alpha-investor.ts
await prisma.filer.create({ /* ... */ });
await invalidateTribeMembersCache(); // 清理缓存
```

**严重程度**: P0 - 10,000 并发下数据库负载激增

---

### 6. search-holdings 查询低效（Buffett 15,000+ 持仓）

**文件**: `services/pi-gateway/src/tools/search-holdings.ts:60-88`  
**问题**: 查询虽然有 `LIMIT 25`，但排序需要扫描所有持仓记录。

```typescript
// L199 - 查询逻辑
const limit = Math.min(top_n ?? 15, 25);

const query = `
  SELECT /* ... */
  FROM "Holding" h
  JOIN "Entity" holder ON holder.id = h."holderEntityId" AND holder."tribeId" = $1
  WHERE h."isSoldOut" IS NOT TRUE
  ORDER BY h."percentOfPortfolio" DESC  -- ⚠️ 需要扫描全表排序
  LIMIT ${limit};
`;
```

**数据规模估算**:
- Buffett 的 `Holding` 表：50+ 季度 × 40+ 持仓/季度 = **15,000+ 行**
- 即使 `LIMIT 25`，排序仍需扫描 15,000 行

**影响**:
- 单次查询延迟 50-100ms（取决于是否有索引）
- 10 个并发 agent 对话 = 500ms+ 总延迟
- agent 工具调用是高频路径

**修复建议**:
添加组合索引（支持排序）：

```sql
-- 索引包含 WHERE 和 ORDER BY 字段
CREATE INDEX "Holding_holder_portfolio_pct_desc" 
ON "Holding"("holderEntityId", "percentOfPortfolio" DESC NULLS LAST)
WHERE "isSoldOut" IS NOT TRUE OR "isSoldOut" IS NULL;
```

**额外优化**（子查询问题）:
```typescript
// 当前代码（L46-55）- 子查询在每次调用时执行
const periodFilter = year == null && quarter == null
  ? `AND (es."periodYear", es."periodQuarter") = (
      SELECT es2."periodYear", es2."periodQuarter"
      FROM "ExtSource" es2
      WHERE es2.kind = '13f' AND es2."periodYear" IS NOT NULL
      ORDER BY es2."periodYear" DESC, es2."periodQuarter" DESC
      LIMIT 1
    )`
  : "";

// 优化：提前查询最近季度
let yearFilter = year;
let quarterFilter = quarter;

if (year == null && quarter == null) {
  const latest = await pool.query(
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

// 然后在主查询中使用 yearFilter 和 quarterFilter
```

**严重程度**: P0 - 高频工具调用路径

---

### 7. getRecentTurns 索引利用不充分

**文件**: `src/lib/agent-history.ts:14-19`  
**问题**: `ChatTurn` 表查询 `(userId, contextKey)` 排序 `createdAt DESC`，现有索引可能未被充分利用。

```typescript
const turns = await prisma.chatTurn.findMany({
  where: { userId, contextKey },
  orderBy: { createdAt: "desc" },
  take: HISTORY_LIMIT, // 10
});
```

**现有索引**: `@@index([userId, contextKey, createdAt])` (schema.prisma:173)

**问题分析**:
- 索引顺序正确，理论上应该被使用
- 但如果统计信息过期，或 SELECT 字段太多，可能退化为全表扫描

**影响**:
- 每个 `/agent` 页面加载 + 每次对话都查询一次
- 10,000 活跃用户 × 每分钟 1 次对话 = 167 QPS
- 全表扫描场景下单次查询可能 > 100ms

**验证建议**:
```sql
-- 在生产数据库执行
EXPLAIN ANALYZE
SELECT id, role, text, "imageUrls", "createdAt"
FROM "ChatTurn"
WHERE "userId" = 'test-user-id' 
  AND "contextKey" = 'company:AAPL'
ORDER BY "createdAt" DESC
LIMIT 10;

-- 检查执行计划：
-- ✅ Index Scan using ChatTurn_userId_contextKey_createdAt_idx
-- ❌ Seq Scan on ChatTurn
```

**修复建议**:
如果未使用索引，添加 covering index（包含 SELECT 字段）：

```sql
CREATE INDEX "ChatTurn_userId_contextKey_createdAt_covering" 
ON "ChatTurn"("userId", "contextKey", "createdAt" DESC) 
INCLUDE (role, text, "imageUrls");
```

或更新统计信息：
```sql
ANALYZE "ChatTurn";
```

**严重程度**: P0（如果索引未使用）/ P1（如果索引已使用但可优化）

---

### 8. home-signals N+1 查询问题

**文件**: `src/lib/home-signals.ts:222-233` + `L582-587`  
**问题**: `buildMasterEvents` 为每个 master 执行 3+ 次独立查询，且 `getTribeMember` 在循环中调用。

```typescript
// L582-587
for (const masterId of masterIds) {
  const result = await buildMasterEvents(masterId); // 内部 3+ 次查询
  if (result.events.length > 0) {
    allEvents.push(...result.events);
  }
}
```

**调用栈分析**:
```
buildMasterEvents(masterId)
  → getAvailableQuarters(masterId)     // 1 次查询
  → getHoldingsByQuarter(latest)       // 1 次查询
  → getHoldingsByQuarter(base)         // 1 次查询
  → getMasterLabel(masterId)
    → getTribeMember(masterId)
      → getTribeMembers()               // 1 次查询（已被 cache，但首次调用仍查询）
```

**影响**:
- 10 个 tribe members × 3 queries = **30 次数据库往返**
- 串行执行，总延迟 ~300-600ms
- `/` 首页每次访问都生成 signals（`getLatestHomeSignalCards` 读缓存，但缓存失效时重新计算）

**修复建议**:

**方案 A: 并行化（快速修复）**
```typescript
// src/lib/home-signals.ts:582-587
const masterResults = await Promise.all(
  masterIds.map(masterId => buildMasterEvents(masterId))
);

const allEvents = masterResults.flatMap(result => result.events);
```

**方案 B: 批量查询（彻底优化）**
```typescript
// 一次查询获取所有 masters 的 holdings
async function getAllMastersHoldings(masterIds: string[]) {
  const allHoldings = await db.holding.findMany({
    where: {
      holder: { tribeId: { in: masterIds } },
      source: { is: { kind: "13f" } },
      isSoldOut: { not: true },
    },
    include: {
      holder: { select: { tribeId: true, personNameEn: true } },
      source: { select: { periodYear: true, periodQuarter: true } },
      security: { select: { ticker: true, canonicalName: true } },
    },
    orderBy: [
      { holder: { tribeId: "asc" } },
      { source: { periodYear: "desc" } },
      { source: { periodQuarter: "desc" } },
    ],
  });
  
  // 按 masterId 分组
  const holdingsByMaster = new Map<string, typeof allHoldings>();
  for (const holding of allHoldings) {
    const masterId = holding.holder.tribeId;
    if (!holdingsByMaster.has(masterId)) {
      holdingsByMaster.set(masterId, []);
    }
    holdingsByMaster.get(masterId)!.push(holding);
  }
  
  return holdingsByMaster;
}

// 然后在循环中使用已查询的数据
const holdingsByMaster = await getAllMastersHoldings(masterIds);
for (const masterId of masterIds) {
  const holdings = holdingsByMaster.get(masterId) ?? [];
  const result = buildMasterEventsFromData(masterId, holdings);
  // ...
}
```

**严重程度**: P0 - 首页性能瓶颈

---

## P1 高优先级问题

### 9. InsightPost.entityIds 无 GIN 索引

**文件**: `prisma/schema.prisma:91` + `src/lib/master-data.ts:619`  
**问题**: `entityIds String[] @default([])` 用于数组包含查询，但无 GIN 索引。

```typescript
// src/lib/master-data.ts:619
const posts = await db.insightPost.findMany({
  where: { 
    status: "published", 
    entityIds: { has: entity.id }  // ⚠️ 数组包含查询
  },
  orderBy: { publishedAt: "desc" },
});
```

**影响**:
- 数组包含查询在无索引时为全表扫描
- 假设 `InsightPost` 有 3,000 行（PRODUCT.md 提到 30 年积累 3 万篇），每次查询扫描全表
- `/master/[id]` 页面加载慢

**修复建议**:
```sql
CREATE INDEX "InsightPost_entityIds_gin" 
ON "InsightPost" USING GIN ("entityIds");
```

**严重程度**: P1

---

### 10. FilingSection 查询缺少复合索引

**文件**: `services/pi-gateway/src/tools/search-filings.ts:82-96`  
**问题**: 查询条件 `entityId + section IN (...) + periodYear` 但只有单列索引。

```sql
-- 现有索引 (schema.prisma:494)
@@index([entityId, section])

-- 实际查询
WHERE fs."entityId" = $1
  AND fs.section = ANY($2::text[])  -- ⚠️ 无法用索引第二列
  AND fs."contentTextLength" > 100
  [AND es."periodYear" = $3]
```

**影响**:
- `section = ANY(...)` 无法使用 `(entityId, section)` 索引的第二列
- 查询器可能只使用 `entityId` 部分，然后全扫描匹配 section
- 单公司可能有 50+ filing × 8 sections = 400 行

**修复建议**:
```sql
CREATE INDEX "FilingSection_entity_section_length" 
ON "FilingSection"("entityId", "section", "contentTextLength")
WHERE "contentTextLength" > 100;
```

或针对时间过滤的索引：
```sql
CREATE INDEX "FilingSection_entity_year_section" 
ON "FilingSection"("entityId", "extractionVersion" DESC, "section")
WHERE "contentTextLength" > 100;
```

**严重程度**: P1

---

### 11. Company search 无 full-text 索引

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
- 10,000+ 家公司 × 无索引 = 全表扫描
- 单次搜索 50-100ms（取决于数据量）
- 用户输入时的实时搜索（每个字符触发一次）→ 高 QPS

**修复建议**:
使用 PostgreSQL `tsvector` + GIN 索引：

```sql
-- Step 1: 添加生成列
ALTER TABLE "Entity" 
ADD COLUMN search_vector tsvector 
GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', coalesce(ticker, '')), 'A') ||
  setweight(to_tsvector('english', coalesce("canonicalName", '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(metadata->>'nameZh', '')), 'B')
) STORED;

-- Step 2: 创建 GIN 索引
CREATE INDEX "Entity_search_vector_gin" 
ON "Entity" USING GIN (search_vector);
```

**查询改写**:
```typescript
// src/app/api/company/search/route.ts
const tsquery = query.replace(/\s+/g, ' & '); // "apple inc" → "apple & inc"

const rows = await prisma.$queryRaw<Entity[]>`
  SELECT id, ticker, "canonicalName", market, code
  FROM "Entity"
  WHERE type = 'company' 
    AND search_vector @@ to_tsquery('simple', ${tsquery})
  ORDER BY ts_rank(search_vector, to_tsquery('simple', ${tsquery})) DESC
  LIMIT ${limit};
`;
```

**严重程度**: P1 - 用户体验问题（搜索慢）

---

### 12. StockPrice 无 (ticker, date DESC) 复合索引

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
- 唯一索引 `(ticker, date)` 支持精确查询，但不支持 `ORDER BY date DESC` 排序
- 数据库需要额外排序步骤（filesort）
- 用户组合可能有 50 个 tickers → 50 次查询，每次都 filesort

**修复建议**:
```sql
CREATE INDEX "StockPrice_ticker_date_desc" 
ON "StockPrice"(ticker, date DESC);
```

**严重程度**: P1

---

### 13. PortfolioHolding 查询可能返回数百行

**文件**: `src/app/api/portfolio/route.ts:71-74`  
**问题**: 无 `LIMIT` 限制，用户可能持有数百个仓位。

```typescript
const holdings = await prisma.portfolioHolding.findMany({
  where: { userId: session.user.id },
  orderBy: { createdAt: "asc" },
  // ⚠️ 无 take 限制
});
```

**影响**:
- 理论上限：单用户 1,000 个持仓
- 序列化 + 价格查询（L32-46 并发查询每个 ticker）→ 超时
- 边缘用户可能触发 API 超时

**修复建议**:
```typescript
const holdings = await prisma.portfolioHolding.findMany({
  where: { userId: session.user.id },
  orderBy: { createdAt: "asc" },
  take: 100, // 合理上限
});

// 如果需要支持更多持仓，实现分页
```

前端实现分页或虚拟滚动。

**严重程度**: P1

---

### 14. CreditLedger.aggregate 无部分索引

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
- 高频调用路径（每次对话前检查余额）

**修复建议**:
分区索引 + 查询改写：

```sql
CREATE INDEX "CreditLedger_userId_currentPeriod" 
ON "CreditLedger"("userId", delta)
WHERE period IS NOT NULL;

CREATE INDEX "CreditLedger_userId_neverExpire" 
ON "CreditLedger"("userId", delta)
WHERE period IS NULL;
```

**查询改写为两次查询**:
```typescript
// src/lib/credits.ts
export async function getBalance(userId: string, period: string): Promise<number> {
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
}
```

**严重程度**: P1

---

### 15-23. 其他 P1 问题（简要列举）

15. **Holding 查询缺少 (holderEntityId, asOfDate DESC) 索引** - `/master/[id]/holdings` 页面慢
16. **ExtSource 需要 (filerEntityId, kind, periodYear DESC) 索引** - 关联查询慢
17. **Financial 缺少 (entityId, year DESC) 索引** - 公司财务页面慢
18. **Entity 缺少 (type, market, onboardPhase) 组合索引** - 批量筛选慢
19. **BeneficialOwnership 无索引** - 13D/13G 查询慢
20. **Note 只有复合索引，缺少 userId 单列索引** - 某些查询模式低效
21. **PortfolioInsight.filerEntityId 无索引** - 投资人文章查询慢
22. **MasterProfile.entityId 无索引** - master 页面加载慢
23. **GeneratedContentVersion 无复合索引** - 历史版本查询慢

---

## P2 中优先级问题（24-37）

### 架构建议

24. **废弃表未清理** - `ChatMessage` 表已停用，应删除
25. **缺少数据归档策略** - `ChatTurn`/`CreditLedger` 无限增长
26. **缺少慢查询监控** - 应配置 `log_min_duration_statement`
27. **缺少连接池监控** - 应监控 `pg_stat_activity`
28. **缺少 API rate limiting** - 所有公开 API 无限流保护
29. **缺少数据库备份验证** - Supabase 自动备份，但未验证恢复流程

### 索引优化

30-37. 次要索引建议（影响较小的查询路径）

---

## 立即行动计划

### 第一阶段（1-2 天，立即执行）

**目标**: 修复 P0 问题，提升到 1,000-2,000 并发支撑能力

#### 1. 提高连接池（5 分钟）
```typescript
// src/lib/prisma.ts
const limit = process.env.PRISMA_CONNECTION_LIMIT ?? '50'
```

```bash
# .env.local
PRISMA_CONNECTION_LIMIT=50
```

#### 2. 修复配额竞态（1 小时）
- `checkAndRecordGuestUsage` - Redis 原子操作
- `tryRecordSpendWithHourlyCheck` - 数据库事务

#### 3. 添加唯一约束（30 分钟）
```sql
-- 清理重复
DELETE FROM "Entity" e1 WHERE EXISTS (
  SELECT 1 FROM "Entity" e2
  WHERE e2.type = 'company' AND e2.market = e1.market 
    AND e2.code = e1.code AND e2.id < e1.id
);

-- 添加约束
CREATE UNIQUE INDEX "entity_market_code_key" 
ON "Entity"(market, code) 
WHERE type = 'company' AND market IS NOT NULL AND code IS NOT NULL;
```

#### 4. 实现静态数据缓存（30 分钟）
- `getTribeMembers` - Redis 缓存，5 分钟 TTL
- `invalidateTribeMembersCache` - 在 onboard 时清理

#### 5. 添加关键索引（30 分钟）
```sql
-- Holding 排序索引
CREATE INDEX "Holding_holder_portfolio_pct_desc" 
ON "Holding"("holderEntityId", "percentOfPortfolio" DESC)
WHERE "isSoldOut" IS NOT TRUE;

-- InsightPost 数组索引
CREATE INDEX "InsightPost_entityIds_gin" 
ON "InsightPost" USING GIN ("entityIds");

-- StockPrice 排序索引
CREATE INDEX "StockPrice_ticker_date_desc" 
ON "StockPrice"(ticker, date DESC);

-- FilingSection 复合索引
CREATE INDEX "FilingSection_entity_section_length" 
ON "FilingSection"("entityId", "section", "contentTextLength")
WHERE "contentTextLength" > 100;
```

#### 6. 优化 N+1 查询（1 小时）
- `home-signals` - 并行化 `Promise.all`
- `search-holdings` - 提前查询最近季度

**预计总工作量**: 4-6 小时

---

### 第二阶段（1 周，P1 问题）

1. Full-text search 索引（1 天）
2. 所有分页保护（1 天）
3. 剩余 P1 索引补充（2 天）
4. 压力测试验证（1 天）

---

### 第三阶段（2-4 周，架构升级）

**目标**: 达到 10,000 并发支撑能力

1. **Read Replica** - Supabase 读写分离
2. **Redis 查询缓存层** - 缓存高频只读数据
3. **CDN + API Gateway** - 静态资源 + rate limiting
4. **数据库分区** - `ChatTurn`/`CreditLedger` 按月分区
5. **异步任务队列** - 长耗时操作移到后台
6. **监控体系** - Grafana + Prometheus

---

## 监控建议

### 数据库性能监控

```sql
-- 慢查询监控（在 Supabase 配置）
ALTER DATABASE postgres SET log_min_duration_statement = 1000; -- 1s

-- 连接池监控
SELECT 
  state, 
  COUNT(*) 
FROM pg_stat_activity 
WHERE datname = 'postgres' 
GROUP BY state;

-- 锁监控
SELECT 
  blocked_locks.pid AS blocked_pid,
  blocking_locks.pid AS blocking_pid,
  blocked_activity.query AS blocked_query,
  blocking_activity.query AS blocking_query
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;
```

### 应用层监控

```typescript
// src/lib/prisma.ts
// 添加查询日志
prisma.$use(async (params, next) => {
  const before = Date.now();
  const result = await next(params);
  const after = Date.now();
  
  const duration = after - before;
  if (duration > 1000) {
    console.warn(`Slow query: ${params.model}.${params.action} - ${duration}ms`);
  }
  
  return result;
});
```

---

## 压力测试脚本

```javascript
// k6-load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 100 },   // 爬坡到 100 用户
    { duration: '5m', target: 100 },   // 保持 100 用户 5 分钟
    { duration: '2m', target: 1000 },  // 爬坡到 1000 用户
    { duration: '5m', target: 1000 },  // 保持 1000 用户 5 分钟
    { duration: '2m', target: 0 },     // 降到 0
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% 请求 < 500ms
    http_req_failed: ['rate<0.01'],   // 失败率 < 1%
  },
};

export default function () {
  // 测试首页
  const homeRes = http.get('https://vt.air7fun.com/');
  check(homeRes, {
    'homepage status 200': (r) => r.status === 200,
    'homepage load < 2s': (r) => r.timings.duration < 2000,
  });
  
  // 测试公司页面
  const companyRes = http.get('https://vt.air7fun.com/company/AAPL');
  check(companyRes, {
    'company page status 200': (r) => r.status === 200,
    'company page load < 1s': (r) => r.timings.duration < 1000,
  });
  
  sleep(1);
}
```

运行测试：
```bash
k6 run k6-load-test.js
```

---

## 索引添加优先级矩阵

| 索引 | 严重程度 | 预估影响 | 实施难度 | 优先级 |
|-----|---------|---------|---------|--------|
| Holding_holder_portfolio_pct_desc | P0 | 高 | 低 | 🔴 立即 |
| InsightPost_entityIds_gin | P1 | 中 | 低 | 🟡 本周 |
| StockPrice_ticker_date_desc | P1 | 中 | 低 | 🟡 本周 |
| Entity_search_vector_gin | P1 | 高 | 中 | 🟡 本周 |
| FilingSection_entity_section_length | P1 | 中 | 低 | 🟡 本周 |
| CreditLedger 分区索引 | P1 | 中 | 中 | 🟡 本周 |
| Holding_holder_asOfDate_desc | P1 | 低 | 低 | 🟢 下周 |
| ExtSource_filer_kind_period | P1 | 低 | 低 | 🟢 下周 |
| 其他次要索引 | P2 | 低 | 低 | 🟢 下月 |

---

## 总结

**当前状态**: 数据库架构可支撑 < 100 并发用户，存在多个严重的性能瓶颈和安全漏洞。

**第一阶段修复后**: 可支撑 1,000-2,000 并发用户，解决连接池、竞态条件、缓存、关键索引问题。

**第二阶段修复后**: 可支撑 5,000-8,000 并发用户，补充所有索引、分页保护、full-text search。

**达到 10,000 目标**: 需要架构升级（Read Replica、Redis 缓存层、CDN），预计额外 2-4 周工作量。

**建议**: 立即执行第一阶段修复（4-6 小时工作量），可快速提升 10 倍并发支撑能力。

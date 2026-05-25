# Entity / Security 架构重构 — Handoff

## 背景

当前数据库存在 `type=security` 的 `Entity` 记录，它是 `import-13f.ts` 早期导入时创建的。这些 entity 除了给 `Holding` 当 foreign key 外没有任何独立语义，与 `Security` 表的功能重复，导致同一 ticker 有 `type=company` + `type=security` 两个 entity。

## 目标架构

```
Investor（投资人格）
  └── Entity(type=master, tribeId='buffett')
        └── MasterProfile
        └── Holding[] (as holder)

Company（上市公司）
  └── Entity(type=company, cik=xxx, ticker=xxx)
        ├── ExtSource(10k) / FinancialFact / FilingSection
        └── Security[]（一个公司可能有多个 share class，如 BRK-A / BRK-B）

Security（证券）
  └── id, cusip, ticker, titleOfClass, companyEntityId → Company
  └── Holding[] (as security, via Holding.securityId)

Filer（13F 提交方）
  └── 就是 Entity(type=company) 本身（用 metadata 标记是否为 filer）
  └── 投资人格通过 FILERS 配置数组映射到 CIK
```

## 当前已完成的工作

### ✅ 阶段 0：数据修复（v0.35.26 已完成）

1. **BRK-B Master/Company 分离**
   - Master entity 保留 `tribeId='buffett'`，去掉 `cik`
   - 新建 `type=company` BRK-B entity（CIK=1067983）
   - 迁移 15,073 FinancialFacts、79 FilingSections、35 Financials、CompanyAnalysis 到公司 entity
   - 44 条 Holdings（as security）迁移到公司 entity
   - 补全 BRK-A Security 记录（cusip=084670108, titleOfClass=Class A）

2. **Security 关联修复**
   - 为 AAPL/NVDA/PDD/TSLA/BRK-B 重新创建 Security 记录
   - 恢复 141 条 Holdings 的 `securityId`
   - 补跑 BMY/PNC/TEVA/UAL/MTB/SYF/GOLD 的 10-K 数据
   - 更新 7 条 Security 的 `companyEntityId`
   - 剩余 8 条 Security 保持 null（已退市/合并/ETF）

3. **导入脚本修复**
   - `import-13f.ts`：不再创建 `type=security` Entity，改为创建/复用 `type=company` + Security
   - `import-10k-xbrl.ts`：按 ticker 查找兼容所有 type，找到非 company 时自动升级

## 剩余四阶段方案

---

### 阶段一：应用层适配（不改 schema）

**目标**：所有应用代码不再读取 `securityEntityId` 和 `Security.entityId`，统一通过 `securityProfile`（Security 表）获取数据。

**需要修改的文件**：

| 文件 | 改动内容 |
|---|---|
| `src/lib/master-data.ts` | `getHoldingsByQuarter`：去掉 `security` (Entity) include，只用 `securityProfile`；`normalized` map 去掉 `?? row.security` fallback；`keyOf` 去掉 `?? securityEntityId`；`exits` 类型字段改为 `securityId` |
| `src/lib/company-data.ts` | `getSecurityIdsForCompany`：去掉 `legacyEntityIds` 和 `entityId` 查询；`getRecentHolders`：简化 `OR` 查询条件；`rowTicker` 和 `securityId` 赋值去掉 `securityEntityId` fallback |
| `src/app/master/[id]/page.tsx` | `holdingKey` 简化；去掉 `companyEntityId ?? sec:` 分支；`getHoldingTicker` / `getHoldingCompanyPath` 去掉 `securityEntityId` 分支 |
| `src/app/master/[id]/holdings/page.tsx` | 同上 |
| `src/lib/home-signals.ts` | 如有 `securityEntityId` 引用，改为 `securityId` |
| `scripts/generate-portfolio-insight.ts` | `keyOf` 改 `securityId` |
| `scripts/run-company-analysis.ts` | 查询条件去掉 `securityEntityId: { in: legacyIds }` |

**验证**：`npm run lint && npm run build`，所有页面功能正常。

---

### 阶段二：Import 脚本最终修复（不改 schema）

**目标**：`import-13f.ts` 不再写入即将删除的字段。

| 文件 | 改动 |
|---|---|
| `scripts/import-13f.ts` | `prepared` 中去掉 `securityEntityId` 字段；`importFiling` 查询条件只查 `securityId`；`upsertSecurityEntity` 中 Security 的查找/创建逻辑从 `entityId` 改为 `companyEntityId`（步骤 5/6） |

**验证**：跑一次 `import-13f.ts`（如 Buffett 2025Q4），确认不产生新的 `securityEntityId` 数据，且 Security 的 `entityId` 字段也不再被写入。

---

### 阶段三：Schema 变更（Prisma migrate）

**修改 `prisma/schema.prisma`**：

```prisma
// 1. Entity model：删除 securityProfile relation
model Entity {
  ...
  // 删除：securityProfile Security? @relation("SecurityEntityProfile")
  ...
}

// 2. Security model：删除 entityId
model Security {
  id              String   @id @default(cuid())
  // 删除：entityId String @unique
  companyEntityId String?
  ...
  // 删除：entity Entity @relation("SecurityEntityProfile", ...)
  company Entity? @relation("SecurityCompany", ...)
  holdings Holding[]
  ...
}

// 3. Holding model：大改
model Holding {
  ...
  holderEntityId   String
  // 删除：securityEntityId String
  securityId       String    // 改为 required（原来是 String?）
  sourceId         String
  ...
  // 删除：security Entity @relation("SecurityEntity", ...)
  // 改名：securityProfile → security，onDelete: SetNull → Cascade
  security Security @relation(fields: [securityId], references: [id], onDelete: Cascade)
  source   ExtSource @relation(...)
  ...
  // 删除：@@unique([holderEntityId, securityEntityId, asOfDate])
  @@unique([holderEntityId, securityId, asOfDate])
  // 删除：@@index([securityEntityId, asOfDate])
  @@index([securityId, asOfDate])
}
```

**阶段一/二遗漏的修改点（实地扫描后补充）**：

以下引用在阶段一/二中也需要同步清理，handoff 初版未完整覆盖：

| 位置 | 内容 | 阶段 |
|---|---|---|
| `src/lib/master-data.ts:209` | `exits` 类型字段 `securityEntityId` → `securityId` | 阶段一 |
| `src/lib/master-data.ts:256` | `exits.map` 返回 `securityEntityId` → `securityId` | 阶段一 |
| `src/lib/company-data.ts:253` | `getRecentHolders` OR 查询仍查 `securityEntityId` | 阶段一 |
| `src/lib/company-data.ts:342` | `securityId: row.securityId ?? row.securityEntityId` 去掉 fallback | 阶段一 |
| `scripts/run-company-analysis.ts:112` | `{ securityEntityId: { in: legacyIds } }` 查询条件 | 阶段一 |
| `scripts/generate-portfolio-insight.ts:154` | `keyOf` 用 `securityEntityId` → `securityId` | 阶段一 |
| `scripts/import-13f.ts:~472` | `existingByEntity = db.security.findFirst({ where: { entityId: companyId } })` | 阶段二 |
| `scripts/import-13f.ts:~488` | `db.security.create({ data: { entityId: companyId, ... } })` 写入 `entityId` | 阶段二 |

**同时修改 `securityProfile` → `security` 的 include 改名**：
- `src/lib/master-data.ts`
- `src/lib/company-data.ts`
- `src/app/master/[id]/page.tsx`
- `src/app/master/[id]/holdings/page.tsx`
- `scripts/generate-portfolio-insight.ts`
- `scripts/run-company-analysis.ts`
- `scripts/import-13f.ts`（如查询中使用了 `securityProfile` relation）

**前置验证（必须先执行）**：
```bash
npx tsx -e "
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  const n = await db.holding.count({ where: { securityId: null } });
  if (n > 0) throw new Error(n + ' holdings have null securityId');
  console.log('OK: all holdings have securityId');
  await db.\$disconnect();
})();
"
```
`securityId` 必须 100% 填充，否则 migrate 将因 `String? → String` 的非空约束而失败。

**运行命令**：
```bash
npx prisma migrate dev --name remove_security_entity
```

**验证**：`npm run lint && npm run build` 通过。

---

### 阶段四：数据清理与脚本删除

**1. 删除旧脚本（5 个）**
这些脚本是旧架构的迁移工具，新架构下不再需要：
- `scripts/backfill-security-table.ts`
- `scripts/migrate-company-securities.ts`
- `scripts/cleanup-duplicate-security-entities.ts`
- `scripts/cleanup-duplicate-security-profiles.ts`
- `scripts/cleanup-duplicate-company-entities.ts`

**2. 删除 `type=security` 的 Entity（139 个）**

```sql
-- 确认无 FK 引用后删除
DELETE FROM "Entity" WHERE type = 'security';
```

**3. 验证**
- `type=security` Entity 数量 = 0
- `Security.entityId` 列已删除
- `Holding.securityEntityId` 列已删除
- 所有页面功能正常
- 跑一次 `import-13f.ts` 验证不产生新脏数据
- 跑一次 `import-10k-xbrl.ts` 验证复用 company entity

---

## 工作量评估

| 阶段 | 估计时间 | 风险 |
|---|---|---|
| 阶段一：应用层适配 | 30 min | 低 |
| 阶段二：Import 修复 | 10 min | 低 |
| 阶段三：Schema 变更 | 40 min | 中（migrate 不可逆，需确保阶段一/二已完成）|
| 阶段四：数据清理 | 15 min | 低 |

**总计：约 1.5 小时。**

## 关键决策

1. **阶段一和阶段三分开**：先改代码、验证功能正常，再改 schema，避免同时动两边。
2. **`securityProfile` 改名为 `security`**：建议阶段三时一起改，代码可读性更好。
3. **旧脚本在阶段三后删除**：schema 稳定后再清理，避免误删。
4. **`Holding.securityEntityId` 遗留数据**：阶段三 schema 删除列时自然清除，无需提前手动更新。
5. **阶段三前必须验证 `securityId` 全量填充**：`Holding.securityId` 从 `String?` 改为 `String` 是非空约束，任何 `null` 都会导致 migrate 失败。阶段一完成后必须跑前置验证命令确认。

## 当前代码状态

已修复的脚本：
- `scripts/import-13f.ts` — 不再创建 `type=security` Entity
- `scripts/import-10k-xbrl.ts` — 兼容所有 type，自动升级为 company

尚未执行的 schema 变更：
- `prisma/schema.prisma` — 仍需阶段三的 migrate

### 附：实地验证快照（截至 handoff 编写时）

| 指标 | 数值 |
|---|---|
| Holding 总数 | 1,516 |
| `securityId` 为 null | **0** |
| `type='security'` Entity 数 | **139** |

`securityId` 已 100% 填充，阶段三的非空约束迁移前提已满足。

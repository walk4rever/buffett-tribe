# 公司 Onboarding 两阶段重构技术深入分析

## 执行摘要

经过代码审查，两阶段重构在技术上**完全可行**，但需要进行三个关键改造：

1. ✅ **拆分 `import-10k-edgartools.ts`**：可行，Entity + Financial 的创建与 FilingSection 的解析是独立步骤
2. ⚠️ **Job Queue 系统**：项目目前**没有**通用 Job Queue，仅有专用的 `FilingSectionExtractionJob` 表，需要扩展
3. ⚠️ **HK 市场货币单位**：强依赖年报 PDF，必须先下载年报才能解析货币，无法完全延后到 Phase 2

---

## 1. `import-10k-edgartools.ts` 的可拆分性分析

### 当前执行流程（US 市场）

```typescript
// 文件：scripts/import-10k-edgartools.ts
async function importEdgarToolsAnnualReports() {
  // 步骤 1：Python 脚本提取基础数据（edgartools）
  const extracted = await extractWithEdgarTools(ticker, fromYear, toYear);
  // 返回：{ title, profile, filings[], facts: CompanyFacts }
  
  // 步骤 2：创建/更新 Entity（数据库写入）
  const companyEntity = await upsertCompanyEntity(cik, ticker, extracted.title, extracted.profile);
  // 写入：Entity 表（canonicalName, ticker, sector, industry, exchange, metadata）
  
  // 步骤 3：逐个处理每年的 10-K 文件
  for (const filing of extracted.filings) {
    // 3a. 创建 ExtSource 记录
    const extSource = await upsertExtSource(entityId, cik, filing);
    
    // 3b. 下载 primary document HTML
    const html = await fetchSecText(cik, filing.accession, filing.primaryDocument);
    
    // 3c. 解析 Inline XBRL（用于补充财务数据）
    const inlineDoc = await parseInlineXbrlDocument(html);
    
    // 3d. 提取并存储 FilingSection（重量级操作）
    await upsertFilingSectionsFromHtml(
      entityId, 
      extSource.id, 
      cik, 
      filing.accession, 
      html,
      kind,
      primaryUrl,
      SECTION_CONCURRENCY  // 并发上传 R2
    );
    // 包括：HTML 切片、R2 上传、FilingSection 表写入
    
    // 3e. 下载并存储 filing index + attachments
    const { html: indexHtml, files: indexFiles } = await fetchFilingIndexFiles(...);
    await upsertFilingAttachments(...);
    
    // 3f. 根据 CompanyFacts + Inline XBRL 创建 Financial 记录
    for (const lineItem of LINE_ITEMS) {
      const value = findBestFactValue(facts, lineItem) ?? pickInlineFactWithUnit(inlineDoc, lineItem);
      await db.financial.upsert({
        where: { entityId_periodEnd_periodType_lineItem: {...} },
        create: { entityId, sourceId, periodEnd, periodType, lineItem, value, unit },
        update: { value, unit }
      });
    }
  }
}
```

### 关键发现

**✅ Phase 1 可以包含的操作**：
- `extractWithEdgarTools()`：调用 Python edgartools 提取结构化数据（**快速**，主要是 API 调用）
- `upsertCompanyEntity()`：创建 Entity（**快速**，单次数据库写入）
- `upsertExtSource()`：创建 ExtSource 记录（**快速**）
- `db.financial.upsert()`：写入 Financial 数据（**快速**，批量写入）

**❌ Phase 2 应延后的操作**：
- `fetchSecText()`：下载 HTML（**中速**，网络 I/O）
- `parseInlineXbrlDocument()`：解析 Inline XBRL（**中速**，DOM 解析）
- `upsertFilingSectionsFromHtml()`：**重量级**
  - 提取 10+ 个 section（Item 1, 1A, 7, 8 等）
  - 每个 section 上传到 R2
  - 写入 FilingSection 表
  - 并发度为 6，但仍是主要耗时点
- `fetchFilingIndexFiles()` + `upsertFilingAttachments()`：**中量级**

### 拆分方案

#### Phase 1: `import-10k-phase1.ts`
```typescript
async function importPhase1(ticker: string, fromYear: number, toYear: number) {
  // 1. 提取结构化数据（CompanyFacts + 基础信息）
  const extracted = await extractWithEdgarTools(ticker, fromYear, toYear);
  
  // 2. 创建 Entity
  const entity = await upsertCompanyEntity(cik, ticker, extracted.title, extracted.profile);
  
  // 3. 创建 ExtSource（每年一条记录）
  const extSources = await Promise.all(
    extracted.filings.map(filing => 
      upsertExtSource(entity.id, cik, filing)
    )
  );
  
  // 4. 批量写入 Financial（从 CompanyFacts）
  for (const filing of extracted.filings) {
    const extSource = extSources.find(s => s.accessionNumber === filing.accession);
    for (const lineItem of LINE_ITEMS) {
      const value = findBestFactValue(extracted.facts, lineItem, filing.reportDate);
      if (value) {
        await db.financial.upsert({
          where: { entityId_periodEnd_periodType_lineItem: {...} },
          create: { entityId: entity.id, sourceId: extSource.id, ... },
          update: { value, unit }
        });
      }
    }
  }
  
  // ❌ 跳过：FilingSection 下载、解析、上传
  // ❌ 跳过：Inline XBRL 解析（可选补充数据源）
  // ❌ 跳过：Filing attachments
  
  return { entityId: entity.id, extSourceIds: extSources.map(s => s.id) };
}
```

**预计耗时**：10-20 秒（主要是 edgartools Python 脚本 + 数据库写入）

#### Phase 2: `import-10k-phase2.ts`
```typescript
async function importPhase2(entityId: string, extSourceIds: string[]) {
  for (const extSourceId of extSourceIds) {
    const extSource = await db.extSource.findUnique({ where: { id: extSourceId } });
    const { cik, accessionNumber, primaryDocument } = extSource;
    
    // 1. 下载 primary document HTML
    const html = await fetchSecText(cik, accessionNumber, primaryDocument);
    
    // 2. 解析 Inline XBRL（补充 Financial 数据）
    const inlineDoc = await parseInlineXbrlDocument(html);
    await supplementFinancialsFromInlineXbrl(entityId, extSourceId, inlineDoc, extSource.periodEnd);
    
    // 3. 提取并存储 FilingSection
    await upsertFilingSectionsFromHtml(
      entityId,
      extSourceId,
      cik,
      accessionNumber,
      html,
      extSource.kind,
      primaryUrl,
      SECTION_CONCURRENCY
    );
    
    // 4. 下载并存储 attachments
    const { html: indexHtml, files: indexFiles } = await fetchFilingIndexFiles(cik, accessionNumber);
    await upsertFilingAttachments(entityId, extSourceId, indexFiles);
    if (extSource.kind === '40f') {
      await upsert40FAttachmentSections(entityId, extSourceId, cik, accessionNumber, indexFiles);
    }
  }
}
```

**预计耗时**：60-180 秒（取决于年份数量，主要是 R2 上传）

---

## 2. Job Queue 系统分析

### 当前状态

项目**没有**通用的 Job Queue 系统，仅有一个专用的 `FilingSectionExtractionJob` 模型：

```prisma
model FilingSectionExtractionJob {
  id                String    @id @default(cuid())
  sourceId          String    // 关联到 ExtSource
  extractionVersion Int
  status            String    @default("pending") // pending | running | success | failed | no_sections
  attempts          Int       @default(0)
  maxAttempts       Int       @default(1)
  sectionCount      Int       @default(0)
  lastError         String?
  lastErrorCode     String?
  workerId          String?
  lockedAt          DateTime?
  startedAt         DateTime?
  finishedAt        DateTime?
  nextRunAt         DateTime?
  lastDurationMs    Int?
  metadata          Json?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  source ExtSource @relation(fields: [sourceId], references: [id], onDelete: Cascade)

  @@unique([sourceId, extractionVersion])
  @@index([status, nextRunAt])
}
```

**用途**：专门用于处理 filing section 的后台提取（已有场景）

**限制**：
- 只能处理 FilingSection 提取任务
- 没有通用的 Job 类型系统
- 没有 worker 进程架构（需要手动运行 backfill 脚本）

### 三种实现方案

#### 方案 A：扩展现有 Job 表（推荐）

创建通用的 `OnboardingJob` 模型：

```prisma
model OnboardingJob {
  id            String    @id @default(cuid())
  entityId      String
  jobType       String    // 'import_filing_sections' | 'generate_profile' | 'generate_business' | ...
  status        String    @default("pending") // pending | running | success | failed
  priority      Int       @default(0)
  attempts      Int       @default(0)
  maxAttempts   Int       @default(3)
  payload       Json      // { ticker, force, ... }
  result        Json?     // 执行结果
  lastError     String?
  workerId      String?
  lockedAt      DateTime?
  startedAt     DateTime?
  finishedAt    DateTime?
  nextRunAt     DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  entity Entity @relation(fields: [entityId], references: [id], onDelete: Cascade)

  @@index([status, priority, nextRunAt])
  @@index([entityId, jobType])
  @@index([createdAt])
}
```

**实现**：
- 创建 `lib/onboarding-job-queue.ts`：Job 创建、查询、状态更新
- 创建 `scripts/onboarding-worker.ts`：轮询并执行 pending jobs
- 可以通过 `pm2` 或 `systemd` 运行 worker 进程

**优点**：
- 完全控制，无外部依赖
- 符合现有 `FilingSectionExtractionJob` 的架构风格
- 可以逐步迁移现有的 FilingSectionExtractionJob

**缺点**：
- 需要自己实现 worker 进程管理
- 缺少成熟 Queue 系统的高级特性（延迟、重试策略、监控）

#### 方案 B：引入 BullMQ（工业级）

```bash
npm install bullmq ioredis
```

**优点**：
- 生产级 Job Queue（基于 Redis）
- 自动重试、延迟、优先级、并发控制
- 内置监控面板（Bull Dashboard）

**缺点**：
- 引入 Redis 依赖（部署复杂度）
- 对于当前规模可能过重

#### 方案 C：简化版——直接调用（MVP）

**Phase 1 完成后直接异步触发 Phase 2**：

```typescript
// Phase 1 完成后
await importPhase1(ticker);

// 记录 Phase 2 状态
await db.entity.update({
  where: { ticker },
  data: {
    onboardingStage: 'phase2_pending',
    metadata: { phase2StartedAt: new Date().toISOString() }
  }
});

// 异步触发 Phase 2（不等待结果）
importPhase2(ticker).catch(err => {
  console.error(`Phase 2 failed for ${ticker}:`, err);
  db.entity.update({
    where: { ticker },
    data: { onboardingStage: 'phase2_failed', metadata: { phase2Error: err.message } }
  });
});

// 立即返回，用户可以访问 DVL 页面
```

**优点**：
- 最简单，无需 Job Queue
- 快速 MVP 验证

**缺点**：
- 进程退出会丢失任务
- 无法重试失败的任务
- 无法监控进度

### 推荐方案

**短期（MVP）**：方案 C（直接异步调用）
**中期（生产）**：方案 A（扩展 OnboardingJob 表）

---

## 3. HK/CN 市场货币单位依赖分析

### 问题根源

**CN 市场**：✅ 无问题
```typescript
export function resolveCnCurrency(): "CNY" {
  return "CNY";  // A股强制 RMB 报告，硬编码即可
}
```

**HK 市场**：⚠️ 强依赖年报 PDF
```typescript
export async function resolveHkCurrencyFromAnnualReport(entityId: string): Promise<"CNY" | "HKD" | "USD"> {
  // 1. 查询最新的 hk-annual-report ExtSource
  const latestSource = await db.extSource.findFirst({
    where: { filerEntityId: entityId, kind: "hk-annual-report" },
    orderBy: { periodYear: "desc" }
  });
  
  // 2. 读取 FilingSection 文本内容
  const sections = await db.filingSection.findMany({
    where: { entityId, sourceId: latestSource.id }
  });
  const text = sections.map(s => s.content).join("\n");
  
  // 3. 正则匹配货币关键词（"RMB"/"HK$"/"US$"）的频率
  // 4. LLM 分类（如果正则不确定）
}
```

**依赖链**：
```
import_financials (写入 Financial 表)
  ↓ 需要知道 currency
  ↓
resolveHkCurrencyFromAnnualReport()
  ↓ 需要读取 FilingSection.content
  ↓
import_annual_report (下载 PDF + 解析 FilingSection)
```

### 解决方案

#### 方案 1：HK 市场 Phase 1 必须包含年报下载（推荐）

**修改 Phase 1 范围**：

```typescript
// HK 市场的 Phase 1
async function onboardHkPhase1(ticker: string) {
  // 1. seed_entity
  await seedEntity(ticker);
  
  // 2. import_annual_report（完整执行，包括 PDF 下载）
  await importAnnualReport(ticker);  // ← 必须在 Phase 1
  
  // 3. import_financials（依赖步骤 2 的货币信息）
  const currency = await resolveHkCurrencyFromAnnualReport(entityId);
  await importFinancials(ticker, currency);
  
  // 4. import_price
  await importPrice(ticker);
  
  // 5. sync_name_map
  await syncNameMap(ticker);
}
```

**Phase 2 仅包含 LLM 生成**：
- `generate_company_profile`
- `generate_business_model`
- `generate_value_analysis`
- `generate_management_analysis`
- `generate_valuation_analysis`

**影响**：
- HK 市场的 Phase 1 会比 US 市场慢（增加 30-60 秒）
- 但仍比完整流程快（省去 5 个 LLM 步骤，节省 2-4 分钟）

#### 方案 2：默认货币 + 后续修正（不推荐）

```typescript
// Phase 1：猜测默认货币
const defaultCurrency = "HKD";  // 大部分港股用 HKD
await importFinancials(ticker, defaultCurrency);

// Phase 2：下载年报后修正
const actualCurrency = await resolveHkCurrencyFromAnnualReport(entityId);
if (actualCurrency !== defaultCurrency) {
  // 重新导入 Financial（更新 unit 字段）
  await reimportFinancials(ticker, actualCurrency);
}
```

**问题**：
- 泡泡玛特（09992）等 RMB 报告公司会在 Phase 1 显示错误数据
- 用户看到的 DVL 页面会先错后对，体验差

#### 方案 3：延迟货币依赖的计算（技术债）

```typescript
// Phase 1：仅导入原始数值，不设置 unit
await db.financial.create({
  entityId,
  periodEnd,
  lineItem: "Revenue",
  value: 12500000000,
  unit: null,  // ← 暂时为 null
});

// Phase 2：补充 unit
const currency = await resolveHkCurrencyFromAnnualReport(entityId);
await db.financial.updateMany({
  where: { entityId, unit: null },
  data: { unit: currency }
});
```

**问题**：
- DVL 页面在 Phase 1 无法显示正确的货币符号
- 违反数据完整性原则

### 推荐方案

**HK 市场采用方案 1**：Phase 1 包含年报下载

**性能对比**：

| 市场 | Phase 1 耗时 | Phase 2 耗时 | 总耗时 |
|------|-------------|-------------|--------|
| US   | 15-20s      | 2-4min      | 同左   |
| CN   | 15-25s      | 2-4min      | 同左   |
| HK   | 45-80s      | 2-4min      | 同左   |

HK 市场的 Phase 1 虽然较慢，但仍比当前完整流程的 3-7 分钟快得多。

---

## 4. 完整实现路线图

### 阶段 1：核心拆分（2-3 天）

**任务**：
- [ ] 实现 `scripts/import-10k-phase1.ts`（US 市场）
- [ ] 实现 `scripts/import-10k-phase2.ts`（US 市场）
- [ ] 修改 `scripts/onboard-company.ts` 支持 `--phase` 参数
- [ ] 数据库 migration：添加 `Entity.onboardingStage` 等字段
- [ ] 测试：选 3 家公司（AAPL, GOOGL, TSLA）验证拆分后数据完整性

**验收标准**：
- Phase 1 完成后 DVL 页面可正常展示核心卡片
- Phase 2 完成后所有内容与当前完整流程一致
- Phase 1 耗时 < 30 秒

### 阶段 2：HK/CN 市场支持（1-2 天）

**任务**：
- [ ] 分析 `import-cn-hk-financials-from-file.ts` 的拆分可行性
- [ ] 实现 HK 市场的 Phase 1（包含年报下载）
- [ ] 实现 CN 市场的 Phase 1
- [ ] 测试：茅台（600519.SS）、泡泡玛特（09992.HK）

**验收标准**：
- HK/CN 市场的 Phase 1 能正确解析货币单位
- 财务数据的 unit 字段正确（CNY/HKD/RMB）

### 阶段 3：Job Queue 集成（2-3 天）

**任务**：
- [ ] 创建 `OnboardingJob` Prisma 模型
- [ ] 实现 `lib/onboarding-job-queue.ts`
- [ ] 实现 `scripts/onboarding-worker.ts`
- [ ] Phase 2 步骤改为 Job 方式执行
- [ ] 添加 Job 状态查询 API：`GET /api/onboarding/status/:entityId`

**验收标准**：
- Phase 1 完成后自动创建 Phase 2 Jobs
- Worker 进程能自动消费 Jobs
- 失败的 Job 会自动重试（最多 3 次）

### 阶段 4：UI 渐进式加载（1-2 天）

**任务**：
- [ ] DVL 页面支持 `onboardingStage` 状态判断
- [ ] 添加 "生成中" skeleton 组件
- [ ] 可选：WebSocket 实时推送 Phase 2 完成通知
- [ ] 添加 "立即生成深度分析" 按钮（手动触发 Phase 2）

**验收标准**：
- Phase 1 完成后用户能立即访问 DVL 页面
- Phase 2 内容显示 loading 状态
- Phase 2 完成后页面自动刷新（或提示用户刷新）

### 阶段 5：迁移现有公司（1 天）

**任务**：
- [ ] 脚本：为所有已有 Financial 数据的公司标记 `onboardingStage = 'complete'`
- [ ] 脚本：为缺少 CompanyAnalysis 的公司补全 Phase 2 Jobs
- [ ] 批量执行缺失的 Phase 2 内容

**验收标准**：
- 所有现有公司的 DVL 页面正常展示
- 缺失的分析内容通过 Job Queue 补全

---

## 5. 风险与缓解

### 风险 1：Phase 1 数据不足导致 DVL 页面报错

**缓解**：
- DVL 页面代码添加 null check 和优雅降级
- CompanyNarrative 缺失时显示占位符，不报错
- BusinessCanvas 缺失时显示 "构建中" 文案

### 风险 2：Phase 2 失败率高

**缓解**：
- LLM 调用添加重试逻辑（最多 3 次）
- 每个 Job 独立执行，一个失败不影响其他
- 失败的 Job 记录详细错误日志

### 风险 3：HK 市场 Phase 1 仍然较慢

**缓解**：
- 优化年报 PDF 下载（并发下载多年份）
- 优化 FilingSection 解析（跳过非关键 section）
- 考虑引入 PDF 解析缓存

### 风险 4：用户在 Phase 2 未完成时就离开页面

**缓解**：
- 添加邮件/推送通知（Phase 2 完成后提醒用户）
- 下次访问时自动展示 Phase 2 新内容
- 首页 "最近更新" 区域高亮显示

---

## 6. 性能预测

### US 市场（以 AAPL 为例）

| 步骤 | 当前耗时 | Phase 1 | Phase 2 |
|------|----------|---------|---------|
| extract edgartools | 8s | 8s | - |
| upsert company | 1s | 1s | - |
| fetch HTML (5 年) | 15s | - | 15s |
| parse inline XBRL | 10s | - | 10s |
| upsert filing sections | 60s | - | 60s |
| upsert financials | 5s | 5s | - |
| import stock prices | 8s | 8s | - |
| generate profile | 25s | - | 25s |
| generate business | 40s | - | 40s |
| generate value | 35s | - | 35s |
| generate management | 30s | - | 30s |
| generate valuation | 30s | - | 30s |
| **总计** | **267s (4.5min)** | **22s** | **245s (4min)** |

**用户感知改善**：从等待 4.5 分钟 → 等待 22 秒

### HK 市场（以泡泡玛特为例）

| 步骤 | 当前耗时 | Phase 1 | Phase 2 |
|------|----------|---------|---------|
| seed entity | 2s | 2s | - |
| import annual report | 50s | 50s | - |
| import financials | 12s | 12s | - |
| import stock prices | 8s | 8s | - |
| 5× generate | 160s | - | 160s |
| **总计** | **232s (3.9min)** | **72s** | **160s (2.7min)** |

**用户感知改善**：从等待 3.9 分钟 → 等待 72 秒

---

## 7. 后续优化方向

### Phase 1 进一步优化

1. **并发下载多年份的 10-K**（US 市场）
   - 当前是串行处理每年，可以并发下载
   - 预计节省 20-30%

2. **Financial 数据批量写入**
   - 当前是逐条 upsert，可以批量 insert
   - 预计节省 10-20%

3. **缓存 CompanyFacts**
   - edgartools 每次都重新下载 company-facts.json
   - 可以缓存到本地，按日期刷新
   - 预计节省 30-40%

### Phase 2 进一步优化

1. **LLM 并发调用**
   - 5 个 generate 步骤可以并发执行
   - 受 Anthropic API rate limit 约束
   - 如果没有 rate limit，可节省 60%

2. **增量更新策略**
   - 已有 CompanyAnalysis 的公司，force=false 时跳过
   - 仅在财报更新时重新生成

3. **智能优先级调度**
   - 被 Alpha 大师持有的公司优先 Phase 2
   - 用户手动触发的立即执行
   - 其他公司低优先级后台慢慢完成

---

## 8. 结论

### 可行性评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 技术可行性 | ⭐⭐⭐⭐⭐ | 完全可行，代码架构支持拆分 |
| 实现难度 | ⭐⭐⭐ | 中等，主要是 Job Queue 集成 |
| 性能提升 | ⭐⭐⭐⭐⭐ | 用户感知时间减少 80-90% |
| 维护成本 | ⭐⭐⭐⭐ | 增加一定复杂度，但可控 |

### 投入回报比

**投入**：约 7-10 天开发 + 2-3 天测试
**回报**：
- 用户体验大幅提升（4.5 分钟 → 22 秒）
- 失败隔离（Phase 2 失败不影响 Phase 1）
- 成本优化（可选择性触发 Phase 2）

### 推荐决策

**✅ 强烈建议实施**

两阶段重构在技术上完全可行，且收益明显。唯一的权衡是 HK 市场的 Phase 1 需要包含年报下载（约 50-60 秒），但这仍比当前的 3-7 分钟快得多。

---

**文档版本**：v1.0  
**创建日期**：2026-09-22  
**作者**：Kiro AI Assistant  
**审核状态**：待用户确认

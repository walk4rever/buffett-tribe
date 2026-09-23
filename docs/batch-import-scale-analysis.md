# 批量导入全市场公司：数据源与规模化分析

## 执行摘要

**目标**：批量导入 12,000-15,000 家上市公司的基础数据（Entity + Financial + StockPrice），使 DVL 页面立即可访问。

**两大核心挑战**：
1. **数据源统一**：三个市场的数据来源、格式、质量差异巨大
2. **规模化并发**：如何在合理时间（< 24 小时）内高效完成 12,000+ 公司的导入

---

## 挑战 1：数据源异构性分析

### 1.1 美股（US Market）～5,000 家

#### 数据源
- **公司基础信息 + 财务数据**：SEC EDGAR API
  - Company Facts API：`https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json`
  - 包含：公司名称、CIK、SIC、行业、历史财务数据（XBRL facts）
  - 优点：官方数据，结构化，免费
  - 缺点：需要先知道 CIK，ticker → CIK 映射需要额外查询

- **股价数据**：Yahoo Finance API（通过 `yfinance` 库）
  - 优点：覆盖全面，历史数据完整
  - 缺点：非官方 API，可能限流

#### 当前实现
- ✅ `scripts/import-10k-edgartools.ts`：单个公司导入
- ❌ **缺少**：批量导入全市场的脚本

#### 批量导入挑战

**挑战 1.1.1：获取全市场 ticker 列表**
```
问题：如何获取美股所有上市公司的 ticker 列表？
方案：
  A. SEC EDGAR 公司列表：https://www.sec.gov/files/company_tickers.json
     - 包含所有注册公司（~12,000 家）
     - 包含 CIK、ticker、公司名称
     - 免费，官方
  B. 纳斯达克/NYSE 官方列表
     - ftp://ftp.nasdaqtrader.com/symboldirectory/nasdaqlisted.txt
     - 更新频率：每日
```

**挑战 1.1.2：SEC API Rate Limiting**
```
限制：
  - 官方文档：10 requests/second
  - User-Agent 必须包含联系邮箱
  - 违规会被暂时封禁

影响：
  - 5,000 家公司 × 2 请求（company facts + submissions）= 10,000 请求
  - 理论最快：10,000 / 10 = 1,000 秒 = 16.7 分钟
  - 实际（考虑网络延迟）：30-60 分钟

缓解方案：
  - 使用连接池（但尊重 rate limit）
  - 增量更新（只更新有新 filing 的公司）
  - 缓存 company facts（按日期过期）
```

**挑战 1.1.3：数据质量问题**
```
问题：
  - 部分公司的 Company Facts 缺少关键字段（Revenue、NetIncome）
  - XBRL 标签不统一（us-gaap vs ifrs-full）
  - 外国公司使用 20-F/40-F，数据结构不同

影响：
  - 预计 5-10% 的公司导入会失败或数据不完整

缓解方案：
  - 多标签映射（已实现：LINE_ITEMS 的 tagsUsGaap + tagsIfrs）
  - 失败公司记录到日志，人工复查
  - 降级处理：缺少 Financial 数据的公司仍创建 Entity（允许 DVL 展示基本信息）
```

#### 批量导入预估（美股）

| 维度 | 预估值 |
|------|--------|
| 总公司数 | 5,000 |
| 单个公司耗时 | 3-5 秒（仅 Entity + Financial + StockPrice） |
| 并发度 | 10（受 SEC rate limit 约束） |
| 总耗时 | 5,000 / 10 × 4s = **33 分钟** |
| 成功率 | 90-95% |

---

### 1.2 港股（HK Market）～2,500 家

#### 数据源
- **公司基础信息**：akshare API
  - `ak.stock_hk_spot_em()`：获取全部港股列表
  - `ak.stock_individual_info_em()`：单个公司详情
  - 优点：免费，覆盖全面
  - 缺点：非官方，稳定性未知

- **财务数据**：akshare API
  - `ak.stock_financial_hk_report_em()`：资产负债表、利润表、现金流量表
  - 优点：结构化数据
  - 缺点：
    - ⚠️ **字段映射不稳定**：不同行业的 STD_ITEM_CODE 不同
    - ⚠️ **货币单位需要从年报 PDF 解析**（见挑战 1.2.2）

- **年报 PDF**：港交所官网
  - `https://www1.hkexnews.hk/`
  - 需要：下载 PDF → 解析文本 → 正则匹配货币关键词

- **股价数据**：Yahoo Finance 或 akshare
  - `ak.stock_hk_daily()`
  - 优点：免费
  - 缺点：历史数据可能不全

#### 当前实现
- ✅ `scripts/fetch-cn-hk-financials-ak.py`：单个公司财务导入
- ✅ `scripts/fetch-hk-annual-report.py`：单个公司年报下载
- ❌ **缺少**：批量导入全市场的脚本

#### 批量导入挑战

**挑战 1.2.1：获取全市场股票代码列表**
```
方案：
  df = ak.stock_hk_spot_em()
  # 返回：代码、名称、最新价、涨跌幅等
  codes = df['代码'].tolist()  # ['00001', '00002', ..., '09988', '09992']
  
预计数量：~2,500 家
```

**挑战 1.2.2：货币单位依赖年报 PDF（核心难点）**
```
问题：
  - HK 公司报告货币不统一（HKD/CNY/USD）
  - 泡泡玛特（09992）港股上市但用 RMB 报告
  - akshare 的财务数据 API 不返回 currency 字段
  - 必须下载年报 PDF 才能判断货币

当前解决方案：
  1. 下载最新年报 PDF
  2. 提取文本内容
  3. 正则匹配 "RMB"/"HK$"/"US$" 频率
  4. LLM 分类（如果正则不确定）
  
  见：scripts/lib/cn-hk-currency-resolve.ts

批量导入困境：
  - 2,500 家公司 × 1 份年报 = 2,500 个 PDF
  - 单个 PDF 下载 + 解析：10-30 秒
  - 串行总耗时：2,500 × 20s = 13.9 小时 ❌
  - 并发（50 个）：2,500 / 50 × 20s = 16.7 分钟 ✅
  
  但问题：
    - 港交所网站可能限流
    - PDF 解析可能失败（格式不规范）
    - LLM 分类成本高（2,500 次调用）
```

**解决方案 A：预建货币映射表（推荐）**
```typescript
// 预先人工标注或批量识别一次，存储到数据库
model CompanyCurrencyMap {
  ticker    String @id  // "9992.HK"
  currency  String      // "CNY"
  source    String      // "annual-report-2024" | "manual"
  verifiedAt DateTime
}

批量导入时：
  1. 先查询 CompanyCurrencyMap
  2. 如果有记录，直接使用
  3. 如果没有，默认 HKD，标记为 "需要验证"
  4. 后台 Job 慢慢补全（下载年报 → 识别货币 → 更新映射表）
```

**解决方案 B：默认货币 + 后台修正**
```
Phase 1：
  - 默认 HKD（覆盖 80% 的港股）
  - Financial 数据写入时 unit = "HKD"
  
Phase 2（后台 Job）：
  - 下载年报识别真实货币
  - 如果不是 HKD，批量更新 Financial.unit
  
问题：
  - 用户可能看到错误的货币（暂时）
  - 需要 DVL 页面支持 "数据更新中" 提示
```

**挑战 1.2.3：akshare 稳定性未知**
```
问题：
  - akshare 是非官方爬虫库，可能被目标网站反爬
  - 批量请求可能触发限流
  
缓解方案：
  - 控制并发（20-50 个同时）
  - 添加随机延迟（500-2000ms）
  - 失败重试（最多 3 次）
  - 记录失败公司，后续手动处理
```

#### 批量导入预估（港股）

| 场景 | 方案 | 并发度 | 总耗时 |
|------|------|--------|--------|
| **含年报下载** | 完整识别货币 | 50 | **16-20 分钟** |
| **默认货币** | 跳过年报 | 100 | **5-8 分钟** |

推荐：**方案 B（默认货币 + 后台修正）**

---

### 1.3 A股（CN Market）～5,000 家

#### 数据源
- **公司基础信息**：akshare API
  - `ak.stock_zh_a_spot_em()`：获取全部 A 股列表
  - `ak.stock_individual_info_em()`：单个公司详情
  
- **财务数据**：akshare API（新浪财经数据源）
  - `ak.stock_financial_analysis_indicator()`：财务指标
  - 优点：结构化，字段相对统一
  - 缺点：列名是中文，需要映射

- **货币单位**：✅ **硬编码为 CNY**
  - A 股强制使用 RMB 报告（CSRC 规定）
  - 无需解析年报

- **股价数据**：akshare API
  - `ak.stock_zh_a_hist()`
  - 优点：免费，完整
  - 缺点：可能限流

#### 当前实现
- ✅ `scripts/fetch-cn-hk-financials-ak.py`：单个公司财务导入
- ✅ `scripts/lib/cn-hk-currency-resolve.ts`：`resolveCnCurrency()` 直接返回 "CNY"
- ❌ **缺少**：批量导入全市场的脚本

#### 批量导入挑战

**挑战 1.3.1：获取全市场股票代码列表**
```python
df = ak.stock_zh_a_spot_em()
# 返回：代码、名称、最新价、涨跌幅、成交量等
codes = df['代码'].tolist()  # ['000001', '000002', ..., '688999']

预计数量：~5,000 家（沪深京三市场）
```

**挑战 1.3.2：akshare 列名映射**
```python
# 已实现：scripts/fetch-cn-hk-financials-ak.py 的 CN_COLUMN_MAP
CN_COLUMN_MAP = {
    "营业收入": "Revenue",
    "归属于母公司所有者的净利润": "NetIncome",
    "基本每股收益": "EPSBasic",
    "资产总计": "TotalAssets",
    "负债合计": "TotalLiabilities",
    "所有者权益(或股东权益)合计": "ShareholdersEquity",
    "经营活动产生的现金流量净额": "OperatingCashFlow",
    # ...
}

问题：
  - 不同行业的模板可能有细微差异
  - 银行/保险的财报结构不同
  
预计失败率：5-10%
```

**挑战 1.3.3：akshare 批量请求限流**
```
问题：
  - 新浪财经后端可能有 rate limit
  - 批量请求可能触发反爬
  
缓解方案：
  - 并发控制（50-100 个）
  - 随机延迟（200-1000ms）
  - 失败重试
```

#### 批量导入预估（A股）

| 维度 | 预估值 |
|------|--------|
| 总公司数 | 5,000 |
| 单个公司耗时 | 2-4 秒（无需下载 PDF） |
| 并发度 | 100 |
| 总耗时 | 5,000 / 100 × 3s = **2.5 分钟** |
| 成功率 | 90-95% |

---

## 挑战 2：规模化并发导入架构

### 2.1 总体规模

| 市场 | 公司数 | 单个耗时 | 并发度 | 预估总耗时 |
|------|--------|----------|--------|-----------|
| 美股 | 5,000 | 4s | 10 | 33 分钟 |
| 港股（默认货币） | 2,500 | 3s | 100 | 8 分钟 |
| A股 | 5,000 | 3s | 100 | 2.5 分钟 |
| **总计** | **12,500** | - | - | **43.5 分钟** |

### 2.2 并发控制架构

#### 方案 A：简单并发池（推荐 MVP）

```typescript
// scripts/batch-import-us-market.ts
import pLimit from 'p-limit';

async function batchImportUsMarket() {
  // 1. 获取全市场 ticker 列表
  const tickers = await fetchAllUsTickers(); // SEC company_tickers.json
  
  // 2. 过滤已存在的公司
  const existing = await db.entity.findMany({
    where: { ticker: { in: tickers }, market: 'us' },
    select: { ticker: true }
  });
  const existingSet = new Set(existing.map(e => e.ticker));
  const toImport = tickers.filter(t => !existingSet.has(t));
  
  console.log(`Total: ${tickers.length}, Existing: ${existing.length}, To import: ${toImport.length}`);
  
  // 3. 并发导入（尊重 SEC rate limit）
  const limit = pLimit(10); // 10 concurrent
  const results = await Promise.allSettled(
    toImport.map(ticker => 
      limit(() => importSingleCompanyPhase1(ticker))
    )
  );
  
  // 4. 统计结果
  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected');
  
  console.log(`Succeeded: ${succeeded}, Failed: ${failed.length}`);
  
  // 5. 记录失败列表
  await fs.writeFile(
    'batch-import-us-failed.json',
    JSON.stringify(failed.map((r, i) => ({
      ticker: toImport[i],
      error: r.reason?.message
    })), null, 2)
  );
}

async function importSingleCompanyPhase1(ticker: string) {
  // 仅导入 Entity + Financial + StockPrice
  // 跳过 FilingSection 下载和 LLM 生成
  
  // 1. 从 SEC API 获取 Company Facts
  const facts = await getCompanyFacts(ticker);
  
  // 2. 创建 Entity
  const entity = await upsertCompanyEntity(facts.cik, ticker, facts.entityName, facts.profile);
  
  // 3. 批量写入 Financial
  for (const [lineItem, timeSeries] of Object.entries(facts.financials)) {
    for (const dataPoint of timeSeries) {
      await db.financial.upsert({
        where: {
          entityId_periodEnd_periodType_lineItem: {
            entityId: entity.id,
            periodEnd: dataPoint.end,
            periodType: 'FY',
            lineItem: lineItem
          }
        },
        create: { /* ... */ },
        update: { /* ... */ }
      });
    }
  }
  
  // 4. 导入股价数据
  await importStockPrices(ticker);
  
  // ❌ 跳过：FilingSection 下载
  // ❌ 跳过：LLM 生成
}
```

**优点**：
- 简单，易实现
- 使用 `p-limit` 控制并发
- 可以随时中断和恢复（通过过滤已存在的公司）

**缺点**：
- 进程退出会丢失所有进行中的任务
- 内存占用较高（12,000 个 Promise）

#### 方案 B：分批次 + Checkpoint（推荐生产）

```typescript
// scripts/batch-import-us-market.ts
async function batchImportUsMarket() {
  const BATCH_SIZE = 500;
  const CONCURRENCY = 10;
  
  const tickers = await fetchAllUsTickers();
  const checkpoint = await loadCheckpoint('us-market-import');
  
  // 从 checkpoint 恢复
  const startIndex = checkpoint?.lastCompletedIndex ?? 0;
  const remaining = tickers.slice(startIndex);
  
  console.log(`Resuming from index ${startIndex}, remaining: ${remaining.length}`);
  
  // 分批次处理
  for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
    const batch = remaining.slice(i, i + BATCH_SIZE);
    console.log(`\nBatch ${Math.floor(i / BATCH_SIZE) + 1}: processing ${batch.length} companies...`);
    
    const limit = pLimit(CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(ticker => limit(() => importSingleCompanyPhase1(ticker)))
    );
    
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    console.log(`Batch completed: ${succeeded}/${batch.length} succeeded`);
    
    // 更新 checkpoint
    await saveCheckpoint('us-market-import', {
      lastCompletedIndex: startIndex + i + batch.length,
      lastCompletedAt: new Date().toISOString(),
      totalSucceeded: (checkpoint?.totalSucceeded ?? 0) + succeeded
    });
  }
}
```

**优点**：
- 可中断和恢复
- 内存占用可控（每批次 500 个）
- Checkpoint 记录进度

**缺点**：
- 实现稍复杂

#### 方案 C：Job Queue（最健壮，但复杂）

```typescript
// 1. 创建 Jobs
async function createBatchImportJobs() {
  const tickers = await fetchAllUsTickers();
  
  for (const ticker of tickers) {
    await db.onboardingJob.create({
      data: {
        entityId: null, // 新公司还没有 entityId
        jobType: 'batch_import_phase1',
        payload: { ticker, market: 'us' },
        priority: 0,
        status: 'pending'
      }
    });
  }
}

// 2. Worker 消费 Jobs
async function batchImportWorker() {
  while (true) {
    const jobs = await db.onboardingJob.findMany({
      where: { status: 'pending', jobType: 'batch_import_phase1' },
      orderBy: { priority: 'desc' },
      take: 10
    });
    
    if (jobs.length === 0) {
      await sleep(5000);
      continue;
    }
    
    await Promise.allSettled(
      jobs.map(job => processJob(job))
    );
  }
}
```

**优点**：
- 最健壮：失败自动重试、进度追踪
- 多 worker 并发消费
- 可动态调整优先级

**缺点**：
- 需要先实现 Job Queue 系统
- 复杂度高

### 2.3 推荐实施方案

**短期（MVP，1-2 周）**：方案 B（分批次 + Checkpoint）
- 快速验证可行性
- 足够健壮（可中断恢复）
- 实现成本低

**中长期（3-6 个月）**：方案 C（Job Queue）
- 迁移到统一的 Job Queue 系统
- 支持增量更新、优先级调度
- 更好的监控和可观测性

---

## 挑战 3：数据质量保障

### 3.1 数据完整性检查

```typescript
// 导入后验证
async function validateImportedCompany(entityId: string) {
  const entity = await db.entity.findUnique({
    where: { id: entityId },
    include: {
      financials: { where: { periodType: 'FY' }, orderBy: { periodEnd: 'desc' }, take: 5 },
      stockPrices: { orderBy: { date: 'desc' }, take: 1 }
    }
  });
  
  const issues: string[] = [];
  
  // 检查 1：是否有财务数据
  if (entity.financials.length === 0) {
    issues.push('No financial data');
  }
  
  // 检查 2：是否有必须字段
  const requiredLineItems = ['Revenue', 'NetIncome', 'TotalAssets', 'ShareholdersEquity'];
  const latestYear = entity.financials[0];
  const lineItems = entity.financials.filter(f => f.periodEnd.getTime() === latestYear?.periodEnd.getTime()).map(f => f.lineItem);
  const missingItems = requiredLineItems.filter(item => !lineItems.includes(item));
  if (missingItems.length > 0) {
    issues.push(`Missing line items: ${missingItems.join(', ')}`);
  }
  
  // 检查 3：是否有股价数据
  if (entity.stockPrices.length === 0) {
    issues.push('No stock price data');
  }
  
  // 检查 4：财务数据合理性
  const revenue = entity.financials.find(f => f.lineItem === 'Revenue')?.value;
  const netIncome = entity.financials.find(f => f.lineItem === 'NetIncome')?.value;
  if (revenue && netIncome && Math.abs(Number(netIncome)) > Number(revenue)) {
    issues.push('NetIncome > Revenue (suspicious)');
  }
  
  return {
    entityId,
    ticker: entity.ticker,
    isValid: issues.length === 0,
    issues
  };
}
```

### 3.2 失败处理策略

| 失败类型 | 处理方式 |
|---------|---------|
| **网络超时** | 自动重试 3 次，间隔递增（1s/5s/15s） |
| **API 限流** | 等待后重试，记录到低优先级队列 |
| **数据缺失** | 创建 Entity 但标记为 `dataIncomplete` |
| **解析错误** | 记录错误日志，人工复查 |
| **未知错误** | 记录完整堆栈，跳过该公司 |

### 3.3 监控指标

```typescript
// 实时监控
interface BatchImportMetrics {
  totalCompanies: number;
  completed: number;
  succeeded: number;
  failed: number;
  successRate: number;
  avgDurationPerCompany: number;
  estimatedTimeRemaining: number;
  failuresByReason: Record<string, number>;
}
```

---

## 挑战 4：增量更新策略

批量导入完成后，如何保持数据更新？

### 4.1 更新频率

| 数据类型 | 更新频率 | 触发方式 |
|---------|---------|---------|
| **Entity 基础信息** | 月度 | Cron Job |
| **Financial（年报）** | 季度 | Cron Job |
| **StockPrice** | 每日 | Cron Job |
| **新上市公司** | 周度 | 增量导入 |

### 4.2 增量更新脚本

```typescript
// scripts/incremental-update-financials.ts
async function incrementalUpdateFinancials(market: 'us' | 'hk' | 'cn') {
  // 1. 查询所有需要更新的公司
  const companies = await db.entity.findMany({
    where: {
      market,
      // 最近 90 天没有更新财务数据
      updatedAt: { lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
    },
    select: { id: true, ticker: true }
  });
  
  console.log(`Found ${companies.length} companies need financial update`);
  
  // 2. 批量更新
  const limit = pLimit(50);
  await Promise.allSettled(
    companies.map(company => 
      limit(() => updateCompanyFinancials(company.ticker, market))
    )
  );
}
```

### 4.3 新上市公司检测

```typescript
// 每周运行一次
async function detectNewIpos(market: 'us' | 'hk' | 'cn') {
  // 1. 获取当前市场的所有 ticker
  const allTickers = await fetchAllTickers(market);
  
  // 2. 查询数据库已有的 ticker
  const existing = await db.entity.findMany({
    where: { market },
    select: { ticker: true }
  });
  const existingSet = new Set(existing.map(e => e.ticker));
  
  // 3. 找出新 ticker
  const newTickers = allTickers.filter(t => !existingSet.has(t));
  
  if (newTickers.length === 0) {
    console.log('No new IPOs detected');
    return;
  }
  
  console.log(`Detected ${newTickers.length} new IPOs: ${newTickers.join(', ')}`);
  
  // 4. 批量导入新公司
  const limit = pLimit(20);
  await Promise.allSettled(
    newTickers.map(ticker => 
      limit(() => importSingleCompanyPhase1(ticker))
    )
  );
}
```

---

## 实施路线图

### Phase 0：准备工作（1-2 天）

- [ ] 创建 `scripts/batch-import/` 目录
- [ ] 实现 `fetchAllUsTickers()`（从 SEC API）
- [ ] 实现 `fetchAllHkCodes()`（从 akshare）
- [ ] 实现 `fetchAllCnCodes()`（从 akshare）
- [ ] 准备 HK 货币映射表（预标注 100 家热门公司）

### Phase 1：单市场 MVP（3-5 天）

**优先级：A股（最简单）**

- [ ] 实现 `batch-import-cn-market.ts`
- [ ] 测试 100 家公司
- [ ] 测试 1,000 家公司
- [ ] 全量导入 5,000 家
- [ ] 数据质量验证

**验收标准**：
- 成功率 > 90%
- 总耗时 < 10 分钟
- DVL 页面能正常展示核心数据

### Phase 2：扩展到三市场（5-7 天）

- [ ] 实现 `batch-import-us-market.ts`
- [ ] 实现 `batch-import-hk-market.ts`（默认货币方案）
- [ ] 测试三市场并发导入
- [ ] 优化并发控制和错误处理

### Phase 3：HK 货币后台补全（3-5 天）

- [ ] 实现 `backfill-hk-currency.ts`
- [ ] 批量下载 HK 年报 PDF
- [ ] 识别货币并更新 Financial.unit
- [ ] 更新 CompanyCurrencyMap 表

### Phase 4：增量更新（2-3 天）

- [ ] 实现 `incremental-update-financials.ts`
- [ ] 实现 `detect-new-ipos.ts`
- [ ] 配置 Cron Jobs

---

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解方案 |
|------|------|------|---------|
| **SEC API 封禁** | 中 | 高 | 尊重 rate limit，添加 User-Agent |
| **akshare 反爬** | 中 | 高 | 控制并发，随机延迟，失败重试 |
| **HK 货币识别失败** | 高 | 中 | 默认 HKD，后台补全 |
| **数据质量差** | 中 | 中 | 验证逻辑，人工复查失败列表 |
| **磁盘空间不足** | 低 | 中 | 监控磁盘使用，及时清理临时文件 |
| **数据库连接池耗尽** | 中 | 高 | 使用连接池，控制并发 |

---

## 成本估算

### 计算资源

| 资源 | 需求 | 成本 |
|------|------|------|
| **CPU** | 4-8 核（并发处理） | 云服务器约 $50-100/月 |
| **内存** | 8-16 GB | 包含在云服务器 |
| **存储** | 100-200 GB（Financial + StockPrice） | 约 $10-20/月 |
| **网络** | 出站流量约 50-100 GB（初次导入） | 约 $5-10 |

### API 调用成本

| API | 调用次数 | 单价 | 总成本 |
|-----|---------|------|--------|
| **SEC EDGAR** | 免费 | $0 | $0 |
| **Yahoo Finance** | 免费（非官方） | $0 | $0 |
| **akshare** | 免费 | $0 | $0 |
| **LLM（货币识别）** | ~500 次（HK 不确定的公司） | $0.001/次 | **$0.5** |

**总成本**：初次导入约 **$65-130**，月度运营约 **$60-120**

---

## 结论

### 可行性评估

| 维度 | 评分 | 说明 |
|------|------|------|
| **技术可行性** | ⭐⭐⭐⭐ | 可行，但 HK 货币识别需要权衡 |
| **时间可行性** | ⭐⭐⭐⭐⭐ | 43.5 分钟内完成全市场导入 |
| **成本可行性** | ⭐⭐⭐⭐⭐ | 成本极低（主要是 API 免费） |
| **数据质量** | ⭐⭐⭐⭐ | 预计 90-95% 成功率 |

### 核心决策点

**HK 货币识别策略（二选一）**：

| 方案 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **A. 完整识别（下载年报）** | 数据准确 | 初次导入慢（+15 分钟） | ⭐⭐⭐ |
| **B. 默认货币 + 后台补全** | 初次导入快 | 暂时显示错误货币（~20%） | ⭐⭐⭐⭐⭐ |

**推荐：方案 B**
- 优先保证 DVL 页面快速可用
- 80% 的港股用 HKD，用户体验影响有限
- 后台慢慢补全，1-2 周内修正完毕

---

**文档版本**：v1.0  
**创建日期**：2026-09-22  
**作者**：Kiro AI Assistant  
**下一步**：等待用户确认 HK 货币策略后开始实施

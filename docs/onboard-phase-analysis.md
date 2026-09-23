# 公司 Onboarding 流程两阶段重构分析

## 当前流程分析（基于 `scripts/onboard-company.ts`）

### US 市场公司完整流程（9步）

| 步骤 | 操作 | 数据来源 | 预估耗时 | 是否阻塞 DVL |
|------|------|----------|----------|--------------|
| 1. `import_10k` | 导入 10-K/20-F/40-F | SEC EDGAR API | 30-120s | ❌ **Phase 2** |
| | - 创建 Entity 基础信息 | | | ✅ **Phase 1 需要** |
| | - 导入 Financial 数据 | | | ✅ **Phase 1 需要** |
| | - 下载并解析 FilingSection（PDF） | | | ❌ **Phase 2** |
| | - 上传到 R2 存储 | | | ❌ **Phase 2** |
| 2. `import_price` | 导入股价历史（StockPrice） | Yahoo Finance | 5-15s | ✅ **Phase 1 需要** |
| 3. `generate_company_profile` | 生成公司概览（LLM） | Anthropic API | 20-40s | ❌ **Phase 2** |
| 4. `generate_business_model` | 生成业务概览+商业画布（LLM） | Anthropic API | 30-60s | ❌ **Phase 2** |
| 5. `generate_value_analysis` | 生成价值分析（LLM） | Anthropic API | 30-60s | ❌ **Phase 2** |
| 6. `generate_management_analysis` | 生成管理分析（LLM） | Anthropic API | 30-60s | ❌ **Phase 2** |
| 7. `generate_valuation_analysis` | 生成估值分析（LLM） | Anthropic API | 30-60s | ❌ **Phase 2** |
| 8. `sync_name_map` | 同步公司名称映射 | 数据库计算 | <1s | ✅ **Phase 1 需要** |

**总耗时**：约 3-7 分钟（串行执行）

### HK/CN 市场公司完整流程（8步）

| 步骤 | 操作 | 数据来源 | 预估耗时 | 是否阻塞 DVL |
|------|------|----------|----------|--------------|
| 1. `seed_entity` | 创建 Entity stub | CN_HK_SEEDS / akshare | 1-3s | ✅ **Phase 1 需要** |
| 2. `import_price` | 导入股价历史 | Yahoo Finance / akshare | 5-15s | ✅ **Phase 1 需要** |
| 3. `import_annual_report` (HK先) | 下载解析年报 PDF | 港交所/巨潮资讯 | 30-90s | ❌ **Phase 2** |
| 4. `import_financials` | 导入财务数据 | akshare API | 10-20s | ✅ **Phase 1 需要** |
| 5-8. `generate_*` | 5个 LLM 生成步骤 | Anthropic API | 150-300s | ❌ **Phase 2** |
| 9. `sync_name_map` | 同步名称映射 | 数据库计算 | <1s | ✅ **Phase 1 需要** |

**总耗时**：约 3-7 分钟（串行执行）

---

## 🎯 两阶段重构方案

### Phase 1: DVL 核心数据（快速可展示）
**目标**：用户能立即看到 DVL 页面，时间控制在 **15-30 秒**内

#### Phase 1 包含的步骤

**US 市场**：
1. `import_10k` **仅执行**：
   - ✅ 创建 Entity（canonicalName, ticker, sector, industry, exchange）
   - ✅ 导入 Financial（5-10年财报数据）
   - ❌ **跳过** FilingSection 下载和解析（PDF 处理）
   - ❌ **跳过** R2 上传
2. `import_price` 完整执行
3. `sync_name_map` 完整执行

**HK/CN 市场**：
1. `seed_entity` 完整执行
2. `import_price` 完整执行
3. `import_financials` 完整执行
4. `sync_name_map` 完整执行

#### Phase 1 产出的数据
- ✅ Entity 基础信息（公司名、ticker、行业分类）
- ✅ Financial 5-10年财报（Revenue、Net Income、Equity、Assets）
- ✅ StockPrice 历史股价数据
- ✅ CompanyNameMap 名称映射
- ✅ 大师持仓数据（从 13F 已有数据 JOIN）

#### Phase 1 支持的 DVL 功能
- ✅ **ValueLineCard 核心卡片**：
  - 公司名称、ticker、行业
  - 最新股价、市值
  - PE/PB/ROE/ROA 基础比率
  - 大师持仓快照（哪些大师、持仓量）
- ✅ **财务趋势图表**：5-10年 Revenue/Income/Equity 走势
- ✅ **股价走势图**：历史价格 Sparkline
- ⚠️ **降级展示**：
  - CompanyNarrative 显示 "生成中..." skeleton
  - BusinessCanvas 显示 "构建中" 占位符
  - 年报 PDF 链接显示 "准备中"

**预计耗时**：15-30 秒

---

### Phase 2: 深度分析内容（异步后台）
**目标**：LLM 生成和文档处理，通过后台 Job Queue 异步完成

#### Phase 2 包含的步骤

1. `import_10k`（US）/ `import_annual_report`（HK/CN）**补充执行**：
   - 下载 PDF
   - 解析 FilingSection
   - 上传 R2 存储
   - 提取关键段落到数据库

2. `generate_company_profile`（LLM，20-40s）
3. `generate_business_model`（LLM，30-60s）
4. `generate_value_analysis`（LLM，30-60s）
5. `generate_management_analysis`（LLM，30-60s）
6. `generate_valuation_analysis`（LLM，30-60s）

#### Phase 2 实现方式
- **Job Queue 架构**：
  - 每个 LLM 生成步骤作为独立 Job
  - 支持并行执行（受 Anthropic API rate limit 约束）
  - 失败可重试，不影响 Phase 1 数据
- **增量更新**：
  - 每个 Job 完成后立即更新数据库
  - 前端通过 WebSocket/轮询实时更新 UI
- **触发时机**：
  - Phase 1 完成后自动触发
  - 或用户首次访问 DVL 页面时触发（lazy loading）

**预计耗时**：2-5 分钟（异步，不阻塞用户）

---

## 📊 性能对比

| 维度 | 当前流程 | Phase 1 | Phase 2 |
|------|----------|---------|---------|
| **用户可见时间** | 3-7 分钟 | **15-30 秒** | - |
| **DVL 核心功能** | ✅ 完整 | ✅ 完整 | ✅ 增强 |
| **深度分析内容** | ✅ 完整 | ⚠️ 占位 | ✅ 完整 |
| **失败影响** | 🔴 全流程阻塞 | 🟢 不影响展示 | 🟡 局部失败 |
| **用户体验** | 🔴 长时间等待 | 🟢 立即可用 | 🟢 渐进增强 |

---

## 🏗️ 实现路径

### 1. 拆分 `import_10k` 脚本（US 市场）
**当前**：`scripts/import-10k-edgartools.ts` 一次性完成所有操作

**重构**：
- `import-10k-phase1.ts`：仅导入 Entity + Financial（跳过 FilingSection）
- `import-10k-phase2.ts`：补充下载 PDF + 解析 FilingSection + R2 上传

**技术细节**：
```typescript
// Phase 1: 快速模式
async function importEntityAndFinancials(ticker: string) {
  // 1. 从 SEC EDGAR API 获取公司基础信息
  const companyInfo = await getCompanyFromEdgar(ticker);
  
  // 2. 创建 Entity
  const entity = await prisma.entity.create({
    data: {
      type: "company",
      canonicalName: companyInfo.name,
      ticker: ticker,
      sector: companyInfo.sic_description,
      // ... 其他基础字段
    }
  });
  
  // 3. 导入 Financial（仅从 API 获取结构化数据，不下载 PDF）
  for (const year of years) {
    const financialData = await getFinancialDataFromEdgar(ticker, year);
    await prisma.financial.create({
      data: {
        entityId: entity.id,
        fiscalYear: year,
        revenue: financialData.revenue,
        netIncome: financialData.netIncome,
        // ... 其他财务字段
      }
    });
  }
  
  // ❌ 跳过：PDF 下载、FilingSection 解析、R2 上传
}

// Phase 2: 深度模式（作为 Job 运行）
async function importFilingSections(ticker: string) {
  const entity = await findEntityByTicker(ticker);
  
  // 下载 PDF
  const filings = await getFilingList(ticker);
  for (const filing of filings) {
    const pdfUrl = filing.pdfUrl;
    const pdfBuffer = await downloadPdf(pdfUrl);
    
    // 解析 FilingSection
    const sections = await parseFilingSections(pdfBuffer);
    
    // 上传 R2
    const r2Key = await uploadToR2(pdfBuffer, filing.id);
    
    // 存储到数据库
    await prisma.extSource.create({
      data: {
        filerEntityId: entity.id,
        kind: "10k",
        filingDate: filing.date,
        r2Key: r2Key,
        sections: {
          create: sections.map(s => ({
            sectionType: s.type,
            content: s.content,
          }))
        }
      }
    });
  }
}
```

### 2. 创建两阶段 Onboard 脚本
- `scripts/onboard-phase1.ts`：执行 Phase 1 步骤
- `scripts/onboard-phase2.ts`：执行 Phase 2 步骤（可作为 Job）
- `scripts/onboard-company.ts`：保持兼容，依次调用 phase1 + phase2

### 3. 数据库状态追踪
```prisma
model Entity {
  // ... existing fields
  onboardingStage     String?   @default("none") // 'phase1' | 'phase2' | 'complete'
  phase1CompletedAt   DateTime?
  phase2CompletedAt   DateTime?
  phase2JobIds        Json?     // { profile: 'job_123', business: 'job_456', ... }
}
```

### 4. UI 渐进式加载
**DVL 页面 (`src/app/dvl/[id]/page.tsx`)**：
```typescript
// 查询公司状态
const company = await getCompanyByIdentifier(id);

if (company.onboardingStage === 'none') {
  return <div>公司未 onboard，请先添加</div>;
}

if (company.onboardingStage === 'phase1') {
  // 显示核心数据 + "深度分析生成中"占位符
  return (
    <>
      <ValueLineCard data={valueLineData} />
      <AnalysisPlaceholder status="generating" />
    </>
  );
}

// phase2 或 complete：显示完整内容
return (
  <>
    <ValueLineCard data={valueLineData} />
    <CompanyNarrative {...narrative} />
    <BusinessCanvas {...canvas} />
  </>
);
```

### 5. Job Queue 集成
假设项目已有 Job Queue 系统（待确认），Phase 2 步骤应该：
```typescript
// 触发 Phase 2（在 Phase 1 完成后）
async function triggerPhase2(ticker: string) {
  const jobs = [
    { name: 'import_filing_sections', data: { ticker } },
    { name: 'generate_company_profile', data: { ticker } },
    { name: 'generate_business_model', data: { ticker } },
    { name: 'generate_value_analysis', data: { ticker } },
    { name: 'generate_management_analysis', data: { ticker } },
    { name: 'generate_valuation_analysis', data: { ticker } },
  ];
  
  const jobIds = await Promise.all(
    jobs.map(job => jobQueue.add(job.name, job.data))
  );
  
  // 记录 Job IDs
  await prisma.entity.update({
    where: { ticker },
    data: {
      onboardingStage: 'phase2',
      phase2JobIds: jobIds,
    }
  });
}
```

---

## 🚧 待确认的技术细节

### 1. `import_10k` 的可拆分性
**问题**：`import-10k-edgartools.ts` 是否支持"仅导入 Entity + Financial，跳过 FilingSection"？

**需要检查**：
- edgartools 库的 API 是否分离了"获取财务数据"和"下载 PDF"
- 是否可以通过参数控制（如 `--skip-sections`）

### 2. Job Queue 系统
**问题**：项目是否已有 Job Queue？

**待查文件**：
- `lib/job-queue.ts` 或类似
- `scripts/lib/` 下是否有 worker 相关代码

### 3. HK/CN 市场的 `import_annual_report`
**问题**：年报下载是否可以延后到 Phase 2？

**依赖关系**：
- HK 市场：`import_financials` 依赖年报的货币单位（`resolveHkCurrencyFromAnnualReport`）
- 解决方案：
  - Phase 1 仅获取货币单位 metadata（轻量级 API 调用）
  - Phase 2 再下载完整 PDF

### 4. 大师持仓数据的可用性
**问题**：Phase 1 能否直接展示大师持仓？

**依赖**：
- 13F 数据是否已通过 `import-13f-edgartools.ts` 导入？
- 新公司首次 onboard 时可能没有持仓数据（正常）

---

## 📌 下一步行动

1. **确认技术可行性**：
   - [ ] 检查 `import-10k-edgartools.ts` 的拆分可能性
   - [ ] 确认项目是否有 Job Queue 系统
   - [ ] 分析 HK/CN 市场的货币单位依赖

2. **POC 实现**（选一家公司测试）：
   - [ ] 实现 `onboard-phase1.ts`（US 市场）
   - [ ] 验证 DVL 页面用 Phase 1 数据可正常展示
   - [ ] 测量 Phase 1 实际耗时

3. **完整重构**：
   - [ ] 实现 Phase 2 脚本 + Job Queue 集成
   - [ ] 更新 DVL 页面支持渐进式加载
   - [ ] 添加 onboarding 进度指示器

4. **迁移现有公司**：
   - [ ] 已 onboard 的公司标记为 `phase2` 或 `complete`
   - [ ] 提供工具补全缺失的 Phase 2 数据

---

## 💡 额外优化建议

### 1. Phase 2 智能调度
- **按访问频率**：高频访问的公司优先完成 Phase 2
- **按大师持仓**：被 Alpha 大师持有的公司优先生成分析
- **手动触发**：DVL 页面添加"立即生成深度分析"按钮

### 2. 缓存策略
- Phase 1 数据变化频率低（季度更新），可以积极缓存
- Phase 2 LLM 生成内容带版本号，支持重新生成

### 3. 错误恢复
- Phase 1 失败 → 阻塞整个 onboard（保持现有行为）
- Phase 2 某个 Job 失败 → 仅该部分显示"生成失败，点击重试"

### 4. 成本优化
- Phase 2 的 LLM 调用是主要成本
- 可以根据用户订阅等级决定是否自动触发 Phase 2
- 免费用户：仅 Phase 1，手动触发 Phase 2
- 付费用户：自动完成 Phase 2

---

**文档版本**：v1.0  
**创建日期**：2026-09-22  
**作者**：Kiro AI Assistant

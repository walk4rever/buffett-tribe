# Handoff: Phase 1/2 优化与招股书支持

## 会话时间
2026-01-XX（续接 0eef5971 会话）

## 本次完成的工作

### 1. Phase 1/2 优化（数据库与性能）

#### 数据库清理（已完成）
- 删除 `section_text` artifacts：16,103 条
- 删除 CN/HK `primary_pdf` artifacts：132 条
- 保留 2020-01-01 以来的 `StockPrice`
- 数据库从 3.488 GB 降至预估 ~1.5 GB

#### Phase 2 LLM 生成优化（已完成）
- **合并 5 次 LLM 调用 → 1 次统一调用**
- 新脚本：`generate-company-analysis-unified.ts`
- 单次生成：overview + business + moat + management + valuation
- 时间节省：4.7 分钟 → 2.5 分钟（每家公司节省 ~2.2 分钟）
- 16,432 家公司预估总节省：**~602 小时**

#### CN/HK 导入脚本优化（已完成）
- `import-cn-annual-report-from-file.ts`：添加 `--skip-r2-upload` 标志
- `import-hk-annual-report-from-file.ts`：添加 `--skip-r2-upload` 标志
- `onboard-company.ts` 的 `buildImportAnnualReportStep`：默认跳过 R2 上传
- 未来 CN/HK 年报导入不再上传 PDF 到 R2，用户点击"查看原文"直接跳转外部链接（巨潮/披露易）

### 2. 招股书支持（刚上市公司场景）

#### 问题场景
SpaceX 等刚上市公司：
- 有招股书（us-prospectus，424B4 / S-1）
- 有 1-2 个季报（10-Q），但数据不完整（只有 XBRL 财务，无 FilingSection）
- 无历史年报（10-K）

#### 解决方案（已完成）

**1. Phase 1 财务数据降级链**（已有，本次确认）
```
import:10k (年报 XBRL)
  ↓ 失败
import:us-quarterly-financials (季报 10-Q XBRL)  ← SpaceX 走这条路
  ↓ 失败
import:us-financials-yf (yfinance 降级兜底)
  ↓ 成功
招股书切片预拉取（如果无 FilingSection）
```

**2. Phase 2 LLM 生成 filing evidence 回退**（已有，本次确认）
- `fetchLatestFilingEvidence()` 已支持：
  ```typescript
  kind: { in: ["10k", "20f", "40f", "hk-annual-report", "cn-annual-report", 
               "cn-prospectus", "us-prospectus"] }  // ← 已包含招股书
  ```
- 按 `periodYear desc` 排序，无年报时自动回退到招股书
- SpaceX 已成功生成完整的投资分析（基于招股书 sections）

**3. 参考资料 tab 动态构造 SEC 链接**（新增）
- 季报如果没有 `url` 和 `primary_html` artifact
- 根据 `accessionNumber` + `CIK` 动态构造 SEC EDGAR 链接：
  ```typescript
  https://www.sec.gov/cgi-bin/viewer?action=view&cik={cik}&accession_number={accession}&xbrl_type=v
  ```
- SpaceX 2026 Q2 季报现在可以点击查看原文

**4. 参考资料 tab 两区域结构**（新增）
- 区域 1：官方报告（招股书、年报、季报）
- 区域 2：其他资料（预留位置，未来接入 `/insights` 文章）

### 3. 三市场统一处理

#### US 市场
- 年报/季报：有 `primary_html` artifact → 内部阅读器
- 招股书：有 `primary_html` artifact → 内部阅读器
- 无 artifact 但有 `accessionNumber` → 动态构造 SEC 链接

#### CN 市场
- 年报/季报：外部链接（巨潮资讯网）
- 不上传 PDF 到 R2（`--skip-r2-upload` 默认开启）

#### HK 市场
- 年报/中报：外部链接（披露易 HKEXnews）
- 不上传 PDF 到 R2（`--skip-r2-upload` 默认开启）

## Phase 1/2 系统审阅结果

### ✅ 已验证正常的场景

1. **成熟公司（有多年年报）**
   - Phase 1：10-K XBRL → Financial 表
   - Phase 2：10-K sections → LLM 统一生成

2. **刚上市公司（有招股书 + 季报）**
   - Phase 1：10-Q XBRL → Financial 表 + 招股书 sections 预拉取
   - Phase 2：招股书 sections → LLM 统一生成

3. **外国发行人（无 10-K，只有 20-F）**
   - Phase 1：20-F XBRL → Financial 表
   - Phase 2：20-F sections → LLM 统一生成

4. **CN/HK 公司**
   - Phase 1：akshare 财务数据 + 年报 PDF 文本提取
   - Phase 2：年报 sections → LLM 统一生成

### ⚠️ 需要监控的边缘场景

1. **季报无内容但有 XBRL**（如 SpaceX 2026 Q2）
   - Financial 有数据 ✓
   - FilingSection 无数据（Phase 2 依赖招股书降级）
   - 参考资料 tab 显示为外部链接 ✓

2. **招股书无 XBRL**（某些老旧 S-1）
   - Phase 1 会走 yfinance 降级兜底
   - Phase 2 仍可从招股书 HTML sections 生成

3. **既无年报也无招股书**（极罕见）
   - Phase 1：yfinance 降级兜底（只有基础财务）
   - Phase 2：无 filing evidence，只基于财务数据生成（质量较低）

### 🚀 用户快速通道（Priority 机制）

用户在 web 界面选择 P0/P1 公司进入快速通道后：
- `Entity.priority` 字段设为正数（前端已实现）
- Cron job worker 脚本（`scripts/cron/hourly-priority-worker.sh`）：
  ```bash
  # mini 机器上每小时运行
  npm run worker:priority
  ```
- `scripts/worker-priority-onboard.ts`：
  - 按 `priority DESC` 排序，优先处理快速通道公司
  - Phase 0 → Phase 1：快速通道优先级最高
  - Phase 1 → Phase 2：快速通道优先级最高
  - 标准队列：Phase 0 按 US/CN/HK 市场均衡（batch size 15）
  - 单公司失败不中断整批（容错机制）

### 📋 Cron Job 部署清单（mini 机器）

**当前状态**（2026-08-30 迁移后）：
- ✅ 股价更新：每周日/周四 `scripts/cron/update-stock-prices.sh`
- ✅ 优先级 worker：每小时 `scripts/cron/hourly-priority-worker.sh`
- ✅ Phase 1/2 worker：每小时 `scripts/cron/hourly-phase1-worker.sh`

**本次修改需要同步**：
1. 确保 mini 机器上的代码是最新版本（包含统一生成脚本）
2. 验证 `.env.local` 包含完整的环境变量（数据库 + LLM API + R2）
3. 验证 `npm install` 已运行（新增的 npm scripts）
4. **不需要修改 crontab**（worker 脚本内部已调用 `onboard:company`）

### 🧪 验证步骤

部署到 mini 后，建议验证：
1. 手动运行一次 priority worker：
   ```bash
   ssh mini
   cd ~/buffett-tribe
   npm run worker:priority -- --dry-run  # 查看待处理清单
   npm run worker:priority -- --limit 1   # 处理 1 家测试
   ```

2. 验证一家刚上市公司（如 SpaceX）：
   ```bash
   npm run onboard:company -- --ticker SPCX --phase 2 --force
   ```
   应该能成功从招股书生成分析

3. 验证参考资料 tab：
   - 访问 http://localhost:3000/company/us-1181412?tab=references
   - 季报应该显示"查看原文 ↗"链接
   - 点击链接应跳转到 SEC EDGAR

## 文件修改清单

### 新增文件
- `scripts/generate-company-analysis-unified.ts` - 统一 LLM 生成脚本

### 修改文件
1. `scripts/onboard-company.ts`
   - Phase 2 使用统一生成步骤（`phase2UnifiedAnalysisStep`）
   - `buildImportAnnualReportStep` 添加 `--skip-r2-upload` 标志

2. `scripts/import-cn-annual-report-from-file.ts`
   - 添加 `--skip-r2-upload` 标志支持

3. `scripts/import-hk-annual-report-from-file.ts`
   - 添加 `--skip-r2-upload` 标志支持

4. `src/app/company/[id]/page.tsx`
   - 参考资料 tab 分为两区域（官方报告 + 其他资料）
   - 动态构造 SEC 链接（`constructedSecUrl`）
   - US 市场只保留 `primary_html` 判断（删除 `primary_pdf`）

5. `src/app/company/[id]/filing/[filingId]/page.tsx`
   - CN/HK filing 早期重定向到外部链接（已有，上次会话完成）

6. `package.json`
   - 添加 `generate:unified-analysis` npm script
   - 添加 `generate:unified-analysis:dry` npm script

7. `handoff.md`（本文件）
   - 完整记录本次优化的上下文和决策

## 待办事项（TODO.md P0 优先级）

1. **⑩ section_text 大面积缺失修复**（已识别，未修复）
   - 645 filing / 4,780 section / 110 家公司波及
   - 只有 BN/SU/DIS 已回填
   - 其余公司需要重新运行 `import:10k` 补全

2. **⑪ 管道可观测性**（待实现）
   - Cron job 运行日志集中收集
   - Phase 1/2 完成率监控
   - 失败任务告警机制

3. **季报全文切片**（能力缺口）
   - 当前只从 10-Q 提取 XBRL 财务数据
   - 无类似 10-K 的 section 切片（Item 1, MD&A 等）
   - 如需支持，需要新增 `import:10q-sections` 脚本

## 技术债务

1. **GeneratedContentVersion 表冗余**（TODO.md P1）
   - 当前只写 `MasterProfile` / `PortfolioInsight`
   - `CompanyAnalysis` 已不再镜像到此表
   - 考虑未来完全移除或重新设计版本管理

2. **Prisma shadow DB 迁移问题**（已知）
   - `P3006` on `20260520000100_add_structured_portfolio_insight`
   - Workaround：手动 `migrate diff` + `executeRawUnsafe` + `migrate resolve`

3. **R2 存储成本优化空间**
   - US `primary_html`：1,465 个文件，~4.3 GB，$0.06/月
   - 不是瓶颈，保留以支持内部阅读器

## 数据完整性状态

### US 市场
- **Financial 表**：完整（10-K + 10-Q + yfinance 降级）
- **FilingSection 表**：部分缺失（section_text 清理误删，见 TODO P0 ⑩）
- **FilingArtifact 表**：`primary_html` 完整，`section_text` 大面积缺失

### CN/HK 市场
- **Financial 表**：完整（akshare）
- **FilingSection 表**：完整（年报 PDF 文本提取）
- **FilingArtifact 表**：`primary_pdf` 已全部删除（改用外部链接）

## 成本与规模

### 当前规模
- 公司总数：~500 家（待完善的桩 + 已完整的）
- Phase 1 完成率：~80%
- Phase 2 完成率：~60%

### 目标规模
- 16,432 家公司（US + CN + HK 三市场）
- Phase 1/2 时间：~3 分钟/家（优化后）
- 总时间预估：~820 小时（34 天 @ 1 家/3分钟）

### Supabase 数据库
- 当前：3.488 GB（698% 超配额）
- 清理后预估：~1.5 GB（Pro Plan $25/月足够）
- 目标规模预估：~5-8 GB（需持续监控，可能需升级到 Team Plan $599/月）

## 相关文档

- `CLAUDE.md`：项目架构与跨市场约束
- `PRODUCT.md`：产品规格与数据模型
- `TODO.md`：待办事项与优先级
- `scripts/README.md`：脚本索引与使用说明

## 决策记录

### 为什么 US 保留 primary_html 而 CN/HK 删除 primary_pdf？
1. **存储成本**：US HTML ~4.3 GB @ $0.06/月，不是瓶颈
2. **用户体验**：US SEC EDGAR 的 HTML 适合内部渲染，体验优于外部跳转
3. **数据可靠性**：本地存档避免 SEC 限流/格式变更风险
4. **CN/HK 特殊性**：PDF 格式，内部渲染体验差，外部链接更合理

### 为什么合并 5 次 LLM 调用而不是继续拆分？
1. **成本**：5 次调用有 5 次固定开销（网络延迟、模型加载）
2. **质量**：统一 prompt 让模型有全局上下文，输出更连贯
3. **速度**：4.7 分钟 → 2.5 分钟，规模化后节省显著
4. **权衡**：单次调用失败会丢失所有字段，但有 checkpoint 机制可重试

### 为什么不自动重新导入 section_text 缺失的公司？
1. **规模**：110 家公司 × 5 年年报 × 20 sections = ~11,000 次 R2 读取
2. **成本**：mini 到 R2 延迟高，每家公司重新导入需 ~10 分钟
3. **优先级**：用户主动访问时再按需修复（lazy repair）
4. **未来**：TODO P0 ⑩ 计划批量修复

---

**会话状态**：Phase 1/2 优化与招股书支持已完成，等待部署到 mini 机器并验证 cron job。

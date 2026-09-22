# Business Essence 两行精华实现方案

## 背景

DVL（数字价值线）页面需要在顶部卡片展示公司的"两行精华"介绍，要求：
- 第一行：行业定位 + 核心产品/服务
- 第二行：营收结构 + 商业模式关键词
- 总字数：100-120 字
- 替代当前过长的"公司概览" section（180字），避免信息冗余

## 核心设计

### 单一数据源 + 批量生成

1. **数据库字段**：`CompanyAnalysis.businessEssence` (string, nullable)
2. **生成脚本**：`scripts/generate-business-essence.ts` - LLM 批量生成
3. **前端渲染**：直接读取 `businessEssence`，为 null 则显示占位符
4. **onboard 集成**：新公司入库时自动生成

---

## 1. 数据库 Schema 调整

### Prisma Schema 修改

```prisma
// prisma/schema.prisma

model CompanyAnalysis {
  id              Int      @id @default(autoincrement())
  entityId        Int      @unique
  version         Int      @default(1)
  
  // 现有字段
  profile         Json?
  business        Json?
  moat            Json?
  management      Json?
  valuation       Json?
  
  // 新增：两行精华（120字）
  businessEssence String?  @db.Text
  
  source          String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  entity          Entity   @relation(fields: [entityId], references: [id], onDelete: Cascade)
  
  @@index([entityId])
  @@map("company_analysis")
}
```

### 迁移命令

```bash
npx prisma migrate dev --name add_business_essence
```

---

## 2. 批量生成脚本

创建 `scripts/generate-business-essence.ts`：

```typescript
/**
 * 为所有公司生成 businessEssence（两行精华，120字）
 * 
 * 运行：
 *   npm run generate:essence           # 全量生成
 *   npm run generate:essence AAPL      # 单个生成
 *   npm run generate:essence --force   # 强制覆盖已有数据
 */

import db from "@/lib/prisma";
import { callDeepSeek } from "@/lib/deepseek"; // 复用现有 LLM 调用

const ESSENCE_PROMPT = `你是价值投资研究员，将公司信息浓缩为**两行精华**（总共 100-120 字）。

格式要求：
【第一行】行业定位 + 核心产品/服务（40-50字）
【第二行】FY{year} 营收 {金额}，收入结构占比，商业模式关键词（50-70字）

商业模式关键词示例：生态锁定、特许经营、浮存金再投资、规模经济、品牌溢价、轻资产、垂直整合

输入数据：
---
公司：{canonicalName}
行业：{sector}
最新财年：FY{latestYear}
最新营收：{latestRevenue}
现有简介：
{existingProfile}
---

直接输出两行文字，不要任何前缀、标题或解释。`;

async function generateEssence(entityId: number, force = false): Promise<string> {
  const company = await db.entity.findUnique({
    where: { id: entityId },
    include: { 
      companyAnalysis: true,
      financials: {
        orderBy: { fiscalYear: 'desc' },
        take: 1,
      }
    },
  });

  if (!company) throw new Error(`Entity ${entityId} not found`);

  // 已有 essence 且不强制覆盖
  if (company.companyAnalysis?.businessEssence && !force) {
    console.log(`✓ ${company.ticker} 已有 essence，跳过`);
    return company.companyAnalysis.businessEssence;
  }

  // 提取必要数据
  const meta = company.metadata as Record<string, any> ?? {};
  const latestFinancial = company.financials[0];
  const latestYear = latestFinancial?.fiscalYear ?? null;
  const latestRevenue = latestFinancial?.items?.Revenue 
    ? `$${(Number(latestFinancial.items.Revenue) / 1e9).toFixed(1)}B`
    : "待补充";

  const existingProfile = 
    (company.companyAnalysis?.profile as any)?.content ??
    (company.companyAnalysis?.business as any)?.summary ??
    "";

  const prompt = ESSENCE_PROMPT
    .replace("{canonicalName}", company.canonicalName)
    .replace("{sector}", company.sector ?? "多元化")
    .replace("{latestYear}", String(latestYear ?? "最新"))
    .replace("{latestRevenue}", latestRevenue)
    .replace("{existingProfile}", existingProfile.slice(0, 500)); // 截取前500字避免超长

  console.log(`🤖 生成 ${company.ticker} 的 essence...`);
  
  const essence = await callDeepSeek(prompt, {
    model: "deepseek-chat", // 便宜快速的模型
    max_tokens: 200,
    temperature: 0.3,
  });

  const cleaned = essence.trim();

  // 写入数据库
  await db.companyAnalysis.upsert({
    where: { entityId: company.id },
    create: {
      entityId: company.id,
      businessEssence: cleaned,
      source: "deepseek-chat",
    },
    update: {
      businessEssence: cleaned,
      updatedAt: new Date(),
    },
  });

  console.log(`✓ ${company.ticker} 生成完成：${cleaned.slice(0, 50)}...`);
  return cleaned;
}

async function main() {
  const args = process.argv.slice(2);
  const ticker = args.find(a => !a.startsWith("--"));
  const force = args.includes("--force");

  if (ticker) {
    // 单个生成
    const company = await db.entity.findFirst({
      where: { ticker: ticker.toUpperCase() },
    });
    if (!company) {
      console.error(`❌ 未找到 ticker: ${ticker}`);
      process.exit(1);
    }
    await generateEssence(company.id, force);
  } else {
    // 批量生成所有"完整"公司
    const companies = await db.entity.findMany({
      where: {
        type: "company",
        financials: { some: {} }, // 至少有一条财务数据
      },
      orderBy: { ticker: 'asc' },
    });

    console.log(`📊 共 ${companies.length} 家公司需要处理\n`);

    for (const company of companies) {
      try {
        await generateEssence(company.id, force);
        await new Promise(r => setTimeout(r, 500)); // 限速，避免 API rate limit
      } catch (err) {
        console.error(`❌ ${company.ticker} 失败:`, err);
        continue;
      }
    }

    console.log(`\n✅ 批量生成完成`);
  }
}

main().catch(console.error).finally(() => db.$disconnect());
```

### 添加到 package.json

```json
{
  "scripts": {
    "generate:essence": "node --env-file=.env.local ./node_modules/.bin/tsx scripts/generate-business-essence.ts"
  }
}
```

---

## 3. 前端读取逻辑

### 修改 `lib/value-line-data.ts`

```typescript
export type ValueLineData = {
  // ... 现有字段
  businessEssence: string | null; // 新增
}

export async function getValueLineData(entityId: number): Promise<ValueLineData | null> {
  const company = await db.entity.findUnique({
    where: { id: entityId },
    include: { 
      companyAnalysis: true,
      // ...
    },
  });

  if (!company) return null;

  return {
    // ... 其他字段映射
    businessEssence: company.companyAnalysis?.businessEssence ?? null,
  };
}
```

### 修改 `components/ValueLineCard.tsx`

```tsx
export function ValueLineCard({ data }: ValueLineCardProps) {
  return (
    <article className="value-line-card">
      <header className="vl-card-head">
        {/* ... 标题、价格等 */}
      </header>

      {/* 两行精华 */}
      {data.businessEssence ? (
        <section className="vl-business-essence">
          <p className="vl-essence-text">{data.businessEssence}</p>
        </section>
      ) : (
        <section className="vl-business-essence vl-business-essence--placeholder">
          <p className="vl-essence-text">
            {data.sector ? `${data.sector}公司` : "公司"}业务精华正在生成中，可查看下方深度分析。
          </p>
        </section>
      )}

      {/* 大师持仓卡片 */}
      {data.topHolders.length > 0 ? (
        // ...
      ) : null}

      {/* 价格走势图 */}
      <section className="vl-card-chart-block">
        {/* ... */}
      </section>

      {/* ... 其余部分 */}
    </article>
  );
}
```

---

## 4. 集成到 onboard 流程

修改 `scripts/onboard-company.ts`，在生成 profile/business 后立即生成 essence：

```typescript
// onboard-company.ts

const STEPS = [
  // ... 现有步骤
  { id: 'generate-profile', name: '生成公司档案' },
  { id: 'generate-business', name: '生成商业分析' },
  
  // 新增步骤
  { id: 'generate-essence', name: '生成两行精华', fn: async () => {
    await exec(`npm run generate:essence ${ticker}`);
  }},
  
  { id: 'generate-moat', name: '生成护城河分析' },
  // ...
];
```

---

## 5. 样式定义

```css
/* src/styles/dvl.css 或 globals.css */

.vl-business-essence {
  margin: 16px 0;
  padding: 14px 18px;
  background: linear-gradient(to right, rgba(0, 113, 227, 0.04), transparent);
  border-left: 3px solid var(--apple-blue);
  border-radius: 6px;
}

.vl-essence-text {
  font-size: 15px;
  line-height: 1.65;
  color: var(--apple-near-black);
  margin: 0;
}

.vl-business-essence--placeholder .vl-essence-text {
  color: rgba(0, 0, 0, 0.4);
  font-style: italic;
}

@media (max-width: 640px) {
  .vl-essence-text {
    font-size: 14px;
  }
}
```

---

## 实际示例

### 苹果（AAPL）
```
全球高端消费电子与数字生态平台，核心产品包括 iPhone、Mac、iPad、
Apple Watch 及服务订阅。FY2024 营收 $391B，其中 iPhone 占 52%、
服务占 22%，商业模式依赖硬件销售驱动的生态锁定与高频复购。
```

### 可口可乐（KO）
```
全球软饮料龙头，拥有 200+ 品牌覆盖碳酸饮料、果汁、茶饮、运动饮料。
FY2023 营收 $46B，其中可口可乐品牌占 45%，通过特许经营与浓缩液销售
实现低资本开支、高 ROE 的轻资产模式。
```

### 伯克希尔·哈撒韦（BRK.B）
```
多元化控股集团，核心业务包括保险（GEICO、再保险）、铁路运输（BNSF）、
能源及 200+ 运营子公司。FY2023 营收 $364B，投资组合持仓 $354B，商业
模式依赖保险浮存金再投资与收购优质企业长期持有。
```

### 茅台（600519.SH）
```
中国高端白酒龙头，产品以飞天茅台为核心，占营收 90%+。FY2023 营收 
¥1,350 亿，毛利率 91%，商业模式依赖品牌稀缺性 + 经销商配额管控实现
持续提价与高利润率。
```

---

## 执行计划

### 第一步：Schema 迁移
```bash
# 添加字段到 Prisma schema
npx prisma migrate dev --name add_business_essence
```

### 第二步：批量生成现有公司
```bash
# 生成所有公司（预计 100+ 家 × $0.0001/次 ≈ $0.01）
npm run generate:essence

# 或分批执行（避免 API rate limit）
npm run generate:essence AAPL
npm run generate:essence BRK.B
# ...
```

### 第三步：验证效果
```bash
npm run dev
# 访问 /dvl/AAPL 查看效果
```

### 第四步：集成到 onboard
修改 `onboard-company.ts`，新公司自动生成 essence

---

## 设计优势

1. **单一数据源**：`CompanyAnalysis.businessEssence` 字段，不需要运行时拼接
2. **质量可控**：LLM 生成 + 人工可审核修改
3. **性能最优**：直接 SQL 读取，无需计算
4. **易维护**：想改某公司的 essence？直接更新数据库或重跑脚本
5. **可扩展**：未来可以加多语言版本（`businessEssenceEn`）

---

## 成本估算

- DeepSeek Chat 价格：~$0.0001/次（200 tokens）
- 100 家公司全量生成：~$0.01
- 新公司 onboard：每家 $0.0001

---

## 待办事项

- [ ] Prisma schema 添加 `businessEssence` 字段
- [ ] 创建 `scripts/generate-business-essence.ts`
- [ ] 修改 `lib/value-line-data.ts` 读取逻辑
- [ ] 修改 `components/ValueLineCard.tsx` 渲染逻辑
- [ ] 添加样式定义
- [ ] 批量生成现有公司的 essence
- [ ] 集成到 `onboard-company.ts` 流程
- [ ] 测试验证

---

## 相关文件

- Schema: `prisma/schema.prisma`
- 生成脚本: `scripts/generate-business-essence.ts`
- 数据获取: `src/lib/value-line-data.ts`
- UI 组件: `src/components/ValueLineCard.tsx`
- 样式: `src/styles/dvl.css` 或 `src/app/globals.css`
- Onboard 流程: `scripts/onboard-company.ts`

# 巴菲特部落 · Buffett Tribe

> 买股票就是买公司。用价值投资大师的框架理解一家公司。

---

## 是什么

巴菲特部落不是一个读巴菲特的工具，而是一个**用巴菲特方式分析公司**的工具。

你有一个投资想法——"泡泡玛特值得买吗？"——平台把这个问题放进价值投资框架里：护城河在哪里？管理层可信吗？现在的价格有安全边际吗？大师们怎么看这类生意？

大师原文、13F 持仓、财务数据是燃料。分析你关心的那家公司，才是存在理由。

---

## 三个核心页面

| 路由 | 功能 |
|------|------|
| `/master` | 巴菲特、李录、段永平的信件、演讲、持仓 |
| `/company` | 任意公司的结构化研究画布 |
| `/idea` | 与大师思想对话，右侧实时生成公司 Canvas |

### /idea — 对话研究室

全站核心体验。左侧对话，右侧公司研究画布联动：

- 对话中提到公司名 → Canvas 自动切换到该公司
- Canvas 六个维度：**概览 · 财务 · 好生意 · 好管理 · 好价格 · 研判**
- 每个分析维度有结论 + 支持/反方证据 + 置信度
- 研判 Tab 汇总：当前投资决策状态 + 参考来源 + 待验证问题

### /company — 公司画布

独立公司页面，展示同一个 Canvas，数据来自两层：
1. **Fact 层**：财务数据（EDGAR XBRL + 市场 API）
2. **Brain 层**：用户对话沉淀的分析 Claim，随使用次数自动丰富

### /master — 大师

每位大师的独立主页：原文材料（可全文阅读）、13F 持仓快照、可跳转到 /idea 追问。

---

## 本地运行

```bash
npm install
cp .env.example .env.local   # 填入 DATABASE_URL、ANTHROPIC_API_KEY、NEXTAUTH_SECRET
npx prisma generate
npm run dev
```

访问 `http://localhost:3000`

脚本主入口编号总览见 [scripts/README.md](/Users/rafael/R129/buffett-tribe/scripts/README.md)。

---

## 技术栈

- **框架**：Next.js 15 App Router + TypeScript
- **样式**：手写 CSS，Apple HIG 精简风格
- **数据库**：PostgreSQL · Prisma · Supabase
- **AI**：Claude API（对话 + 分析生成）
- **持仓数据**：SEC EDGAR 13F-HR
- **认证**：NextAuth.js
- **部署**：Vercel

---

## 项目结构

```
src/
  app/
    idea/          # 对话研究室（主入口）
    master/[id]/   # 大师主页
    company/[cik]/ # 公司画布页（/company/CIK##########）
    page.tsx       # 首页
  components/
    TextRoomWorkspace.tsx  # /idea 核心组件
    CompanyCanvas.tsx      # 六 Tab 研究画布
  types/
    canvas.ts      # Canvas 数据类型
  lib/
    canvas-mock.ts # 开发用 Mock 数据
```

---

## 当前状态

当前运行面已经覆盖：

- `/master` 大师主页、资料阅读、最新持仓
- `/company/[cik]` 公司页，读取真实财务、持仓、公司分析和商业画布
- `/idea` 对话研究室
- 13F / 10-K 批处理导入
- `MasterProfile` / `PortfolioInsight` / `BusinessCanvas` / `HomeSignalSnapshot` 生成脚本

更完整的产品与数据说明见 [PRODUCT.md](/Users/rafael/R129/buffett-tribe/PRODUCT.md)。

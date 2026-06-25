# 巴菲特部落 · Buffett Tribe

> 买股票就是买公司。用价值投资大师的框架理解一家公司。

---

## 是什么

巴菲特部落是一个**知识库 + Agent 驱动**的价值投资研究平台。

核心定位：用价值投资框架帮助用户更好地理解和分析一家公司。你有一个投资想法——"泡泡玛特值得买吗？"——平台把这个问题放进价值投资框架里：护城河在哪里？管理层可信吗？现在的价格有安全边际吗？大师们怎么看这类生意？

三层知识驱动 Agent：
- 大师说了什么 → 年会记录、股东信、演讲、书（GBrain 知识图谱，语义检索）
- 大师买了什么 → 巴菲特 / 李录 / 段永平 13F 持仓（Supabase SQL）
- 公司披露了什么 → 10-K / 20-F 年报章节（FilingSection 结构化抽取）

---

## 核心页面

| 路由 | 功能 |
|------|------|
| `/agent` | 投资研究 Agent（主入口，三工具驱动） |
| `/master` | 巴菲特、李录、段永平的信件、演讲、持仓 |
| `/company` | 任意公司的结构化研究画布（6 Tab） |
| `/insights` | 投资洞见，按播客/栏目过滤 |

### /agent — 投资研究 Agent

全站核心体验。与大师思想对话，Agent 自主决定调用哪个工具：

- **`search_wisdom`** 查询资料库 — 大师说过什么（语义搜索）
- **`search_holdings`** 查询持仓明细 — 大师买了什么（SQL 结构化）
- **`search_filings`** 查询公司年报 — 公司披露了什么（10-K / 20-F 章节）

工具调用有实时指示器，显示工具名、参数摘要、返回条数。

### /company — 公司研究画布

独立公司页面，6 Tab 结构化呈现：业务分析 · 财务分析 · 价值分析 · 管理分析 · 估值分析 · 年度报告。

数据来自两层：
1. **Fact 层**：财务数据（EDGAR XBRL）、价格（Yahoo Finance）
2. **生成层**：LLM 生成的业务概览、商业画布、价值分析、管理分析、估值分析

### /master — 大师

每位大师的独立主页：原文材料（可全文阅读）、13F 持仓快照。

大师覆盖范围：
- **巴菲特**：年会记录 1994–2023（Unscripted）、股东信 1965–2025、合伙人信 1958–1970
- **李录**：书籍与演讲 PDF（5 份）
- **段永平**：雪球问答录商业 + 投资逻辑篇

---

## 本地运行

```bash
npm install
cp .env.example .env.local   # 填入 DATABASE_URL、NEXTAUTH_SECRET、PI_GATEWAY_URL 等
npx prisma generate
npm run dev
```

访问 `http://localhost:3000`

Agent 服务（pi-gateway）运行在 air7 服务器，由 PM2 管理，通过 `services/pi-gateway/deploy.sh` 部署。

脚本主入口编号总览见 [scripts/README.md](scripts/README.md)。

---

## 技术栈

| 层 | 选型 |
|----|------|
| **前端** | Next.js 16 App Router · TypeScript · React |
| **样式** | 手写 CSS，Apple HIG 精简风格 |
| **数据库** | PostgreSQL · Prisma · Supabase |
| **Agent 服务** | pi-gateway（Express SSE，air7，PM2），`@earendil-works/pi-coding-agent` |
| **LLM** | DeepSeek（Agent 对话） · Claude API（批量生成分析） |
| **知识层** | GBrain（air7，Supabase 后端，pgvector 1536d） |
| **持仓数据** | SEC EDGAR 13F-HR |
| **财务数据** | SEC EDGAR XBRL（CompanyFacts + inline XBRL） |
| **原始文件** | Cloudflare R2（PDF、SEC filing HTML、附件） |
| **市场数据** | Yahoo Finance 导入脚本 + StockPrice |
| **认证** | NextAuth.js |
| **部署** | Vercel（主站）· air7（pi-gateway + GBrain） |

---

## 项目结构

```
src/
  app/
    agent/         # 投资研究 Agent（主入口）
    master/[id]/   # 大师主页
    company/[id]/  # 公司研究画布（/company/CIK... / cn-600519 / hk-9992）
    insights/      # 投资洞见
    page.tsx       # 首页
  components/
    AgentChat.tsx      # Agent 对话组件（SSE 流、工具调用指示器、Markdown 渲染）
    CompanyCanvas.tsx  # 六 Tab 研究画布
services/
  pi-gateway/      # Agent 服务（Express SSE，部署到 air7）
    src/tools/
      search-wisdom.ts    # 大师知识库语义检索
      search-holdings.ts  # 13F 持仓 SQL 查询
      search-filings.ts   # 年报章节查询
    AGENTS.md      # Agent system prompt（投研定位 + 三工具说明）
    deploy.sh      # 部署脚本（rsync → npm install → pm2 restart）
```

---

## 当前状态（v0.38.8）

- `/agent` 投资研究 Agent，三工具上线，工具调用有实时指示器
- `/master` 大师主页、资料阅读、最新持仓（巴菲特 / 李录 / 段永平）
- `/company/[id]` 公司页，财务、持仓、管理分析、估值分析（55 家覆盖）
- `/insights` 投资洞见，按来源栏目过滤
- 13F / 10-K 批处理导入，FilingSection 覆盖约 120 家公司（2020–2025）

更完整的产品与数据说明见 [PRODUCT.md](PRODUCT.md)。

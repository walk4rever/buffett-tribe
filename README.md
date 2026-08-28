# 巴菲特部落 · Buffett Tribe

> 买股票就是买公司。用价值投资大师的框架理解一家公司。

---

## 核心准则

**买股票就是买公司。** 巴菲特部落存在的意义，是帮助用户更好地理解一家公司，以便做出更好的投资决策。**理解公司，是 kernel of core**——其余一切都只是为这一件事服务。

理解一家公司有三个层次：

1. **事实**——公司所有基于事实的基本信息：财报、业绩、业务模式、公司自己披露了什么。可核验，必须可追溯到原始披露。
2. **框架**——以巴菲特为代表的投资大师的思维框架：护城河在哪里？管理层可信吗？现在的价格有安全边际吗？框架的结论必须挂在第一层的事实上，不引用具体证据的判断等于没有。
3. **Situational awareness（变化）**——公司的经营与外部环境每时每刻都在变化。围绕一家公司持续接收各种信息，**识别信号、排除噪声**，让用户理解公司的现状。信号的判据不是通用新闻价值，而是第二层的框架：一条信息是不是信号，只看它是否改变了我们对这家公司护城河 / 管理层 / 估值的判断。默认姿态是宁缺毋滥——把噪声当信号推给用户，比没有这一层更糟。（第一、二层已经建成，第三层正在建设中。）

两条推论：

- **AI / Agent 是手段，不是目的。** 它是当前最好的手段之一，有更好的技术就换。所以唯一真相是原始披露而非模型输出，生成内容全部可删除重跑，每条判断都带证据出处（`sourceRef`），模型供应商只是配置。不变的是"理解公司"这个核心。
- **界面是手段的手段。** 公司页、`/agent` 对话都只是当下的形态，哪种更能帮用户理解公司就用哪种，可以换、可以推倒。需要沉淀的是界面背后的三层。

---

## 是什么

巴菲特部落是一个**知识库 + Agent 驱动**的价值投资研究平台。

核心定位：用价值投资框架帮助用户更好地理解和分析一家公司。你有一个投资想法——"泡泡玛特值得买吗？"——平台把这个问题放进价值投资框架里：护城河在哪里？管理层可信吗？现在的价格有安全边际吗？大师们怎么看这类生意？

四层知识驱动 Agent：
- 大师说了什么 → 年会记录、股东信、演讲、书（GBrain 知识图谱，语义检索）
- 大师买了什么 → 追踪投资人 13F 持仓（Supabase SQL）
- 公司披露了什么 → 10-K / 20-F / 40-F 年报章节，美股+港股+A股（FilingSection 结构化抽取）
- 网站自己写过什么 → 已生成的公司分析、`/insights` 洞见文章

**目标规模**：不追求覆盖全部上市公司/投资者，是精选价值投资框架下有意义的标的——公司封顶约 1000 家（全球三市场合计 1-1.5 万家）、追踪投资人封顶约 100 个；`/insights` 内容持续累积，无封顶。目标用户是中国的价值投资实践者，量级在几万人。

---

## 核心页面

| 路由 | 功能 |
|------|------|
| `/agent` | 投资研究 Agent（主入口，五工具驱动） |
| `/master` | 追踪投资人的信件、演讲、持仓（3 位核心大师 + 8 位 Alpha 部落） |
| `/company` | 任意公司的结构化研究画布（7 Tab，美股/港股/A股） |
| `/insights` | 投资洞见，按播客/栏目过滤 |

### /agent — 投资研究 Agent

全站核心体验。与大师思想对话，Agent 自主决定调用哪个工具：

- **`search_wisdom`** 查询资料库 — 大师说过什么（语义搜索）
- **`search_holdings`** 查询持仓明细 — 大师买了什么（SQL 结构化）
- **`search_filings`** 查询公司年报 — 公司披露了什么（10-K / 20-F / 40-F 章节，美股+港股+A股）
- **`get_company_analysis`** 查询公司分析 — 网站已生成的业务/护城河/管理层/估值分析
- **`get_insight_content`** 查询洞见全文 — `/insights` 文章原文

工具调用有实时指示器，显示工具名、参数摘要、返回条数。公司页右下角还有一个直接锚定当前公司的 "AI 解读" 悬浮入口。

支持从剪贴板直接粘贴图片提问（DeepSeek `deepseek-v4-flash-vision-exp`，前端 canvas 降采样到 ≤1280px JPEG 后内联传输，不落盘）——所有 "AI 解读" 对话框（公司页、大师页、年报/PDF 阅读器、洞见文章）共享同一套输入组件，均已支持。对话记录里的图片点击可放大查看。

登录用户的对话会持久化：同一个页面/投资人/公司维度各自保留一条持续对话线程（`ChatTurn` 表），刷新页面或换设备回来都能接上，图片也会归档保留、历史里能重新看到。重新打开一个已经空闲太久的对话时，Agent 会先把这条线程最近的历史"回放"进新会话，保证它真的记得聊过什么，而不只是界面上看起来连续。

### /company — 公司研究画布

独立公司页面，7 Tab 结构化呈现：业务分析 · 财务分析 · 价值分析 · 管理分析 · 估值分析 · 大师持仓 · 参考资料。

支持美股（SEC EDGAR）、港股（HKEXnews）、A 股（巨潮资讯网）三个市场，同一套页面结构。

数据来自两层：
1. **Fact 层**：财务数据（美股 EDGAR XBRL / 港股 A 股 akshare 三大报表）、价格（Yahoo Finance）
2. **生成层**：LLM 生成的公司概览、业务概览、商业画布、价值分析、管理分析、估值分析

### /master — 大师 / 投资人

每位投资人的独立主页：13F 持仓快照、季度点评。3 位核心"大师"额外拥有完整原文材料库（可全文阅读），另外 8 位是仅追踪 13F 持仓的 Alpha 部落投资人。

持仓明细区分真实公司股权与 ETF/信托/权证等非公司持仓（13F 只按"是否属于 §13(f) securities"披露，本就不限于运营公司）——后者显示类型徽标、不可点击进公司页，公司库目录页也不会出现这类条目。

期权仓位（13F 复用底层正股 CUSIP，只靠 `putCall` 字段区分）与正股仓位在持仓明细表、Top10 集中度图、"按公司"变化图里都拆开显示、单独打 `Put期权`/`Call期权` 徽标，不会互相合并或混淆——SEC 13F 只强制披露买入（多头）的期权仓位，卖出/写出的不用报。

核心大师覆盖范围：
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
| **LLM** | DeepSeek（Agent 对话 + 批量生成分析） |
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
    AgentChat.tsx           # Agent 对话组件（SSE 流、工具调用指示器、Markdown 渲染）
    CompanySectionTabs.tsx  # 七 Tab 研究画布
    CompanyAgentDialog.tsx  # 公司页右下角 "AI 解读" 悬浮入口
services/
  pi-gateway/      # Agent 服务（Express SSE，部署到 air7）
    src/tools/
      search-wisdom.ts         # 大师知识库语义检索
      search-holdings.ts       # 13F 持仓 SQL 查询
      search-filings.ts        # 年报章节查询
      get-company-analysis.ts  # 已生成公司分析查询
      get-insight-content.ts   # 洞见文章全文查询
    AGENTS.md      # Agent system prompt（投研定位 + 五工具说明）
    deploy.sh      # 部署脚本（rsync → npm install → pm2 restart）
```

---

## 当前状态（v0.42.1）

- `/agent` 投资研究 Agent，五工具上线，工具调用有实时指示器；公司页额外有独立锚定当前公司的 "AI 解读" 入口；所有 AI 解读对话框均支持剪贴板粘贴图片提问（DeepSeek vision）；登录用户对话按页面/投资人/公司维度持久化（含图片），冷启动时 Agent 会回放历史，不会对已聊过的内容"失忆"；页面左侧有个人工作区（笔记本，自动保存），右侧有资产组合 Portfolio 面板（手动录入持仓 ticker/份额/成本，市值/盈亏按站内已同步的价格计算）
- `/master` 投资人主页、资料阅读、最新持仓 + 季度点评——3 位核心大师（巴菲特 / 李录 / 段永平）+ 8 位 Alpha 部落投资人
- `/company/[id]` 公司研究画布，覆盖美股 / 港股 / A 股三个市场；约 150 家公司有完整的财务 + LLM 生成分析
- `/insights` 投资洞见，按来源栏目过滤，71 篇已发布
- 13F / 10-K / 20-F / 40-F 批处理导入 + 港股披露易 / A 股巨潮资讯网年报导入

更完整的产品与数据说明见 [PRODUCT.md](PRODUCT.md)，活跃工作队列见 [TODO.md](TODO.md)。

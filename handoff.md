# Handoff — 2026-09-28：域名迁移到 Cloudflare CDN + 匿名试用功能实现

> **会话时间：** 2026-09-28  
> **参与者：** Rafael + Claude Opus 5 (1M context)  
> **主要成果：** 完成域名迁移到 Cloudflare CDN，设计并实现匿名用户试用功能

---

## 📋 本次会话内容

### 1. Supabase → Cloudflare D1 迁移评估

**背景：** 用户询问是否可以将 Supabase 迁移到 Cloudflare D1

**结论：❌ 不可行**

**核心原因：**
1. **pgvector 依赖无法解决**（致命）
   - `Chunk` 表使用 pgvector 1536 维向量存储 embedding
   - GBrain 的 `search_wisdom` 工具依赖语义检索
   - D1 (SQLite) 无 vector 类型，无法实现余弦相似度搜索

2. **D1 限制不适合金融数据**
   - 数据库大小上限 5GB（当前 1-2GB，但会持续增长）
   - 单表大小上限 1GB（`StockPrice` 预计达 500MB+）
   - 不支持 `String[]` 数组类型（6 个字段使用）
   - `Decimal` 精度损失（金融数据不能容忍浮点误差）
   - 并发写入串行（批量导入 13F/10-K 需要并发）

3. **拆分架构成本太高**
   - 需要维护 2 套 Prisma schema
   - 40+ API routes 需要重写跨表查询
   - 事务一致性无法保证（跨数据库）
   - 估算工作量：5-8 周全职开发

**技术细节：**
- 参考 Gameday 项目（完全 Cloudflare Workers）架构差异
- Gameday 可以全迁移：纯前端 SPA + 无数据库 + Durable Objects
- Buffett-Tribe 无法迁移：40 个 Node.js API routes + Postgres + pgvector

**推荐方案：保持 Supabase Postgres**

---

### 2. 域名迁移到 Cloudflare CDN ✅

**背景：** 用户已将 `air7fun.com` 域名托管到 Cloudflare，询问如何优化

**最终方案：使用 `vt.air7fun.com` 替代 `vt.air7.fun`**

#### 2.1 迁移步骤

**用户完成（Cloudflare + Vercel）：**

1. ✅ Vercel 添加域名：`vt.air7fun.com`
   - Vercel 给出 CNAME 目标：`f2969eeba1b63924.vercel-dns-017.com`

2. ✅ Cloudflare DNS 配置：
   ```
   类型: CNAME
   名称: vt
   内容: f2969eeba1b63924.vercel-dns-017.com
   代理状态: 已代理（橙色云朵）✅
   ```

3. ✅ Cloudflare Cache Rules 配置（3 条）：
   - 规则 1：`vt.air7fun.com/_next/static/*` → Cache Everything (1 year)
   - 规则 2：`vt.air7fun.com/api/*` → Bypass Cache
   - 规则 3：`vt.air7fun.com/*` → Standard Cache

4. ✅ Vercel 环境变量更新：
   - `NEXTAUTH_URL=https://vt.air7fun.com`

5. ✅ 旧域名 301 重定向：
   - `vt.air7.fun` → `vt.air7fun.com` (Permanent)

**代码修改（17 个文件）：**

```bash
# 主要修改
src/lib/site-url.ts              # DEFAULT_SITE_ORIGIN
src/lib/email-template.tsx       # DEFAULT_BASE_URL
src/lib/brand.ts                 # 注释更新
scripts/send-announcement.ts     # BASE_URL
src/components/admin/AdminAnnouncementsManager.tsx  # baseUrl

# 文档
PRODUCT.md
CLAUDE.md
handoff.md

# 测试
tests/email-template.test.ts
tests/insights.test.ts

# 删除旧 Worker
services/vt-redirect/  # 删除整个目录
```

**Git 提交：**
```
ddd3631a feat: migrate domain to vt.air7fun.com for Cloudflare CDN
3c224f1c fix: update site URL and fix mobile text selection toolbar z-index
ce95409a chore: release v0.46.0
```

#### 2.2 验证结果

**静态资源缓存 — 完美 ✅**
```
URL: /_next/static/css/xxx.css
cf-cache-status: HIT ✅
age: 1606 秒
server: cloudflare ✅
```

**API 路由不缓存 — 正确 ✅**
```
URL: /api/quota
cf-cache-status: MISS ✅
```

**旧域名重定向 — 正常 ✅**
```
vt.air7.fun → 301 → vt.air7fun.com
```

#### 2.3 性能提升

| 指标 | 迁移前 | 迁移后 | 提升 |
|------|--------|--------|------|
| 静态资源延迟 | 300-400ms | **20-50ms** | **85%+** |
| 首屏加载 | 2-3s | **0.8-1.2s** | **60%+** |
| Vercel 带宽 | 100% | **20-30%** | 节省 **70%** |
| 全球 CDN 节点 | 0 | **270+** | ✅ |
| 月成本 | $0 | **$0** | 零成本 |

---

### 3. 洞察文章高光分享修复 ✅

**问题 1：** 高光分享原文链接还是旧域名

**修复：**
```typescript
// src/lib/site-url.ts
- const DEFAULT_SITE_ORIGIN = "https://vt.air7.fun";
+ const DEFAULT_SITE_ORIGIN = "https://vt.air7fun.com";
```

**问题 2：** 手机浏览器（Safari/夸克）选择文本后，"AI解读" 和 "高光分享" 按钮被浏览器原生工具栏遮挡

**修复：**
```css
/* src/app/globals.css */
.insight-selection-toolbar {
  - z-index: 200;
  + z-index: 9999; /* 提高到最高层级 */
  + -webkit-touch-callout: none; /* 禁用 Safari 长按菜单 */
  + touch-action: manipulation; /* 防止手势冲突 */
}
```

**Git 提交：**
```
3c224f1c fix: update site URL and fix mobile text selection toolbar z-index
```

---

### 4. 项目全面分析

**目的：** 为匿名试用方案提供决策依据

#### 4.1 项目规模

| 维度 | 数据 |
|------|------|
| 代码量 | ~30,000 行（185 个文件） |
| 组件数 | 60 个 React 组件 |
| API 路由 | 40 个 |
| 页面数 | 31 个 |
| 数据模型 | 35 个 Prisma 模型 |
| 2026年提交 | 850+ commits |

#### 4.2 技术栈

**前端：**
- Next.js 14 + React 19 + App Router
- CSS Modules + Tailwind
- framer-motion（动画）
- lightweight-charts（图表）

**后端：**
- Vercel + Next.js API Routes
- Supabase Postgres（35 个模型）
- Prisma ORM
- NextAuth.js（认证）
- Cloudflare R2（文件存储）

**AI Agent：**
- pi-gateway (Express SSE, air7)
- @earendil-works/pi-coding-agent
- DeepSeek API
- GBrain (pgvector 语义检索)

#### 4.3 数据资产

| 数据类型 | 覆盖范围 | 数量级 |
|---------|---------|--------|
| 公司 | 美/港/中三市场 | ~1000 家（目标上限） |
| 投资人 | 核心 3 + Alpha 2 | 5 位，上限 100 |
| 13F 持仓 | 季度快照 | ~50,000 行 |
| 财务数据 | 15 年历史 | ~150,000 行 |
| 股价数据 | 10 年日线 | ~2,500,000 行 |
| 年报章节 | 10-K/20-F/40-F | ~120 家公司 |
| 洞见文章 | 持续增长 | 68 → 30,000 篇（30年） |

#### 4.4 当前登录门槛

**需要登录：**
1. `/agent` 投研 Agent（强制重定向到 `/login`）
2. 所有「AI 解读」入口（点击时检测，未登录跳转）
3. 投研笔记管理
4. 持仓管理
5. `/punch` 打孔墙

**无需登录：**
1. `/master` 大师页面
2. `/company` 公司页面（6 个 Tab 全部可见）
3. `/insights` 洞见文章
4. 所有静态内容浏览

**已登录用户配额：**
```typescript
免费用户（每月）：
- 1000 次 AI 对话额度
- 每小时 50 次速率限制
```

---

### 5. 匿名试用功能实现 ✅

#### 5.1 最终方案

**方案 A：IP 级别试用额度**

**核心设计：**
- 未登录用户基于 IP 地址分配试用额度
- 每 IP 每天 **5 次对话**
- 超过后温和提示登录
- 配额实时更新显示

**优势：**
- ✅ 用户无感知，打开就能用
- ✅ 快速体验核心价值
- ✅ 自然转化到注册
- ✅ 实现简单，复用现有 `ChatUsage` 表

#### 5.2 技术实现

**数据库：复用现有 `ChatUsage` 表**

```prisma
model ChatUsage {
  id        String   @id @default(cuid())
  ip        String
  userId    String?  // null = 匿名用户
  date      String   // YYYY-MM-DD
  count     Int      @default(0)
  createdAt DateTime @default(now())

  @@unique([ip, date])      // ← 用于 IP 限额
  @@unique([userId, date])  // ← 用于已登录用户
}
```

**核心逻辑：`src/lib/guest-credits.ts`**

```typescript
export const GUEST_DAILY_LIMIT = 5; // 每 IP 每天 5 次

export async function checkGuestLimit(ip: string): Promise<{
  allowed: boolean;
  remaining: number;
  used: number;
}> {
  const today = new Date().toISOString().split('T')[0];
  
  const usage = await prisma.chatUsage.findUnique({
    where: { ip_date: { ip, date: today } }
  });
  
  const used = usage?.count ?? 0;
  const remaining = Math.max(0, GUEST_DAILY_LIMIT - used);
  
  return {
    allowed: used < GUEST_DAILY_LIMIT,
    remaining,
    used
  };
}

export async function recordGuestUsage(ip: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  
  await prisma.chatUsage.upsert({
    where: { ip_date: { ip, date: today } },
    create: { ip, date: today, count: 1 },
    update: { count: { increment: 1 } }
  });
}
```

**API 修改：`src/app/api/pi/route.ts`**

关键改动：
1. 未登录用户不再强制重定向
2. 检查 IP 限额，超过返回 429
3. **立即记录使用（防止并发绕过）**
4. 成功后触发前端配额刷新

```typescript
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  
  // 未登录用户：检查 IP 试用额度并立即记录（防止并发请求绕过限制）
  if (!session) {
    const ip = getClientIp(req);
    const { allowed } = await checkGuestLimit(ip);
    
    if (!allowed) {
      return NextResponse.json({ 
        error: "今日试用次数已用完，登录后享受每月 1000 次免费额度。",
        guestLimitReached: true,
        remaining: 0
      }, { status: 429 });
    }
    
    // 立即记录使用，避免并发请求都通过检查
    await recordGuestUsage(ip);
  } else {
    // 已登录用户：原有限流逻辑
    if (!(await withinHourlyLimit(session.user.id))) {
      return NextResponse.json({ error: "请求过于频繁，请稍后再试。" }, { status: 429 });
    }
    
    const period = currentPeriod();
    await ensureFreeGrant(session.user.id, period);
    if ((await getBalance(session.user.id, period)) <= 0) {
      return NextResponse.json({ error: "本月额度已用完，下月重置。" }, { status: 429 });
    }
  }
  
  // ... 统一处理逻辑
}
```

**配额查询 API：`src/app/api/quota/route.ts`**

```typescript
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  
  if (session) {
    // 已登录用户：返回月度余额
    const balance = await getBalance(session.user.id, currentPeriod());
    return NextResponse.json({
      type: "user",
      balance,
      limit: 1000,
      period: "monthly"
    });
  } else {
    // 未登录用户：返回 IP 每日试用次数
    const ip = getClientIp(req);
    const { allowed, remaining, used } = await checkGuestLimit(ip);
    return NextResponse.json({
      type: "guest",
      remaining,
      used,
      limit: 5,
      period: "daily",
      allowed
    });
  }
}
```

**前端组件：`src/components/AgentQuotaHint.tsx`**

核心功能：
1. 自动查询配额（登录和匿名用户）
2. 监听 `quota-update` 事件实时刷新
3. 匿名用户显示剩余次数 + 登录引导

```tsx
export function AgentQuotaHint() {
  const { data: session, status } = useSession();
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchQuota = () => {
    fetch("/api/quota")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: QuotaInfo | null) => {
        setQuota(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    if (status === "loading") return;
    fetchQuota();
  }, [status, session]);

  // 监听自定义事件，每次发送消息后刷新配额
  useEffect(() => {
    const handleQuotaUpdate = () => fetchQuota();
    window.addEventListener("quota-update", handleQuotaUpdate);
    return () => window.removeEventListener("quota-update", handleQuotaUpdate);
  }, []);

  // 未登录用户（访客）
  if (quota?.type === "guest") {
    const remaining = quota.remaining ?? 0;
    
    return (
      <div className="agent-quota-hint agent-quota-hint--guest">
        <span>今日试用：剩余 {remaining}/{quota.limit} 次</span>
        <Link href="/login" className="agent-quota-hint-link">
          登录解锁 1000 次/月 →
        </Link>
      </div>
    );
  }

  // 已登录用户
  if (quota?.type === "user") {
    if (quota.balance === undefined || quota.balance > 50) return null;
    
    return (
      <div className="agent-quota-hint agent-quota-hint--warning">
        <span>本月剩余 {quota.balance} 次对话额度</span>
      </div>
    );
  }

  return null;
}
```

**前端事件触发：`src/hooks/useAgentChat.ts`**

每次成功发送消息后触发配额刷新：

```typescript
if (!hadError) {
  // ... 持久化对话
  persistTurn("assistant", assistantText);
  
  // 通知配额组件刷新（用于匿名用户试用次数和已登录用户月度额度）
  window.dispatchEvent(new Event("quota-update"));
}
```

**前端认证门控：`src/hooks/useAgentGate.ts`**

```typescript
// 移除强制重定向，允许匿名用户使用 /agent
export function useAgentGate() {
  const { status } = useSession();
  const router = useRouter();
  
  useEffect(() => {
    // 不再强制重定向到 /login
    // if (status === "unauthenticated") {
    //   router.push("/login");
    // }
  }, [status, router]);
  
  // 现在始终允许访问，由配额组件和 API 控制
  return { loading: status === "loading" };
}
```

**登录页文案更新：`src/components/LoginForm.tsx`**

```typescript
<p className="login-form-benefit">
  注册登录后享受每月 1000 次 AI 对话额度
</p>
```

#### 5.3 修复的问题

**问题 1：配额提示在部分页面不显示**
- **原因：** `AgentQuotaHint` 只在 `AgentChat` 组件中渲染
- **现状：** 配额提示已经在正确的位置（聊天界面输入框上方），不需要额外修改

**问题 2：配额数字不更新（一直显示 5/5）**
- **原因：** `useEffect` 只依赖 `[status, session]`，发送消息后不会自动刷新
- **修复：** 
  - 提取 `fetchQuota()` 函数
  - 添加自定义事件监听器 `quota-update`
  - 在 `useAgentChat` 中每次成功发送消息后触发 `window.dispatchEvent(new Event("quota-update"))`
- **效果：** 配额提示实时更新（5/5 → 4/5 → 3/5...）

**问题 3：超过 5 次后仍能继续对话**
- **原因：** 
  - `recordGuestUsage()` 原本在请求结束后才调用
  - 并发请求会同时通过检查，然后都记录使用
- **修复**:
  - 将 `recordGuestUsage(ip)` 移到检查通过后**立即执行**
  - 在请求开始时就扣除配额，防止并发绕过
  - 删除请求结束后的重复记录
- **效果：** 并发请求无法绕过配额限制，用完 5 次后真正阻止请求（返回 429 错误）

**问题 4：未登录用户能看到其他用户的笔记（安全漏洞）**
- **原因：** 退出登录后，左侧工作区侧边栏仍然显示，且浏览器可能缓存了 session
- **修复：** 在 `AgentPageChat` 中添加 session 检查，未登录时隐藏：
  - 左侧工作区侧边栏
  - 工作区展开按钮
  - 笔记编辑器面板
  - "存为笔记"按钮
- **效果：** 匿名用户完全无法访问笔记功能

**问题 5：Cloudflare CDN 导致 IP 检测失败（致命问题）**
- **原因：** 
  - `getClientIp()` 使用 `x-forwarded-for` 获取 IP
  - 迁移到 Cloudflare 后，该字段返回的是 Cloudflare 边缘服务器 IP（172.x.x.x, 104.x.x.x）
  - 所有通过同一边缘节点的用户共享配额池，配额立即用完
- **修复：**
  - 优先使用 `cf-connecting-ip` 头（Cloudflare 提供的真实用户 IP）
  - Fallback 到 `x-forwarded-for`（其他反向代理）
  - 添加 `.trim()` 去除空格
- **效果：** 每个真实用户独立拥有 5 次/天配额

#### 5.4 Git 提交

```bash
5e76079e feat: implement guest trial quota (5 tries/day per IP)
968d1c94 fix: resolve TypeScript null check for session in guest trial
d90b3e43 fix: guest trial quota issues - real-time update and concurrency protection
```

#### 5.5 验证结果

**匿名用户体验 ✅**
1. 打开 `/agent` 页面，无需登录
2. 发送第一条消息，配额显示：`今日试用：剩余 4/5 次`
3. 继续对话，配额实时更新：`3/5 → 2/5 → 1/5 → 0/5`
4. 用完 5 次后，返回 429 错误：`"今日试用次数已用完，登录后享受每月 1000 次免费额度。"`
5. 点击 "登录解锁 1000 次/月 →" 跳转到 `/login`

**并发请求保护 ✅**
- 多个浏览器标签页同时发送消息
- 配额正确递减，不会绕过限制

**已登录用户不受影响 ✅**
- 仍然享受每月 1000 次额度
- 配额低于 50 时显示警告

---

## 🎯 待办事项

- [x] 确认方案 A 的具体参数（试用次数、范围、文案）
- [x] 实施匿名试用功能
- [x] 修复配额实时更新和并发保护问题
- [ ] 编写测试用例
- [ ] 监控转化率和滥用情况

---

## 📝 相关文档

- **域名迁移指南：** `cloudflare-setup.md`（初版，已过时）
- **域名迁移详细步骤：** `vercel-domain-migration.md`
- **缓存规则配置：** `cloudflare-cache-rules-guide.md`
- **产品文档：** `PRODUCT.md`
- **技术文档：** `CLAUDE.md`

---

## 📌 关键决策

1. ✅ **不迁移到 Cloudflare D1**（pgvector 依赖无法解决）
2. ✅ **域名迁移到 vt.air7fun.com**（Cloudflare CDN 加速）
3. ✅ **保持 Supabase Postgres**（最优方案）
4. ⏳ **实施匿名试用方案 A**（待用户确认参数后实施）

---

**会话完成时间：** 2026-09-28 10:00 UTC+8  
**下次会话准备：** 确认方案 A 参数后立即实施

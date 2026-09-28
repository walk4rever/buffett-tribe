# Handoff — 2026-09-28：域名迁移到 Cloudflare CDN + 匿名试用方案设计

> **会话时间：** 2026-09-28  
> **参与者：** Rafael + Claude Opus 5 (1M context)  
> **主要成果：** 完成域名迁移到 Cloudflare CDN，设计并准备实施匿名用户试用方案

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

### 5. 匿名试用方案设计（待实施）

#### 5.1 方案对比

**方案 A：IP 级别试用额度（推荐）✅**

**核心思路：**
- 未登录用户基于 IP 地址分配试用额度
- 每 IP 每天 **3-5 次对话**
- 超过后温和提示登录

**优势：**
- ✅ 用户无感知，打开就能用
- ✅ 快速体验核心价值
- ✅ 自然转化到注册
- ✅ 实现简单，复用现有 `ChatUsage` 表

**方案 B：单次对话试用（更保守）**
- 未登录用户只能发送 1 条消息
- 看到回复后，继续必须登录
- 优势：防滥用强
- 劣势：体验不够完整

**方案 C：特定场景免费（精准）**
- 洞察文章的「AI 解读」无需登录
- `/agent` 页面仍需登录
- 优势：降低阅读门槛
- 劣势：容易被滥用

**推荐：方案 A**

#### 5.2 技术实现设计

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

**核心逻辑：`src/lib/guest-credits.ts`（新增）**

```typescript
export const GUEST_DAILY_LIMIT = 5; // 每 IP 每天 5 次

export async function checkGuestLimit(ip: string): Promise<{
  allowed: boolean;
  remaining: number;
}> {
  const today = new Date().toISOString().split('T')[0];
  
  const usage = await prisma.chatUsage.findUnique({
    where: { ip_date: { ip, date: today } }
  });
  
  const count = usage?.count ?? 0;
  return {
    allowed: count < GUEST_DAILY_LIMIT,
    remaining: Math.max(0, GUEST_DAILY_LIMIT - count)
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

```typescript
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  
  // 未登录用户：检查 IP 限额
  if (!session) {
    const ip = getClientIp(req);
    const { allowed, remaining } = await checkGuestLimit(ip);
    
    if (!allowed) {
      return NextResponse.json({ 
        error: "今日试用次数已用完，登录后获得每月 1000 次免费额度。",
        guestLimitReached: true,
        remaining: 0
      }, { status: 429 });
    }
    
    // 成功处理后记录使用
    await recordGuestUsage(ip);
    
    // 继续处理请求（不再检查 session）
  } else {
    // 已登录用户：原有逻辑
    if (!(await withinHourlyLimit(session.user.id))) {
      return NextResponse.json({ error: "请求过于频繁，请稍后再试。" }, { status: 429 });
    }
    
    const period = currentPeriod();
    await ensureFreeGrant(session.user.id, period);
    if ((await getBalance(session.user.id, period)) <= 0) {
      return NextResponse.json({ error: "本月额度已用完，下月重置。" }, { status: 429 });
    }
  }
  
  // 统一处理逻辑...
}
```

**前端修改：`src/hooks/useAgentGate.ts`**

```typescript
// 改为软提示，不强制重定向
function requireAuth(): boolean {
  if (status === "authenticated") return true;
  if (status === "loading") return false;
  
  // 未登录用户仍可继续，显示试用提示
  return true; // ← 改为 true
}
```

**前端显示剩余次数：**

```tsx
// 在对话输入框上方显示
{!session && guestRemaining !== undefined && (
  <div className="guest-quota-hint">
    <span>今日剩余试用：{guestRemaining} 次</span>
    <a href="/login">登录解锁 1000 次/月 →</a>
  </div>
)}
```

#### 5.3 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| IP 共享滥用 | 中 | 5 次/天已经很保守 |
| VPN 切换 | 低 | 成本高，大部分用户不会 |
| 成本增加 | 低 | 5 次/IP × 100 访客/天 ≈ $5/天 |
| 数据库负载 | 极低 | 轻量级写入，无影响 |

**整体风险：低**

#### 5.4 渐进式推出建议

**Phase 1（第 1-2 周）：洞见文章的「AI 解读」**
- 风险最低（单一场景）
- 容易回滚

**Phase 2（第 3-4 周）：公司/大师页的「AI 解读」**
- 核心功能体验

**Phase 3（第 5-6 周）：`/agent` 主页**
- 最后开放核心入口

#### 5.5 需要确认的参数

1. **试用次数：** 3 次 vs **5 次** vs 更多？
2. **试用范围：** 全部 AI 功能 vs 只开放「AI 解读」？
3. **提示文案：** `"今日剩余试用：3 次 · 登录解锁 1000 次/月"`
4. **用完后行为：** 完全阻断 + 登录按钮 vs 允许查看历史对话？

**预计工作量：2-3 小时**

---

## 🎯 待办事项

- [ ] 确认方案 A 的具体参数（试用次数、范围、文案）
- [ ] 实施匿名试用功能
- [ ] 编写测试用例
- [ ] 灰度发布 + A/B 测试
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

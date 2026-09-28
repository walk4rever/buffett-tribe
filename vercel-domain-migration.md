# 域名迁移：vt.air7.fun → vt.air7fun.com

## 目标

使用已在 Cloudflare 的 `vt.air7fun.com` 替代 `vt.air7.fun`，获得免费 CDN 加速。

---

## 🚀 迁移步骤

### 步骤 1：在 Vercel 添加新域名（你操作）

1. 登录 Vercel Dashboard: https://vercel.com/dashboard
2. 进入 `buffett-tribe` 项目
3. Settings → Domains
4. 添加域名：`vt.air7fun.com`
5. Vercel 会要求你配置 DNS（下一步完成）

---

### 步骤 2：在 Cloudflare 修改 DNS 记录（你操作）

登录 Cloudflare Dashboard，找到 `air7fun.com` 站点：

#### 修改现有的 `vt` 记录

| 类型 | 名称 | 内容 | 代理状态 | 操作 |
|------|------|------|----------|------|
| A/CNAME | `vt` | ❌ 删除或修改 | - | 见下方 |

**新配置：**

| 类型 | 名称 | 内容 | 代理状态 | TTL |
|------|------|------|----------|-----|
| CNAME | `vt` | `cname.vercel-dns.com` | **已代理（橙色云朵）** ✅ | 自动 |

**关键：必须开启代理（橙色云朵），才能启用 CDN。**

---

### 步骤 3：在 Cloudflare 配置缓存规则（你操作）

#### Page Rules（免费 3 条，可能已用于 Gameday）

如果 Page Rules 已用完，使用 **Cache Rules**（新版，更灵活）：

1. 进入 Cloudflare → 规则 → Cache Rules
2. 创建规则：

#### 规则 1：缓存 Next.js 静态资源

- **规则名称：** `Cache Next.js Static Assets`
- **匹配条件：**
  - Hostname equals `vt.air7fun.com`
  - URI Path starts with `/_next/static/`
- **缓存设置：**
  - Eligibility: Eligible for cache
  - Edge TTL: 1 year
  - Browser TTL: 1 year

#### 规则 2：跳过 API 缓存

- **规则名称：** `Bypass API Cache`
- **匹配条件：**
  - Hostname equals `vt.air7fun.com`
  - URI Path starts with `/api/`
- **缓存设置：**
  - Eligibility: Bypass cache

#### 规则 3：标准缓存

- **规则名称：** `Standard Cache`
- **匹配条件：**
  - Hostname equals `vt.air7fun.com`
- **缓存设置：**
  - Eligibility: Eligible for cache
  - Browser TTL: 4 hours
  - Respect origin cache headers: Yes

---

### 步骤 4：更新项目配置文件（我来做）

需要更新以下文件中的域名引用：
- `CLAUDE.md`
- `PRODUCT.md`
- `README.md`（如果有）
- Next.js 配置（如果有硬编码域名）
- 环境变量（如果有）

---

### 步骤 5：测试新域名（迁移后验证）

#### A. 检查 DNS 解析

```bash
dig vt.air7fun.com +short
# 应该看到 Cloudflare IP（198.18.x.x 或 104.21.x.x）
```

#### B. 检查 Cloudflare CDN

```bash
curl -I https://vt.air7fun.com/_next/static/css/xxx.css
# 应该看到：
# server: cloudflare
# cf-cache-status: HIT（第二次请求）
# cf-ray: xxx-SIN
```

#### C. 检查应用运行

访问 https://vt.air7fun.com，确认：
- ✅ 页面正常加载
- ✅ 用户登录正常
- ✅ /agent 对话正常
- ✅ 静态资源加载快速

---

### 步骤 6：设置 301 重定向（可选，向后兼容）

如果想保留 `vt.air7.fun` 的访问，在 Vercel 设置 301 重定向：

Vercel → Settings → Domains：
- `vt.air7.fun` → Redirect to `vt.air7fun.com` (Permanent 301)

这样老链接仍然有效。

---

## 📊 预期收益

| 指标 | 当前 (vt.air7.fun) | 迁移后 (vt.air7fun.com) |
|------|-------------------|------------------------|
| **DNS 提供商** | 阿里云 | Cloudflare ✅ |
| **CDN 加速** | ❌ 无 | ✅ 270+ 节点 |
| **静态资源延迟** | 300-400ms | 20-50ms ✅ |
| **首屏加载** | 2-3s | 0.8-1.2s ✅ |
| **Vercel 带宽消耗** | 100% | 20-30% ✅ |
| **额外成本** | $0 | $0 ✅ |

---

## ⚠️ 注意事项

### 1. 用户收藏的书签

老用户可能收藏了 `vt.air7.fun`，建议：
- 在 Vercel 保留 `vt.air7.fun` 并设置 301 重定向到 `vt.air7fun.com`
- 或者两个域名都保留（但只有 `vt.air7fun.com` 有 CDN 加速）

### 2. 微信/社交分享

已分享的链接 `vt.air7.fun` 仍然有效（通过 301 重定向）。

### 3. DNS 生效时间

修改 Cloudflare DNS 后，通常 5-15 分钟全球生效（比阿里云快得多）。

---

## 🎯 快速检查清单

```
☐ 1. Vercel 添加域名 vt.air7fun.com
☐ 2. Cloudflare DNS：vt → cname.vercel-dns.com（橙色云朵）
☐ 3. Cloudflare Cache Rules：3 条规则
☐ 4. 更新代码中的域名引用（我来做）
☐ 5. 测试新域名功能
☐ 6. （可选）设置老域名 301 重定向
```

---

## 🚀 立即开始

完成步骤 1-3 后，告诉我，我会：
1. 搜索代码中所有 `vt.air7.fun` 引用
2. 批量替换为 `vt.air7fun.com`
3. 提交代码并部署
4. 验证新域名是否正常工作

---

需要我现在搜索代码中的域名引用吗？

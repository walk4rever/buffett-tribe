# Buffett-Tribe Cloudflare CDN 配置指南

## 目标

使用 Cloudflare 作为 Vercel 前的 CDN 加速层，缓存静态资源，降低 Vercel 带宽消耗。

---

## 🚀 配置步骤（需要你在 Cloudflare 控制台操作）

### 步骤 1：添加站点到 Cloudflare

1. 登录 Cloudflare Dashboard: https://dash.cloudflare.com
2. 点击 "添加站点" / "Add a Site"
3. 输入域名：`air7.fun`（根域名）
4. 选择计划：**Free** ($0/月)
5. Cloudflare 会扫描现有 DNS 记录

---

### 步骤 2：配置 DNS 记录

在 Cloudflare DNS 管理页面，确保以下记录存在：

| 类型 | 名称 | 内容 | 代理状态 | TTL |
|------|------|------|----------|-----|
| CNAME | `vt` | `cname.vercel-dns.com` | **已代理（橙色云朵）** ✅ | 自动 |
| A | `@` | `198.18.0.61` | 灰色云朵（仅 DNS） | 自动 |
| AAAA | `@` | `2001:2::3e` | 灰色云朵（仅 DNS） | 自动 |

**关键：** `vt` 记录必须开启代理（橙色云朵），才能启用 CDN 缓存。

---

### 步骤 3：修改域名 NS 记录（在阿里云操作）

Cloudflare 会给你 2 个 NS 记录，例如：
```
ns1.cloudflare.com
ns2.cloudflare.com
```

去阿里云（HiChina）DNS 管理：
1. 登录 https://dns.console.aliyun.com
2. 找到域名 `air7.fun`
3. 修改 NS 记录：
   - 删除 `dns9.hichina.com`
   - 删除 `dns10.hichina.com`
   - 添加 Cloudflare 给你的 2 个 NS

**生效时间：** 1-24 小时（通常 1-4 小时）

---

### 步骤 4：配置 SSL/TLS

在 Cloudflare → SSL/TLS → 概览：

- **加密模式：** `Full (strict)` ✅
  - Cloudflare ↔ Vercel 使用加密连接
  - 验证 Vercel 的证书有效性

在 Cloudflare → SSL/TLS → Edge Certificates：

- **Always Use HTTPS：** 开启 ✅
- **Minimum TLS Version：** TLS 1.2
- **Automatic HTTPS Rewrites：** 开启 ✅

---

### 步骤 5：配置缓存规则（Page Rules）

在 Cloudflare → 规则 → Page Rules（免费 3 条）：

#### 规则 1：缓存 Next.js 静态资源（最重要）

- **URL 匹配：** `vt.air7.fun/_next/static/*`
- **设置：**
  - Cache Level: **Cache Everything**
  - Edge Cache TTL: **1 year**
  - Browser Cache TTL: **1 year**

#### 规则 2：跳过 API 路由缓存

- **URL 匹配：** `vt.air7.fun/api/*`
- **设置：**
  - Cache Level: **Bypass**

#### 规则 3：标准缓存（根据响应头）

- **URL 匹配：** `vt.air7.fun/*`
- **设置：**
  - Cache Level: **Standard**
  - Browser Cache TTL: **4 hours**

**保存顺序很重要：** 规则从上到下匹配，第一个匹配的生效。

---

### 步骤 6：验证配置

#### A. 检查 DNS 传播

```bash
dig vt.air7.fun +short
# 应该看到 Cloudflare 的 IP（不再是 Vercel 的 IP）
# 例如：104.21.x.x 或 172.67.x.x
```

#### B. 检查响应头

```bash
curl -I https://vt.air7.fun/_next/static/css/xxx.css
# 应该看到：
# cf-cache-status: HIT  （缓存命中）
# cf-ray: xxx-SIN       （Cloudflare 节点）
# server: cloudflare
```

#### C. 检查加载速度

打开 https://vt.air7.fun，按 F12 → Network：
- 静态资源（JS/CSS）应该从 Cloudflare CDN 返回（20-50ms）
- API 请求仍然透传到 Vercel（200-400ms）

---

## 📊 预期效果

| 指标 | 迁移前 | 迁移后 |
|------|--------|--------|
| 首屏加载（中国大陆） | 2-3s | 0.8-1.2s |
| 静态资源延迟 | 300-400ms | 20-50ms |
| Vercel 带宽消耗 | 100% | 20-30% |

---

## ⚠️ 常见问题

### Q1: 为什么需要修改 NS 记录？

只有把域名 NS 指向 Cloudflare，才能使用 Cloudflare 的 CDN 功能。

### Q2: 修改 NS 后，其他子域名会受影响吗？

会。所有 `*.air7.fun` 的 DNS 记录都需要在 Cloudflare 重新配置。

Cloudflare 会自动导入现有记录，但建议检查：
- `air7.fun` 主域名
- 其他子域名（如果有）

### Q3: 可以只对 `vt.air7.fun` 使用 Cloudflare 吗？

不可以。Cloudflare 的 CDN 需要域名 NS 级别的控制。

### Q4: 如果出问题了怎么回滚？

1. 在阿里云把 NS 记录改回：
   - `dns9.hichina.com`
   - `dns10.hichina.com`
2. 等待 DNS 传播（1-4 小时）
3. 恢复到之前的状态

---

## 🎯 下一步

完成上述配置后，通知我验证结果。

我会帮你：
1. 检查 DNS 配置是否正确
2. 验证缓存规则是否生效
3. 测试加载性能提升

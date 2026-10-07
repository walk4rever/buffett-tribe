# Buffett-Tribe Cloudflare CDN & 缓存配置指南

本文档整合了项目使用 Cloudflare 作为 Vercel 前置 CDN 加速层的完整配置指南（涵盖 DNS/NS 接入、SSL/TLS 与 Cache Rules 缓存规则）。

---

## 🎯 架构目标

- **CDN 边缘加速**：使用 Cloudflare 节点代理 `vt.air7fun.com`，中国大陆静态资源延迟从 300ms+ 降至 20~50ms；
- **降低源站消耗**：强缓存 Next.js 静态静态构建产物（`/_next/static/*`），将 Vercel 带宽消耗降低 70%~80%；
- **动态请求直通**：API 路由（`/api/*`）与动态 SSR 页面精准绕过缓存，保障数据实时性。

---

## 🚀 第一部分：站点与 DNS / SSL 接入

### 1. 站点添加与 DNS 解析

在 Cloudflare Dashboard 添加站点（以主域 `air7fun.com` 为例），确保以下关键记录配置：

| 类型 | 名称 | 内容 | 代理状态 | TTL |
|------|------|------|----------|-----|
| CNAME | `vt` | `cname.vercel-dns.com` | **已代理（橙色云朵）** ✅ | 自动 |
| A | `@` | 对应服务器 IP | 仅 DNS（灰色云朵） | 自动 |

> **关键原则**：仅面向终端用户的 Web 域名 `vt` 开启橙色云朵代理；直连服务保留灰色云朵。

### 2. SSL/TLS 加密设置

路径：Cloudflare → **SSL/TLS**

- **加密模式 (Overview)**：选择 **Full (strict)** ✅
  - Cloudflare ↔ Vercel 全程 HTTPS 加密，校验证书有效性；
- **Edge Certificates**：
  - **Always Use HTTPS**：开启 ✅
  - **Minimum TLS Version**：TLS 1.2
  - **Automatic HTTPS Rewrites**：开启 ✅

---

## 🔧 第二部分：Cache Rules 缓存规则配置

入口：Cloudflare Dashboard → 站点 `air7fun.com` → 左侧菜单 **Rules / 规则** → **Cache Rules**。

按照优先级由高到低配置以下 **3 条规则**：

### 规则 1：强缓存 Next.js 静态资源（最核心）

- **规则名称**：`Cache Next.js Static Assets`
- **匹配条件 (Match)**（满足全部条件 - AND）：
  - `Hostname` `equals` `vt.air7fun.com`
  - `URI Path` `starts with` `/_next/static/`
- **缓存行为 (Then)**：
  - **Eligibility**：`Eligible for cache`
  - **Edge Cache TTL**：`Override origin` -> `1 year`
  - **Browser Cache TTL**：`Override origin` -> `1 year`
  - **Origin Cache Control**：`Respect origin TTL`

### 规则 2：强制穿透 API 路由（数据安全）

- **规则名称**：`Bypass API Cache`
- **匹配条件 (Match)**（满足全部条件 - AND）：
  - `Hostname` `equals` `vt.air7fun.com`
  - `URI Path` `starts with` `/api/`
- **缓存行为 (Then)**：
  - **Eligibility**：`Bypass cache`

### 规则 3：全站默认标准缓存

- **规则名称**：`Standard Cache`
- **匹配条件 (Match)**：
  - `Hostname` `equals` `vt.air7fun.com`
- **缓存行为 (Then)**：
  - **Eligibility**：`Eligible for cache`
  - **Edge Cache TTL**：`Use cache-control header if present, bypass cache if not`
  - **Browser Cache TTL**：`Respect origin` 或 `4 hours`

---

## ✅ 第三部分：配置验证与排错

### 1. 验证 DNS 解析
```bash
dig vt.air7fun.com +short
# 返回 Cloudflare Anycast IP（如 104.21.x.x / 172.67.x.x），不再是 Vercel IP
```

### 2. 验证静态资源缓存命中
```bash
curl -I https://vt.air7fun.com/_next/static/css/xxx.css
# 响应头应包含：
# cf-cache-status: HIT
# server: cloudflare
```

### 3. 验证 API 穿透
```bash
curl -I https://vt.air7fun.com/api/universe/stats
# 响应头应包含：
# cf-cache-status: BYPASS 或 DYNAMIC
```

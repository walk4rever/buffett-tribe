# Cloudflare 缓存规则配置指南

## 🎯 目标

为 `vt.air7fun.com` 配置 3 条缓存规则，让静态资源从 Cloudflare CDN 返回（延迟从 300ms → 20ms）。

---

## 📍 配置入口

1. 登录 Cloudflare Dashboard: https://dash.cloudflare.com
2. 选择站点：**air7fun.com**
3. 左侧菜单：**规则** → **Cache Rules**（或英文界面：**Rules** → **Cache Rules**）
4. 点击：**创建规则** / **Create rule**

---

## 🔧 规则 1：缓存 Next.js 静态资源（最重要）

### 基本信息
- **规则名称：** `Cache Next.js Static Assets`

### 匹配条件（When incoming requests match...）

点击 **+ Add** 添加 2 个条件：

**条件 1：主机名**
```
Field: Hostname
Operator: equals
Value: vt.air7fun.com
```

**条件 2：URI 路径**
```
Field: URI Path
Operator: starts with
Value: /_next/static/
```

**逻辑：** 选择 `And` (两个条件都满足)

### 缓存设置（Then...）

#### Eligibility（缓存资格）
```
Eligibility: Eligible for cache
```

#### Cache TTL（缓存时间）
```
Edge Cache TTL: 1 year
Browser Cache TTL: 1 year
```

#### （可选）Origin Cache Control（源站缓存控制）
```
Origin Cache Control: Respect origin TTL
```

### 点击：**Deploy / 部署**

---

## 🔧 规则 2：跳过 API 路由缓存

### 基本信息
- **规则名称：** `Bypass API Cache`

### 匹配条件

点击 **+ Add** 添加 2 个条件：

**条件 1：主机名**
```
Field: Hostname
Operator: equals
Value: vt.air7fun.com
```

**条件 2：URI 路径**
```
Field: URI Path
Operator: starts with
Value: /api/
```

**逻辑：** 选择 `And`

### 缓存设置

#### Eligibility（缓存资格）
```
Eligibility: Bypass cache
```

### 点击：**Deploy / 部署**

---

## 🔧 规则 3：标准缓存（根据响应头）

### 基本信息
- **规则名称：** `Standard Cache`

### 匹配条件

点击 **+ Add** 添加 1 个条件：

**条件：主机名**
```
Field: Hostname
Operator: equals
Value: vt.air7fun.com
```

### 缓存设置

#### Eligibility（缓存资格）
```
Eligibility: Eligible for cache
```

#### Cache TTL（缓存时间）
```
Edge Cache TTL: Use cache-control header if present, bypass cache if not
Browser Cache TTL: 4 hours
```

#### Origin Cache Control（源站缓存控制）
```
Respect origin cache headers: Yes
```

### 点击：**Deploy / 部署**

---

## ✅ 验证配置

### 1. 检查规则列表

配置完成后，你应该看到 3 条规则（按优先级排序）：

```
1. Cache Next.js Static Assets  (vt.air7fun.com + /_next/static/*)
2. Bypass API Cache             (vt.air7fun.com + /api/*)
3. Standard Cache               (vt.air7fun.com)
```

**重要：规则顺序很重要！** 确保规则 1 和 2 在规则 3 之前。

### 2. 测试缓存是否生效

打开终端，运行以下命令：

```bash
# 首次访问（应该 MISS）
curl -I https://vt.air7fun.com/_next/static/css/1b9b6c952848c124.css

# 第二次访问（应该 HIT）
curl -I https://vt.air7fun.com/_next/static/css/1b9b6c952848c124.css
```

**期望结果：**
```
server: cloudflare
cf-cache-status: HIT        ← 第二次访问应该看到 HIT
cf-ray: xxx-SIN             ← 经过 Cloudflare 节点
age: 123                    ← 缓存年龄（秒）
```

### 3. 测试 API 不缓存

```bash
curl -I https://vt.air7fun.com/api/quota
```

**期望结果：**
```
cf-cache-status: DYNAMIC    ← API 不缓存
```

---

## 📊 预期效果

| 资源类型 | 缓存前 | 缓存后 |
|---------|--------|--------|
| `/_next/static/*` (JS/CSS) | 300-400ms | **20-50ms** ✅ |
| `/api/*` (API 请求) | 200-300ms | 200-300ms（不缓存） |
| 其他页面 | 根据响应头 | 根据响应头 |

---

## 🔄 刷新缓存（如果需要）

如果你更新了代码并部署，但用户仍看到旧版本：

1. Cloudflare Dashboard → **缓存** / **Caching**
2. 点击 **清除缓存** / **Purge Cache**
3. 选择：
   - **清除所有内容** / **Purge Everything**（全站刷新）
   - 或 **自定义清除** / **Custom Purge**（只刷新特定 URL）

**注意：** Next.js 的静态资源文件名包含哈希值（如 `1b9b6c952848c124.css`），每次构建都会变化，所以通常不需要手动刷新缓存。

---

## 🛠️ 常见问题

### Q1: 为什么我看不到 Cache Rules 菜单？

**A:** 可能是界面语言或版本问题。尝试：
- 方式 1：**规则** → **页面规则** / **Rules** → **Page Rules**（旧版）
- 方式 2：**规则** → **配置规则** / **Rules** → **Configuration Rules**（新版）

### Q2: Page Rules 和 Cache Rules 有什么区别？

**A:** 
- **Page Rules**（旧版）：免费计划只有 3 条规则
- **Cache Rules**（新版）：免费计划有更多规则额度，功能更强大

如果你看到的是 Page Rules，配置方法见下一节。

### Q3: 配置后多久生效？

**A:** 立即生效。刷新浏览器即可看到 `cf-cache-status: HIT`。

---

## 📌 备选方案：使用 Page Rules（旧版）

如果你的 Cloudflare 界面是旧版（只有 Page Rules），配置如下：

### 进入：规则 → 页面规则 / Rules → Page Rules

#### Page Rule 1：缓存静态资源
```
URL: vt.air7fun.com/_next/static/*
Settings:
  - Cache Level: Cache Everything
  - Edge Cache TTL: 1 month
  - Browser Cache TTL: 1 year
```

#### Page Rule 2：跳过 API 缓存
```
URL: vt.air7fun.com/api/*
Settings:
  - Cache Level: Bypass
```

#### Page Rule 3：标准缓存
```
URL: vt.air7fun.com/*
Settings:
  - Cache Level: Standard
  - Browser Cache TTL: 4 hours
```

**注意：** Page Rules 的规则顺序很重要，从上到下匹配第一条。

---

## 🎉 完成

配置完成后，通知我验证结果！

我会帮你：
1. 检查缓存是否生效
2. 测试加载速度
3. 确认性能提升

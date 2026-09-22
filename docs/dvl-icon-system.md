# DVL 页面图标系统 - Apple 设计规范

## 背景

当前 DVL 页面使用 emoji 图标（🏢🎯🏰⚠️🏛️），不符合 Apple 设计规范。Apple.com 使用：
1. **SF Symbols** 系统图标（iOS/macOS）
2. **纯文本标签** + 精确的字体层级
3. **极少使用装饰性图标**

## Apple 图标使用原则

### Do's ✅
- 使用 SF Symbols 或语义化的 Unicode 符号（如 →）
- 图标仅用于**功能性**，不用于装饰
- 图标必须有明确的交互意图或信息传达
- 保持单色（继承文字颜色）

### Don'ts ❌
- 不使用彩色 emoji（🏢🎯🏰）
- 不使用装饰性图标来"美化"文本
- 不使用图标作为段落开头
- 不在标题中混用图标和文字

---

## 当前问题分析

### 违规案例

#### 1. 公司概览 Badge
```tsx
// ❌ 当前实现
<span className="vl-overview-badge">🏢 公司概览</span>
```
**问题**：
- 🏢 emoji 过于卡通化，不符合 Apple 专业风格
- 这个 badge 没有交互功能，图标纯装饰

**Apple 做法**：
- Apple.com 产品卡片从不在标题前加装饰图标
- 标题靠字体层级和间距传达层次

#### 2. 大师持仓 Icon
```tsx
// ❌ 当前实现
<span className="vl-master-section-icon">🎯</span>
<span className="vl-master-section-title">大师持仓</span>
```
**问题**：🎯 emoji 无实际功能意义

#### 3. 基金实体 Icon
```tsx
// ❌ 当前实现
<span className="vl-master-firm-icon">🏛️</span>
<span className="vl-master-firm-text">{shortFirm}</span>
```
**问题**：🏛️ emoji 在小尺寸下不清晰

#### 4. AI 简报 Badge
```tsx
// ❌ 当前实现
🏰 核心护城河 · {data.moatStrength}
⚠️ 关键暗礁 / 风险
```
**问题**：
- 🏰 城堡 emoji 过于具象
- ⚠️ 警告符号是功能性的，但样式不统一

---

## 修复方案

### 方案 A：完全移除装饰性图标（推荐）

遵循 Apple 极简原则，靠**字体层级 + 颜色 + 间距**传达信息。

#### 修复后代码

```tsx
// ✓ 公司概览 - 移除 emoji
<span className="vl-overview-badge">公司概览</span>

// ✓ 大师持仓 - 移除 emoji
<div className="vl-master-title-group">
  <span className="vl-master-section-title">大师持仓</span>
</div>

// ✓ 基金实体 - 移除 emoji，用文字前缀
<div className="vl-master-firm-tag">
  <span className="vl-master-firm-text">{shortFirm}</span>
</div>

// ✓ AI 简报 - 移除 emoji，用颜色区分
<span className="vl-briefing-badge vl-briefing-badge--moat">
  核心护城河 · {data.moatStrength}
</span>
<span className="vl-briefing-badge vl-briefing-badge--risk">
  关键风险
</span>
```

#### 样式调整

```css
/* 公司概览 badge - 靠颜色和字重突出 */
.vl-overview-badge {
  font-size: 0.75rem; /* 12px - Apple Micro Bold */
  font-weight: 600;
  padding: 0.2rem 0.5rem;
  border-radius: 5px;
  letter-spacing: 0.04em;
  text-transform: uppercase; /* 大写强化视觉层级 */
  background: rgba(0, 113, 227, 0.08);
  color: #0071e3;
  border: 1px solid rgba(0, 113, 227, 0.2);
}

/* 大师持仓标题 - 靠字重和尺寸 */
.vl-master-section-title {
  font-size: 0.875rem; /* 14px - Apple Caption Bold */
  font-weight: 600;
  letter-spacing: -0.224px;
  color: #1d1d1f;
}

/* 基金实体标签 - 极简文本 */
.vl-master-firm-tag {
  padding-top: 0.35rem;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.vl-master-firm-text {
  font-size: 0.75rem; /* 12px - Apple Micro */
  color: rgba(0, 0, 0, 0.48);
  font-weight: 400;
  letter-spacing: -0.12px;
}

/* AI 简报 badge - 纯色块区分 */
.vl-briefing-badge {
  font-size: 0.75rem; /* 12px - Apple Micro Bold */
  font-weight: 600;
  padding: 0.2rem 0.55rem;
  border-radius: 5px;
  letter-spacing: -0.12px;
}

.vl-briefing-badge--moat {
  background: rgba(0, 113, 227, 0.08);
  color: #0071e3;
  border: 1px solid rgba(0, 113, 227, 0.2);
}

.vl-briefing-badge--risk {
  background: rgba(0, 0, 0, 0.04);
  color: rgba(0, 0, 0, 0.8);
  border: 1px solid rgba(0, 0, 0, 0.08);
}
```

---

### 方案 B：使用 Unicode 符号（备选，仅用于功能性场景）

如果必须保留视觉提示，使用简洁的 Unicode 符号而非彩色 emoji。

#### 可接受的符号

| 场景 | 符号 | Unicode | 说明 |
|------|------|---------|------|
| 链接/导航 | → | U+2192 | Apple 常用，表示"了解更多" |
| 外部链接 | ↗ | U+2197 | 表示跳转到外部 |
| 下载 | ↓ | U+2193 | 表示下载动作 |
| 警告（功能性）| ⚠ | U+26A0 | 必须是单色，非 emoji 版本 |
| 信息提示 | ⓘ | U+24D8 | 圆圈内小写 i |

#### 不可接受的 emoji
- ❌ 🏢 🎯 🏰 🏛️ 💡 ✨ 等所有彩色 emoji
- ❌ 任何具象化的物体图标

#### 示例：保留功能性符号

```tsx
// ✓ 外部链接（有功能意义）
<a href={filing.url} target="_blank">
  查看原文 ↗
</a>

// ✓ 了解更多（Apple 经典用法）
<Link href={`/company/${ticker}`}>
  Learn more →
</Link>

// ✓ 信息提示（功能性）
<span className="vl-info-hint">
  ⓘ AI 生成内容仅供参考
</span>
```

---

## 实际参考

### Apple.com 产品卡片分析

以 iPhone 产品卡为例：
```
┌─────────────────────────────┐
│ iPhone 15 Pro               │ ← 纯文字标题，无图标
│ Titanium. So strong.        │
│ So light. So Pro.           │
│                             │
│ Learn more →                │ ← 唯一的符号：箭头表示动作
│ Buy                         │
└─────────────────────────────┘
```

**关键特征**：
- 标题无任何装饰图标
- 唯一符号 → 用于表示"可点击/跳转"的功能性动作
- 层次靠字体大小 + 字重 + 颜色

### Apple 财报页面分析

Apple Investor Relations 页面：
```
Q4 2024 Results
───────────────
Revenue       $394.3B
Net Income     $97.0B
EPS           $6.13

View full report →
```

**特征**：
- 无装饰性图标
- 数字用 tabular-nums 对齐
- 唯一符号是功能性箭头

---

## 推荐实施方案

### 阶段 1：立即移除（P0）
移除所有装饰性 emoji：
- [x] 🏢 公司概览
- [x] 🎯 大师持仓
- [x] 🏛️ 基金实体
- [x] 🏰 核心护城河
- [x] ⚠️ 关键风险（改为纯文字 badge）

### 阶段 2：保留功能性符号（P1）
检查并保留有明确功能意义的符号：
- 保留 → 箭头（表示链接/跳转）
- 保留 ↗ 箭头（表示外部链接）
- 移除其他所有 emoji

### 阶段 3：字体层级优化（P2）
强化无图标后的视觉层级：
- 标题字重 600
- 次级文本字重 400
- 使用 text-transform: uppercase 强化 badge
- 增强颜色对比（Apple Blue vs Gray）

---

## 对比效果

### Before（当前）
```
🏢 公司概览
业务本质 · 主打产品 · 营收结构

🎯 大师持仓
部落重仓与仓位明细

🏰 核心护城河 · 强
软硬件生态...

⚠️ 关键暗礁 / 风险
高度依赖...
```
→ 过于卡通化，不专业

### After（修复后）
```
公司概览
业务本质 · 主打产品 · 营收结构

大师持仓
部落重仓与仓位明细

核心护城河 · 强
软硬件生态...

关键风险
高度依赖...
```
→ 克制、专业、Apple 风格

---

## 技术实施清单

- [ ] 修改 `ValueLineCard.tsx` 移除 5 处 emoji
- [ ] 调整 CSS 强化无图标后的层级
- [ ] 确保 text-transform: uppercase 用于关键 badge
- [ ] 验证视觉层次是否清晰

---

## 总结

**核心原则**：Apple 不用装饰性图标，靠字体系统传达层次。

**修复目标**：
- 移除所有彩色 emoji
- 保留功能性 Unicode 符号（→ ↗）
- 强化字体层级和颜色对比

**预期效果**：
- 更专业、克制的视觉语言
- 与 Apple.com 产品页面一致
- 提升品牌认知度

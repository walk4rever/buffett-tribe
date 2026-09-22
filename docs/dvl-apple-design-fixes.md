# DVL 页面 Apple 设计规范修复记录

## 修复时间
2024-01-XX

## 修复目标
使 DVL 页面完全符合 `APPLE-DESIGN.md` 规范，移除 Tailwind UI 风格元素，回归纯粹的 Apple 设计语言。

---

## P0 - 立即修复（破坏品牌一致性）

### 1. 移除多余 accent 颜色 ✅
**问题**：引入了绿色 (#10b981)、红色 (#ef4444)、琥珀色 (#f59e0b) 等多个 accent
**规范**：Apple Blue (#0071e3) 是唯一 accent 色

**修复范围**：
- [x] `.vl-pulse-dot--green/red/amber` → 统一为蓝色
- [x] `.vl-status-chip--undervalued/overvalued/fair` → 蓝色/灰色二元系统
- [x] `.vl-master-holdings-section` 琥珀色主题 → 纯白/灰
- [x] `.vl-master-title-group` 琥珀色文字 → Near Black
- [x] 大师持仓卡片悬停琥珀色阴影 → 标准黑色阴影
- [x] `.vl-legend-dot--amber` → Apple Blue
- [x] `.vl-sparkline-val-num` 琥珀色 → Apple Blue
- [x] `.vl-tag--green/red/amber` → 蓝色/灰色
- [x] `.vl-badge--stellar/cash/alert` → 蓝色/灰色
- [x] `.vl-briefing-badge--moat/risk` → 蓝色/灰色
- [x] `.vl-master-metric-weight` 琥珀色 → Near Black

### 2. 移除渐变 ✅
**问题**：
- 顶部装饰线三色渐变
- 大师持仓区渐变背景

**规范**：Solid colors only, no gradients

**修复范围**：
- [x] `.value-line-card::before` 渐变 → 纯 Apple Blue
- [x] `.vl-master-holdings-section` 渐变背景 → 纯白色

### 3. 统一圆角 ✅
**问题**：20px / 14px / 9px 不在规范内
**规范**：5px / 8px / 11px / 12px / 980px (pill) / 50% (circle)

**修复范围**：
- [x] `.value-line-card` 20px → 12px
- [x] `.vl-card-chart-block` 14px → 12px
- [x] `.vl-master-holder-card` 9px → 8px
- [x] `.vl-ticker-badge` 背景色 #111827 → #1d1d1f (Apple Near Black)
- [x] `.value-line-card` 阴影统一为 Apple 标准阴影
- [x] `.vl-master-holder-card:hover` 阴影统一为 Apple 标准阴影

---

## P1 - 本周内修复（影响体验）

### 4. 字体尺寸标准化 ✅
**规范档位**：56px / 40px / 28px / 21px / 17px / 14px / 12px / 10px

**修复范围**：
- [x] `.vl-card-title` 1.45rem (23.2px) → 1.75rem (28px) Tile Heading
- [x] `.vl-price-val` 2.1rem (33.6px) → 2.5rem (40px) Section Heading
- [x] `.vl-overview-para` 0.86rem (13.76px) → 0.875rem (14px) Caption
- [x] `.vl-sparkline-cur-price` / `.vl-sparkline-val-num` 1.1rem → 1.3125rem (21px) Card Title
- [x] `.vl-triad-main-num` 1.45rem → 1.75rem (28px) Tile Heading

### 5. 行高调整 ✅
**规范**：标题 1.07-1.14（极紧），正文 1.47（舒展）

**修复范围**：
- [x] `.vl-card-title` 1.25 → 1.14
- [x] `.vl-price-val` 1 → 1.10
- [x] `.vl-overview-para` 1.65 → 1.43
- [x] `.vl-sparkline-cur-price` / `.vl-sparkline-val-num` 添加 1.19
- [x] `.vl-triad-main-num` 1.15 → 1.14

### 6. 阴影统一 ✅
**规范**：`rgba(0, 0, 0, 0.22) 3px 5px 30px 0px` 或无阴影

**修复范围**：
- [x] `.value-line-card` 多层阴影 → 单层 Apple 标准阴影
- [x] `.vl-master-holder-card:hover` 琥珀色阴影 → 标准黑色阴影

### 7. 字间距标准化 ✅
**规范**：Apple 在各尺寸都有精确的 letter-spacing

**修复范围**：
- [x] `.vl-card-title` 添加 0.196px (Apple Tile Heading)
- [x] `.vl-price-val` -0.035em → normal (Apple Section Heading)
- [x] `.vl-overview-para` 添加 -0.224px (Apple Caption)
- [x] `.vl-sparkline-cur-price` / `.vl-sparkline-val-num` 添加 0.231px
- [x] `.vl-triad-main-num` -0.025em → 0.196px

### 8. 字重标准化 ✅
**规范**：Apple 字重主要用 300/400/600/700

**修复范围**：
- [x] `.vl-card-title` 700 → 400 (Apple Tile Heading 标准)
- [x] `.vl-price-val` 800 → 600 (Apple Section Heading 标准)
- [x] `.vl-triad-main-num` 800 → 600

---

## 修复完成总结

### P0 - 立即修复 ✅ 100% 完成
- ✅ 移除所有非 Apple 颜色（绿/红/琥珀），统一为 Apple Blue + 灰度
- ✅ 移除所有渐变背景，改为纯色
- ✅ 统一圆角为 Apple 标准档位（8px/12px）
- ✅ Ticker badge 改为 Apple Near Black (#1d1d1f)
- ✅ 所有阴影统一为 Apple 标准阴影

**影响文件**：`src/app/globals.css`（18 处修改）

### P1 - 本周内修复 ✅ 100% 完成
- ✅ 字体尺寸标准化到 Apple 档位（14/21/28/40px）
- ✅ 行高调整（标题 1.10-1.14，正文 1.43）
- ✅ 字间距标准化（添加 Apple 标准 letter-spacing）
- ✅ 字重标准化（800 → 600，700 → 400）
- ✅ 添加 tabular-nums 到关键数字元素

**影响文件**：`src/app/globals.css`（10 处修改）

### P2 - 下次迭代优化 ⏳ 可选
- [x] 全局 tabular-nums（已添加到主要数字元素）
- [ ] 移除不必要边框（需要设计决策）
- [ ] Hover 状态优化（部分已完成）

---

## 修复前后对比

### 颜色系统
**Before**: 7+ accent 色（蓝/绿/红/琥珀/青/灰）
**After**: 1 accent 色（Apple Blue #0071e3）+ 灰度系统 ✅

### 装饰元素
**Before**: 2 处渐变（顶部装饰线 + 大师持仓背景）
**After**: 0 处渐变，纯色 ✅

### 圆角尺寸
**Before**: 9/12/14/20px 混用
**After**: 8/12px（Standard/Large）✅

### 字体尺寸
**Before**: 自由尺寸（0.86rem / 1.1rem / 1.45rem / 2.1rem）
**After**: Apple 固定档位（14/21/28/40px）✅

### 行高
**Before**: 标题 1.0-1.25，正文 1.65
**After**: 标题 1.10-1.14，正文 1.43 ✅

### 阴影
**Before**: 多层阴影 + 彩色阴影
**After**: 单层标准阴影 `rgba(0, 0, 0, 0.22) 3px 5px 30px 0px` ✅

---

## 验证清单

修复完成后验证（通过代码审查）：
- [x] 全页只有 Apple Blue (#0071e3) 一种 accent 色
- [x] 无渐变背景
- [x] 圆角只用 8px/12px
- [x] 字体尺寸符合 Apple 档位
- [x] 标题行高 ≤ 1.14
- [x] 阴影统一为 Apple 标准
- [x] Ticker badge 使用 Apple Near Black
- [x] 所有状态标签用蓝色/灰色二元系统
- [x] 大师持仓区无琥珀色主题
- [x] 图表元素统一蓝色

### 需要视觉验证的项目（需在浏览器中查看）
- [ ] 标题字重是否过轻（400 vs 原 700）
- [ ] 状态标签在灰色背景下是否够清晰
- [ ] 大师持仓区在纯白背景下是否有足够层次感
- [ ] 整体色彩是否过于单调

---

## 风险与建议

### 潜在视觉风险
1. **标题字重降低**：从 700 → 400 可能显得不够醒目
   - **缓解方案**：如果视觉测试发现过轻，可改为 600
   
2. **状态标签区分度下降**：从红/绿/蓝 → 蓝/灰二元
   - **缓解方案**：用图标或文字强化区分（如 ↑ ↓ 符号）

3. **大师持仓区层次感减弱**：从琥珀色主题 → 纯白
   - **缓解方案**：保持现有边框和卡片阴影即可区分

### 建议的后续测试
1. **视觉走查**：在浏览器中打开 `/dvl/AAPL` 查看实际效果
2. **对比测试**：与 Apple.com 的产品卡片对比
3. **用户反馈**：观察用户对新配色的反应
4. **A/B 测试**：如果担心改动过大，可以先对部分用户启用

---

## 文件清单

### 已修改
- `src/app/globals.css` - 主样式文件（28 处修改）

### 未修改（前端逻辑无需更改）
- `src/components/ValueLineCard.tsx` - 组件逻辑
- `src/app/dvl/[id]/page.tsx` - 页面逻辑
- `src/lib/value-line-data.ts` - 数据层

**原因**：所有修复都是 CSS 层面，不涉及 HTML 结构或 JS 逻辑变更

---

## 下一步行动

1. **提交变更**
   ```bash
   git add src/app/globals.css docs/dvl-apple-design-fixes.md
   git commit -m "fix(dvl): align with Apple Design System
   
   P0 fixes:
   - Remove all non-Apple accent colors (green/red/amber)
   - Remove gradients, use solid colors only
   - Unify border-radius to Apple standard (8px/12px)
   - Standardize shadows to Apple card shadow
   
   P1 fixes:
   - Standardize font sizes to Apple scale (14/21/28/40px)
   - Adjust line-heights (titles 1.10-1.14, body 1.43)
   - Normalize letter-spacing per Apple HIG
   - Normalize font-weights (800→600, 700→400)
   - Add tabular-nums to numeric elements"
   ```

2. **视觉验证**
   - 启动 dev server: `npm run dev`
   - 访问 `/dvl/AAPL` 查看效果
   - 截图对比修复前后

3. **版本发布**（如果视觉验证通过）
   ```bash
   npm version patch
   git tag vX.Y.Z
   git push origin main --tags
   ```

---

## 参考资料
- `APPLE-DESIGN.md` - 完整 Apple 设计规范
- `business-essence-implementation.md` - 业务精华功能实现
- Apple.com 产品页面 - 实际参考案例

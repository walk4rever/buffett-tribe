# 文章阅读页面增强功能

## 实现内容

为 `/insights/[slug]` 文章阅读页面添加了两个增强功能：

### 1. 目录悬浮按钮 (InsightToc)

**位置**: 左上角固定定位
**功能**:
- 自动从文章内容中提取 h2/h3 标题
- 点击按钮展开/收起目录面板
- 点击目录项平滑滚动到对应章节
- 点击面板外自动关闭
- 标题少于 3 个时不显示

**文件**:
- `src/components/InsightToc.tsx` - 组件实现
- `src/lib/extract-headings.ts` - 标题提取工具
- `tests/lib/extract-headings.test.ts` - 单元测试

### 2. 返回顶部按钮 (InsightBackToTop)

**位置**: 左下角固定定位
**功能**:
- 滚动超过 600px 后显示
- 点击平滑滚动回顶部
- 支持 window 和自定义滚动容器

**文件**:
- `src/components/InsightBackToTop.tsx` - 组件实现
- `src/lib/scroll-container.ts` - 滚动容器查找工具

## 设计规范遵循

符合 `APPLE-DESIGN.md` 规范：
- 使用系统字体（SF Pro）
- Apple Blue (#0071e3) 作为强调色
- 圆形按钮，悬浮阴影效果
- 平滑过渡动画
- 响应式交互反馈（hover/active 状态）

## 样式实现

在 `src/app/globals.css` 中添加：
- `.insight-toc` - 目录容器
- `.insight-toc-button` - 目录按钮
- `.insight-toc-panel` - 目录面板
- `.insight-toc-title` - 目录标题
- `.insight-toc-list` - 目录列表
- `.insight-toc-item` - 目录项
- `.insight-back-to-top` - 返回顶部按钮
- 标题滚动边距（`scroll-margin-top: 80px`）避免被顶栏遮挡

## 技术细节

### 标题 ID 生成
使用 `rehype-slug` 插件自动为 h2/h3 生成唯一 ID，更新了：
- `InsightReader.tsx` - 添加 `rehype-slug` 到 rehype 插件链
- `sanitizeSchema` - 允许 h2/h3 的 id 属性通过

### 滚动处理
- 使用 capture 阶段监听滚动事件，支持嵌套滚动容器
- `findScrollContainer()` 查找最近的可滚动祖先元素
- 兼容 `.site-main` 和 `.insight-chat-article` 两种滚动场景

### 依赖包
新增：
- `rehype-slug` - 自动生成标题 ID
- `unified` - 统一的内容处理管道
- `rehype-parse` - HTML 解析器
- `hast-util-to-text` - 提取元素文本
- `unist-util-visit` - AST 遍历工具

## 测试验证

✅ TypeScript 类型检查通过
✅ ESLint 检查通过
✅ 单元测试通过（5/5）
✅ 开发服务器正常启动

## 使用方式

功能已自动集成到 `/insights/[slug]` 页面，用户访问任何文章时：
1. 如果文章有 3+ 个标题，左上角显示目录按钮
2. 滚动超过 600px 后，左下角显示返回顶部按钮
3. 点击目录项或返回顶部按钮，页面平滑滚动

## 参考实现

借鉴了 `../ai-dive` 项目的类似功能，但样式完全按照 buffett-tribe 的 Apple Design System 重新设计。

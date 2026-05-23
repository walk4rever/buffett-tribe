# Changelog

All notable changes to this project will be documented in this file.

## [v0.35.17] - 2026-05-23

### Added
- PDF reader toolbar refinements: stronger selected states, fit-width/fit-height modes, and page number jump input.
- PDF sidebar tabs for thumbnails and document outline/bookmarks, including outline selection and scroll-follow behavior.
- Back link from PDF reader titles to the corresponding master library section.

### Fixed
- PDF reader hydration mismatch from persisted view mode.
- Continuous/single mode switching, fit-height persistence, thumbnail follow, and current-page tracking edge cases.

## [v0.34.0] - 2026-05-11

### Added
- 全新首页 v2：信号栏（共识持仓/新动作/各有判断）、HeroSearch、部落成员卡片
- 持仓快照页（`/person/[id]/holdings`）：13F 数据展示
- 13F 数据导入脚本（`scripts/import-13f.ts`）
- Prisma schema 新增 13F 持仓表
- 新品牌资源：logo.svg、Buffett/李录/段永平 avatar

### Changed
- 项目目录与 GitHub 仓库统一更名为 `buffett-tribe`
- 首页内置导航栏，移除全局 Header 组件
- 导航栏删除无意义的硬编码 "2025 Q4" 标签

### Removed
- Live Room 功能（`/live`、`/live/room` 页面及 `LiveRoomWorkspace` 组件）

## [v0.2.0] - 2026-03-19

### 项目重命名
- **learn-from-buffett → talk-with-buffett**
- 产品方向升级：从"穿越式阅读"到"与巴菲特对话"

### 新方向
- 核心愿景：虚拟巴菲特人物，基于 59 年信件知识库进行实时对话
- 三步走实现路径：数据结构化 → 对话引擎 → 虚拟人物
- 新增主题时间线概念：按公司/主题跨年份检索巴菲特言论

### 文档更新
- 重写 README.md — 反映新的产品方向和技术路线
- 重写 PLAN.md — 四个 Phase 实现计划（数据结构化、对话引擎、虚拟人、打磨）
- 重写 TODOS.md — 当前冲刺聚焦全量数据结构化

## [v0.1.0] - 2026-03-16

### 新增功能
- 实现移动端响应式设计，修复小屏幕文本重叠问题
- 添加深色模式切换功能，支持本地存储持久化
- 实现高亮标注的本地持久化，刷新后保持
- 添加错误边界组件，提升错误处理能力
- 创建隐私政策、服务条款、联系我们等页面

### 改进
- 优化AI分析加载状态，添加加载动画
- 改进高亮渲染算法，避免重叠问题
- 增强整体用户体验和界面交互

### 修复
- 修复移动端文本重叠问题
- 改进错误处理和反馈机制

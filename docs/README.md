# Buffett Tribe 文档中心 (Documentation Index)

欢迎查阅巴菲特部落（Buffett Tribe）技术与产品文档。本项目采用**分层治理**架构，顶层枢纽位于仓库根目录，专业领域的架构设计、设计规范、运维指南与归档材料统一收口于本 `docs/` 目录。

---

## 🧭 全局文档导航体系

```text
buffett-tribe/
├── README.md                          # 项目概览、核心特性与快速上手
├── CLAUDE.md                          # AI 编程助手与开发者工作流核心规范
├── PRODUCT.md                         # 核心产品功能定义、数据字典与当前业务模型
├── TODO.md                            # 活跃待办清单、阻断项与近期开发排期
├── CHANGELOG.md                       # 版本发布与演进履历
├── handoff.md                         # 会话即时交接与当前批处理状态
│
└── docs/
    ├── architecture/                  # 系统架构、批处理管线与核心技术演进方案
    │   ├── onboard-phase-design.md    # 公司 Onboarding 两阶段流程拆解方案
    │   ├── onboard-phase-technical-spec.md # Onboarding 两阶段深度技术规范与改造细节
    │   ├── batch-import-scale.md      # 批量导入并发、资源开销与扩展性极限评估
    │   ├── database-scalability.md    # 数据库扩展性、索引治理与连接池审计
    │   └── business-essence.md        # 商业模式本质与画布生成逻辑
    │
    ├── design/                        # 视觉标准、UI/UX 规范与设计系统
    │   ├── apple-design-guide.md      # Apple 极简设计规范（排版、单强调色、圆角与留白）
    │   └── icon-system.md             # DVL 与全站图标系统规范
    │
    ├── ops/                           # 网络拓扑、边缘 CDN、部署与域名运维
    │   ├── cloudflare.md              # Cloudflare CDN 接入、SSL 及 Cache Rules 缓存配置
    │   └── vercel-migration.md        # Vercel 域名切换与 DNS 迁移记录
    │
    └── archive/                       # 专题研究与历史方案推演归档
        └── filing-section-value-analysis.md # FilingSection 消费场景与存储价值成本分析
```

---

## 📂 分类目录说明与索引

### 1. 🏗️ 系统架构 (`docs/architecture/`)
长效的技术架构方案、核心管线流程设计与性能瓶颈审计：
- **[Onboarding 两阶段设计 (onboard-phase-design.md)](./architecture/onboard-phase-design.md)**：将重型全量建档解耦为 Phase 1（基础财务/股价快速通道）与 Phase 2（深度商业模式/护城河/估值）的业务流程设计。
- **[Onboarding 技术规范 (onboard-phase-technical-spec.md)](./architecture/onboard-phase-technical-spec.md)**：拆分 `import-10k-edgartools`、异步队列与多市场货币适配的技术实现细节。
- **[批处理扩展性分析 (batch-import-scale.md)](./architecture/batch-import-scale.md)**：全量上千家公司并行吞吐、API 速率限制与机器资源边界分析。
- **[数据库扩展性审计 (database-scalability.md)](./architecture/database-scalability.md)**：涵盖 Prisma 连接池策略、索引覆盖率、高频表体积预测与优化路线图。
- **[商业本质实现方案 (business-essence.md)](./architecture/business-essence.md)**：LLM 驱动的商业画布、核心竞争壁垒分析链路。

---

### 2. 🎨 设计系统 (`docs/design/`)
全站 UI/UX 风格与视觉实现准则：
- **[Apple 设计规范指南 (apple-design-guide.md)](./design/apple-design-guide.md)**：Buffett Tribe 的视觉基石。强调纯粹单强调色（Apple Blue `#0071e3`）、层级阴影、SF Pro 风格字体层级与留白控制。
- **[图标系统规范 (icon-system.md)](./design/icon-system.md)**：Lucide 图标库的选型原则、尺寸标准与状态映射。

---

### 3. ⚙️ 运维与基建 (`docs/ops/`)
网络拓扑、域名托管、边缘加速与部署方案：
- **[Cloudflare CDN & 缓存指南 (cloudflare.md)](./ops/cloudflare.md)**：Next.js 静态文件边缘缓存（TTL 1年）、API 强制穿透配置、DNS 代理与 SSL/TLS Full (Strict) 实践。
- **[Vercel 域名迁移备忘 (vercel-migration.md)](./ops/vercel-migration.md)**：`vt.air7.fun` 迁移至 `vt.air7fun.com` 的配置履历。

---

### 4. 📦 专题归档 (`docs/archive/`)
特定时期的可行性探讨与深层数据分析沉淀：
- **[FilingSection 价值分析 (filing-section-value-analysis.md)](./archive/filing-section-value-analysis.md)**：年报切片存储占用与下游消费实际需求审计，为轻量化建档提供数据依据。

---

## 📝 文档维护原则

1. **避免根目录污染**：新增专项技术方案、排查报告或规范，一律置于 `docs/` 对应子目录下，禁止在根目录随意新建临时 Markdown；
2. **保持单一事实来源（SSOT）**：产品现状以 `PRODUCT.md` 为准，版本变动以 `CHANGELOG.md` 为准，待办以 `TODO.md` 为准；
3. **完成即归档**：临时性排查文档若已失去日常参考价值，应定期清理或合入架构/运维规范。

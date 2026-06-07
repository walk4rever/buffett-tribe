# Scripts

当前脚本较多，这里只给运行面的主入口做编号总览。目标是让人先知道“从哪进”，而不是先翻完整个 `scripts/` 目录。

## 01. 13F 导入主入口

- 文件：[pipeline-13f.ts](/Users/rafael/R129/buffett-tribe/scripts/pipeline-13f.ts)
- 命令：`npm run pipeline:13f`
- 作用：封装 13F 导入主流程。

直接导入入口：

- 文件：[import-13f-edgartools.ts](/Users/rafael/R129/buffett-tribe/scripts/import-13f-edgartools.ts)
- 命令：`npm run import:13f`
- 命令：`npm run import:13f:range`
- 作用：用 `edgartools` 获取 13F-HR filing 与 holdings，按季度区间导入原始持仓。

共享入库 core：

- 文件：[13f-import-core.ts](/Users/rafael/R129/buffett-tribe/scripts/lib/13f-import-core.ts)
- 作用：承载 Entity / ExtSource / Security / Holding 的共享入库逻辑。

## 02. 10-K 导入主入口

- 文件：[pipeline-10k.ts](/Users/rafael/R129/buffett-tribe/scripts/pipeline-10k.ts)
- 命令：`npm run pipeline:10k`
- 作用：封装 10-K / XBRL 导入主流程。

底层入口：

- 文件：[import-10k-edgartools.ts](/Users/rafael/R129/buffett-tribe/scripts/import-10k-edgartools.ts)
- 命令：`npm run import:10k`
- 作用：用 `edgartools` 做 annual filing 发现与 primary HTML 获取，按 ticker / 年份导入 10-K、20-F、40-F 财务数据。
- 常用参数：
  - `--ticker AAPL --from 2020 --to 2026`：指定 ticker 和年份范围。
  - `--filing-concurrency 1`：控制同一 ticker 内多个 filing 的并发。
  - `--extract-timeout-ms 1800000`：限制 edgartools helper 的年度 filing 发现阶段。
  - `--no-edgartools-html`：只用 edgartools 做 filing 发现，primary HTML 改由 TS 侧从 SEC 拉取；适合绕开 edgartools `html()` 读取超时。
- R2 standard 归档范围：保存 `primary_html`、`index_html`、`section_text`、`section_blocks`；不默认归档 `section_html`、exhibits、attachments、data files。附件只入库清单、类型、描述和 SEC 原始 URL。
- 依赖：先安装 `requirements-edgartools.txt`。

共享入库 core：

- 文件：[annual-report-import-core.ts](/Users/rafael/R129/buffett-tribe/scripts/lib/annual-report-import-core.ts)
- 作用：承载 Prisma/R2/section artifact/facts/attachments/derived financials 的共享入库逻辑。

验证入口：

- 文件：[verify-10k-edgartools.ts](/Users/rafael/R129/buffett-tribe/scripts/verify-10k-edgartools.ts)
- 命令：`npm run verify:10k:edgartools`
- 作用：对同一批 ticker 跑 edgartools 导入，并按 accession 输出 sections、attachments、artifacts、facts、derived 计数。

保真度对比：

- 文件：[compare-annual-report-fidelity.ts](/Users/rafael/R129/buffett-tribe/scripts/compare-annual-report-fidelity.ts)
- 命令：`npm run compare:10k:fidelity -- --tickers AAPL,ZM,SNOW,VTS,TSM,ASML --out scratch/annual-report-qa/fidelity.json`
- 作用：对比已归档 `primary_html` 与结构化 section blocks。v3 blocks artifact 会保留 block HTML，所以脚本会按结构化阅读器实际渲染路径统计图片、表格、`colspan`、`rowspan`、inline style、iXBRL facts 等差异。默认只报告 warning；加 `--strict` 后有 warning 会返回非零退出码。
- 适用场景：检查年度报告页面的图片缺失、财务表格错位、结构化抽取丢失原 HTML 样式等问题。

结构化 sections 回填：

- 文件：[extract-10k-sections.ts](/Users/rafael/R129/buffett-tribe/scripts/extract-10k-sections.ts)
- 命令：`npm run extract:10k:sections -- --needs-current-version --limit 50`
- 作用：从 `primary_html` 重新抽取结构化章节。当前 v3 会把 table/image 的原 HTML 保存到 versioned `section_blocks` artifact，前端按需 hydrate 后可在结构化模式保留图片、`colspan`、`rowspan` 和原 inline style。
- 常用参数：`--ticker SNOW`、`--source-id <ExtSource.id>`、`--limit 50`、`--needs-current-version`。

全量入口：

- 文件：[import-all-10k-edgartools.ts](/Users/rafael/R129/buffett-tribe/scripts/import-all-10k-edgartools.ts)
- 命令：`npm run import:10k:all`
- 作用：按公司批量导入 2020 到最新的 10-K / 20-F / 40-F 年报，带 `.cache/import-10k-all.json` checkpoint，可中断续跑。
- checkpoint 粒度：同时记录公司级和年度级状态，包括 `completed`、`failed`、`inProgress`、`completedYears`、`failedYears`、`inProgressYears`。重跑时会跳过已完成公司；部分失败公司只补未完成年份。
- 日志：长任务建议把输出追加到 `.cache/import-10k-all.log`，便于恢复 session 后定位中断点。
- 常用参数：
  - `--from 2020 --to 2026`：导入年份范围。
  - `--concurrency 1`：公司级并发；默认 1，保守保护 SEC/R2/DB。
  - `--filing-concurrency 1`：子进程内 filing 并发；默认 1。
  - `--extract-timeout-ms 1800000`：edgartools helper 超时。
  - `--company-timeout-ms 5400000`：单个公司年度导入子进程超时。
  - `--retries 5 --retry-delay-ms 30000`：失败年份补跑时提高重试次数和间隔。
  - `--no-edgartools-html`：禁用 edgartools 预加载 primary HTML，改由 TS 侧拉取；用于处理 `html()` read timeout。
  - `--fresh`：忽略旧 checkpoint 重新开始。
  - `--dry-run`：只打印将要处理的目标，仍会刷新 checkpoint 的 `targetOrder`。

失败年份补跑示例：

```bash
npm run import:10k:all -- --from 2020 --to 2026 --concurrency 1 --filing-concurrency 1 --no-edgartools-html --extract-timeout-ms 1800000 --company-timeout-ms 5400000 --retries 5 --retry-delay-ms 30000
```

当前 2020-2026 全量导入结果：

- 公司：126/126 completed
- 年度报告：882 completed
- 失败项：`failed=0`、`failedYears=0`
- checkpoint：`.cache/import-10k-all.json`
- 日志：`.cache/import-10k-all.log`

补充：

- 归档层通过 `scripts/lib/filing-archive.ts` 统一管理
- 原始工件会按 `cik / accession / kind` 生成稳定的 R2 key
- 这条入口可以重复跑，standard artifact 会按固定 key 幂等写入，不会重复建脏数据

- 文件：[import-10k-from-13f.ts](/Users/rafael/R129/buffett-tribe/scripts/import-10k-from-13f.ts)
- 命令：`npm run import:10k:from13f`
- 作用：从最新持仓反推需要补齐财务数据的公司。

## 03. Security 修复入口

- 文件：[backfill-security-company-links.ts](/Users/rafael/R129/buffett-tribe/scripts/backfill-security-company-links.ts)
- 命令：`npm run backfill:security:company-links`
- 命令：`npm run backfill:security:company-links:dry`
- 作用：把 `Security` 重新挂到正确的公司实体。

## 04. Security 巡检入口

- 文件：[check-security-integrity.ts](/Users/rafael/R129/buffett-tribe/scripts/check-security-integrity.ts)
- 命令：`npm run check:security:integrity`
- 作用：检查 `Security -> companyEntityId` 和相关持仓映射是否完整。

## 05. 财务巡检入口

- 文件：[check-financial-integrity.ts](/Users/rafael/R129/buffett-tribe/scripts/check-financial-integrity.ts)
- 命令：`npm run check:financial:integrity`
- 作用：检查公司财务覆盖情况。

补充巡检：

- 文件：[check-all-company-financials.ts](/Users/rafael/R129/buffett-tribe/scripts/check-all-company-financials.ts)
- 作用：全量公司财务巡检，不在 `package.json` 主入口里。

## 06. 公司基本信息生成入口

- 文件：[generate-company-profile.ts](/Users/rafael/R129/buffett-tribe/scripts/generate-company-profile.ts)
- 命令：`npm run generate:company-profile`
- 命令：`npm run generate:company-profile:dry`
- 作用：生成并入库 `CompanyAnalysis.narrative.overview`，只负责公司基本信息，不生成业务概览或价值分析。

常用示例：

```bash
npm run generate:company-profile -- --company AAPL --force
```

## 07. 业务模型生成入口

- 文件：[generate-business-model.ts](/Users/rafael/R129/buffett-tribe/scripts/generate-business-model.ts)
- 命令：`npm run generate:business-model`
- 命令：`npm run generate:business-model:dry`
- 命令：`npm run generate:business-canvas`
- 命令：`npm run generate:business-canvas:dry`
- 作用：生成并入库 `CompanyAnalysis.narrative.business` 与 `BusinessCanvas`；旧的 `generate:business-canvas` 是兼容入口。

常用示例：

```bash
npm run generate:business-model -- --company AAPL --force
```

## 08. 价值分析生成入口

- 文件：[generate-value-analysis.ts](/Users/rafael/R129/buffett-tribe/scripts/generate-value-analysis.ts)
- 命令：`npm run generate:value-analysis`
- 命令：`npm run generate:value-analysis:dry`
- 作用：生成并入库 `CompanyAnalysis.moat`，只负责护城河、资本配置、风险与观察指标等价值分析。

常用示例：

```bash
npm run generate:value-analysis -- --company AAPL --force
```

## 09. 大师画像生成入口

- 文件：[generate-master-profile.ts](/Users/rafael/R129/buffett-tribe/scripts/generate-master-profile.ts)
- 命令：`npm run generate:master-profile`
- 命令：`npm run generate:master-profile:dry`
- 作用：生成并入库 `MasterProfile`，用于大师主页画像与投资方法摘要。

常用示例：

```bash
npm run generate:master-profile -- --master buffett
```

## 10. 季度持仓点评入口

- 文件：[generate-portfolio-insight.ts](/Users/rafael/R129/buffett-tribe/scripts/generate-portfolio-insight.ts)
- 命令：`npm run generate:portfolio-insight`
- 命令：`npm run generate:portfolio-insight:dry`
- 作用：生成并入库 `PortfolioInsight`，用于大师主页的季度组合点评。

常用示例：

```bash
npm run generate:portfolio-insight -- --master buffett
```

## 11. 首页信号生成入口

- 文件：[generate-home-signals.ts](/Users/rafael/R129/buffett-tribe/scripts/generate-home-signals.ts)
- 命令：`npm run generate:home-signals`
- 命令：`npm run generate:home-signals:dry`
- 作用：生成并入库首页信号快照 `HomeSignalSnapshot`。

## 11. 数据库健康检查入口

- 文件：[check-db.ts](/Users/rafael/R129/buffett-tribe/scripts/check-db.ts)
- 命令：`npm run check:db`
- 作用：做数据库层面的健康检查。

## 12. 名称与资料补齐入口

- 文件：[backfill-company-profiles.ts](/Users/rafael/R129/buffett-tribe/scripts/backfill-company-profiles.ts)
- 命令：`npm run backfill:company:profiles`
- 作用：补公司 profile 元数据。

- 文件：[backfill-names.ts](/Users/rafael/R129/buffett-tribe/scripts/backfill-names.ts)
- 命令：`npm run backfill:names`
- 作用：补中文名 / 英文短名。

- 文件：[sync-company-name-map.ts](/Users/rafael/R129/buffett-tribe/scripts/sync-company-name-map.ts)
- 命令：`npm run sync:company-name-map`
- 作用：同步 `CompanyNameMap`。

## 13. Neo4j 图谱入口

- 文件：[neo4j-schema-v2.ts](/Users/rafael/R129/buffett-tribe/scripts/neo4j-schema-v2.ts)
- 命令：`npm run neo4j:schema:v2`
- 作用：初始化 / 重建 Neo4j 图谱 schema。

- 文件：[neo4j-extract-triplets.ts](/Users/rafael/R129/buffett-tribe/scripts/neo4j-extract-triplets.ts)
- 命令：`npm run neo4j:extract`
- 作用：抽取关系 triplets。

- 文件：[neo4j-import-shareholder-range.ts](/Users/rafael/R129/buffett-tribe/scripts/neo4j-import-shareholder-range.ts)
- 命令：`npm run neo4j:import:2020-2025`
- 作用：批量导入股东信 / 资料范围到图谱。

- 文件：[neo4j-smoke-test.ts](/Users/rafael/R129/buffett-tribe/scripts/neo4j-smoke-test.ts)
- 命令：`npm run neo4j:smoke`
- 作用：Neo4j 联通性 smoke test。

## 14. 价格历史导入入口

- 文件：[fetch-stock-prices-yf.py](/Users/rafael/R129/buffett-tribe/scripts/fetch-stock-prices-yf.py)
- 命令：`npm run import:stock-prices:yf`
- 作用：用 `yfinance` 拉取日线历史并生成 Yahoo chart JSON，必要时再写入 `StockPrice`。

常用示例：

```bash
npm run import:stock-prices:yf -- --ticker AAPL --start 2025-05-23 --end 2026-05-26 --import-db
```

批量和断点续跑：

```bash
npm run import:stock-prices:yf -- --tickers AAPL,MSFT,GOOGL --start 2020-01-01 --end 2026-05-26 --import-db
```

本地准备：

```bash
python3 -m venv .venv
.venv/bin/pip install yfinance
```

说明：

- 脚本会默认写入 checkpoint，成功的 ticker 下次会自动跳过。
- 如需忽略 checkpoint 重新跑一遍，追加 `--fresh`。
- 如需遇到单个 ticker 失败就立刻停止，追加 `--fail-fast`。

全量 company 批处理入口：

- 文件：[import-company-stock-prices-yf.ts](/Users/rafael/R129/buffett-tribe/scripts/import-company-stock-prices-yf.ts)
- 命令：`npm run import:company-stock-prices:yf`
- 作用：自动从 `entity` 表读取所有 company ticker，按批调用 `yfinance` 导入脚本。

常用示例：

```bash
npm run import:company-stock-prices:yf -- --batch-size 10 --start 2020-01-01
```

## 15. 当前推荐顺序

最常见的运行顺序是：

1. `01` 导入 13F
2. `02` 导入 10-K
3. `03` 修 `Security`
4. `04` / `05` 做巡检
5. `06` / `07` / `08` / `09` 生成页面内容
6. `10` 生成首页快照

## 16. 非主入口

下面这些不应被当成当前主入口：

- 历史脚本
  - 例如已下线、未纳入运行面的脚本
- 实验脚本
  - `eval-*`
  - `bench-*`
  - `test-*`
- 草稿 / 迁移中脚本
  - 目前不在 `package.json` 主命令里，或者已被 `tsconfig.scripts.json` 排除

使用原则：

1. 先看这个 README，再决定用哪个命令
2. 优先跑 `package.json` 里的入口，不要直接执行散落脚本
3. 新增主入口时，先更新这里，再更新 `package.json`

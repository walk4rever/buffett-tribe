# Scripts

当前脚本较多，这里只给运行面的主入口做编号总览。目标是让人先知道“从哪进”，而不是先翻完整个 `scripts/` 目录。

## 01. 13F 导入主入口

- 文件：[pipeline-13f.ts](/Users/rafael/R129/buffett-tribe/scripts/pipeline-13f.ts)
- 命令：`npm run pipeline:13f`
- 作用：封装 13F 导入主流程。

直接导入入口：

- 文件：[import-13f.ts](/Users/rafael/R129/buffett-tribe/scripts/import-13f.ts)
- 命令：`npm run import:13f`
- 命令：`npm run import:13f:range`
- 作用：按季度区间导入 13F 原始持仓。

## 02. 10-K 导入主入口

- 文件：[pipeline-10k.ts](/Users/rafael/R129/buffett-tribe/scripts/pipeline-10k.ts)
- 命令：`npm run pipeline:10k`
- 作用：封装 10-K / XBRL 导入主流程。

底层入口：

- 文件：[import-10k-xbrl.ts](/Users/rafael/R129/buffett-tribe/scripts/import-10k-xbrl.ts)
- 命令：`npm run import:10k`
- 作用：按 ticker / 年份导入 10-K、20-F、40-F 财务数据。

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

## 06. 商业画布生成入口

- 文件：[generate-business-canvas.ts](/Users/rafael/R129/buffett-tribe/scripts/generate-business-canvas.ts)
- 命令：`npm run generate:business-canvas`
- 命令：`npm run generate:business-canvas:dry`
- 作用：生成并入库 `BusinessCanvas`。

常用示例：

```bash
npm run generate:business-canvas -- --company AAPL --force
```

## 07. 大师画像生成入口

- 文件：[generate-master-profile.ts](/Users/rafael/R129/buffett-tribe/scripts/generate-master-profile.ts)
- 命令：`npm run generate:master-profile`
- 命令：`npm run generate:master-profile:dry`
- 作用：生成并入库 `MasterProfile`，用于大师主页画像与投资方法摘要。

常用示例：

```bash
npm run generate:master-profile -- --master buffett
```

## 08. 季度持仓点评入口

- 文件：[generate-portfolio-insight.ts](/Users/rafael/R129/buffett-tribe/scripts/generate-portfolio-insight.ts)
- 命令：`npm run generate:portfolio-insight`
- 命令：`npm run generate:portfolio-insight:dry`
- 作用：生成并入库 `PortfolioInsight`，用于大师主页的季度组合点评。

常用示例：

```bash
npm run generate:portfolio-insight -- --master buffett
```

## 09. 公司分析生成入口

- 文件：[run-company-analysis.ts](/Users/rafael/R129/buffett-tribe/scripts/run-company-analysis.ts)
- 作用：生成并入库 `CompanyAnalysis`。

常用示例：

```bash
node --env-file=.env.local ./node_modules/.bin/tsx scripts/run-company-analysis.ts --all
```

说明：

- 这个脚本当前仍是主运行面的一部分。
- 但它还没有挂成 `package.json` 的正式别名。

## 10. 首页信号生成入口

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

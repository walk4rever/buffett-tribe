# Scripts

当前脚本较多，这里只给运行面的主入口做编号总览。目标是让人先知道“从哪进”，而不是先翻完整个 `scripts/` 目录。

## 00. 新公司一键 onboarding 入口

- 文件：[onboard-company.ts](/Users/rafael/R129/buffett-tribe/scripts/onboard-company.ts)
- 命令：`npm run onboard:company -- --ticker XXXX`
- 作用：给一个不在任何大师 13F 持仓里的全新美股 ticker 建立完整公司页，按顺序编排 7 步（每步跑完都查库验证真正写入了数据，不只看子进程退出码——`generate:*` 系列脚本会内部捕获单公司错误后仍退出 0）：
  1. `import:10k`（Entity + Financial + FilingSection + R2 归档）
  2. `import:stock-prices:yf --import-db`（StockPrice，可用 `--skip-price` 跳过）
  3-7. `generate:company-profile` / `generate:business-model` / `generate:value-analysis` / `generate:management-analysis` / `generate:valuation-analysis`（可用 `--skip-generation` 整体跳过）
- 常用参数：
  - `--ticker XXXX --from 2020 --to 2026`：ticker 和年份范围（默认 2020 到当前年）。
  - `--price-start 2020-01-01`：股价起始日期（默认 `fetch-stock-prices-yf.py` 自身的近 2 年）。
  - `--force`：透传给 5 个 `generate:*` 脚本，强制重新生成已存在的内容。
  - `--skip-price` / `--skip-generation`：只跑核心数据导入，跳过股价或全部 LLM 生成。
  - `--fresh`：忽略 checkpoint 从头开始。
  - `--dry-run`：只打印将要执行的步骤列表。
  - `--market cn|hk`：切换到 A股/港股 onboarding，9 步（`seed_entity` → `import:stock-prices:yf` → [cn: `import:cn-hk-financials` → `import:cn-annual-report` | hk: `import:hk-annual-report` → `import:cn-hk-financials`，顺序按市场不同，见下] → 5 个 LLM 生成步骤，见 14 号入口）。**`seed_entity` 不再需要手工种子表**（2026-08-06 起）：canonicalName/nameZh/nameEnShort/exchange/行业原文经 [fetch-cn-hk-company-profile-ak.py](/Users/rafael/R129/buffett-tribe/scripts/fetch-cn-hk-company-profile-ak.py) 用 akshare 自动查询，sector 由 [cn-hk-sector-classify.ts](/Users/rafael/R129/buffett-tribe/scripts/lib/cn-hk-sector-classify.ts) 用 LLM 分类。[cn-hk-company-seeds.ts](/Users/rafael/R129/buffett-tribe/scripts/lib/cn-hk-company-seeds.ts) 只作为坏数据兜底的手工覆盖表（ticker 在表里就用手填值，否则自动查），不是必需路径。currency：CN 硬编码 CNY（监管硬性要求），HK 从年报正文提取（正则频率统计 + LLM 兜底，[cn-hk-currency-resolve.ts](/Users/rafael/R129/buffett-tribe/scripts/lib/cn-hk-currency-resolve.ts)）——因此 HK 分支把"导入年报"排到"导入财务"前面（CN 不需要，顺序不变）。详见 `TODO.md` P0 ④。
- Checkpoint：按 ticker 存到 `.cache/onboard-company/<TICKER>.json`，记录每步验证通过的完成时间；重跑默认跳过已完成步骤，某一步验证失败会在该步停止，修好后重跑同一条命令即可从断点续跑。
- 2026-07-17 端到端验证：`--ticker ODFL --from 2024 --to 2024 --skip-price --skip-generation` 从零创建 Entity，10 条 `Financial` + 22 个 `FilingSection` 写入，R2 归档确认，checkpoint 断点续跑验证通过（生产库真实数据，非测试库）。

## 01. 13F 导入主入口

- 文件：[pipeline-13f.ts](/Users/rafael/R129/buffett-tribe/scripts/pipeline-13f.ts)
- 命令：`npm run pipeline:13f`
- 作用：封装 13F 导入主流程。

直接导入入口：

- 文件：[import-13f-edgartools.ts](/Users/rafael/R129/buffett-tribe/scripts/import-13f-edgartools.ts)
- 命令：`npm run import:13f`
- 命令：`npm run import:13f:range`
- 作用：用 `edgartools` 获取 13F-HR filing 与 holdings，按季度区间导入原始持仓。
- 支持 filer：不是硬编码列表——`getTrackedFilers()`（`scripts/lib/13f-import-core.ts`）从 `Filer` 表动态读取，新 onboard 的投资人下次 `import:13f --all` 自动纳入，无需改代码。核心三位 `buffett`/`lilu`/`duan` + Alpha 若干（截至 2026-08-13：`gavin-baker`/`alex-sacerdote`/`leopold-aschenbrenner`/`christopher-begg`/`terry-smith`/`mohnish-pabrai`/`chris-hohn`/`micky-malka`/`bill-ackman`）。
- 不传 `--quarter-list`/`--from`/`--to` 时默认只拉最近 4 个季度（`--quarters` 默认值）——onboard 新投资人若要对齐既有惯例，必须显式传 `--from 2020Q1 --to <最新季度>`，否则会静默漏掉早期历史。13F 导入没有定时任务、全靠手动触发，某个投资人某一季被漏掉不会有任何提示——用 `npm run check:13f-quarter-coverage`（见 18 号入口）核对每位 filer 从 2020Q1（或其自身首份 13F 更晚的话，以那份为准）到 EDGAR 最新 filing 是否连续无缺，2026-08-15 首次跑就抓出了 alex-sacerdote 和 leopold-aschenbrenner 各自的静默空档，已修复。
- 示例：`npm run import:13f -- --filer gavin-baker --quarter-list 2026Q1,2025Q4`。

共享入库 core：

- 文件：[13f-import-core.ts](/Users/rafael/R129/buffett-tribe/scripts/lib/13f-import-core.ts)
- 作用：承载 Entity / ExtSource / Security / Holding 的共享入库逻辑。
- `percentOfPortfolio` 按 `(holderEntityId, asOfDate)` 汇总重算（`reconcilePercentOfPortfolio()`），不是单份 accession 内自算——同一季度若跨多份 13F 文件披露（常见于新建仓位保密期满后单独补报），据此才能算出正确份额，详见 `PRODUCT.md` 数据字典「稳定主键原则」（2026-08-13 修复）。

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

结构化 sections 安全回填队列：

- 文件：[backfill-filing-section-jobs.ts](/Users/rafael/R129/buffett-tribe/scripts/backfill-filing-section-jobs.ts)
- 命令：`npm run backfill:filing-section-jobs -- --kinds 10k --sample 20`
- 作用：按 `ExtSource` 粒度创建并执行 `FilingSectionExtractionJob`，用于低速、可暂停、可审计地回填 v3 sections。状态包括 `pending`、`running`、`success`、`failed`、`no_sections`。
- 默认策略：单 worker、每份之间延迟 60 秒、`maxAttempts=1`，失败只记录 job error，不无限重试。
- 暂停方式：创建 `tmp/filing-section-backfill.pause`；worker 会在当前 source 完成后停止。
- 小样本验证：2026-06-08 已 seed 20 个 `10k` job；结果为 18 `success`、2 `no_sections`、0 `failed`。由于 Supabase Disk IO budget 已告警，扩大样本前应先观察 Supabase hourly Disk IO。
- 建议：先只跑 `10k`；`20f`、`40f` 单独排队和修 parser 后再跑，不要混入主回填。

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
- 作用：生成并入库 `CompanyAnalysis.profile`，只负责公司基本信息，不生成业务概览或价值分析。

常用示例：

```bash
npm run generate:company-profile -- --company AAPL --force
```

## 07. 业务模型生成入口

- 文件：[generate-business-model.ts](/Users/rafael/R129/buffett-tribe/scripts/generate-business-model.ts)
- 命令：`npm run generate:business-model`
- 命令：`npm run generate:business-model:dry`
- 作用：一次调用生成叙述文本与商业画布，一起写入 `CompanyAnalysis.business`（`{ narrative, canvas }`）。

常用示例：

```bash
npm run generate:business-model -- --company AAPL --force
```

## 08. 价值分析生成入口

- 文件：[generate-value-analysis.ts](/Users/rafael/R129/buffett-tribe/scripts/generate-value-analysis.ts)
- 命令：`npm run generate:value-analysis`
- 命令：`npm run generate:value-analysis:dry`
- 作用：生成并入库 `CompanyAnalysis.moat`（不叫 `value`——同一行还有 `valuation` 字段，一字之差易读混/敲错），只负责护城河、资本配置、风险与观察指标等价值分析。

常用示例：

```bash
npm run generate:value-analysis -- --company AAPL --force
```

## 09. 大师画像生成入口

- 文件：[generate-master-profile.ts](/Users/rafael/R129/buffett-tribe/scripts/generate-master-profile.ts)
- 命令：`npm run generate:master-profile`
- 命令：`npm run generate:master-profile:dry`
- 作用：生成并入库 `MasterProfile`，用于大师主页画像与投资方法摘要。**不基于我们数据库里任何持仓/13F/10-K 数据**——`bio`/`fundOverview` 是纯公开知识总结，等价于直接问 LLM"总结一下这个人和他的基金公司"，只传投资人姓名进 prompt。`bio` 写人物经历/投资理念，`fundOverview` 写基金背景+组织形式；两者都不涉及持仓集中度/行业分布/季度调仓，那部分由 10 号入口 `PortfolioInsight` 单独承担，避免重复（2026-08-14 改为纯公开知识总结，此前一度改成过引用我们自己算出的 13F 总市值，后发现这会把一个更窄口径的内部统计冒充成基金真实规模，撤回）。

常用示例：

```bash
npm run generate:master-profile -- --master buffett
```

## 09b. 大师资料库文章挂载入口

- 文件：[tag-insight-masters.ts](/Users/rafael/R129/buffett-tribe/scripts/tag-insight-masters.ts)
- 命令：`npm run tag:insight-masters`
- 命令：`npm run tag:insight-masters:dry`
- 作用：把 `/insights` 里实质讨论某位大师的文章，写入该文章 `InsightPost.entityIds`（追加，不覆盖，与 `tag-insight-companies.ts` 共用同一字段时安全共存），使其出现在 `/master/[id]` 资料库区。匹配靠标题包含人名或 `tags` 数组命中人名，不需要 LLM——这批内容（`import:insight` 导入的译文）的标题/标签本身就是可靠信号，与 `tag-insight-companies.ts` 需要 LLM 语义判断公司提及是否成立不同。
- 常用参数：`--master <tribeId>` 单个大师，`--all` 全部大师（含核心成员，无匹配自动跳过）。

常用示例：

```bash
npm run tag:insight-masters -- --master gavin-baker
```

## 10. 季度持仓点评入口

- 文件：[generate-portfolio-insight.ts](/Users/rafael/R129/buffett-tribe/scripts/generate-portfolio-insight.ts)
- 命令：`npm run generate:portfolio-insight`
- 命令：`npm run generate:portfolio-insight:dry`
- 作用：生成并入库 `PortfolioInsight`，用于大师主页的季度组合点评。
- 增减持判定用真实份额变化（`computeShareDeltaPct`，阈值 1%），不用 `percentOfPortfolio` 差值——后者会被股价波动和其他仓位膨胀稀释污染，2026-08-15 之前的版本因此把巴菲特"从未卖过的可口可乐"、李录"份额没变的腾讯音乐"都错误叙述成了减持。行业标签只用 `Entity.sector` 里的真实数据，没有数据的标的不让 LLM 瞎猜。持仓导入（01 号入口）不会自动触发这一步，两者永远是分开的手动环节，导入新一季持仓后要记得单独补跑。

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

## 13. 价格历史导入入口

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

## 14. A股/港股财务数据导入入口

- 文件：[fetch-cn-hk-financials-ak.py](/Users/rafael/R129/buffett-tribe/scripts/fetch-cn-hk-financials-ak.py)
- 命令：`npm run import:cn-hk-financials`
- 作用：用 `akshare` 拉取三大报表并映射到 `Financial`/`LINE_ITEMS`。港股（`--market hk`）按 `STD_ITEM_NAME` 中文科目名映射（`STD_ITEM_CODE` 按行业模板漂移——工商业 `004xxx`、保险/银行 `002xxx`，不可做键）；A 股（`--market cn`）按 Sina 宽表中文列名映射，含银行模板列名别名。导入前按 `REQUIRED_LINE_ITEMS` 校验完整性：科目全年份缺失（=模板未覆盖）直接报错退出，不导入半成品数据。

常用示例：

```bash
npm run import:cn-hk-financials -- --code 09992 --market hk --currency CNY --import-db
```

本地准备：

```bash
.venv/bin/pip install -r requirements-akshare.txt
```

说明：

- `--currency` 必须手工核对真实年报后填写，不能从 `--market` 推断——泡泡玛特虽在港交所上市，报表货币是人民币而非港币，这是本入口设计时踩过的一个真实坑，不是理论风险。
- 只按单公司调用（无跨 ticker 批处理/断点续跑），因为它总是被 `onboard-company.ts --market hk` 的 `import_financials` 步骤调用，断点续跑在 `onboard-company.ts` 那一层已经有了。

## 14b. 港股年报原文导入入口

- 文件：[fetch-hk-annual-report.py](/Users/rafael/R129/buffett-tribe/scripts/fetch-hk-annual-report.py)
- 命令：`npm run import:hk-annual-report`
- 作用：从披露易（HKEXnews）搜索并下载年报 PDF，`pypdf` 提取文本后切成 4 段存入 `FilingSection`（`ExtSource.kind = "hk-annual-report"`），供 `fetchLatestFilingEvidence()` 读取——这是 CN/HK 公司能跑通业务/价值/管理分析 LLM tab 的前提（`hasUsableFilingEvidence()` 之前一直因为没有年报原文而拒绝生成）。

常用示例：

```bash
npm run import:hk-annual-report -- --code 09992 --market hk --years 2 --import-db
```

本地准备：

```bash
.venv/bin/pip install -r requirements-hkex.txt
```

说明：

- 披露易的搜索是 JSF 应用，不是 REST API——直接 `requests.get()` 加查询参数会静默返回空结果，不报错也不提示。真正可用的做法：先访问搜索页拿 `javax.faces.ViewState`，POST 回去建立 session，再调 `titleSearchServlet.do`；且该接口在不指定股票代码时限制搜索跨度最多一个月，超了同样静默返回空——脚本按月回溯扫描，不是一次性查询。
- 该站点没有公开的"按股票代码搜索"参数（`stockId=-1` 表示不过滤，按 `STOCK_CODE` 本地过滤更可靠），且下载大文件较慢（实测约 85KB/s，一份 8MB 年报约 100 秒），脚本已按此设置了较长的超时，不是 bug。
- 只做港股（`--market hk`），A 股走巨潮资讯网（cninfo），机制不同，尚未实现。
- 切成 4 段是刻意不做 SEC Item 式精细边界识别——港股年报没有那种固定编号章节惯例，`fetchLatestFilingEvidence()` 真正需要的只是"有真实原文可引用"，不需要精确切边界。

## 15. 当前推荐顺序

最常见的运行顺序是：

1. `01` 导入 13F
2. `02` 导入 10-K
3. `03` 修 `Security`
4. `04` / `05` 做巡检
5. `06` / `07` / `08` / `09` 生成页面内容
6. `10` 生成首页快照

## 15b. 13F 季度覆盖巡检入口

- 文件：[check-13f-quarter-coverage.ts](/Users/rafael/R129/buffett-tribe/scripts/check-13f-quarter-coverage.ts)
- 命令：`npm run check:13f-quarter-coverage`（`-- --json`、`-- --strict`）
- 作用：拿 SEC EDGAR 的真实 13F-HR report date 列表（[edgartools_13f_report_dates.py](/Users/rafael/R129/buffett-tribe/scripts/edgartools_13f_report_dates.py) 只读 `filing.report_date`，不调用 `.obj()`，快且不会崩）当基准，核对每位 tracked filer 从 2020Q1（或其自身首份 13F 更晚的话，以那份为准）到 EDGAR 最新 filing 之间，`ExtSource` 里是否每季都有。13F 导入没有定时任务、全靠手动触发，某一季被漏掉不会有任何提示；2026-08-15 首次跑就抓出 alex-sacerdote（缺 2026Q1）和 leopold-aschenbrenner（缺 2024Q4、2025Q1）两个静默空档，已修复，复跑后 12/12 全绿。

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
- 一次性数据种子脚本
  - `seed-punch-duan-apple.ts` — 打孔（Punch）功能第一条种子数据（段永平 × 苹果），已跑过写入生产库，保留作为未来其他"孔"录入的模板参考，不是重复运行的主入口

使用原则：

1. 先看这个 README，再决定用哪个命令
2. 优先跑 `package.json` 里的入口，不要直接执行散落脚本
3. 新增主入口时，先更新这里，再更新 `package.json`

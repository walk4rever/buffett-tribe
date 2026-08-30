# Handoff — 批量公司 Onboarding（2026-08-29 ~ 08-30）

## 这是什么

清理 `/company` 页面"待完善"分组的存量——DB 里有 13F 持仓提到但从未 onboard 的公司桩（`Financial` 行数为 0）。开始时 259 家，全部美股。目标是批量跑 `onboard:company` 补全 Financial + 五段 LLM 生成内容（profile/business/moat/management/valuation）。

## 执行地点：从 air7 迁移到 mini

**air7（阿里云新加坡）跑批次 1（50 家）时触发了硬重启**——3.4G 内存的机器上除了 buffett-tribe 的 pi-gateway/gbrain，还挤着一个完全无关的项目 **pi-matrix**（docker-compose，6 个容器：litellm + 5 个 uvicorn + orchestrator，常驻吃掉 ~820MB），叠加批量任务处理大文件（诺基亚 18MB 的 10-K）瞬时内存飙升，触发 OOM，进而系统级 panic 重启（不是单进程被 kill 那么轻）。

**处理**：
- pi-matrix 全部停止+移除（`docker compose down` + 单独 `docker rm` 两个动态起的 executor 容器，都是 `restart: always`，必须删除不能只 stop）
- air7 加了 2G swap 兜底
- 最终决定：**批量 onboard + 两条股价周更 cron 全部迁移到 mini**（Mac mini M4，32G 内存，ssh 别名 `mini`）。air7 上只留 `pi-gateway-buffett-tribe`（`/agent` 实时聊天网关，必须留在云主机）
- air7 上的 `/root/cron-job-buffett-tribe` checkout 已删除，crontab 已清空 buffett-tribe 条目
- mini 上环境：`~/buffett-tribe`（repo + node_modules + `.venv`），`.env.local` 手动放置（DB/AI/R2 共 10 个变量），crontab 复用 air7 同款两条（周六 01:00 cn,hk / 周日 01:00 us，mini 系统时区已是北京时间）——两条 cron 都用跟 crontab 一致的受限 PATH 手动模拟触发验证过，全部成功

**已知代价**：mini 到 Cloudflare R2 的网络延迟比 air7 高约 4 倍（实测 TLS 握手：air7 ~55ms vs mini ~210-230ms）。10-K 导入每个 section 要归档 2 份文件到 R2（文本+区块 JSON），一份 filing 20+ 个 section、6 年份 filing，全部串行，单公司这一步能到 3-12+ 分钟，比在 air7 上明显慢。见下方「效率问题」一节——**这个描述本身不准确，两份文件里有一份根本不该写，已在 P1 停写（见下）**。

## 本轮修复的真 bug（均已本地 typecheck/lint 过，部分已在 mini 上跑通验证）

1. **批量循环无容错**——`onboard-alpha-investor.ts --onboard-holdings` 原来一个 ticker 失败就拖垮整批。抽成共享helper `scripts/lib/onboard-batch-runner.ts`（`onboardTickersWithFailureIsolation`），catch+log+continue+汇总失败列表。
2. **`generate-valuation-analysis.ts` 的 P/E 门槛误杀亏损公司**——原来 `pe.current == null` 就整篇跳过；改成只要 `pe.current`/`priceToOcf`/`priceToFcf`/`revenueCagrPct` 任一可用就生成，P/E 缺失时 prompt 明确告诉 LLM 用 P/OCF、P/FCF、营收增速代替，不许编造 PE 数字。
3. **情景测算对负 EPS 公司算出荒谬的负股价**——`src/lib/valuation-metrics.ts` 的 `computeScenarios()` 原来只判空不判负；ACVA 这类全亏损年公司放宽 P/E 门槛后暴露：情景算出 `impliedPrice: -9.42` 这种负数股价。已加 `latestEps <= 0` 判空，补了单测（`tests/valuation-metrics.test.ts`）。
4. **`onboard:pending` 批量脚本没装 edgartools**——`scripts/deploy-cron-job.sh` 原来只在部署时装 yfinance，没装 edgartools，第一次在 air7 上试跑直接 `ModuleNotFoundError`。已加 `-r requirements-edgartools.txt`。**mini 上没走这个脚本，是手动装的，装了 edgartools+yfinance+akshare+pypdf+pymupdf 全套**。
5. **AVAV（AeroVironment）10-K 导入选中了同一财年的原始 filing + 10-K/A 修正案两份**——`scripts/edgartools_annual_report_extract.py` 原来按年份范围选 filing 时没去重，修正案通常只改一部分内容、抽不出完整 section，触发 per-filing 零 section 校验失败。已按 `report_date` 去重，同财年优先保留非 `/A` 版本。**这个 bug 会影响任何历史上发过 10-K/A 的公司，不只 AVAV**，已验证修复且清理了 AVAV 之前写入的那条 0-section 脏数据（`ExtSource` 表）。
6. **股价周更 checkpoint 会永久冻结**——最严重的一个，**独立于本轮批量任务，影响所有未来的周更 cron**。`fetch-stock-prices-yf.py` 的 skip 判断只比对"参数签名"，而 `--start` 是从当前 `StockPrice` 最大日期反推的；一旦某个 ticker 被跳过一次，它自己的最大日期就不再前进，下一次（哪怕一周后）算出的签名完全相同，于是又被跳过——自锁循环，一旦触发就永远不会再更新。已加 20 小时过期窗口（保留同批次崩溃重跑不必重下的本意，同时保证跨周一定会重新检查）。**这个是 2026-08-30 用户怀疑"美股那次周更没成功"顺藤摸瓜挖出来的，如果没有这次排查，价格数据会在 2026-08-28 那天永久卡住**。
7. **`onboard-company.ts` 断点丢失后重跑，会把"合法跳过"误判成"失败"**——`verifyCompanyAnalysisField()`（原名 `wasCompanyAnalysisFieldUpdatedSince`）原来只认"这一步是不是刚写入的"，不认"这个字段本来就有值"。迁移到 mini 后本地 checkpoint 全部丢失（`.cache/onboard-company/` 没跟着 rsync），重跑已经成功过的公司时，`generate:*` 脚本正确跳过（"already has X, use --force"），但校验逻辑仍判定失败——VEEV 撞上过。已改成：无 `--force` 时字段非空即算成功；有 `--force` 时保留原来的"必须是这一步写入的"严格校验（防止 `--force` 重跑时 LLM 静默超时却误报成功）。

## 已知但故意不修的两个缺口

- **INTC（Intel）**：10-K 导入财务数据成功，但 6 份 filing 全部抽取出 0 个 section。查到根因是 Intel 的 TOC 表格结构被 `collectRenderableBlocks()` 整个折叠成一个巨大 table block（"Item Number | Item Part I Item 1. | Business: ..." 这种表头+多行拼一起），`isLikelyItemHeadingTable()` 的正则匹配不上开头。这是抽取器的深层结构问题，TODO.md 里已经记过同类故障好几次（RACE 页脚锚点、INTU 连字符标题），需要专项时间做回归测试，本轮没有动手改。
- **BTGO（BitGo）**：section 抽取正常（23 个），但 `parse inline facts: facts=0` ——它的 10-K 主文档没有 `ix:` inline XBRL 标签（用 SEC 官方 API 核实过，`xmlns:ix` 命名空间根本没声明）。大概率是刚上市公司还在传统 XBRL（非 inline）豁免期内，我们的财务推导逻辑只认 inline XBRL。这是能力缺口，不是 bug，跟当年"CN/HK 需要独立抽取路径"是同一类问题。

## 当前进度

- 起始待处理：259 家（全美股）
- 已排除 1 家非公司 ticker（QQQ，ETF，`onboard:pending` 现在会自动过滤）
- **批次 1（air7，50 家）**：42 成功，8 失败（VEEV/VECO/AVAV/NOK/JOBY/AMBQ/INTC/BTGO）——除 INTC/BTGO 外全部已在后续处理中解决或确认为合理跳过
- **批次 2（mini，50 家，跑了 6.5 小时后用户手动叫停）**：27 成功，4 失败尝试（BTGO/GEMI/VOYG/NKE）+ 1 家被中断（GRAB）——NKE 已续跑成功，GRAB 续跑中，GEMI/VOYG 确认合理跳过
- **当前剩余待处理：约 175 家**

## 效率问题：根因已查清，方案 P0-P3 已落地为代码（2026-08-30，未 commit/未部署/清理脚本未跑——见文末「当前状态与部署清单」）

**先说结论：之前记的「需要把 section 级 R2 归档改成并发批量上传」方向是错的。真正的问题是这两份 section 文件里有一份根本不该写——写入路径还在跑，读取路径 2026-06-13 就被删干净了，中间隔了两个半月没人发现。**

### 时间线

- **`9722cc8a`（2026-06-13）** 年报阅读器从「分章节懒加载」改成 **iframe 直接指向 `primary_html`**。commit message 原话：*"section_text / section_html / section_blocks FilingArtifacts are now unused"*，并写了 `scripts/cleanup-section-artifacts.ts` 一次性删掉 **3 万行** R2 对象 + DB 行。
- **写入端（`scripts/lib/filing-section-storage.ts`）漏删了**——它最后一次改动是 06-09，清理 commit 是 06-13，压根没被碰过。
- 于是此后每一次 onboarding 都在原地重新造一遍垃圾。生产库现状（2026-08-30 查）：

```
kind             行数      总大小     创建时间
section_blocks   13,986   2,546 MB   100% 在 2026-06-14 之后
section_text     14,303     324 MB   100% 在 2026-06-14 之后
primary_html      1,337   5,538 MB
```

### 前提：FilingSection 只有一个生产读者

做任何取舍之前先确认消费方，`grep` 结果很干净：

- 年报阅读器读的是 `primary_html`（美股 iframe，`FilingReader`）或 `primary_pdf`（CN/HK，`PdfFilingReader`）——见 `src/app/company/[id]/annual-report/[year]/page.tsx:44` 起，**全程不碰 FilingSection**
- `/api/filing-section` 是全站唯一读 FilingSection 的 app 代码，且**零调用方**
- 唯一真实消费方是 pi-gateway 的 `search_filings`（裸 SQL）

**所以 section artifact 的所有决策，只需要对着 `search_filings` 一个消费者判断。**

### 三个市场的实测真相表（2026-08-30 生产库）

| filing kind | 公司 | sections | 有 text artifact | 有 primary_html | 当前的全文路径 | 状态 |
|---|---|---|---|---|---|---|
| `10k` | 208 | 23,690 | 12,693（**54%**） | ✅ | 重解析 primary_html | 能用，慢 |
| `20f` | 23 | 2,992 | 1,293（**43%**） | ✅ | 重解析 primary_html | 能用，慢 |
| `40f` | 2（BN/SU） | 31 | **0** | ✅ 但是错的文档 | **两条路都断** | 🔴 静默降级 |
| `cn-annual-report` | 7 | 168 | 168（100%） | ❌ | 只有 text artifact | 能用，唯一副本 |
| `hk-annual-report` | 7 | 142 | 142（100%） | ❌ | 只有 text artifact | 能用，唯一副本 |
| `us-prospectus` | 1 | 4 | 4 | ✅ 但 kind 不可解析 | 只有 text artifact | 能用 |

两条之前没抓到的：

**① 美股有近一半 section 根本没有 text artifact**（10-K 缺 10,997 条、20-F 缺 1,699 条），是 6 月一刀切删掉的存量。这直接决定了下面 P3 不能是简单"翻转优先级"——翻转后仍有 46% 落回重解析。

**② 40-F 的全文在 `/agent` 上是坏的，而且不报错。**

```
BN 2025 management_discussion_and_analysis   真实 721,959 字符
                                             search_filings 实际返回 ~1,869 字符（0.26%）
```

两条路同时踩空：40-F 的 section 从 EX-99 附件抽取（`upsert40FAttachmentSections`），key 是 `management_discussion_and_analysis` / `annual_information_form`；而 `fetchFullSectionContent()`（`services/pi-gateway/src/tools/search-filings.ts:155`）拿 40-F 封面表的 `primary_html` 去跑 10-K item 解析器，永远产不出这些 key；接着 `row.text_artifact_url` 又是 NULL（6 月删的）。两条都 null 之后，`search-filings.ts:259` **静默回退到 `row.content`**——被截断的预览。Agent 在用 0.26% 的 MD&A 回答 Brookfield 的问题，没有任何异常信号。

### 单公司 onboard 的 R2 账（美股，6 份 filing × 平均 19.9 章）

| 写什么 | 次数 | 体积 | 谁在读 |
|---|---|---|---|
| `primary_html` | 6 | ~25 MB | **刚需**：阅读器 iframe（`/api/filing-html`）+ `search_filings` 全文（现场重解析） |
| `index_html` | 6 | ~0.1 MB | 无人读（但只有 6 次、每次 16KB，可忽略） |
| `section_text` | ~120 | ~2.8 MB | US 上是 `search_filings` 的回退路径；HK/CN/40-F 上是**唯一**全文来源 |
| `section_blocks` | ~120 | **~22 MB** | **零生产消费方** |

**成本模型修正**：之前记的「210ms TLS 握手 × 840 次」不成立——`@smithy/node-http-handler` 里 `keepAlive = true` 是硬编码默认、`maxSockets` 默认 50，连接是复用的。真正的串行成本是**每个 artifact 三次往返**（`scripts/lib/filing-archive.ts:200 / 216 / 220`）：

```
Prisma findUnique  →  R2 PutObject  →  Prisma upsert
```

252 个 artifact × 3 ≈ **756 次串行往返，其中三分之二打的是 Supabase 不是 R2**。这个修正的意义：砍掉 `section_blocks` 只消掉一半，剩下一半仍是延迟绑定的，**并发才是承重的那一刀**——而且 socket 池（50）本来就够用，不需要额外配置。

`section_blocks` 比之前记的更冤：`buildStoredFilingSectionData()` 在 `filing-section-storage.ts:109` 深拷贝每一个 block，只为了 `:126` 读一次 `.length`；而 `.map()` 恒等保长，`lightBlocks.length` 永远等于 `extracted.blocks.length`——**整个计算可证明是 no-op**，不只是"结果只用了长度"。上传的仍是没剥 html 的 `extracted.blocks`，那 2.5GB 绝大部分是每章 HTML 的第二份拷贝，第一份就在同一 filing 的 `primary_html` 里。

### 为什么不能一刀切把两份都停掉、并跑 `cleanup-section-artifacts.ts` 清库

**`section_text` 是 HK/CN 年报的唯一全文来源，删掉不可恢复。**

```
kind                sections  有text artifact  DB存的长度  真实长度  父级有primary_html
cn-annual-report      168         168           8,000     60,063        0
hk-annual-report      142         142           7,787     81,586        0
us-prospectus           4           4           8,000    365,197     4（但 FilingKind 不含此 kind，解析器不支持）
10k / 20f          26,682      13,986           2,266     20,850    26,672
```

HK/CN 走 PDF → pypdf 抽文本，**没有 `primary_html` 可重解析**，而 DB 里的 `content` 已被 `vacuum-bloated-tables.ts` 截到 8000 字符（真实 6-8 万字）。删 artifact = 87% 正文永久消失，只能重下 PDF 重抽。`a10942b8`（2026-07-27「search_filings now covers HK companies」）加的 `text_artifact_url` 回退分支就是为这条路存在的。

**6 月那次一刀切已经造成过一次丢失**，就是上面那条 40-F 静默降级的来源。**`cleanup-section-artifacts.ts` 不能再原样跑第二次**——`scripts/cleanup-section-artifacts.ts:46` 是 `kind IN ('section_text','section_html','section_blocks')` 一把删，不区分来源。

**另外，`section_text` 对美股 agent 其实是更便宜的路，只是没在用。** `search_filings` 每次带 section 的查询取 3 行，并行对每行执行 `fetchFullSectionContent()`：下载 4MB `primary_html` → 跑完整 10-K 的 cheerio 解析。**单次提问 = 12MB 下载 + 3 次全文解析**（代码注释自己承认 R2 读延迟 "sub-second to 2+ minutes" 大幅波动，所以加了重试）。而 `section_text` 只有 23KB、直接读、不用解析。它现在排在后面，只是因为 `15df715d`（2026-07-08）写这段时 section artifact 刚被 6 月删光、不可用。

### 方案与落地状态（按必要性排序，2026-08-30 P0-P3 已完成，未 commit）

**P0 — 修 40-F 全文（正确性问题，跟性能无关）—— ✅ 已完成**
1. 对 BN / SU 在 mini 上重跑 `import:10k --from 2020 --to 2026`，`buildStoredTextOnlyFilingSectionData` 把 42 条 40-F section 的 text artifact 全部补回（此前 0/31 有 artifact；`code_of_ethics`/`audit_committee_financial_expert` 等此前从未提取过的 section 这次也一并写入）。已验证：BN 2025 `management_discussion_and_analysis` 的 `contentTextLength` 从 1,869（0.26%）恢复到 722,594（100%）。
2. `services/pi-gateway/src/tools/search-filings.ts`：`fetchFullSectionContent()` 两条路都失败、只能回退到截断预览时，不再静默——在 excerpt 前拼一句可见警告（"⚠️ 完整正文暂不可用...请勿据此得出结论"），带真实长度对比。已过 L3 golden test（`search-filings.test.ts`）+ pi-gateway tsc + 根目录 lint/typecheck/vitest 全绿。**尚未部署到 air7**（改动在 `services/pi-gateway/` 下，需要 `deploy.sh` 才能生效，见下方"提交状态"）。

**P1 — 停写 + 清理 `section_blocks`** —— ✅ 代码已改，清理脚本尚未执行
- `scripts/lib/filing-section-storage.ts`：删掉 `archiveSectionBlocksArtifact()`，`buildStoredFilingSectionData()` 不再上传 blocks artifact，`blocksArtifactId` 恒为 `null`，`blockCount` 直接读 `extracted.blocks.length`（不再算无用的 `stripBlocksHtml()`，但保留该函数导出——`migrate-filing-sections-to-artifacts.ts`仍在用，那是另一个历史一次性脚本，不动它）。
- `scripts/cleanup-section-artifacts.ts`：`kind` 过滤收窄为只删 `'section_blocks'`，并在文件头写清楚**为什么不能再把 `section_text`/`section_html` 加回这个 IN 列表**（6 月那次一刀切删过一次，40-F 那 31 条就是那次事故的产物，P0 刚修好）。
- **清理脚本本身还没跑**——现在跑 `tsx scripts/cleanup-section-artifacts.ts --dry-run` 应该只报 13,986 个 `section_blocks`；确认后去掉 `--dry-run` 执行，删掉存量 2.5GB。

**P2 — 把 `sectionConcurrency` 传进去** —— ✅ 已完成
`scripts/import-10k-edgartools.ts`：新增 `SECTION_CONCURRENCY = 6` 常量，`upsertFilingSectionsFromHtml()` 调用点补上第 9 个参数。之前是默认值 1（`mapLimit` 写好了形同虚设）。

| | 上传次数 | 上传字节 | 串行往返 |
|---|---|---|---|
| 改动前 | 252 | ~50 MB | ~756 |
| P1+P2 之后 | 132 | ~28 MB | **~66** |

**P3 — `search_filings` 优先读 text artifact，缺失时回退 primary_html** —— ✅ 窄范围版本已完成
`fetchFullSectionContent()` 里两个分支顺序对调：先试 `text_artifact_url`（几十 KB，免解析），失败/缺失再回退 `primary_html` 重解析（几 MB + 完整 cheerio 解析）。**没有做的部分**：缺失的 12,696 条 text artifact（46% 的美股 10-K/20-F section）仍然是缺失状态，不会因为这次改动被补上——那是一个单独的、量级更大的 backfill 任务，本次只是让"已有的时候优先用",不改变"没有就还是重解析"这一半的行为，所以没有覆盖率回归。

L3 golden test 结果（`tests/agent-tools/search-filings.test.ts`，连续跑 3 次）：HK（泡泡玛特）、CN（贵州茅台）、"list available sections"（AAPL）三个用例稳定通过——其中 HK/CN 两个用例正是验证"text artifact 优先"路径的用例。第 4 个用例（DIS 2020 10-K "Aspire"）连续 3 次失败，**确认与本次改动无关**：该 section 的 `textArtifactId` 本身是 `null`（我方改动的代码分支对它是纯 no-op），直接对其 `primary_html`（6.1MB）计时得到单次 fetch 75.5 秒，超过工具自身 `FULL_TEXT_FETCH_TIMEOUT_MS`（45秒/次 × 2 次重试 = 90秒预算）——是当前 R2 到本机的网络延迟处在代码注释早就承认的"2+ 分钟"区间的高位，命中了一个**预算不够用的既有问题**，不是本次四项改动引入的回归。**建议单独立项**：要么把 `FULL_TEXT_FETCH_TIMEOUT_MS`/重试次数调大，要么把这类大文件全文重解析的兜底也做成"先返回预览+警告，后台异步补全"，而不是让工具调用同步等 90 秒。

**不要动**：`buildStoredTextOnlyFilingSectionData` 及 CN/HK/prospectus/40-F 的写入路径，一行别碰——这次全程没碰。

**只提不删（CLAUDE.md §3）**：`/api/filing-section` 死路由、`index_html` 归档无消费方；另外 SPCX 那 4 条 `us_prospectus_1..4` 长度分别是 365,198 / 365,198 / 365,197 / 365,196，看起来是同一份文档的四份近似重复，不是真的分了 4 章。

按当前未优化的速度，剩下 175 家还要 30-40 小时；P1+P2 落地后这个数字会大幅下降（清理脚本还没跑，P2 的并发已经在代码里，下次 onboard 批次会直接生效）。

## 接下来怎么续跑

**⚠️ 续跑前必须先把 mini 的代码同步到最新**——见下方「当前状态与部署清单」，mini 现在缺 6 个已发布的 bug 修复，也缺本次 P0-P3 的全部改动。原样在 mini 上跑 `onboard:pending` 会：继续用未隔离失败的批量循环（`onboard-alpha-investor.ts` 那份仍然是老代码是没关系的，`onboard:pending` 走的是新脚本 `onboard-batch-runner.ts`——这个从写出来就在 v0.43.35 之前，mini 上是有的；但 P/E 负值、40-F 去重、股价 checkpoint 冻结、`--force` 断点误判这 4 个修复 mini 没有）、继续写入已经决定要停掉的 `section_blocks`、并发仍是 1。

```bash
ssh mini
cd ~/buffett-tribe
export PATH=$HOME/node/bin:/opt/homebrew/bin:$PATH
npm run onboard:pending -- --dry-run          # 先看还剩多少、都是谁
npm run onboard:pending -- --limit 50         # 建议继续按 50 一批，别一次性跑完
```

每批建议：跑完看失败列表分类（合理跳过 / 已知缺口 / 真失败），抽查几家生成内容质量，确认没问题再开下一批。

## 当前状态与部署清单（2026-08-30 会话结束时）

代码分布在三个地方，版本互不一致，续跑或部署前先对照这张表：

| 位置 | 6 个 bug 修复（`4bff4b33`/v0.43.36） | 本次 P0-P3 | 备注 |
|---|---|---|---|
| 本地 `main` 分支 | ✅ 已 commit 已 push | ✅ 已 commit（`dc19e425`+`524ae382`）已打 tag `v0.43.37` 已 push | — |
| mini（`~/buffett-tribe`） | ❌ 缺失，仍是 v0.43.35 | ❌ 缺失 | 不是 git checkout（无 `.git`），代码靠人工同步，不会自动跟上 push——**这是目前唯一还没同步的地方** |
| air7（pi-gateway，`/agent` 生产网关） | 不适用（独立部署单元） | ✅ 已跑 `deploy.sh` 部署，已重启 PM2，已 grep 确认部署文件含改动 | — |

**✅ P0-P3 已全部落地（2026-08-30 会话内完成，更新于清理脚本执行后）**：

1. **Commit + 部署 + 打 tag，已完成**：`dc19e425`（fix: stop writing zero-consumer section_blocks artifacts, fix silent 40-F truncation）+ `524ae382`（chore: bump version to v0.43.37），已打 tag `v0.43.37` 并推送到 `main`。`services/pi-gateway/deploy.sh` 已跑，air7 上的 `pi-gateway-buffett-tribe` 已重启并核实部署的文件里含 P0/P3 改动（grep 确认过）。
2. **`section_blocks` 清理脚本已执行**：`--dry-run` 先确认只有 `section_blocks`（13,999 个，比复盘时的 13,986 略多——多出的是 BN/SU 40-F 补跑时 mini 还在用 P1 之前的旧代码写入的），确认后正式跑，R2 + DB 共删除 13,999 个对象。执行后复查 `FilingArtifact` 按 kind 分组：`section_blocks` 已归零，`section_text`（14,357）/`primary_html`/`primary_pdf` 等其他 kind 均未受影响。
3. **验证**：lint / typecheck（app + scripts + pi-gateway）/ 根目录 vitest 全绿；`search-filings.test.ts` 的 4 个 L3 golden case 里 3 个稳定通过，第 4 个（DIS "Aspire"）因 2026-08-30 当次 R2 到本机的实测延迟（75.5s/6MB，超过工具自身 45s×2 的重试预算）失败，确认与本次改动无关（该行 `textArtifactId` 为 `null`，P3 的改动对它是 no-op）。

**已经落地、不可逆的部分**（生产数据库已直接变更）：BN、SU 两家 40-F 公司的 42 个 `FilingSection` 全部补上了 `textArtifactId`（此前 0/31）；`section_blocks` 存量已从 R2/DB 彻底删除。

**唯一还没做的事——同步 mini**：mini（`~/buffett-tribe`）的 `scripts/` 目录仍然落后两轮，既没有更早的 6-bug-fix 提交（`4bff4b33`/v0.43.36），也没有本次 P0-P3。**下次在 mini 上跑 `onboard:pending` 之前必须先手动同步这些文件过去**，否则会继续写入已经决定停掉的 `section_blocks`（清理脚本只是删存量，不会阻止旧代码继续产生新的）、并发仍是 1。

**新发现、不在 P0-P3 范围内、建议单独立项**：`FULL_TEXT_FETCH_TIMEOUT_MS`（45秒 × 2 次重试 = 90秒预算）相对 2026-08-30 实测的 R2 延迟（6MB 文件单次 fetch 75.5 秒）偏小，`search_filings` 对没有 text artifact 的大 section 做 `primary_html` 现场重解析时有真实概率超时降级到截断预览（叠加 P0 的警告后至少不会再是静默的，但仍是能力缺口）。

---

# Handoff 追加 — 品牌改名 Value Tribe + DIS 测试根因订正（2026-08-30 第二次会话）

## 1. 品牌改名：巴菲特部落 · Buffett Tribe → 价值部落 · Value Tribe

起因是讨论「给美国市场用户做一条主力支线」。结论是**不 fork、不开长期 branch**——数据层（13F / 10-K / filing sections / 股价）本来就是英文源数据，`Chunk` 表更是早已 `contentEn`（必填 100%）+ `contentZh`（95% 覆盖）的英文优先双语结构，检索三条路径全查 `contentEn`。英文版真正的增量成本只在表现层和生成内容，fork 会把 105 个脚本和 schema 复制一份、每个管线 bug 要修两遍。完整方案（locale 载体、schema locale 维度、分期）见下方第 3 节。

改名本身作为方案的 P0 单独发布（域名暂不处理，用户明确押后）。

- **新增单一真源**：`src/lib/brand.ts`（`BRAND_ZH` / `BRAND_EN` / `BRAND_FULL`）+ `services/pi-gateway/src/brand.ts`（pi-gateway 是独立 deployable，无法跨包 import，两份需手动同步，文件注释里写明了）。
- **改动面**：Next.js 应用 24 个文件、pi-gateway 2 个 tool 的 label/description + `AGENTS.md`、`scripts/send-announcement.ts`、README/PRODUCT/CLAUDE.md。
- **刻意未改的内部标识符**（改了会破坏线上数据或部署）：R2 key 前缀 `buffett-tribe/users/...`、PM2 进程名与远端目录 `pi-gateway-buffett-tribe`、`package.json` 的 `name`、`/api/mcp` 的 MCP server `name`、以及全部域名（含分享卡片上的 `https://buffett.air7.fun`）。
- **刻意未改写的历史记录**：`PRODUCT.md` 的 2026-08-28 变更日志条目、`TODO.md:189` 的 v0.43.5 条目——它们记述过去发生的事，其中还引用了 `InsightPost.source` 当时的真实数据值，改写历史日志是错的。
- **生产数据迁移（已执行，不可逆）**：`InsightPost` 的 `source` 6 行、`author` 6 行、`contentRaw` 英文 6 行 + 中文 1 行，全部由旧品牌改为新品牌。做这个是因为 `/insights` 把 `source` 直接当标签渲染、且 `master-data.ts` 的徽章映射是拿它当键查的，不迁移会出现「站点已改名但这 6 篇仍显示旧名」。迁移完成后 `master-data.ts` 里过渡用的旧键别名已删除。

## 2. 订正：DIS "Aspire" 测试失败的真实根因不是 R2 延迟

上一节记录把它归因为「R2 到本机延迟 75.5s 超过 45s×2 预算」。**这个结论不完整**。真实根因是 **`section_text` artifact 缺失**：

- DIS 2020 的 `item_1_business` 全文 83,675 字，`FilingSection.content` 只存了 3,000 字预览，而 `textArtifactId` 为 `null`。`FilingSection.textArtifact` 的外键是 `onDelete: SetNull`，所以 **artifact 一被删，链接就自动变 NULL**——这正是早期那版「三种 kind 全删」的 `cleanup-section-artifacts.ts` 造成的，上次只回填了 BN/SU，没回填其他公司。
- 走 `primary_html` 现场重解析这条兜底路径时，DIS 2020 的 primary_html 有 6.1MB，确实会撞上延迟预算——但那只是**第二重失败**，不是根因。
- **修复**：`npm run import:10k -- --ticker DIS --from 2020 --to 2020` 重导一次，21 个 section 全部补上 text artifact。测试通过，且耗时从 **101s 降到 9.25s**（走上 text artifact 快速路径，不再重解析 6MB HTML）。

上次记录里「P3 的改动对它是 no-op」的说法也需要订正：P3 加的降级警告**正常工作**——工具如实输出了「⚠️ 完整正文暂不可用……原文共 83,675 字，此处仅 3,000 字，请勿据此得出结论」。P3 把一个静默的错误变成了一个可见的错误，这正是它该做的；测试失败是**被 P3 暴露出来的真实数据缺陷**，不是 P3 的回归。

## 3. 新发现的真实缺口：4,780 个 section 正在提供降级内容

顺着上面的根因全库普查（判据：`textArtifactId is null AND length(content) < contentTextLength`，即「没有全文 artifact，且存的确实是被截断的预览」）：

| 指标 | 数量 |
|---|---|
| 降级的 FilingSection | **4,780** |
| 涉及公司 | **110** |
| 需重导的 filing | **645** |
| 平均可用正文比例 | **27.4%** |

按 `extractionVersion` 看分布更清楚：v2 共 10,857 个 section，**text artifact 数为 0**（那一代根本没有这个机制）；v3 共 16,181 个，14,342 个有、1,839 个缺。8/29–8/30 两批重新导入的（8,965 + 1,117）则 100% 完整——说明**当前写入路径是对的，这是历史存量问题**。

受影响最多的公司：BABA(85 section/8 filing)、LUV(70/7)、TM(69/6)、JOYY(67/6)、TSM(65/6)、NETTF(65/6)、RH(65/7)、GOTU(65/6)、AAL(63/6)、LBTYK(63/12)、TSLA(62/10)。

**影响**：`/agent` 的 `search_filings` 对这 110 家公司回答年报类问题时，平均只能看到 27% 的正文。P3 的警告保证了它不会静默撒谎，但能力缺口是真的。

**建议**：立项做一次 645 filing 的 `import:10k` 回填。这是个大活（每个 section 一次 R2 写入），按 CLAUDE.md 的既定分工应在 **mini** 上跑，且注意 mini 到 R2 的延迟是 air7 的约 4 倍。已作为 P0 记入 `TODO.md`。

## 4. 美国市场支线的完整方案（已与用户对齐，尚未开工）

已定的两个前提：**整站统一改名 Value Tribe**（一个品牌两个 locale，顺带规避在美国用 Buffett 名字做商业产品的商标/姓名权风险）；**英文内容从源数据独立生成**（不从中文翻译——中文本身就是从英文源数据生成的，再翻回去是二次损耗）。

三条架构决策：

1. **locale 载体 = `[locale]` 路由段 + middleware 重写**，不是 header 注入——locale 若来自 `headers()` 会让每个页面退化为动态渲染，丢掉现有静态/ISR 能力。路径策略保守优先：中文留在根路径**一个 URL 都不改**，英文走 `/en/*`。
2. **生成内容用 locale-keyed 行**（`@@unique([entityId, locale])`），**故意不沿用** `Chunk` 的 `contentEn`/`contentZh` 配对列——那里两语种是翻译派生、1:1、永远 2 种；这里是各自独立生成、需独立重生成、语种数开放，配对列会让 5 字段 × N 语种列数爆炸。
3. **`onboard-company.ts` 不按 locale 分叉**，照抄既有的 market 纪律，locale 只是 `steps` 的参数。

分期（每期独立可发布）：P0 改名（**本次已发布**）→ P1 locale 骨架（只启用 zh，站点行为不变）→ P2 文案抽取（1,112 行 / 98 文件入字典）→ P3 schema + 管线（migration + 8 个 `generate-*.ts` 加 `--locale`）→ P4 批量生成 + agent locale 化 → P5 法务页/邮件/hreflang。

**开工前必须先处理的风险**：英文 token 密度约为中文的 1.5–2 倍，按中文输出调好的 `max_tokens` 跑英文时会静默截断；而本仓库已知**没有截断检测+重试机制**（见记忆「LLM截断检测缺口」）。P4 是 244 家 × 5 步 = 1,220 次调用，**建议把截断检测提到 P3 之前做**，否则会烧钱产垃圾。

另外「Value Tribe」是个相当通用的名字，动手处理域名前需确认 `valuetribe.com` 可得 + USPTO 无冲突。

## 5. 顺带发现、未修

`scripts/import-beneficial-ownership.ts` 有 6 个既有 typecheck 报错（`formData.coverPageHeader` possibly undefined，220/221/223/249/250/252 行）。`npm run typecheck:scripts` 不在 CI 门禁里，所以一直没暴露。本次未修（与改名无关）。

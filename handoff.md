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

**已知代价**：mini 到 Cloudflare R2 的网络延迟比 air7 高约 4 倍（实测 TLS 握手：air7 ~55ms vs mini ~210-230ms）。10-K 导入每个 section 要归档 2 份文件到 R2（文本+区块 JSON），一份 filing 20+ 个 section、6 年份 filing，全部串行，单公司这一步能到 3-12+ 分钟，比在 air7 上明显慢。见下方"效率问题，未解决"。

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

## 效率问题，未解决

mini 上单公司 10-K 导入阶段可能要 3-12+ 分钟（batch 2 平均约 14 分钟/家全流程），主要卡在每个 section 要归档 2 份文件到 R2（文本+blocks JSON），全部**串行**（`archiveFilingArtifact()`，`scripts/lib/filing-archive.ts`），单份 filing 20+ section、多年份 filing 叠加，网络延迟被放大很多倍。air7 到 R2 的延迟只有 mini 的约 1/4。

没有动手改——真要解决需要把 section 级的 R2 归档改成并发批量上传，是个有一定范围的改动，本轮只做了问题定位，没有排期。按当前速度剩下 175 家大概还要 30-40 小时。

## 接下来怎么续跑

```bash
ssh mini
cd ~/buffett-tribe
export PATH=$HOME/node/bin:/opt/homebrew/bin:$PATH
npm run onboard:pending -- --dry-run          # 先看还剩多少、都是谁
npm run onboard:pending -- --limit 50         # 建议继续按 50 一批，别一次性跑完
```

每批建议：跑完看失败列表分类（合理跳过 / 已知缺口 / 真失败），抽查几家生成内容质量，确认没问题再开下一批。

## 未提交的代码改动

本次会话所有修复都还**没有 commit**（`git status` 仍显示 working tree 有改动），也没有跑 `/ship`。文件清单见 `git status --short` / `git diff --stat`。

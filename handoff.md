# Handoff: 自动化管线双轮驱动升级与多市场长青维护体系

## 会话时间
2026-09-30

---

## 核心架构与系统当前状态

### 1. 全球大盘底座（Master Universe）
截至 2026-09-30，全库三地市场总覆盖规模为 **16,467 家**：
- **美股 (US)**：8,076 家（SEC 官方全量 exchange 挂牌标的）
- **A股 (CN)**：5,572 家（上交所、深交所、北交所全量股票）
- **港股 (HK)**：2,819 家（港交所主板与创业板全量股票）

**各阶段（Phase）分布状态**：
- **Phase 0（待建档底座）**：~15,137 家（纯代码与公司名存根，等待批处理或快速通道激活）
- **Phase 1（基础建档完成）**：~1,139 家（已有财务数据、基础公司资料、外部年报链接与自上市以来的股价历史）
- **Phase 2（深度分析完备）**：~191 家（已有完整商业模式九宫格画布、10 维雷达图护城河、资本分配治理卡片、三情景估值模型）

---

### 2. 自动化调度管线（Hourly Dual-Drive Worker）
- **文件**：[`scripts/pipeline-priority-worker.ts`](file:///Users/rafael/R129/buffett-tribe/scripts/pipeline-priority-worker.ts) / [`scripts/cron/hourly-priority-worker.sh`](file:///Users/rafael/R129/buffett-tribe/scripts/cron/hourly-priority-worker.sh)
- **调度频次**：每小时 15 分触发一次（mini 机器常驻）。
- **调度策略**：
  1. **第一优先级（快速通道 VIP）**：优先抽取用户在网页端申请加急的标的（`priority > 0` 且 `onboardPhase IN [0, 1]`），无条件插队置顶处理。
  2. **第二优先级（大池子双轮驱动）**：快速通道未满时，剩余名额在 **P1→P2（完善四大深度分析）** 与 **P0→P1（基础建档扩大覆盖）** 之间按 5:5 动态配比，且任意一侧不足时自动补满另一侧。
  3. **三大市场交叉轮询（Round-Robin）**：US、HK、CN 交叉推进，防止单一市场饥饿。
  4. **严格批次约束**：单批 `<= 10` 家，执行超时阈值设为 35 分钟，内置 PID 文件排他锁，杜绝跨批次重叠。

---

### 3. 周度长青维护任务（Weekly Maintenance Crons）

#### (1) 全网新上市公司自动发现入池（每周六 10:00 CST）
- **文件**：[`scripts/cron/weekly-sync-new-listings.sh`](file:///Users/rafael/R129/buffett-tribe/scripts/cron/weekly-sync-new-listings.sh) / [`scripts/seed-master-universe.ts`](file:///Users/rafael/R129/buffett-tribe/scripts/seed-master-universe.ts)
- **机制**：
  - A 股通过 `akshare.stock_info_a_code_name()` 获取最新代码（带 3 次重试与现有文件兜底）；
  - 港股通过 `akshare.stock_hk_spot()` 获取最新列表（带 3 次重试与现有文件兜底）；
  - 美股直接拉取 SEC EDGAR 官方 `company_tickers_exchange.json`；
  - 比对现有数据库，新上市 IPO 代码自动以 `onboardPhase: 0`、`isMasterUniverse: true` 写入 `Entity`，无缝纳入大池子。

#### (2) 周度股价更新（周六 12:00 CN/HK，周日 01:00 US）
- **文件**：[`scripts/import-company-stock-prices-yf.ts`](file:///Users/rafael/R129/buffett-tribe/scripts/import-company-stock-prices-yf.ts) / [`scripts/cron/update-stock-prices.sh`](file:///Users/rafael/R129/buffett-tribe/scripts/cron/update-stock-prices.sh)
- **机制**：
  - **精准范围过滤**：默认仅对 `onboardPhase >= 1` 的标的更新最新股价（收敛至 ~1,330 家，跳过 1.5 万家 Phase 0 存根，耗时减少 92% 并杜绝被 Yahoo Finance IP 限流）；
  - **按需拉取**：P0 标的在后续被 Worker 提拔为 P1 时，`onboard-company.ts` 会自动拉齐其自 2020 年（或上市日）至今的全部历史股价，随后自然并入周更集合。

---

### 4. 年报与资产存储策略（No-R2 Policy）
- **当前标准**：年报 PDF 与 HTML 原文**绝不上传 R2**，节约对象存储成本与上传时间；
- **展示方式**：前端参考资料 Tab 统一构造或展示官方权威外部链接：
  - **美股**：SEC EDGAR 官方 Viewer URL（`https://www.sec.gov/cgi-bin/viewer?...`）
  - **A股**：巨潮资讯网官方 PDF 直链
  - **港股**：港交所披露易（HKEXnews）官方直链

---

### 5. Mini 机器 Crontab 配置与部署规范
远端机器（`mini`, 100.72.199.33）Crontab 当前配置：
```cron
PATH=/Users/rafael/node/bin:/usr/bin:/bin:/usr/sbin:/sbin

# 1. 每周六 10:00 (北京时间)：全网三大市场新上市公司探测入池 (写入 Phase 0)
0 10 * * 6 /Users/rafael/buffett-tribe/scripts/cron/weekly-sync-new-listings.sh >> /Users/rafael/logs/buffett-tribe/sync-new-listings.log 2>&1

# 2. 每周六 12:00 (北京时间)：更新已建档 (Phase >= 1) 的 CN/HK 股票周度股价
0 12 * * 6 /Users/rafael/buffett-tribe/scripts/cron/update-stock-prices.sh cn,hk >> /Users/rafael/logs/buffett-tribe/update-stock-prices-cn-hk.log 2>&1

# 3. 每周日 01:00 (北京时间)：更新已建档 (Phase >= 1) 的 US 股票周度股价
0 1 * * 0 /Users/rafael/buffett-tribe/scripts/cron/update-stock-prices.sh us >> /Users/rafael/logs/buffett-tribe/update-stock-prices-us.log 2>&1

# 4. 每小时 15 分：双轮驱动批处理 (优先通道 + P0-P1 50% + P1-P2 50%，<= 10 家/批)
15 * * * * /Users/rafael/buffett-tribe/scripts/cron/hourly-priority-worker.sh 10 all >> /Users/rafael/logs/buffett-tribe/priority-worker.log 2>&1
```

**部署标准命令（必须保持 exclude 规则以保护远端环境）**：
```bash
rsync -avz --exclude 'node_modules' --exclude '.next' --exclude '.git' --exclude '.cache' --exclude 'logs' --exclude '.venv' --exclude 'venv' --exclude 'scratch' --exclude 'tmp' ./ mini:~/buffett-tribe/
```

---

### 6. 近期缺陷排查与加固记录
1. **统一分析脚本回退**：废弃 `generate-company-analysis-unified.ts`，还原回成熟的 4 步独立生成（商业模式画布、护城河、治理分析、估值模型）。
2. **结构化严格校验**：`verifyCompanyAnalysisField()` 引入 `isValidAnalysisPayload`，严格校验护城河 10 维雷达图、治理资本分配卡片、估值 PE 分位与三情景指标，防止畸形数据放行。
3. **估值不足哨兵**：对于次新股或财务年限不足标的（如 `0100.HK`），校验逻辑识别并放行 `{ status: "insufficient_data" }`，避免死循环重试。
4. **SEC 爬虫 Identity 修复**：[`scripts/helpers/edgartools-fetch-filings.py`](file:///Users/rafael/R129/buffett-tribe/scripts/helpers/edgartools-fetch-filings.py) 显式调用 `set_identity("BuffettTribe rafael@air7.fun")`，杜绝 SEC 请求拦截。

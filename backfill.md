# 财报数据全量回填任务监控与执行指南 (Phase 1 & 2 Financials Backfill)

本文档记录统一批量回填脚本（`scripts/batch-backfill-phase12-financials.ts`）在远程主机 `mini` 上的运行状态、路径配置以及常用监控与运维命令，方便后续任何 Agent 或开发者快速查阅与接管。

---

## 1. 任务概述

- **任务内容**：回填美股、A 股、港股全量 Phase 1 和 Phase 2 标的的法定财务报表（资产负债表、利润表、现金流量表全部标准化指标）并落库。
- **执行脚本**：`scripts/batch-backfill-phase12-financials.ts`（通过 `npm run backfill:phase12-financials` 触发）
- **覆盖市场**：美股 (1,678 家)、A 股 (926 家)、港股 (1,024 家)，总目标 3,678 家
- **断点机制**：基于 `.cache/batch-backfill-phase12-financials.json`，已处理完成的公司会自动跳过，支持随时无损恢复执行。

---

## 2. 运行环境与关键路径 (`mini` 主机)

该任务以持久后台守护方式运行在主机 `mini` (Mac mini) 上：

| 配置项 | 路径 / 说明 |
| :--- | :--- |
| **项目工作目录** | `/Users/rafael/buffett-tribe` |
| **Node 可执行路径** | `/Users/rafael/node/bin/node` |
| **PID 记录文件** | `/Users/rafael/logs/buffett-tribe/backfill-phase12-financials.pid` |
| **任务标准日志** | `/Users/rafael/logs/buffett-tribe/backfill-phase12-financials.log` |
| **断点缓存状态** | `/Users/rafael/buffett-tribe/.cache/batch-backfill-phase12-financials.json` |

---

## 3. 查阅与监控常用命令速查

任何 Agent 可直接在本地执行以下 SSH 命令查看实时状况：

### 3.1 查看进程活跃状态与资源占用
```bash
ssh mini "if [ -f /Users/rafael/logs/buffett-tribe/backfill-phase12-financials.pid ]; then \
  PID=\$(cat /Users/rafael/logs/buffett-tribe/backfill-phase12-financials.pid); \
  echo \"PID: \$PID\"; \
  ps -p \$PID -o pid,stat,%cpu,%mem,time,command; \
else \
  ps aux | grep batch-backfill-phase12-financials | grep -v grep; \
fi"
```

### 3.2 查看完成统计（已完成 vs 失败）
```bash
ssh mini "/Users/rafael/node/bin/node -e 'const d = require(\"/Users/rafael/buffett-tribe/.cache/batch-backfill-phase12-financials.json\"); console.log(\"已完成:\", Object.keys(d.completed||{}).length, \"失败:\", Object.keys(d.failed||{}).length)'"
```

### 3.3 查看最近处理日志（实时尾部 30 行）
```bash
ssh mini "tail -n 30 /Users/rafael/logs/buffett-tribe/backfill-phase12-financials.log"
```

### 3.4 检查失败标的列表及错误原因
```bash
ssh mini "/Users/rafael/node/bin/node -e 'const d = require(\"/Users/rafael/buffett-tribe/.cache/batch-backfill-phase12-financials.json\"); console.log(JSON.stringify(d.failed||{}, null, 2))'"
```

---

## 4. 任务控制与异常处理

### 4.1 停止后台任务
```bash
ssh mini "kill \$(cat /Users/rafael/logs/buffett-tribe/backfill-phase12-financials.pid)"
```
脚本会将 `SIGTERM` 传递给当前公司的子进程组，等待子进程退出并保留检查点；不要只杀父进程或直接清理检查点文件。

### 4.2 重新启动 / 断点续跑
任务恢复前先确认本地修复代码已同步到 `mini`，并核对数据库迁移及检查点状态。获得恢复安排后，再在 `mini` 上拉起任务；脚本会读取断点缓存并跳过已成功条目：
```bash
ssh mini "cd /Users/rafael/buffett-tribe && nohup npm run backfill:phase12-financials > /Users/rafael/logs/buffett-tribe/backfill-phase12-financials.log 2>&1 & echo \$! > /Users/rafael/logs/buffett-tribe/backfill-phase12-financials.pid"
```

---

## 5. 执行记录抽查点快照

| 检查时间 | 运行状态 | 进程 PID | 全量完成进度 | 本次任务进度 | 失败数 | 处理速度 / 预估 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **2026-10-12 17:04** | 启动 | 77246 | 50 / 3,678 | 0 / 3,628 | 0 | 初始启动，断点识别前 50 家 |
| **2026-10-12 17:25** | 正常运行 | 77246 | 179 / 3,678 | 129 / 3,628 | 0 | 约 8~9s/家，预计剩余 ~9.4 小时 |
| **2026-10-12 17:52** | 人工停止 | 77246 | 307 / 3,678 | 257 / 3,628 | 0 | 停止于 0061.HK，触发数据库锁悬挂排查 |
| **2026-10-12 23:47** | 守护重拉 | 82826 | 357 / 3,678 | 0 / 3,321 | 0 | 代码加固后重启全量，US=1678, CN=664, HK=979 |
| **2026-10-12 23:52** | 正常运行 | 82826 | 370 / 3,678 | 13 / 3,321 | 0 | HK 阶段 ~23s/家（akshare 逐家抓取，慢于美股 8~9s）；DB 非 idle 查询 0、未授权锁 0；粗估全量剩余 ~15 小时 |

---

## 6. 数据库连接与锁等待排查及防护

### 6.1 历史事故复盘（2026-10-12 17:52）
在人工终止 `mini` 上的 backfill 脚本后，主站点出现“搜索任何公司（如 `APO`、`Apollo`）无限挂起卡死超时”的现象：
- **根本原因**：
  1. **子进程未优雅退出**：脚本执行链条为 `TS orchestrator -> Python (akshare) -> Node (import TS)`。仅终止父进程可能遗留子进程及未完成的数据库写入。
  2. **写入事务粒度过大**：财务批量写入曾使用长事务，锁等待可能拖慢其他数据库请求。
  3. **Prisma 实例重复创建**：子脚本各自创建客户端会增加连接池压力。

### 6.2 紧急自愈操作
若再次发生类似锁死卡顿：
1. **优先方案（SQL Editor 杀锁）**：
   在 Supabase 控制台的 SQL Editor 执行：
   ```sql
   SELECT pg_terminate_backend(pid) 
   FROM pg_stat_activity 
   WHERE state != 'idle' 
     AND pid != pg_backend_pid() 
     AND query NOT LIKE '%pg_stat_activity%';
   ```
2. **彻底方案（重启项目）**：
   在 Supabase Dashboard -> **Project Settings** -> **General** -> 页面底部的 **Restart project** 重启数据库，所有未提交事务会自动回滚。

### 6.3 已实施的防护
- **优雅退出**：批处理脚本捕获 `SIGINT` / `SIGTERM` 并向子进程组传递信号；收到停止信号后保留检查点，子脚本在 `finally` 中断开 Prisma。
- **客户端生命周期**：财务导入路径复用 Prisma 单例，并在退出时统一断开连接。
- **短批次增量写入**：财务事实按复合唯一键排序，每批最多 50 行，通过 `INSERT ... ON CONFLICT ... DO UPDATE` 写入，不删除本次数据源未包含的旧行。
- **数据库等待上限**：写入批次设置 `lock_timeout = 5s` 和 `statement_timeout = 30s`；其他短写事务也设置超时保护，避免无限等待。
- **迁移状态**：`reportingCurrency` / `FxRate` 迁移已在生产数据库完成。

### 6.4 当前状态与恢复条件
- 2026-10-12 的全量回填已暂停，停止位置记录为 `0061.HK`；不要在本地修复代码同步、检查点核对和恢复安排确认前重启。
- 已用 ASML 验证财务增量导入及 EUR 汇率写入。导入前后均为 361 条财务行，旧行无丢失或数值变化；数据库检查未发现活动查询或锁等待。
- ASML FY2020–FY2025 的 `CashBeginningOfPeriod` 仍缺失。该字段未用期末现金代填，需作为源数据/映射缺口另行处理。
- 恢复全量任务前，至少完成全项目 lint、测试和生产构建，并先在 `mini` 上同步修复版本、确认检查点可续跑。

---

## 7. 港股「非港币报表」与汇率链路核查（2026-10-12 23:52）

起因：确认获取汇率的脚本是否考虑了港股市场 / 非港币财报的情形。核查覆盖 `src/lib/fx-rates-core.ts`、`src/lib/fx-rates.ts`、`src/lib/value-line-data.ts`、`scripts/update-fx-rates.ts`、`scripts/lib/cn-hk-currency-resolve.ts` 与生产库实际数据。

### 7.1 结论：主链路正确，非港币情形已被覆盖

币种集合不是硬编码清单，而是按「交易市场 → 交易币种」×「实体 `reportingCurrency`」逐对推导（`currenciesNeededForConversion`，`src/lib/fx-rates-core.ts:94`），取两侧中所有非 USD 币种：

| 情形 | pair | 需要的汇率 |
| :--- | :--- | :--- |
| 港股 / 港币报表 | (HKD, HKD) | 无（`reporting === trading` 直接跳过，不需要换算） |
| 港股 / 人民币报表 | (CNY, HKD) | **CNY + HKD** 两者 |
| 港股 / 美元报表 | (USD, HKD) | 仅 HKD |
| A 股 / 人民币 | (CNY, CNY) | 无 |
| 美股 / 欧元报表（ASML） | (EUR, USD) | 仅 EUR |

消费端 `src/lib/value-line-data.ts:326` 以 USD 为枢轴换算：`amount × (rate[from] / rate[to])`。用库内现值验算 CNY 0.14941 / HKD 0.12743 = 1.1725（1 元人民币 = 1.17 港元），方向与量级正确。

生产库实测（2026-10-12 23:52）——非港币报表不是边角情况，有财务数据的 1,038 家港股中 **40% 不是港币报表**：

| 港股 `Financial.unit` | 公司数 | 财务行数 |
| :--- | ---: | ---: |
| HKD | 618 | 161,781 |
| CNY | 379 | 105,094 |
| USD | 41 | 13,304 |

`FxRate` 表已有 CNY / EUR / HKD 三行，`asOfDate` 均为 2026-10-12。本轮重启后前 13 家港股的解析结果 `Entity.reportingCurrency` 与 `Financial.unit` 完全一致：`0068/0072/0073 → CNY`、`0069/0076 → USD`、其余 HKD。

> 汇率周更（`scripts/cron/update-fx-rates.sh`）已确认有人负责，本节不作为缺陷记录，后续 agent 不必重复排查。

### 7.2 待修：两个 backfill 路径保留了静默「assume HKD」兜底

`resolveHkCurrencyFromAnnualReport`（`scripts/lib/cn-hk-currency-resolve.ts:97`）是**故意抛异常**的，注释明确写着：an unresolved currency must not silently become "assume HKD"，the exact mistake 泡泡玛特 already proved wrong once。但两个 backfill 调用点把这个保证打穿了：

| 调用点 | 行为 | 判定 |
| :--- | :--- | :--- |
| `scripts/onboard-company.ts:374-384` | 年报正则 → yfinance → **向上抛** | 正确，保证成立 |
| `scripts/batch-backfill-phase12-financials.ts:113-141` | `try {} catch {}` 吞异常 → yfinance → `return "HKD"` | **兜底违规** |
| `scripts/process-company-phase3-deep.ts:75-104` | 同上，同样 `return "HKD"` | **兜底违规** |

后果不是「显示得不好看」：被误标 HKD 的人民币报表公司会出现 `reportingCurrency === tradingCurrency === 'HKD'`，于是 `convertCurrency` 原样返回、`valuationCurrencyAvailable` 判定为 `true`，**人民币数字顶着 HK$ 符号与港元市值直接比对**，每个 PE / PB / 估值比率偏差约 CNY/HKD ≈ **+17%**。受影响的正是上表中那 379 家人民币报表港股。

对本轮 979 家港股队列的缓解因素：1,046 家港股有 `hk-annual-report` ExtSource（1,037 家同时有财务数据、9 家只有年报），队列基本就是「有年报的港股」，因此年报文本正则路径应能覆盖绝大多数，兜底极少触发。但**该解析路径没有任何日志输出**，走没走到默认分支无法证明（见 7.4）。

修法（尚未实施）：删掉上述两处的 `return "HKD"`，让异常向上抛。检查点本身有 `failed` map，这类公司会落入失败清单等人工判断，而不是静默污染数据。改动会触及正在运行的脚本，需等本轮跑完或停掉后再同步到 `mini`。

### 7.3 待验：币种枚举被锁死在 CNY / HKD / USD 三种

三处硬约束：

- `scripts/fetch-cn-hk-financials-ak.py:187`：`--currency` 仅接受 `CNY` / `HKD` / `USD`
- `scripts/lib/cn-hk-currency-resolve.ts`：`type CurrencyGuess = "CNY" | "HKD" | "USD"`
- 同文件 `CURRENCY_PATTERNS`：正则表只含 `RMB|人民幣` / `HK\$|港幣` / `US\$|美元`

若某家港股年报用 GBP / JPY / SGD / EUR 计账，则：正则频率判定必然失败（表里该币种不存在）→ 落到 LLM 兜底 → 而该 LLM 被 system prompt 限定「只回答 CNY / HKD / USD 之一」→ 大概率被错标；同时 FX 层永远不会被问到这个币种（`currenciesNeededForConversion` 只会拿到被错标的 `reportingCurrency`）。**即结构上无法表达该情形，且错误是静默的。**

1,046 家有年报的港股里是否真的存在这类公司，目前未验证——这是待抽查项，不能直接假定为空集。建议的抽查方式：对解析结果走 LLM 兜底分支、或正则三币种计数均低于 `MIN_DOMINANT_COUNT` 的实体逐个人工过一遍。

### 7.4 可审计性缺口

- 币种解析（命中 seed / 复用已有 `Financial.unit` / 年报正则 / LLM 兜底 / yfinance / 默认 HKD）**全程无日志**。检查点只记录已完成 ticker 与计数，不记录币种来源。
- 结果：979 家港股跑完后，币种来源不可回溯，7.2 / 7.3 两个风险是否真的发生过无法从产物侧反查（只能靠 `Financial.unit` 反推最终值，推不出判断路径）。
- 修法：在 `resolveCompanyCurrency` 每次返回前打一行带来源标记的日志（建议同时落进任务日志文件，而非仅 stdout），一轮跑完即可用 `grep` 复核分布。

### 7.5 复核方式

本次核查所有查询都通过临时脚本完成，未使用 `node -e` 一行流（引号经过 ssh 双层 shell 后极易被吞，Postgres 字面量 `'idle'` 就曾因此触发 `42703 column "idle" does not exist`）。可用做法：

1. 本地写 `CommonJS` 脚本（后缀必须是 `.cjs`，仓库 `package.json` 为 `type: module`），从 `require("@prisma/client")` 起手；
2. `scp` 到 mini 的仓库根目录（`/tmp` 下因找不到 `@prisma/client` 会失败）；
3. `cd /Users/rafael/buffett-tribe && /Users/rafael/node/bin/node --env-file=.env.local ./<name>.cjs`；
4. 跑完删除该临时文件，避免仓库出现未跟踪残留。

本节用到的统计口径：`Entity` 按 `market` × `reportingCurrency` 分布；HK 实体的 `Financial.unit` 分布；`reportingCurrency` 与 `Financial.unit` 不一致的清单；`FxRate` 全表；以及 `pg_stat_activity` / `pg_locks` 的锁等待快照。

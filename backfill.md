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

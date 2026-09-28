# Handoff — 2026-09-28（晚）：紫金矿业优先通道卡死问题 + 年报 PDF 上传决策

> **会话时间：** 2026-09-28 傍晚（北京时间）
> **参与者：** Rafael + Kimi Code
> **主要成果：** 定位紫金矿业在优先通道死循环的根因，完成临时解锁；遗留一个产品/架构决策：年报 PDF 到底要不要上传 R2

---

## 📋 问题现象

紫金矿业（601899.SS，A股）今天 16:02 被加入优先通道（`priority=100`, `onboardPhase=1`，目标 P1→P2 深度分析），但 mini 上的 hourly cron worker 跑了两轮（16:15、17:15）都没完成，表现为"一直没被处理"。

## 🔍 根因分析

**不是没被选上，而是每次选中后都卡死，且失败不被记录，形成死循环：**

1. **卡点：P2 第 1 步「导入年报原文」的 R2 上传**
   - 紫金 5 份年报中，2020–2023 年 PDF（15~29MB）均上传成功
   - **FY2025 年报 PDF 达 80MB**（`/tmp/cn-annual-report-ak/601899_2025.pdf`）
   - 上传 R2 每次都精确打满 600 秒单次超时被 abort（`error=AbortError elapsedMs=6000xx`），重试 5 次 × 10 分钟 ≈ 50 分钟
   - 超时配置：`src/lib/r2.ts:23`，`R2_UPLOAD_TIMEOUT_MS` 默认 600_000ms；80MB 要传完需稳定 >1.1MB/s 上行，mini 所在网络到 Cloudflare R2 达不到

2. **Worker 35 分钟硬超时先于上传失败触发，失败不会被记录**
   - `scripts/pipeline-priority-worker.ts:325` 的 timeout 直接 `process.exit(0)`，绕过了 catch 分支
   - 后果：`onboardPhase2Attempts` 不增加、priority 不清零 → 下一小时 cron 再次选中 → 再卡 35 分钟 → **无限循环**
   - 这是系统性缺陷：**任何一家公司卡住都会永久霸占优先通道**

3. **附带问题：超时退出留下孤儿进程**
   - 父 worker 退出后，`onboard-company.ts` / `import-cn-annual-report-from-file.ts` 子进程仍在跑，继续无望重试上传

## ✅ 已执行的临时解锁（2026-09-28 18:00 左右）

- 杀掉 mini 上 17:15 轮残留的 5 个孤儿进程（PID 68096/68111/68112/68145/68146），已确认无残留
- 数据库将 `601899.SS` 的 `priority` 100 → 0，`onboardPhase` 保持 1
- 效果：fast-track 通道（`priority > 0`）不再选它，标准 P0 通道也不会（已是 Phase 1），死循环断开，cron 对其他公司恢复正常

**当前状态：** 紫金停在 Phase 1；2020–2023 年报已导入，FY2025 年报（80MB）未上传成功。未手工重跑（用户决定暂不跑）。

---

## 🎯 待决策：年报 PDF 到底要不要上传 R2？

紫金这个 case 把一个潜在问题摆上台面：**A 股年报 PDF 普遍很大（紫金 FY2025 达 80MB），从 mini 的网络上行到 Cloudflare R2 不稳定，会阻塞整个 onboarding 流水线。**

### 上传 PDF 的用途（如果不上传会失去什么）

- 阅读页直接展示年报原文 PDF（`primary_pdf`，供用户在线阅读）
- FilingSection 已抽取的文本/chunk 不依赖 PDF 在线可用，LLM 生成用的是抽取后的文本
- 注：HK/US 公司今天的年报导入（含 R2 上传）都正常（3~4 分钟），问题集中在 A 股超大 PDF

### 可选方向

| 方案 | 说明 | 代价 |
|------|------|------|
| A. 保持上传，只调参 | `R2_UPLOAD_TIMEOUT_MS` 提到 30 分钟（cron 脚本里设 env） | 80MB 仍可能传不完；worker 35 分钟上限也装不下 5 次重试 |
| B. 改 multipart 分块上传 | S3 multipart，分块并行，慢网络下更稳 | 要改 `src/lib/r2.ts`，有一定工作量 |
| C. 大文件跳过上传 | 比如 >50MB 的 PDF 只抽文本入 FilingSection，不传 R2、不提供在线阅读 | 阅读页缺原文；需要产品层面接受 |
| D. 全部不上传 PDF | 所有市场只保留抽取文本 | 改变现有产品形态（US/HK 已传了的怎么处理？） |
| E. 换上传路径 | 从本机或其他网络更好的机器传 R2，mini 只负责抽取 | 流水线变复杂 |

### 无论选哪个，都建议先修的系统性缺陷

1. **worker 超时退出路径要记失败**：`pipeline-priority-worker.ts` 的 timeout 分支应给当前公司记一次 attempts（或至少清 priority），否则同类卡死会复发
2. **超时退出要杀子进程**：避免孤儿进程堆积
3. **R2 上传总预算要小于 worker 超时**：5 次 × 600s + 退避 ≈ 50min > 35min 的 worker 上限，配置层面就自相矛盾

---

## 📌 关键文件

- `scripts/pipeline-priority-worker.ts` — hourly worker（候选选择 + 超时缺陷所在）
- `scripts/cron/hourly-priority-worker.sh` — mini 上 cron 入口（`15 * * * *`，`--priority-only`）
- `src/lib/r2.ts` — R2 上传 + 超时/重试逻辑
- `scripts/fetch-cn-annual-report.py` / `scripts/import-cn-annual-report-from-file.ts` — A 股年报下载与导入
- mini 日志：`~/logs/buffett-tribe/priority-worker.log`、`~/buffett-tribe/logs/pipeline-priority.log`

## 📝 下次会话准备

1. 决策：年报 PDF 是否上传 R2（上面 A–E 方案，或组合）
2. 若决定继续上传 → 选 A 或 B 实施，然后手工重跑紫金 P2 验证
3. 无论决策如何 → 修复 worker 超时记失败 + 杀子进程两个缺陷

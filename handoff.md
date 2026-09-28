# Handoff — 2026-09-28（晚）：紫金矿业优先通道卡死 + 注册简化 + Resend 域名核查

> **会话时间：** 2026-09-28 傍晚（北京时间）
> **参与者：** Rafael + Kimi Code
> **主要成果：** ① 定位紫金矿业在优先通道死循环的根因并临时解锁，遗留"年报 PDF 要不要上传 R2"决策；② 注册窗口简化为邮箱+密码，昵称默认取邮箱前缀（已上线）；③ 核查域名迁移对 Resend 邮件服务的影响（结论：无需改动）

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

---

## ✉️ 注册窗口简化（已完成并上线）

- 注册表只剩「邮箱 + 密码」两栏，删除「昵称（可选）」输入框
- 服务端默认昵称取邮箱前缀：`rafael+test@gmail.com` → `rafael`（剥离 `+tag`）；空前缀存 `null`
- 昵称仍可通过现有个人资料功能修改
- 改动：`src/components/LoginForm.tsx`、`src/app/api/auth/register/route.ts`
- 已端到端测试（普通邮箱 / +tag / 重复 409 / 短密码 400 / 非法邮箱 400 / 注册后自动登录 session 昵称正确），lint + build 通过
- **提交 `c7cc5992`，已 push 到 main**（Vercel 自动部署）

---

## 📮 Resend 邮件服务 × 域名迁移核查（结论：无需改动）

**背景：** 本站域名从 `vt.air7.fun` 迁到 `vt.air7fun.com`（Cloudflare CDN），需确认对 Resend 发信的影响。

### 实测结论

- Resend 账户唯一发送域名是 **`air7.fun`，状态 verified**（区域 ap-northeast-1，2026-03 配置）
- `air7.fun` 的 DNS 仍在阿里云（hichina），**未随迁移动过**，Resend 所需记录完整：
  - DKIM：`resend._domainkey.air7.fun` TXT ✅
  - SPF：`send.air7.fun` MX（feedback-smtp...amazonses）+ `v=spf1 include:amazonses.com ~all` TXT ✅
- 发件地址 `vt@air7.fun`（`src/lib/brand.ts:29` 默认值）与已验证域名匹配
- 邮件内链接（重置密码等）此前已随代码改到 `vt.air7fun.com`，无遗留

**关键概念：** 发信只依赖**发件域名**（air7.fun）的 DNS 验证，与**网站域名**（air7fun.com）无关，所以域名迁移对邮件服务零影响。

### ⚠️ 两个长期注意事项

1. **`air7.fun` 不能废弃**，它现在承担三件事：① Resend 发信验证 ② pi-gateway（`relay.air7.fun`）③ 旧站 301 跳转。若未来把它的 DNS 也迁到 Cloudflare，DKIM/SPF 三条记录必须原样搬过去，否则发信立刻挂。
2. **Vercel 环境变量检查项**：`RESEND_FROM` / `RESEND_REPLY_TO` 要么不设（代码兜底 `vt@air7.fun`），要么只能是 `@air7.fun` 地址；改成 `@air7fun.com` 会因域名未验证导致发送失败。（本次 vercel CLI 在本机卡在登录交互未查到，需在 Vercel 后台人工确认。）

### 可选优化（未做，留待决策）

让发件人也用新域名 `vt@air7fun.com` 保持品牌一致：Resend 后台添加 `air7fun.com` 发送域名 → DKIM/SPF 记录加到 Cloudflare DNS → 验证通过后改 `RESEND_FROM`；`RESEND_REPLY_TO` 建议保留 `vt@air7.fun`（该邮箱有 AWS inbound SMTP 收件，新域名未配收件）。

# retryExhaustedStage 实施说明

## 目标

把“主动排除的标的”和“应处理但重试耗尽的标的”彻底分开：

- `onboardPhase = -1`：只表示 OTC、退市、ETF 等主动排除标的。
- `retryExhaustedStage = 1/2/3`：表示该阶段自动重试耗尽，等待人工处理。
- `onboardPhase` 继续表示实际完成到哪一步。

## Schema

给 `Entity` 增加：

```prisma
retryExhaustedStage Int?
@@index([retryExhaustedStage])
```

## 状态规则

| 场景 | onboardPhase | retryExhaustedStage |
| :--- | :---: | :---: |
| 正常处理 | 0/1/2/3 | null |
| 失败 1～2 次 | 当前阶段 | null |
| Phase 1 重试耗尽 | 0 | 1 |
| Phase 2 重试耗尽 | 1 | 2 |
| Phase 3 重试耗尽 | 2 | 3 |
| Fast-track 可恢复 | 对应阶段 | 1/2/3，priority > 0 |
| 主动排除 | -1 | null |

## Worker

- 普通候选只接受 `onboardPhase >= 0 AND retryExhaustedStage IS NULL`。
- 第三次失败时设置 `retryExhaustedStage`，不把 phase 改成 -1。
- 成功推进时清空 `retryExhaustedStage` 和对应 attempts。
- Fast-track 自愈只选择 `retryExhaustedStage IS NOT NULL AND priority > 0`。
- 排除判断只接受 `phase = -1` 或 metadata `isExcluded=true`。

## 管理页和搜索

- 管理大盘分别统计排除、重试耗尽、可重试和正常阶段。
- 管理列表增加“重试耗尽”状态徽标和筛选。
- 搜索 API 返回 `retryExhaustedStage`。
- 前台默认过滤 `phase=-1` 和 `retryExhaustedStage != null`。
- `status:universe` 输出同样拆分。

## 数据回补

新增 `scripts/backfill-retry-exhausted-stage.ts`，支持 `--dry-run`：

1. Phase 1 重试耗尽：`phase=-1`、非 excluded、attempts1>=3 → `phase=0, stage=1`。
2. Phase 2 重试耗尽：`phase=1`、attempts2>=3 → `stage=2`。
3. 排除标的：`phase=-1`、`isExcluded=true` → `stage=null`。
4. Fast-track：保留 `priority>0`，标记 stage。

当前预期：

- Phase 1 重试耗尽：25 家
- Phase 2 重试耗尽：33 家
- 重试耗尽合计：58 家
- 错误集中的排除标的：36 个（32 个硬失败、4 个非阻断异常）

## 上线顺序

1. Schema migration。
2. 更新 worker、搜索、管理页、排除脚本和状态脚本。
3. 部署代码，mini 拉取。
4. 运行回补 dry-run 并核对数量。
5. 正式回补。
6. 验收：
   - `phase=-1 AND retryExhaustedStage!=null` 为 0。
   - `stage!=null AND isExcluded=true` 为 0。
   - Phase 1 重试耗尽 25 家。
   - Phase 2 重试耗尽 33 家。
   - 重试耗尽不进入普通候选队列。
   - Fast-track 仍可自愈。

## 实施状态（2026-10-21）

- [x] Prisma 字段和迁移：`20261021120000_add_retry_exhausted_stage`
- [x] Worker 状态流转、候选过滤和 fast-track 自愈
- [x] 管理页豁免/重试耗尽拆分
- [x] 管理检索状态筛选
- [x] 搜索 API 返回 `retryExhaustedStage`
- [x] `status:universe` 统计拆分
- [x] 排除脚本写入 `retryExhaustedStage = null`
- [x] 回补脚本与 dry-run
- [x] dry-run 结果：58 家变更，Phase 1 25 家，Phase 2 33 家
- [x] 全量 Vitest：527 通过，14 跳过
- [x] lint、build 通过
- [x] 部署到 mini（`18b89b73`）并重新生成 Prisma Client
- [x] 正式回补完成：58 家（P1 25、P2 33）
- [x] 验证：`phase=-1 AND stage!=null = 0`；`stage!=null AND isExcluded=true = 0`
- [x] `status:universe` 已显示“重试耗尽待人工 58 家”

回补顺序：先提交/推送并让 mini 拉取新代码，再运行正式回补，避免旧 worker 把刚改成 Phase 0 的重试耗尽公司重新捞起。

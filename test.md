# Agent 与部署测试覆盖说明

> 记录时间：2026-10-19
> 对应版本：v0.47.12
> 范围：根目录应用测试、pi-gateway 测试、agent 工具契约测试、CI、部署后验证。

## 1. 结论

当前测试集主要覆盖代码层行为，能够验证工具参数、结果格式化、错误分支、财务计算和部分真实数据库查询。

它没有覆盖一个关键层：**生产部署环境是否具备工具运行所需的配置**。

因此，`web_search` / `fetch_web_page` 的单元测试可以通过，但 air7 上缺少 `DEEPSEEK_API_KEY` 时仍然会在真实请求中失败。这次发布暴露的正是这个缺口。

## 2. 测试分层

| 层级 | 位置 / 命令 | 覆盖内容 | 不覆盖 |
|---|---|---|---|
| 根目录单元测试 | `npx vitest run` | 财务、估值、资本配置、组件、路由、导入、agent payload | 真实第三方 API、生产环境变量 |
| 根目录完整命令 | `npm run test` | 上述 Vitest + Python parsing unittest | 部署配置、真实联网工具 |
| gateway 测试 | `npm test`（`services/pi-gateway`） | 工具 schema、白名单、格式化、mock fetch、URL 校验 | 真实 DeepSeek API、air7 `.env` |
| L3 工具黄金用例 | `tests/agent-tools/*.test.ts` | 有 `DIRECT_URL` 时直连生产库测试 filings/holdings/company analysis | web 工具、部署环境 |
| CI | `.github/workflows/test.yml` | lint + 根目录测试 + gateway 测试 + 部分真实数据库用例 | 不设置 `DEEPSEEK_API_KEY`，不调用真实联网工具 |
| 数据完整性 | 每周 workflow | 财务、证券、持仓覆盖、filing section、DB 大小 | agent 运行时与工具调用 |
| E2E | `e2e/site-search.spec.ts` | 站内搜索 | `/agent` 对话、SSE、工具调用 |

## 3. 当前实际测试内容

### 3.1 根目录 Vitest

覆盖重点包括：

- 财务计算、拆股识别、自由现金流、ROIC、ROE；
- 资本配置统计；
- 估值 PE/PB、历史分位、情景计算；
- 公司页、价值线、财务报表组件；
- 洞见导入和 Markdown 渲染；
- 13F restatement、持仓趋势；
- 部分 API 路由和纯函数；
- agent 公司指标 payload；
- agent secret 校验。

本次本地执行结果：

```text
70 个测试文件通过，4 个跳过
510 个测试通过，14 个跳过
```

跳过的主要是需要 `DIRECT_URL` 的数据库测试。

本地这轮我实际执行的是 `npx vitest run`，没有单独执行 `npm run test` 中的 Python unittest；CI 的 Test workflow 已通过，包含 `npm run test`。

### 3.2 pi-gateway 测试

`services/pi-gateway` 下有 9 个测试文件、55 个测试，覆盖：

- 工具白名单和运行时配置；
- `web_search` 请求构造、结果格式化、错误处理；
- `fetch_web_page` URL 校验、私网拦截、正文截断；
- 公司指标工具请求和格式化；
- 图表参数校验；
- 财报、持仓、wisdom 格式化辅助函数；
- 图片附件校验。

本次结果：

```text
9 个测试文件通过
55 个测试通过
```

### 3.3 联网工具测试的真实边界

`services/pi-gateway/src/tools/web-search.test.ts` 和 `fetch-web-page.test.ts`：

- 在 `beforeEach` 中设置 `DEEPSEEK_API_KEY=test-key`；
- 使用 `vi.stubGlobal("fetch", ...)` mock 外部请求；
- 验证请求 URL、body、header、结果格式化和错误映射；
- 验证缺少 key 时返回可读错误。

它们验证的是：

```text
代码在 key 存在时行为正确
代码在 key 缺失时能报出错误
```

它们不验证：

```text
air7 的 .env 里是否真的有 DEEPSEEK_API_KEY
生产环境是否能访问 DeepSeek
部署后的 gateway 是否加载了新环境变量
```

### 3.4 L3 真实数据库用例

`tests/agent-tools/` 包含：

- `search-filings.test.ts`
- `search-holdings.test.ts`
- `company-analysis.test.ts`
- `search-wisdom.test.ts`

有 `DIRECT_URL` 时会连接生产库。`search_wisdom` 因为涉及付费 embedding，默认不进入 CI。

本次另外用 `.env.local` 单独执行了：

```text
tests/agent-tools/company-analysis.test.ts
3 个测试通过
```

### 3.5 CI

`.github/workflows/test.yml` 每次 push / PR 执行：

```text
npm ci
npm ci --working-directory services/pi-gateway
npm run sync:shared
npm run lint
npm run test
```

CI 的 `DIRECT_URL` 来自 secrets，因此部分真实数据库用例会运行。

CI 没有设置 `DEEPSEEK_API_KEY`，所以：

- 不会真实调用 DeepSeek Search；
- 不会真实调用 DeepSeek Fetch；
- 无法发现生产 gateway 的联网配置缺失。

### 3.6 数据完整性检查

每周 workflow 覆盖：

- 财务完整性；
- 证券完整性；
- 持仓/公司覆盖；
- filing section 完整性；
- 数据库大小。

这些检查保证数据资产没有明显缺口，但不测试 agent 工具运行时。

### 3.7 E2E

目前只有 `e2e/site-search.spec.ts`，覆盖站内搜索。

没有覆盖：

- `/agent` 页面完整对话；
- SSE 事件流；
- 工具调用指示器；
- 线上 gateway 的工具执行。

## 4. 本次发布实际做过的验证

已执行：

- `npm run lint`
- 根目录 TypeScript 检查
- scripts TypeScript 检查
- gateway TypeScript 检查
- `npm run build`
- 根目录 `npx vitest run`
- gateway `npm test`
- AAPL、9992.HK、600519.SS 的资本配置和估值 payload 冒烟
- 线上 `get_company_valuation` 对话调用
- 线上 `get_company_capital_allocation` 对话调用
- 线上 `/health` 检查
- PM2 状态检查

部署后发现问题：

- air7 `.env` 缺少 `DEEPSEEK_API_KEY`；
- `web_search` 返回 `DEEPSEEK_API_KEY is not configured on the gateway`；
- `fetch_web_page` 同样不可用。

原因：

- `deploy.sh` 按设计不覆盖 air7 的 `.env`；
- 只更新 `.env.example` 不会自动更新生产环境；
- 单元测试 mock 了外部请求，检测不到这个配置缺失。

已修复并验证：

- 从 air7 `.pi-agent/models.json` 中读取已有 DeepSeek provider key；
- 写入 `.env` 的 `DEEPSEEK_API_KEY`；
- 补上 `APP_ORIGIN`；
- 重启 gateway；
- 实际 `web_search` 返回 10 条结果；
- 实际 `fetch_web_page` 读取 `https://example.com` 成功。

## 5. 当前测试集的主要缺口

### 缺口一：没有部署配置预检

部署前不会检查 air7 `.env` 是否包含：

```text
AGENT_SECRET
DIRECT_URL
DASHSCOPE_API_KEY
DEEPSEEK_API_KEY
```

建议在 `services/pi-gateway/deploy.sh` 增加 preflight；缺少必需变量时直接失败，不要等到用户使用工具才发现。

### 缺口二：没有部署后工具 smoke test

建议增加一个可手动或发布时执行的 smoke：

1. 请求 `/health`，确认 200；
2. 调用一次 `web_search`，确认 `tool_end.error=false`；
3. 调用一次 `fetch_web_page`，确认 `tool_end.error=false`；
4. 检查 `get_company_valuation` 和 `get_company_capital_allocation` 的 `tool_end.error=false`。

这会产生少量模型/API 费用，适合作为发布检查或手动 smoke，不适合每次 unit test 都跑。

### 缺口三：没有 `/agent` E2E

建议后续补一个最小 E2E：

- 打开 `/agent`；
- 发送一个问题；
- 确认 SSE 收到 `tool_start`、`tool_end`、`delta`、`done`；
- 确认工具错误不会静默变成普通回答。

### 缺口四：`get_insight_content` 无结果不代表工具故障

“特斯拉 SpaceX 合并”在站内没有对应文章时返回“未找到相关深度研报文章”，这是内容覆盖问题，不是工具错误。测试应区分：

- 工具执行失败；
- 查询成功但没有匹配内容。

## 6. 后续验收建议

- 每次发布前：`lint` + 三套 TypeScript + `npm run build` + 根目录 Vitest + gateway Vitest。
- 每次部署前：检查 air7 必需环境变量。
- 每次部署后：`/health` + 至少一个联网工具 smoke + 一个计算工具 smoke。
- 涉及 agent 工具新增或改名时：更新白名单、AGENTS、UI 工具名、L3 golden case 和 gateway 单元测试。
- 涉及外部 API 时：单元测试继续 mock，但发布前必须做一次真实调用验证。

## 7. 2026-10-20 财务第一批修复后的复跑

对应 `bug.md` 第九章的财务第一批修复，本轮实际执行：

```text
npx vitest run
70 个测试文件通过，4 个跳过
522 个测试通过，14 个跳过

npm run lint
通过

npm run build
通过
```

在线黄金审计结果：

```text
22/23 PASS
BRK-B: VALUATION_PB_BAND_INVALID（既有 BUG-18，非本批引入）
```

本批没有改变部署配置检查范围；`test.md` 前六节关于部署环境变量、gateway smoke 和 `/agent` E2E 的缺口仍然成立。

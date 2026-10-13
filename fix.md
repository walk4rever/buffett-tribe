# 港股股数口径、报表币种单位与资本配置页面修复报告 (2026-10-13)

## 一、 背景与根因剖析

### 1. 港股股数与市值极端失真（如阿里巴巴港股 0.01 亿股）
- **现象**：阿里巴巴港股（9988.HK）FY2020–FY2026 的 `CommonStockSharesOutstanding` 每年均为 `1,000,000 CNY`。页面将其除以 1 亿显示，显示为荒谬的 `0.01 亿股`；页头总市值仅约 `HK$107.0M`。
- **根因 1（映射错误）**：规范字典（`canonical-financial-dictionary.json` / `.ts`）曾将 `"已发行股本"`, `"股份代号"`, `"股本"` 作为港股别名映射到 `CommonStockSharesOutstanding`。港股资产负债表中的“股本”是注册/账面资本金额（如阿里的 100 万元人民币），而非发行股数。
- **根因 2（去重逻辑覆盖真实值）**：采集器 `scripts/fetch-cn-hk-financials-ak.py` 优先读取资产负债表，错误值率先占坑；后续调用 `stock_hk_financial_indicator_em` 获取的实时真实股数（约 199.02 亿股）被“先到者保留”规则静默抛弃。
- **根因 3（币种与单位强转）**：导入脚本 `scripts/import-cn-hk-financials-from-file.ts` 将所有科目单位均设为公司报告币种（`CNY`/`HKD`/`USD`），没有保存 `shares` 单位。

### 2. 资本配置明细表列错位
- 表头 `<th>` 仅有 7 列（漏掉了“现金分红”），而表体 `<td>` 渲染了 8 列数据。
- 导致从第 6 列起全部错位：表头“股数”下方展示的是“现金分红”，表头“ROE”下方展示的是“股数”，真实的 ROE 数值溢出至表格右侧无表头区域。

### 3. 缺失分红/回购被强行置零
- 在 `src/lib/value-line-data.ts` 中曾有硬编码逻辑：若存在经营现金流（`ocf != null`），则将缺失的 `repAmt` 和 `dividendsPaid` 强行兜底赋值为 `0`。
- 这将“爬虫/数据源未采集到分红记录”与“当年确认 0 分红”混淆，误导用户对资本配置决策的判断。

### 4. 金融机构（银行/保险）套用工商业 FCF/CapEx 瀑布模型
- 摩根大通（JPM）等银行机构的经营现金流（OCF）由客户存贷款流向主导，不存在工商业属性的资本开支（CapEx）。
- 页面强行计算 $FCF = OCF - CapEx$ 并展示“经营现金流资本去向瀑布图”，缺乏业务合理性。

### 5. 行级单位丢失与特定公司币种错标
- `getCompanyFinancials` 组装数据时丢弃了行级 `unit`，导致跨币种报表（如 TSM 混杂 TWD 与 USD）无法在科目层精准换算。
- 友邦保险（1299.HK）作为全球跨国保险巨头，官方记账币种为 `USD`，此前库内曾被标为 `CNY`。
- A 股实收资本（面值 1 元）此前全量入库单位标为 `CNY`，未规范为 `shares`。

---

## 二、 修复工作实施清单

### 1. 代码层修复 (Codebase Fixes)

| 文件路径 | 修复内容 |
| :--- | :--- |
| `scripts/lib/canonical-financial-dictionary.json`<br>`src/lib/canonical-financial-dictionary.ts` | 清空 `CommonStockSharesOutstanding` 的 `hkAliases`，移除 `"股本"` / `"股份代号"`，阻断资产负债表资本金额被映射为股数。 |
| `scripts/fetch-cn-hk-financials-ak.py` | 资产负债表不再采集假的股本记录；从港股指标接口获取的最新总股本显式赋予 `unit="shares"`。 |
| `scripts/import-cn-hk-financials-from-file.ts` | 导入逻辑支持保留 record 自带单位，对 `CommonStockSharesOutstanding` 强制保持 `shares` 单位，不再被法币币种覆盖。 |
| `src/lib/company-data.ts` | 在 `getCompanyFinancials` 中新增 `itemUnits: Record<string, string>` 字典并向外透传，保障科目级真实单位不丢失。 |
| `src/lib/value-line-data.ts` | 1. 移除对缺失分红/回购的 `(ocf != null ? 0 : null)` 兜底，忠实保留 `null`。<br>2. 增加 `sharesSource?: "disclosed" \| "derived"` 标记，区分官方真实披露股数与基于 $NetIncome / EPS$ 的推算股数。 |
| `src/lib/capital-allocation-metrics.ts` | 在 `CapitalAllocationAnnualInput` 中补充 `sharesSource` 类型定义，透传至前端视图。 |
| `src/components/CapitalAllocationView.tsx` | 1. 补全 `<th style={{ textAlign: "right" }}>现金分红</th>`，彻底恢复 8 列对 8 列的一一对应。<br>2. 股数表头修改为通用“股数”，推算年份单元格展示浅灰「推算」徽标及悬停释义。<br>3. 对 `sectorModelType === "banks" \|\| "insurance"` 的金融机构隐藏通用 FCF 资本去向瀑布图。 |
| `scripts/lib/cn-hk-company-seeds.ts` | 增加 `1299.HK`（友邦保险）种子项，确立官方记账币种为 `USD`。 |

### 2. 数据库数据清洗与修正 (Database Patches)

1. **港股历史假股本清理**：
   - 删除了全库 1,037 家港股公司因资产负债表“股本”误录入的 4,749 条 `CommonStockSharesOutstanding` 脏记录（单位为 `CNY`/`HKD`/`USD`）。
2. **阿里巴巴（9988.HK）数据重建**：
   - 重新抓取并入库：FY2026 写入官方真实股数 `19,901,959,514` 股（约 199.02 亿股），历史财年（FY2020–FY2025）经净利润与 EPS 自动推算出各年 194～220 亿股并带上「推算」标识，页面市值与估值恢复正常。
3. **A 股股数单位规范**：
   - 将全库 A 股 32,706 条面值即股数的 `CommonStockSharesOutstanding` 记录的 `unit` 从 `CNY` 批量纠正为 `'shares'`。
4. **友邦保险（1299.HK）币种校正**：
   - 纠正 `1299.HK` 的 `Entity.reportingCurrency` 为 `USD`，将其 550 条财务行单位纠正为 `USD`。

---

## 三、 验证闭环与同步确认

1. **质量检查 (Verification Loop)**：
   - `npm run lint`：通过，0 error，0 warning。
   - `npm test`：通过，全量 47 个测试套件（307 个测试用例）全部绿色通过。
   - `npm run build`：通过，Next.js 16 静态/动态路由打包成功。
2. **远程与生产节点同步**：
   - Commit `2d399510` & `06ce7bae` 已推送到远程 `origin/main`。
   - mini 机器通过 `git pull origin main` 完成 Fast-forward 同步，工作区代码完全对齐。

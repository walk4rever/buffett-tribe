# 模型覆盖审计（2026-10-14）

读了 100 份晨星快照，schema 并集 **414 行**；我们字典 **120 项**。

把它按性质分开之后：真正要拷贝的**数据行 266 行，我们覆盖了 82 行（31%）**，其余是容器行、晨星自己的 as-reported 平行轨、和到期日阶梯表。

判定标准（三条同时成立才允许扩展）：**晨星没定义 + 我们确实需要 + 源头拿得到**。
前两条机器算，第三条只有人能填，见文末待裁决清单。

## 总览

| 判定 | 项数 |
| --- | ---: |
| 已拷贝 | 85 |
| 候选扩展 | 22 |
| 待补 id（按名称匹配） | 13 |

## 1. 同一晨星行被多项认领（5 处）

一个晨星概念对应我们多个科目。要么拆错了，要么其中一个该改成别的行。

| 晨星条目 | 认领的我方科目 |
| --- | --- |
| `IFIS001700` | SellingExpense / AdministrativeExpense / SGAExpense |
| `IFIS002367` | InterestIncome / InterestExpense |
| `IFIS001917` | NonOperatingIncome / NonOperatingExpense |
| `IFBS000350` | CashAndCashEquivalents / ShortTermInvestments |
| `IFBS003308` | CommonStockSharesOutstanding / CapitalSurplus |

## 2. 待补 id：晨星有、我们没填（13 项）

这些不是扩展申请，是拷贝没做完。名称匹配已给出候选，需人工确认后填入字典。

| 我们的科目 | 中文名 | 疑似晨星条目 | 晨星 label | 相似度 | 备注 |
| --- | --- | --- | --- | ---: | --- |
| `InterestIncome` | 利息收入 | `IFIS002367` | Net Interest Income/Expense | 90% | 净额/毛额口径可能不同；与 InterestExpense 共用 IFIS002367 |
| `InterestExpense` | 利息支出 | `IFIS002367` | Net Interest Income/Expense | 90% | 净额/毛额口径可能不同；与 InterestIncome 共用 IFIS002367 |
| `InvestmentIncome` | 投资收益 | `IFIS001915` | Net Investment Income | 90% | 净额/毛额口径可能不同 |
| `NonOperatingIncome` | 营业外收入 | `IFIS001917` | Non-Operating Income/Expenses, Total | 90% | 与 NonOperatingExpense 共用 IFIS001917 |
| `NonOperatingExpense` | 营业外支出 | `IFIS001917` | Non-Operating Income/Expenses, Total | 90% | 与 NonOperatingIncome 共用 IFIS001917 |
| `EPSBasic` | 基本每股收益 | `IFIS101198` | Reported Normalized Basic EPS | 90% |  |
| `OtherReceivables` | 其他应收款 | `IFBS002709` | Other Receivables | 100% |  |
| `LongTermEquityInvestments` | 长期股权投资 | `IFBS001320` | Long Term Equity Investments | 100% |  |
| `InvestmentProperty` | 投资性房地产 | `IFBS100681` | Investment Properties and Properties Held for Development | 90% |  |
| `OtherPayables` | 其他应付款 | `IFBS002867` | Trade and Other Payables | 90% |  |
| `CapitalSurplus` | 资本公积 | `IFBS003308` | Paid in Capital | 90% | 与 CommonStockSharesOutstanding 共用 IFBS003308 |
| `MinorityInterest` | 少数股东权益 | `IFBS001381` | Non-Controlling/Minority Interests | 90% |  |
| `CashReceivedFromDisposalOfAssets` | 处置资产收回的现金净额 | `IFIS001877` | Asset Disposals | 77% | 跨表匹配，需确认 |

## 3. 候选扩展（22 项）

晨星 schema 里找不到对应行。**是否保留取决于第三列**，机器判不了。

| 我们的科目 | 中文名 | 所属表 | US 可取 | CN 可取 | HK 可取 | 备注 | 需要？ |
| --- | --- | --- | :-: | :-: | :-: | --- | --- |
| `TaxesAndSurcharges` | 税金及附加 | income_statement | ✓ | ✓ | ✓ |  |  |
| `FairValueChangeIncome` | 公允价值变动收益 | income_statement | ✓ | ✓ | ✓ |  |  |
| `MinorityInterestIncome` | 少数股东损益 | income_statement | ✓ | ✓ | ✓ |  |  |
| `NotesReceivable` | 应收票据 | balance_sheet_asset | ✓ | ✓ | ✓ |  |  |
| `Prepayments` | 预付款项 | balance_sheet_asset | ✓ | ✓ | ✓ |  |  |
| `ContractAssets` | 合同资产 | balance_sheet_asset | ✓ | ✓ | ✓ |  |  |
| `TotalLoans` | 客户贷款及垫款总额 (银行专属) | balance_sheet_asset | ✓ | ✓ | ✓ |  |  |
| `ConstructionInProgress` | 在建工程 | balance_sheet_asset | — | ✓ | ✓ |  |  |
| `RightOfUseAssets` | 使用权资产 | balance_sheet_asset | ✓ | ✓ | ✓ |  |  |
| `Goodwill` | 商誉 | balance_sheet_asset | ✓ | ✓ | ✓ |  |  |
| `EmployeeBenefitsPayable` | 应付职工薪酬 | balance_sheet_liability | ✓ | ✓ | ✓ |  |  |
| `TaxesPayable` | 应交税费 | balance_sheet_liability | ✓ | ✓ | ✓ |  |  |
| `NonCurrentLiabilitiesDueWithinOneYear` | 一年内到期的非流动负债 | balance_sheet_liability | ✓ | ✓ | ✓ |  |  |
| `LeaseLiabilities` | 租赁负债 | balance_sheet_liability | ✓ | ✓ | ✓ |  |  |
| `TotalDebt` | 总有息负债 (长短借款合计) | balance_sheet_liability | ✓ | — | — |  |  |
| `CashReceivedFromSales` | 销售商品、提供劳务收到的现金 | cash_flow | — | ✓ | ✓ |  |  |
| `CashPaidForInvestments` | 投资支付的现金 | cash_flow | ✓ | ✓ | ✓ |  |  |
| `CashReceivedFromBorrowings` | 取得借款收到的现金 | cash_flow | ✓ | ✓ | ✓ |  |  |
| `CashRepaymentsOfBorrowings` | 偿还债务支付的现金 | cash_flow | ✓ | ✓ | ✓ |  |  |
| `AssetsUnderManagement` | 管理资产规模 | supplementary | ✓ | ✓ | ✓ |  |  |
| `NetClientFlows` | 客户资产净流入 | supplementary | ✓ | ✓ | ✓ |  |  |
| `InvestmentManagementFeeIncome` | 资产管理费收入 | supplementary | ✓ | ✓ | ✓ |  |  |

## 4. 晨星有、我们完全没有的行（242 行）

按性质分开看，别把 250 这个数当成 250 个缺失科目。

### 4.1 真正缺的科目（184 行）

| 晨星 id | label | 表 | 多少家公司有 | 层级 |
| --- | --- | --- | ---: | --- |
| `IFIS001977` | Net Income after Extraordinary Items and Discontinued Operations | income | 100 | IncomeStatement > Net Income after Extraordinary Items and Discontinued Operations |
| `IFIS001090` | Net Income after Non-Controlling/Minority Interests | income | 100 | IncomeStatement > Net Income after Non-Controlling/Minority Interests |
| `IFCF001591` | Net Cash Flow from Continuing Operating Activities, Indirect | cashflow | 100 | CashFlow > Cash Flow from Operating Activities, Indirect > Net Cash Flow from Continuing Operating Activities, Indirect |
| `IFCF001510` | Cash Flow from Continuing Investing Activities | cashflow | 100 | CashFlow > Cash Flow from Investing Activities > Cash Flow from Continuing Investing Activities |
| `IFCF001509` | Cash Flow from Continuing Financing Activities | cashflow | 100 | CashFlow > Cash Flow from Financing Activities > Cash Flow from Continuing Financing Activities |
| `IFCF000650` | Effect of Exchange Rate Changes | cashflow | 94 | CashFlow > Cash and Cash Equivalents, End of Period > Effect of Exchange Rate Changes |
| `IFIS101189` | Irregular Income/Expenses | income | 92 | IncomeStatement > Non-Operating Income/Expenses, Total > Irregular Income/Expenses |
| `IFIS001839` | Business Revenue | income | 89 | IncomeStatement > Gross Profit > Total Revenue > Business Revenue |
| `IFIS001220` | Operating Income/Expenses | income | 89 | IncomeStatement > Operating Income/Expenses |
| `ORISZ00021` | Regular Dividend Per Share Calc | income | 89 | EpsAndWaso > Total Dividend Per Share > Regular Dividend Per Share Calc |
| `IFIS200292` | Other Income/Expense, Non-Operating | income | 78 | IncomeStatement > Non-Operating Income/Expenses, Total > Other Income/Expense, Non-Operating |
| `IFIS001040` | Non-Controlling/Minority Interests | income | 75 | IncomeStatement > Non-Controlling/Minority Interests |
| `IFIS002230` | Diluted Net Income Available to Common Stockholders | income | 70 | IncomeStatement > Diluted Net Income Available to Common Stockholders |
| `IFIS001882` | Gain/Loss on Foreign Exchange | income | 67 | IncomeStatement > Non-Operating Income/Expenses, Total > Net Investment Income > Gain/Loss on Foreign Exchange |
| `IFCF001615` | Net Movement in Non-Controlling/Minority Interest | cashflow | 66 | CashFlow > Cash Flow from Financing Activities > Cash Flow from Continuing Financing Activities > Net Movement in Non-Controlling/Minority Interest |
| `IFIS003118` | Cost of Goods and Services | income | 65 | IncomeStatement > Gross Profit > Cost of Revenue > Cost of Goods and Services |
| `IFIS002303` | Reported Effective Tax Rate | income | 65 | IncomeStatement > Income Statement Supplemental Section > Reported Normalized and Operating Income/Expense Supplemental Section > Reported Effective Tax Rate |
| `IFIS000040` | General and Administrative Expenses | income | 65 | IncomeStatement > Operating Income/Expenses > Selling, General and Administrative Expenses > General and Administrative Expenses |
| `IFIS101191` | Income from Associates, Joint Ventures and Other Participating Interests | income | 61 | IncomeStatement > Non-Operating Income/Expenses, Total > Net Investment Income > Income from Associates, Joint Ventures and Other Participating Interests |
| `IFIS001690` | Selling and Marketing Expenses | income | 59 | IncomeStatement > Operating Income/Expenses > Selling, General and Administrative Expenses > Selling and Marketing Expenses |
| `IFBS100688` | Prepayments and Deposits, Current | balance | 59 | BalanceSheet > Total Assets > Total Current Assets > Prepayments and Deposits, Current |
| `IFBS002717` | Payables and Accrued Expenses, Non-Current | balance | 57 | BalanceSheet > Total Liabilities > Total Non-Current Liabilities > Payables and Accrued Expenses, Non-Current |
| `IFIS101208` | Other Income/Expense, Operating | income | 56 | IncomeStatement > Operating Income/Expenses > Other Income/Expense, Operating |
| `IFIS001982` | Impairment/Write Off/Write Down of Other Assets | income | 51 | IncomeStatement > Non-Operating Income/Expenses, Total > Irregular Income/Expenses > Impairment/Write Off/Write Down of Other Assets |
| `IFIS001855` | Depreciation, Amortization and Depletion | income | 51 | IncomeStatement > Operating Income/Expenses > Depreciation, Amortization and Depletion |
| `IFIS001892` | Impairment/Write Off/Write Down of Capital Assets | income | 50 | IncomeStatement > Non-Operating Income/Expenses, Total > Irregular Income/Expenses > Impairment/Write Off/Write Down of Capital Assets |
| `IFBS200020` | Trade and Other Receivables, Non-Current | balance | 50 | BalanceSheet > Total Assets > Total Non-Current Assets > Trade and Other Receivables, Non-Current |
| `IFCF100478` | Cash Dividends Paid to Non-Controlling/Minority Interests | cashflow | 50 | CashFlow > Cash Flow from Financing Activities > Cash Flow from Continuing Financing Activities > Cash Dividends Paid to Non-Controlling/Minority Interests |
| `IFCF200290` | Other Operating Cash Flow | cashflow | 49 | CashFlow > Cash Flow from Operating Activities, Indirect > Net Cash Flow from Continuing Operating Activities, Indirect > Other Operating Cash Flow |
| `IFIS000250` | Depreciation and Amortization | income | 47 | IncomeStatement > Operating Income/Expenses > Depreciation, Amortization and Depletion > Depreciation and Amortization |
| `IFIS001871` | Fair Value or Unrealized Gain/Loss on Financial Assets | income | 46 | IncomeStatement > Non-Operating Income/Expenses, Total > Net Investment Income > Fair Value or Unrealized Gain/Loss on Financial Assets |
| `IFIS101192` | Other Finance Income/Expenses | income | 42 | IncomeStatement > Non-Operating Income/Expenses, Total > Total Net Finance Income/Expense > Other Finance Income/Expenses |
| `IFIS200030` | Other Income, Operating | income | 40 | IncomeStatement > Operating Income/Expenses > Other Income/Expense, Operating > Other Income, Operating |
| `IFIS001370` | Taxes Other Than Income Taxes | income | 39 | IncomeStatement > Operating Income/Expenses > Taxes Other Than Income Taxes |
| `IFCF200010` | Cash Flow from/Used in Operating Activities, Direct | cashflow | 38 | CashFlow > Cash Flow from/Used in Operating Activities, Direct |
| `IFIS101183` | Staff Costs | income | 37 | IncomeStatement > Operating Income/Expenses > Selling, General and Administrative Expenses > Staff Costs |
| `IFBS001890` | Provisions, Current | balance | 36 | BalanceSheet > Total Liabilities > Total Current Liabilities > Provisions, Current |
| `IFBS000570` | Deferred Costs/Assets, Non-Current | balance | 36 | BalanceSheet > Total Assets > Total Non-Current Assets > Deferred Costs/Assets, Non-Current |
| `IFIS001928` | Other Investment Income | income | 35 | IncomeStatement > Non-Operating Income/Expenses, Total > Net Investment Income > Other Investment Income |
| `IFIS001885` | Gain/Loss on Investments and Other Financial Instruments | income | 34 | IncomeStatement > Non-Operating Income/Expenses, Total > Net Investment Income > Gain/Loss on Investments and Other Financial Instruments |
| … | 其余 144 行见 JSON | | | |

### 4.2 晨星自己的 as-reported / 标准化前平行轨（不是我们缺科目，是另一条轨）（10 行）

| 晨星 id | label | 表 | 多少家公司有 | 层级 |
| --- | --- | --- | ---: | --- |
| `IFIS003203` | Total Revenue as Reported, Supplemental | income | 100 | IncomeStatement > Income Statement Supplemental Section > Reported Normalized and Operating Income/Expense Supplemental Section > Total Revenue as Reported, Supplemental |
| `IFCF002210` | Change in Cash as Reported, Supplemental | cashflow | 100 | CashFlow > Cash Flow Supplemental Section > Change in Cash as Reported, Supplemental |
| `IFIS002229` | Reported Normalized Income | income | 87 | IncomeStatement > Income Statement Supplemental Section > Reported Normalized and Operating Income/Expense Supplemental Section > Reported Normalized Income |
| `IFIS003138` | Total Operating Profit/Loss as Reported, Supplemental | income | 78 | IncomeStatement > Income Statement Supplemental Section > Reported Normalized and Operating Income/Expense Supplemental Section > Total Operating Profit/Loss as Reported, Supplemental |
| `IFIS003202` | Reported Normalized Operating Profit | income | 34 | IncomeStatement > Income Statement Supplemental Section > Reported Normalized and Operating Income/Expense Supplemental Section > Reported Normalized Operating Profit |
| `IFIS003137` | Operating Expense as Reported, Supplemental | income | 27 | IncomeStatement > Income Statement Supplemental Section > Reported Normalized and Operating Income/Expense Supplemental Section > Operating Expense as Reported, Supplemental |
| `IFIS003176` | Reported Normalized EBITDA | income | 16 | IncomeStatement > Income Statement Supplemental Section > Reported Normalized and Operating Income/Expense Supplemental Section > Reported Normalized EBITDA |
| `IFCF001698` | Interest Received, Supplemental | cashflow | 7 | CashFlow > Cash Flow Supplemental Section > Interest Received, Supplemental |
| `IFCF001697` | Income Tax Refund, Supplemental | cashflow | 4 | CashFlow > Cash Flow Supplemental Section > Income Tax Refund, Supplemental |
| `IFIS003177` | Reported Normalized EBIT | income | 3 | IncomeStatement > Income Statement Supplemental Section > Reported Normalized and Operating Income/Expense Supplemental Section > Reported Normalized EBIT |

### 4.3 到期日阶梯表（合同义务、租赁负债分年、债务分年）（48 行）

| 晨星 id | label | 表 | 多少家公司有 | 层级 |
| --- | --- | --- | ---: | --- |
| `DMBS000041` | Total Contractual Obligations | balance | 97 | BalanceSheet > Total Contractual Obligations |
| `DMBS000042` | Total Contractual Obligations due in Year 1 | balance | 97 | BalanceSheet > Total Contractual Obligations > Total Contractual Obligations due in Year 1 |
| `DMBS000047` | Total Contractual Obligations due Beyond | balance | 97 | BalanceSheet > Total Contractual Obligations > Total Contractual Obligations due Beyond |
| `DMBS000033` | Total Lease Liability | balance | 96 | BalanceSheet > Total Lease Liability |
| `DMBS000034` | Total Lease Liability - Due in year 1 | balance | 96 | BalanceSheet > Total Lease Liability > Total Lease Liability - Due in year 1 |
| `DMBS000039` | Total Lease Liability - Beyond | balance | 95 | BalanceSheet > Total Lease Liability > Total Lease Liability - Beyond |
| `DMBS000046` | Total Contractual Obligations due in Year 5 | balance | 95 | BalanceSheet > Total Contractual Obligations > Total Contractual Obligations due in Year 5 |
| `DMBS000048` | Total Contractual Obligations - Interests Charges and Other Adjustments | balance | 94 | BalanceSheet > Total Contractual Obligations > Total Contractual Obligations - Interests Charges and Other Adjustments |
| `DMBS000001` | Debt Maturity Schedule Total | balance | 93 | BalanceSheet > Debt Maturity Schedule Total |
| `DMBS000038` | Total Lease Liability - Due in year 5 | balance | 92 | BalanceSheet > Total Lease Liability > Total Lease Liability - Due in year 5 |
| `DMBS000002` | Debt due in Year 1 | balance | 91 | BalanceSheet > Debt Maturity Schedule Total > Debt due in Year 1 |
| `DMBS000043` | Total Contractual Obligations due in Year 2 | balance | 90 | BalanceSheet > Total Contractual Obligations > Total Contractual Obligations due in Year 2 |
| `DMBS000006` | Debt due in Year 5 | balance | 89 | BalanceSheet > Debt Maturity Schedule Total > Debt due in Year 5 |
| `DMBS000040` | Total Lease Liability - Interest Charges and Other Adjustments | balance | 89 | BalanceSheet > Total Lease Liability > Total Lease Liability - Interest Charges and Other Adjustments |
| `DMBS000025` | Other Contractual Obligations Maturity Schedule Total | balance | 88 | BalanceSheet > Other Contractual Obligations Maturity Schedule Total |
| `DMBS000026` | Other Contractual Obligations due in Year 1 | balance | 88 | BalanceSheet > Other Contractual Obligations Maturity Schedule Total > Other Contractual Obligations due in Year 1 |
| `DMBS000007` | Debt due Beyond | balance | 86 | BalanceSheet > Debt Maturity Schedule Total > Debt due Beyond |
| `DMBS000030` | Other Contractual Obligations due in Year 5 | balance | 85 | BalanceSheet > Other Contractual Obligations Maturity Schedule Total > Other Contractual Obligations due in Year 5 |
| `DMBS000035` | Total Lease Liability - Due in year 2 | balance | 84 | BalanceSheet > Total Lease Liability > Total Lease Liability - Due in year 2 |
| `DMBS000031` | Other Contractual Obligations due Beyond | balance | 82 | BalanceSheet > Other Contractual Obligations Maturity Schedule Total > Other Contractual Obligations due Beyond |
| `DMBS000008` | Debt - Interests Charges and Other Adjustments | balance | 78 | BalanceSheet > Debt Maturity Schedule Total > Debt - Interests Charges and Other Adjustments |
| `DMBS000017` | Operating Lease Obligation Maturity Schedule Total | balance | 77 | BalanceSheet > Operating Lease Obligation Maturity Schedule Total |
| `DMBS000018` | Operating Lease due in Year 1 | balance | 77 | BalanceSheet > Operating Lease Obligation Maturity Schedule Total > Operating Lease due in Year 1 |
| `DMBS000003` | Debt due in Year 2 | balance | 76 | BalanceSheet > Debt Maturity Schedule Total > Debt due in Year 2 |
| `DMBS000023` | Operating Lease due Beyond | balance | 74 | BalanceSheet > Operating Lease Obligation Maturity Schedule Total > Operating Lease due Beyond |
| `DMBS000009` | Capital Lease Obligation Maturity Schedule Total | balance | 73 | BalanceSheet > Capital Lease Obligation Maturity Schedule Total |
| `DMBS000044` | Total Contractual Obligations due in Year 3 | balance | 73 | BalanceSheet > Total Contractual Obligations > Total Contractual Obligations due in Year 3 |
| `DMBS000010` | Capital Lease due in Year 1 | balance | 72 | BalanceSheet > Capital Lease Obligation Maturity Schedule Total > Capital Lease due in Year 1 |
| `DMBS000036` | Total Lease Liability - Due in year 3 | balance | 71 | BalanceSheet > Total Lease Liability > Total Lease Liability - Due in year 3 |
| `DMBS000015` | Capital Lease due Beyond | balance | 67 | BalanceSheet > Capital Lease Obligation Maturity Schedule Total > Capital Lease due Beyond |
| `DMBS000020` | Operating Lease due in Year 3 | balance | 67 | BalanceSheet > Operating Lease Obligation Maturity Schedule Total > Operating Lease due in Year 3 |
| `DMBS000022` | Operating Lease due in Year 5 | balance | 67 | BalanceSheet > Operating Lease Obligation Maturity Schedule Total > Operating Lease due in Year 5 |
| `DMBS000014` | Capital Lease due in Year 5 | balance | 66 | BalanceSheet > Capital Lease Obligation Maturity Schedule Total > Capital Lease due in Year 5 |
| `DMBS000019` | Operating Lease due in Year 2 | balance | 65 | BalanceSheet > Operating Lease Obligation Maturity Schedule Total > Operating Lease due in Year 2 |
| `DMBS000004` | Debt due in Year 3 | balance | 63 | BalanceSheet > Debt Maturity Schedule Total > Debt due in Year 3 |
| `DMBS000016` | Capital Lease - Interests Charges and Other Adjustments | balance | 63 | BalanceSheet > Capital Lease Obligation Maturity Schedule Total > Capital Lease - Interests Charges and Other Adjustments |
| `DMBS000045` | Total Contractual Obligations due in Year 4 | balance | 61 | BalanceSheet > Total Contractual Obligations > Total Contractual Obligations due in Year 4 |
| `DMBS000028` | Other Contractual Obligations due in Year 3 | balance | 59 | BalanceSheet > Other Contractual Obligations Maturity Schedule Total > Other Contractual Obligations due in Year 3 |
| `DMBS000011` | Capital Lease due in Year 2 | balance | 56 | BalanceSheet > Capital Lease Obligation Maturity Schedule Total > Capital Lease due in Year 2 |
| `DMBS000037` | Total Lease Liability - Due in year 4 | balance | 55 | BalanceSheet > Total Lease Liability > Total Lease Liability - Due in year 4 |
| … | 其余 8 行见 JSON | | | |

## 5. 待你裁决的清单

把结论写进 `scripts/lib/golden-set/model-decisions.json` 的 `items.<key>.need`，取值：
`需要-保留扩展` / `不需要-删除` / `待定`。脚本下次运行会把它填进上表。

- `TaxesAndSurcharges`（税金及附加）：晨星 schema 里无对应行
- `FairValueChangeIncome`（公允价值变动收益）：晨星 schema 里无对应行
- `MinorityInterestIncome`（少数股东损益）：晨星 schema 里无对应行
- `NotesReceivable`（应收票据）：晨星 schema 里无对应行
- `Prepayments`（预付款项）：晨星 schema 里无对应行
- `ContractAssets`（合同资产）：晨星 schema 里无对应行
- `TotalLoans`（客户贷款及垫款总额 (银行专属)）：晨星 schema 里无对应行
- `ConstructionInProgress`（在建工程）：晨星 schema 里无对应行
- `RightOfUseAssets`（使用权资产）：晨星 schema 里无对应行
- `Goodwill`（商誉）：晨星 schema 里无对应行
- `EmployeeBenefitsPayable`（应付职工薪酬）：晨星 schema 里无对应行
- `TaxesPayable`（应交税费）：晨星 schema 里无对应行
- `NonCurrentLiabilitiesDueWithinOneYear`（一年内到期的非流动负债）：晨星 schema 里无对应行
- `LeaseLiabilities`（租赁负债）：晨星 schema 里无对应行
- `TotalDebt`（总有息负债 (长短借款合计)）：晨星 schema 里无对应行
- `CashReceivedFromSales`（销售商品、提供劳务收到的现金）：晨星 schema 里无对应行
- `CashPaidForInvestments`（投资支付的现金）：晨星 schema 里无对应行
- `CashReceivedFromBorrowings`（取得借款收到的现金）：晨星 schema 里无对应行
- `CashRepaymentsOfBorrowings`（偿还债务支付的现金）：晨星 schema 里无对应行
- `AssetsUnderManagement`（管理资产规模）：晨星 schema 里无对应行
- `NetClientFlows`（客户资产净流入）：晨星 schema 里无对应行
- `InvestmentManagementFeeIncome`（资产管理费收入）：晨星 schema 里无对应行

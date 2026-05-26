# Buffett Tribe 数据缩写字典（简版）

> 适用范围：本项目的 13F / 10-K / XBRL 数据导入与展示。  
> 更新时间：2026-05-26

## 1) 证券与主体标识

| 术语 | 含义 | 示例 | 来源 |
|---|---|---|---|
| `Ticker` | 股票代码（交易代码），用于在交易所识别证券 | `AAPL`, `MCO`, `SPGI` | Investor.gov Glossary: Ticker（https://www.investor.gov/index.php/introduction-investing/investing-basics/glossary/ticker） |
| `CUSIP` | 9位证券标识码，用于唯一识别多数美加证券 | `037833100`（Apple 常见 CUSIP） | Investor.gov: CUSIP Number（https://www.investor.gov/introduction-investing/investing-basics/glossary/cusip-number） |
| `CIK` | SEC 分配给 EDGAR 申报主体的唯一编号（Central Index Key） | `0001067983`（Berkshire） | SEC EDGAR Glossary: CIK（https://www.sec.gov/submit-filings/filer-support-resources/edgar-glossary） |
| `Accession Number` / `accno` | EDGAR 单次申报的唯一受理号 | `0001193125-26-226661` | SEC EDGAR Filer Manual（术语定义，ACCESSION NUMBER）（https://www.sec.gov/info/edgar/specifications/edgarfm-vol1-34_d.pdf） |

## 2) 报表与数据来源

| 术语 | 含义 | 示例 | 来源 |
|---|---|---|---|
| `13F-HR` | 机构投资管理人季度持仓申报表（披露持仓） | 2026Q1 持仓 | SEC EDGAR Filing Type 页面描述（如 “Form 13F-HR - Quarterly report filed by institutional managers, Holdings”） |
| `10-K` | 美国上市公司年报（年度报告） | FY2025 10-K | SEC Form 10-K（https://www.sec.gov/files/form10-k.pdf） |
| `XBRL` | 结构化财报标记语言；SEC 用于财务披露结构化数据 | `companyfacts` API 中 us-gaap 标签 | SEC EDGAR API 文档（https://www.sec.gov/edgar/sec-api-documentation） |
| `EDGAR` | SEC 披露检索系统（申报与公开查询） | filings / submissions / companyfacts | SEC 官网（https://www.sec.gov/edgar/search/） |

## 3) 本项目常见时间字段

| 术语 | 含义 | 示例 | 来源 |
|---|---|---|---|
| `asOfDate` | 持仓生效报告日（通常对应报告期末） | `2026-03-31` | 项目 schema: `Holding.asOfDate`（`prisma/schema.prisma`） |
| `filedAt` | 向 SEC 实际提交日期 | `2026-05-15`（13F） | 项目 schema: `ExtSource.filedAt`（`prisma/schema.prisma`） |
| `periodYear` | 报告期年份 | `2026` | 项目 schema: `ExtSource.periodYear`（`prisma/schema.prisma`） |
| `periodQuarter` | 报告期季度（1-4） | `1`（Q1） | 项目 schema: `ExtSource.periodQuarter`（`prisma/schema.prisma`） |
| `FY` / `Q1..Q4` | 财报周期类型（年报/季报） | `FY`, `Q1` | 项目 schema: `Financial.periodType`（`prisma/schema.prisma`） |

## 4) 本项目常见数值字段

| 术语 | 含义 | 示例 | 来源 |
|---|---|---|---|
| `shares` | 持股数量 | `1200000` | 项目 schema: `Holding.shares`（`prisma/schema.prisma`） |
| `valueUsd` | 持仓市值（美元） | `350000000` | 项目 schema: `Holding.valueUsd`（`prisma/schema.prisma`） |
| `percentOfPortfolio` | 该标的占组合比例 | `12.4`（%） | 项目 schema: `Holding.percentOfPortfolio`（`prisma/schema.prisma`） |

## 5) 快速辨析

- `AAPL` 是 **Ticker**，不是 `CUSIP`。  
- `CUSIP` 通常是 9 位字母数字组合；`Ticker` 通常是 1-5 位交易代码。  
- 同一公司可能存在多个证券代码/类别（例如不同 share class），分析时应优先用项目内 `securityId` 去重，而不是只看 `ticker`。

## 6) 备注（项目实现口径）

- 本项目 13F 导入与增量对比的工程主键建议使用 `Holding.securityId`，`ticker` 主要用于展示。  
- `Security` 通过 `companyEntityId` 关联公司实体；同一公司可有多个 `Security`（如不同 share class）。  
- 原因：`ticker` 可能缺失、变更或存在多类别映射；`securityId` 才是项目内稳定的证券主键。
- 文本关系抽取当前不再落到 Postgres 表；`Mention` 和 `EntityRelation` 已移除，关系检索统一走 Neo4j 图谱链路。

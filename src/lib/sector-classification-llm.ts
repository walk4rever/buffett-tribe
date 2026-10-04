/**
 * 13 类行业分类 —— LLM 路由的 prompt 构建与响应校验（纯函数，无 I/O）。
 *
 * 设计要点（为什么不是规则）：
 *   · 规则读不到 `CompanyAnalysis.overview`，而 overview 里恰好写着「属建筑
 *     安装业 / 主营 X / 收入来自 Y」这类分类答案。规则只能退回去猜关键词，
 *     于是把「数字信息服务」这类描述误判。
 *   · 规则没有逃生舱，每家公司都被塞进某个桶（历史数据里 338 家 industrial
 *     有 184 家是 null-sector 兜底产物）。
 *
 * 因此这里做三件事：把事实组织成证据包 → 用分层 prompt 让模型先定「族」再定
 * 「细分」→ 强制输出结构化结果，并允许 `unknown`。
 *
 * I/O（调 LLM、写库）在 scripts/classify-sector.ts，本文件保持可单测。
 */

import {
  SECTOR_MODEL_13_CONFIG,
  SECTOR_MODEL_13_TYPES,
  isSectorModelType13,
  type SectorModelType13,
} from "./sector-classification";
import type { SectorFingerprint } from "./sector-fingerprint";

/** prompt 改动必须 bump：参与 inputsHash，bump 后全库会自动重算 */
export const SECTOR_CLASSIFY_PROMPT_VERSION = "sector13-v3";

/** 置信度低于此值 → 进人工复核队列（不静默落库） */
export const SECTOR_REVIEW_CONFIDENCE_THRESHOLD = 0.7;

export type SectorClassificationOutcome = "classified" | "unknown";

export interface SectorEvidence {
  ticker: string | null;
  market: string | null;
  name: string;
  nameZh: string | null;
  cik: string | null;
  /** 数据源给的行业字段，口径混杂（Yahoo 式 + 中文行业名），只作参考 */
  sectorRaw: string | null;
  industry: string | null;
  exchange: string | null;
  /** 3 句话业务概览（Phase 1 生成），本分类的主证据 */
  overview: string | null;
  fingerprint: SectorFingerprint;
}

export interface SectorClassificationResult {
  outcome: SectorClassificationOutcome;
  /** unknown 时为 null */
  type: SectorModelType13 | null;
  confidence: number;
  reason: string;
  evidenceUsed: string[];
  /** 置信度不足或 reason 缺失，需人工复核 */
  needsReview: boolean;
}

// ── 证据格式化 ────────────────────────────────────────────────────────────────

function formatMagnitude(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${(value / 1e8).toFixed(1)} 亿`;
  if (abs >= 1e4) return `${(value / 1e4).toFixed(1)} 万`;
  return value.toString();
}

function formatRatio(value: number | null, asPercent = false): string | null {
  if (value == null) return null;
  return asPercent ? `${(value * 100).toFixed(1)}%` : value.toFixed(2);
}

/**
 * 财务指纹的展示行。同时被 prompt 与人工复核文件使用 —— 人工复核时要能看到
 * 模型到底看到了什么，才能判断它错在证据还是错在推理。
 */
export function formatFingerprintLines(fingerprint: SectorFingerprint, label = "财务指纹"): string[] {
  if (!fingerprint.periodLabel) return [`${label}：无可用财务数据`];

  const entries: Array<[string, string | null]> = [
    ["营收", fingerprint.revenue != null ? formatMagnitude(fingerprint.revenue) : null],
    ["营收同比", formatRatio(fingerprint.revenueYoY, true)],
    ["净利率", formatRatio(fingerprint.netMargin, true)],
    ["毛利率", formatRatio(fingerprint.grossMargin, true)],
    ["ROE", formatRatio(fingerprint.roe, true)],
    ["资产/营收", formatRatio(fingerprint.assetToRevenue)],
    ["负债/资产", formatRatio(fingerprint.liabilitiesToAssets, true)],
    ["资本开支/营收", formatRatio(fingerprint.capexToRevenue, true)],
    ["经营现金流/净利润", formatRatio(fingerprint.cashConversion)],
    ["是否亏损", fingerprint.isLossMaking == null ? null : fingerprint.isLossMaking ? "是" : "否"],
  ];

  const body = entries
    .filter(([, value]) => value != null)
    .map(([key, value]) => `${key}：${value}`)
    .join("，");

  return [`${label}（${fingerprint.periodLabel}）：${body}`];
}

export function buildSectorEvidenceText(evidence: SectorEvidence): string {
  const lines: string[] = [];

  const nameParts = [evidence.name];
  if (evidence.nameZh && evidence.nameZh !== evidence.name) nameParts.push(`（${evidence.nameZh}）`);
  lines.push(`名称：${nameParts.join("")}`);

  const identity = [
    evidence.market ? `市场：${evidence.market}` : null,
    evidence.ticker ? `代码：${evidence.ticker}` : null,
    evidence.exchange ? `交易所：${evidence.exchange}` : null,
  ].filter(Boolean);
  if (identity.length > 0) lines.push(identity.join("　"));

  if (evidence.sectorRaw || evidence.industry) {
    lines.push(
      `数据源行业字段（口径混杂，仅供参考，不可直接当分类依据）：Sector=${evidence.sectorRaw ?? "N/A"}　Industry=${evidence.industry ?? "N/A"}`,
    );
  }

  lines.push("");
  lines.push("业务概览（由年报与财务数据生成的事实性描述，本任务的主证据）：");
  lines.push(evidence.overview?.trim() ? evidence.overview.trim() : "（无）");

  lines.push("");
  lines.push(...formatFingerprintLines(evidence.fingerprint));

  return lines.join("\n");
}

// ── Prompt ────────────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const catalog = SECTOR_MODEL_13_TYPES.map((type) => {
    const c = SECTOR_MODEL_13_CONFIG[type];
    return `- ${type}（${c.label}）：${c.definition}`;
  }).join("\n");

  return `你是上市公司行业分类器。你的任务：为公司选择唯一一个分类。

分类标准是「估值逻辑是否不同」，不是行业名称。判断依据是：这家公司的估值锚是什么（用什么倍数、看什么指标），以及它的利润由什么驱动。

# 可选类别（13 类）
${catalog}

# 判断顺序

第一步，先不看行业名字，回答三个客观问题：
1. 收入来自「资产带来的利息/承保利润/租金/资产增值」，还是「卖产品或服务」？
2. 资产/营收比是多少？显著大于 3 通常意味着资产负债表型业务。
3. 毛利率与资本开支/营收的水平？（高毛利 + 低资本开支 = 轻资产；低毛利 + 高资本开支 = 重资产）

注意：**不要只凭负债/资产比判定金融**。零售与连锁餐饮常用租赁负债与股份回购压低权益，负债率也会超过 80%（例：家得宝负债/资产 87.8%、ROE 110%、但资产/营收仅 0.64），这类公司是消费品牌而非银行。同理，ROE 极高或为负都不是金融信号。判定金融需要同时满足：资产/营收显著偏高 **且** 收入来自利息/承保/收费。

第二步，按业务本质落到「族」，再在族内定细分：

- 资产负债表型（资产/营收显著偏高，收入来自资产）
  · 吸收存贷、赚净息差、承担信用风险 → banks
  · 先收保费后赔付、赚承保利润与投资收益 → insurance
  · 不承担信用风险的收费型：管理规模、成交量、评级、托管佣金 → capital_markets
  · 靠存量物业收租或开发销售、对利率敏感 → real_estate
- 产品同质、价格由全球供需决定（油气/煤炭/矿业/钢铁/化工/水泥）→ energy_materials
- 受监管特许经营、核准回报率决定收益上限（电/气/水/电网/核电）→ utilities
- 电信运营商（竞争性 ARPU + 重资本开支）→ telecommunications
- 卖给终端消费者的产品或服务，靠品牌、渠道、门店 → consumer_brand
- 药品、器械、医疗服务，靠管线与专利 → healthcare
- 软件与平台，靠订阅、网络效应、轻资产 → software_platform
- 芯片与电子硬件，靠技术代际与产能 → semiconductor_hardware
- 设备制造、工程承包、运输物流，靠订单与产能 → industrial
- 业务横跨多个不相关行业，靠分部估值加总（SOTP）→ conglomerate

第三步，在这些已知边界上必须按规则裁决，不要自由发挥：

金融内部：
- 交易所、资产管理、券商投行、评级与金融数据（如 MSCI、SPGI、BLK、CME、HKEX）→ capital_markets，**不要**归 banks（它们不承担信用风险，估值倍数差距巨大）
- 管理式医疗（UNH、CI、CNC 这类健康保险公司）→ healthcare
- 支付网络（V、MA）→ software_platform，**不要**归 capital_markets
- 信托、融资租赁、消费信贷 → banks（承担资产负债表风险）

地产内部：
- 物业管理 → industrial（轻资产服务业），**不要**归 real_estate
- 抵押型 REIT（如 NLY、AGNC，赚息差）→ banks
- 酒店经营（自有并运营酒店）→ consumer_brand；纯粹持有酒店物业收租 → real_estate

控股判定（最严格标准，不要过度识别）：
- conglomerate 的门槛：旗下**并表经营**≥3个**完全不相关**的行业（例：金融+制造+能源+消费），**且无单一业务占营收>50%**，**且**估值必须用分部加总（SOTP）而非单一倍数。典型：伯克希尔（保险+铁路+能源+制造）、长和（港口+零售+基建+电讯+能源）、中信（银行+证券+特钢+地产）。
- 两个业务的组合（零售+地产、制造+服务、成衣+商铺）→ 按**主营收入占比更大**的业务归类，**不算** conglomerate
- 单一主业 + 参股/财务投资（如医药公司持有券商股权）→ 按主业归，利润来自投资收益不改变主业性质
- 名字含「控股」「集团」「综合企业」不等于 conglomerate — 必须看实际业务构成

其他：
- 电信设备制造 → semiconductor_hardware（电信只装运营商）
- 汽车整车与零部件 → consumer_brand
- 人力与项目型专业服务 → industrial；软件订阅式专业服务 → software_platform
- 电池、储能及电池产线设备 → industrial（是电气设备/部件制造，**不是**半导体；别因为「技术代际」「产能周期」就归 semiconductor_hardware）
- 光伏：组件/电池片归 semiconductor_hardware（GICS 口径），光伏玻璃/石英埩埚/硅料等材料归 energy_materials

算力相关（按**收入形态**判，不按「算力」这个词判）：
- 自营挖矿/自产算力，价格随行就市（币价、算力市价）→ energy_materials（利润随商品价格，PE 失效）
- 按租约把机房或算力出租收租（有租约对手方、收入是租金）→ real_estate（收租型重资产，估值锚是资产与 FFO/NAV）
- 交易所、经纪、托管、做市等收费型数字资产服务 → capital_markets
- 纯持币的财库型主体（估值锚是币的 NAV）→ unknown

# 证据不足时必须输出 unknown

允许输出 unknown 的情况：
1. 既没有业务概览，财务数据也不足以判断（证据基本为空）
2. 描述只说是「投资控股」「综合业务」，没有任何业务细节可判断归属
3. 标的不是经营性实体：SPAC/空白支票公司、ETF、信托基金、封闭式基金
4. 描述与财务指纹严重矛盾，且无法判断哪一边可信

**绝对不要「暂归最近类别」。** 宁可 unknown，也不要一个不可靠的标签 —— 错误标签会污染该类的估值基准，比缺失更糟。

# 输出

只输出一个 JSON 对象，不要 Markdown 代码块，不要任何额外解释：

{"type": "<上述 13 个 key 之一，或 unknown>", "confidence": <0 到 1 的小数>, "reason": "<不超过 60 字>", "evidence_used": ["<用到的证据字段名>"]}

约束：
- reason 必须引用输入里真实出现过的事实（例如业务概览中的原话、或某个具体财务比率），**禁止写输入里没有的业务描述**。做不到就不要写。
- confidence 的标定：0.9 以上表示业务本质明确且无边界冲突；0.7–0.9 表示有一点边界模糊但结论可靠；低于 0.7 表示你在猜 —— 这种情况应该重新考虑输出 unknown。
- evidence_used 从这些值里选：overview、fingerprint、industry_field、company_name。`;
}

export function buildSectorClassificationPrompt(evidence: SectorEvidence): { system: string; user: string } {
  return {
    system: buildSystemPrompt(),
    user: `请对以下公司做分类。\n\n${buildSectorEvidenceText(evidence)}`,
  };
}

// ── 响应校验 ──────────────────────────────────────────────────────────────────

function parseJsonLoose(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const candidates = [withoutFence];
  const first = withoutFence.indexOf("{");
  const last = withoutFence.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(withoutFence.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // 试下一个候选
    }
  }
  throw new Error(`无法解析分类响应为 JSON：${raw.slice(0, 200)}`);
}

/**
 * 校验并归一化 LLM 响应。
 *
 * 与 classify-existing-companies 的旧规则不同，这里**不提供兜底类别**：
 * 响应里出现非法类型直接抛错，由调用方决定重试或标记失败。悄悄改成 industrial
 * 正是旧方案污染数据的方式。
 */
export function parseSectorClassification(raw: string): SectorClassificationResult {
  const parsed = parseJsonLoose(raw);

  const rawType = parsed.type ?? parsed.sector ?? parsed.category;
  const typeText = typeof rawType === "string" ? rawType.trim().toLowerCase() : "";

  const rawConfidence = parsed.confidence;
  let confidence =
    typeof rawConfidence === "number" && Number.isFinite(rawConfidence)
      ? rawConfidence
      : typeof rawConfidence === "string" && Number.isFinite(Number(rawConfidence))
        ? Number(rawConfidence)
        : 0.5;
  confidence = Math.min(1, Math.max(0, confidence));

  const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";
  const rawEvidence = parsed.evidence_used ?? parsed.evidenceUsed;
  const evidenceUsed = Array.isArray(rawEvidence)
    ? rawEvidence.filter((item): item is string => typeof item === "string")
    : [];

  if (typeText === "unknown" || typeText === "" || typeText === "none" || typeText === "null") {
    return { outcome: "unknown", type: null, confidence, reason, evidenceUsed, needsReview: false };
  }

  if (!isSectorModelType13(typeText)) {
    throw new Error(`响应中的类型不在 13 类之内：${String(rawType)}`);
  }

  // reason 是零幻觉承诺的审计线索，缺失时降级置信度让它进复核队列
  const effectiveConfidence = reason ? confidence : Math.min(confidence, 0.5);

  return {
    outcome: "classified",
    type: typeText,
    confidence: effectiveConfidence,
    reason,
    evidenceUsed,
    needsReview: effectiveConfidence < SECTOR_REVIEW_CONFIDENCE_THRESHOLD,
  };
}

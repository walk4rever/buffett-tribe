// Resolves the reporting/functional currency for a CN/HK company's Financial
// rows. akshare exposes no currency field anywhere (checked both markets'
// company-profile and financial-statement endpoints) — see
// scripts/fetch-cn-hk-company-profile-ak.py's module docstring.
//
// CN is a hardcoded fact, not a per-company lookup: A-share listed companies
// are required (CSRC / mainland accounting rules) to report in RMB. Every CN
// entry ever hand-typed into the old scripts/lib/cn-hk-company-seeds.ts (贵州
// 茅台/中国神华/宁德时代/招商银行/泸州老窖/长江电力, 6/6) was CNY — zero
// exceptions.
//
// HK genuinely varies — 泡泡玛特 (09992) is HK-listed but reports in RMB, not
// HKD, confirmed against real FY2024 revenue figures (see TODO.md P0 ②).
// So HK currency is extracted from the annual report text itself, which by
// pipeline order is only available after import_annual_report runs (see
// onboard-company.ts's HK step reordering) — this can't run at seed_entity
// time like the CN case.
import { execSync } from "node:child_process";
import db from "@/lib/prisma";
import { normalizeCurrencyCode } from "@/lib/fx-rates-core";
import { CN_HK_SEEDS } from "./cn-hk-company-seeds";

export function resolveCnCurrency(): "CNY" {
  return "CNY";
}

type CurrencyGuess = "CNY" | "HKD" | "USD";

// Verified against 泡泡玛特's already-stored hk-annual-report FilingSection
// text: real financial-statement tables repeat a currency unit header on
// every column (e.g. "RMB'000" / "人民幣千元") dozens of times, while an
// incidental mention elsewhere (a subsidiary's functional currency in the
// notes, e.g. "美元" for a Hong Kong entity) shows up once or twice — a
// frequency count cleanly separates the two rather than matching on the
// first hit.
const CURRENCY_PATTERNS: Record<CurrencyGuess, RegExp> = {
  CNY: /RMB|人民[幣币]/g,
  HKD: /HK\$|港[元幣币]/g,
  USD: /US\$|美元/g,
};

const MIN_DOMINANT_COUNT = 5;
const MIN_DOMINANCE_RATIO = 3;

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

async function classifyCurrencyLlm(sampleText: string): Promise<CurrencyGuess | null> {
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_API_BASE_URL;
  const model = process.env.AI_MODEL;
  if (!apiKey || !baseUrl || !model) {
    throw new Error("Missing AI_API_KEY / AI_API_BASE_URL / AI_MODEL env vars for currency classification.");
  }

  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 4000,
      stream: false,
      messages: [
        {
          role: "system",
          content:
            "You read excerpts of company annual reports and answer only with the currency the financial statements are denominated in: CNY, HKD, or USD. No explanation.",
        },
        {
          role: "user",
          content: `What currency are the financial statements in this annual report excerpt denominated in? Answer only CNY, HKD, or USD.\n\n${sampleText.slice(0, 3000)}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
  const raw = (data.choices?.[0]?.message?.content ?? "").trim().toUpperCase();
  if (raw.includes("CNY")) return "CNY";
  if (raw.includes("HKD")) return "HKD";
  if (raw.includes("USD")) return "USD";
  return null;
}

// Reads the most recently imported hk-annual-report's FilingSection text for
// this entity and resolves the currency it's denominated in. Regex-first
// (frequency count over real repeated table headers), LLM fallback only if
// the regex can't find a clearly dominant currency. Throws rather than
// silently defaulting — an unresolved currency must not silently become
// "assume HKD", the exact mistake 泡泡玛特 already proved wrong once.
export async function resolveHkCurrencyFromAnnualReport(entityId: string): Promise<CurrencyGuess> {
  const latestSource = await db.extSource.findFirst({
    where: { filerEntityId: entityId, kind: "hk-annual-report" },
    orderBy: { periodYear: "desc" },
    select: { id: true },
  });
  if (!latestSource) {
    throw new Error(`No hk-annual-report ExtSource found for entity ${entityId} — run import_annual_report first.`);
  }

  const sections = await db.filingSection.findMany({
    where: { entityId, sourceId: latestSource.id },
    select: { content: true },
  });
  const text = sections.map((s) => s.content ?? "").join("\n");
  if (!text.trim()) {
    throw new Error(`hk-annual-report FilingSection text is empty for entity ${entityId} — cannot resolve currency.`);
  }

  const counts = Object.fromEntries(
    (Object.entries(CURRENCY_PATTERNS) as Array<[CurrencyGuess, RegExp]>).map(([currency, pattern]) => [
      currency,
      countMatches(text, pattern),
    ]),
  ) as Record<CurrencyGuess, number>;

  const sorted = (Object.entries(counts) as Array<[CurrencyGuess, number]>).sort((a, b) => b[1] - a[1]);
  const [topCurrency, topCount] = sorted[0];
  const runnerUpCount = sorted[1][1];

  if (topCount >= MIN_DOMINANT_COUNT && (runnerUpCount === 0 || topCount >= runnerUpCount * MIN_DOMINANCE_RATIO)) {
    return topCurrency;
  }

  const llmGuess = await classifyCurrencyLlm(text);
  if (llmGuess) return llmGuess;

  throw new Error(
    `Could not resolve HK reporting currency for entity ${entityId} from annual report text (regex counts: ${JSON.stringify(counts)}, LLM fallback also failed). Needs manual investigation.`,
  );
}

export function resolveHkCurrencyViaYfinance(ticker: string): CurrencyGuess | null {
  try {
    const pyCmd = process.env.VIRTUAL_ENV
      ? `${process.env.VIRTUAL_ENV}/bin/python`
      : ".venv/bin/python";
    const cmd = `[ -x ${pyCmd} ] && ${pyCmd} -c 'import yfinance as yf; print(yf.Ticker("${ticker}").info.get("financialCurrency", ""))' || python3 -c 'import yfinance as yf; print(yf.Ticker("${ticker}").info.get("financialCurrency", ""))'`;
    const out = execSync(cmd, { encoding: "utf-8", timeout: 20000 }).trim().toUpperCase();
    if (out === "CNY" || out === "HKD" || out === "USD") {
      return out as CurrencyGuess;
    }
    return null;
  } catch (e) {
    console.error("[resolveHkCurrencyViaYfinance] failed:", e);
    return null;
  }
}

export interface ResolveCurrencyCandidate {
  id?: string | null;
  ticker: string;
  market?: string | null;
  reportingCurrency?: string | null;
}

/**
 * 跨市场权威五级币种推导解析器 (5-Tier Currency Resolver):
 * 1. 精准种子表 (CN_HK_SEEDS) 覆盖 (如 AIA 友邦标示为 USD)
 * 2. Entity 库内已登记且合规的 reportingCurrency
 * 3. 市场级法定规则 (US -> USD, CN -> CNY)
 * 4. 港股 (HK) 多级推导:
 *    4a. 库内已有 Financial 表的法定记账单位 unit
 *    4b. 从年报正文 (FilingSection) 中提取词频 (resolveHkCurrencyFromAnnualReport)
 *    4c. Yahoo Finance 财报币种 (financialCurrency)
 *    4d. 最终兜底为 HKD
 */
export interface ResolveCurrencyOptions {
  dbClient?: typeof db;
  yfResolver?: (ticker: string) => CurrencyGuess | null;
}

export async function resolveCompanyReportingCurrency(
  candidate: ResolveCurrencyCandidate,
  optionsOrDb?: ResolveCurrencyOptions | typeof db,
): Promise<string> {
  const options: ResolveCurrencyOptions =
    optionsOrDb && "financial" in optionsOrDb
      ? { dbClient: optionsOrDb }
      : (optionsOrDb ?? {});
  const dbClient = options.dbClient ?? db;
  const yfResolver = options.yfResolver ?? resolveHkCurrencyViaYfinance;

  // 1. 手工精准种子表兜底与优先匹配
  const seed = (CN_HK_SEEDS as Record<string, { currency?: string }>)[candidate.ticker];
  if (seed?.currency) {
    const normSeed = normalizeCurrencyCode(seed.currency);
    if (normSeed) return normSeed;
  }

  // 2. 检查 Entity 上已登记且合规的 reportingCurrency
  const registered = normalizeCurrencyCode(candidate.reportingCurrency);
  if (registered) return registered;

  // 3. 市场级别默认
  const normMarket = candidate.market?.toLowerCase();
  if (normMarket === "us" || (!normMarket && !candidate.ticker.includes("."))) return "USD";
  if (
    normMarket === "cn" ||
    candidate.ticker.endsWith(".SS") ||
    candidate.ticker.endsWith(".SZ") ||
    candidate.ticker.endsWith(".BJ")
  ) {
    return "CNY";
  }

  // 4. 港股 (HK) 多级推导:
  // 4a. 检查库内已有 Financial 表的法定记账单位 unit
  if (candidate.id) {
    try {
      const existingFin = await dbClient.financial.findFirst({
        where: { entityId: candidate.id, unit: { in: ["CNY", "HKD", "USD"] } },
        select: { unit: true },
      });
      const normFinUnit = normalizeCurrencyCode(existingFin?.unit);
      if (normFinUnit) return normFinUnit;
    } catch {
      // 忽略查询失败
    }

    // 4b. 尝试从年报正文（FilingSection）中统计币种词频
    try {
      const fromReport = await resolveHkCurrencyFromAnnualReport(candidate.id);
      const normReport = normalizeCurrencyCode(fromReport);
      if (normReport) return normReport;
    } catch {
      // Phase 1 阶段尚未切出 FilingSection，静默 fallback
    }
  }

  // 4c. 尝试从 Yahoo Finance 接口获取财报申报币种 (financialCurrency)
  const fromYf = normalizeCurrencyCode(yfResolver(candidate.ticker));
  if (fromYf) return fromYf;

  // 4d. 最终兜底为 HKD
  return "HKD";
}

/**
 * 将解析出的权威币种写回 Entity.reportingCurrency (若库内尚未登记或不一致)
 */
export async function persistCompanyReportingCurrency(
  entityId: string,
  currency: string,
  dbClient = db,
): Promise<void> {
  const norm = normalizeCurrencyCode(currency);
  if (!norm) return;
  try {
    await dbClient.entity.update({
      where: { id: entityId },
      data: { reportingCurrency: norm },
    });
  } catch (err) {
    console.warn(`[persistCompanyReportingCurrency] Failed to update entity ${entityId}:`, err);
  }
}



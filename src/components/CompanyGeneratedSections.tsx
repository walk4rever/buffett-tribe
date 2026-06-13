/**
 * Server-rendered sections for the LLM-generated 管理分析 / 估值分析 tabs.
 * Payloads come from GeneratedContentVersion (artifactType:
 * management_analysis / valuation_analysis). All numbers in the valuation
 * payload were computed in code; the LLM only wrote the narratives.
 */

type GeneratedArtifact = {
  payload: unknown;
  generatedAt: Date;
  source: string;
};

type AnalysisCard = {
  label: string;
  verdict: string;
  evidence?: string;
  sourceRef?: string;
};

type MasterView = {
  master: string;
  view: string;
  evidence?: string;
  sourceRef?: string;
};

type ManagementPayload = {
  headline: string;
  capitalAllocation: { score: number | null; cards: AnalysisCard[] };
  masterViews: MasterView[];
  alignment: { cards: AnalysisCard[] };
  watchlist: string[];
};

type ScenarioItem = {
  name: string;
  growthPct: number;
  exitPe: number;
  rationale: string;
  impliedPrice: number | null;
  impliedAnnualReturnPct: number | null;
};

type ValuationPayload = {
  metrics: {
    asOfDate: string;
    latestPrice: number | null;
    latestFiscalYear: number | null;
    pe: { current: number | null; min: number | null; max: number | null; median: number | null; percentile: number | null };
    priceToOcf: number | null;
    priceToFcf: number | null;
    fcfBasis: "fcf" | "ocf_proxy";
    revenueCagrPct: number | null;
    netIncomeCagrPct: number | null;
  };
  position: { verdict: string; narrative: string };
  quality: { narrative: string };
  scenarios: { horizonYears: number; items: ScenarioItem[]; note: string };
  conclusion: { narrative: string; masterContrast: string };
};

function obj(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseCards(value: unknown): AnalysisCard[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): AnalysisCard | null => {
      const card = obj(item);
      if (!card) return null;
      const label = str(card.label);
      const verdict = str(card.verdict);
      if (!label || !verdict) return null;
      return { label, verdict, evidence: str(card.evidence), sourceRef: str(card.sourceRef) };
    })
    .filter((card): card is AnalysisCard => card != null);
}

export function parseManagementPayload(payload: unknown): ManagementPayload | null {
  const root = obj(payload);
  if (!root) return null;
  const capitalAllocation = obj(root.capitalAllocation);
  const alignment = obj(root.alignment);
  const headline = str(root.headline);
  const cards = parseCards(capitalAllocation?.cards);
  if (!headline || !cards.length) return null;

  const masterViews = Array.isArray(root.masterViews)
    ? root.masterViews
        .map((item): MasterView | null => {
          const view = obj(item);
          if (!view) return null;
          const master = str(view.master);
          const text = str(view.view);
          if (!master || !text) return null;
          return { master, view: text, evidence: str(view.evidence), sourceRef: str(view.sourceRef) };
        })
        .filter((v): v is MasterView => v != null)
    : [];

  return {
    headline,
    capitalAllocation: { score: numOrNull(capitalAllocation?.score), cards },
    masterViews,
    alignment: { cards: parseCards(alignment?.cards) },
    watchlist: Array.isArray(root.watchlist) ? root.watchlist.map(str).filter(Boolean) : [],
  };
}

export function parseValuationPayload(payload: unknown): ValuationPayload | null {
  const root = obj(payload);
  const metrics = obj(root?.metrics);
  const pe = obj(metrics?.pe);
  const position = obj(root?.position);
  const quality = obj(root?.quality);
  const scenarios = obj(root?.scenarios);
  const conclusion = obj(root?.conclusion);
  if (!root || !metrics || !pe || !position || !quality || !scenarios || !conclusion) return null;
  if (!str(position.narrative)) return null;

  const items = Array.isArray(scenarios.items)
    ? scenarios.items
        .map((item) => {
          const s = obj(item);
          if (!s) return null;
          return {
            name: str(s.name) || "情景",
            growthPct: numOrNull(s.growthPct) ?? 0,
            exitPe: numOrNull(s.exitPe) ?? 0,
            rationale: str(s.rationale),
            impliedPrice: numOrNull(s.impliedPrice),
            impliedAnnualReturnPct: numOrNull(s.impliedAnnualReturnPct),
          };
        })
        .filter((s): s is ScenarioItem => s != null)
    : [];

  return {
    metrics: {
      asOfDate: str(metrics.asOfDate),
      latestPrice: numOrNull(metrics.latestPrice),
      latestFiscalYear: numOrNull(metrics.latestFiscalYear),
      pe: {
        current: numOrNull(pe.current),
        min: numOrNull(pe.min),
        max: numOrNull(pe.max),
        median: numOrNull(pe.median),
        percentile: numOrNull(pe.percentile),
      },
      priceToOcf: numOrNull(metrics.priceToOcf),
      priceToFcf: numOrNull(metrics.priceToFcf),
      fcfBasis: metrics.fcfBasis === "fcf" ? "fcf" : "ocf_proxy",
      revenueCagrPct: numOrNull(metrics.revenueCagrPct),
      netIncomeCagrPct: numOrNull(metrics.netIncomeCagrPct),
    },
    position: { verdict: str(position.verdict), narrative: str(position.narrative) },
    quality: { narrative: str(quality.narrative) },
    scenarios: { horizonYears: numOrNull(scenarios.horizonYears) ?? 5, items, note: str(scenarios.note) },
    conclusion: { narrative: str(conclusion.narrative), masterContrast: str(conclusion.masterContrast) },
  };
}

function GenMeta({ artifact }: { artifact: GeneratedArtifact }) {
  return (
    <span className="company-gen-meta">
      AI 生成 · {artifact.generatedAt.toISOString().slice(0, 10)}
    </span>
  );
}

function CardGrid({ cards, columns }: { cards: AnalysisCard[]; columns?: 2 | 3 }) {
  return (
    <div className={`company-placeholder-grid${columns === 2 ? " company-placeholder-grid--two" : ""}`}>
      {cards.map((card) => (
        <article key={card.label} className="company-placeholder-card">
          <h3>{card.label}</h3>
          <p>{card.verdict}</p>
          {card.evidence ? <p className="company-gen-evidence">{card.evidence}</p> : null}
          {card.sourceRef ? <p className="company-gen-source">来源：{card.sourceRef}</p> : null}
        </article>
      ))}
    </div>
  );
}

export function ManagementAnalysisSection({ artifact }: { artifact: GeneratedArtifact }) {
  const data = parseManagementPayload(artifact.payload);
  if (!data) return null;

  return (
    <>
      <div className="company-financial-trend-head">
        <h3>管理层总评</h3>
        <GenMeta artifact={artifact} />
      </div>
      <div className="company-text-card">
        <p>{data.headline}</p>
      </div>

      <div className="company-financial-trend-head">
        <h3>资本配置{data.capitalAllocation.score != null ? ` · ${data.capitalAllocation.score}/10` : ""}</h3>
      </div>
      <CardGrid cards={data.capitalAllocation.cards} />

      {data.masterViews.length > 0 ? (
        <>
          <div className="company-financial-trend-head">
            <h3>大师视角</h3>
          </div>
          <div className="company-placeholder-grid company-placeholder-grid--two">
            {data.masterViews.map((view) => (
              <article key={view.master} className="company-placeholder-card">
                <h3>{view.master}</h3>
                <p>{view.view}</p>
                {view.evidence ? <p className="company-gen-evidence">{view.evidence}</p> : null}
                {view.sourceRef ? <p className="company-gen-source">来源：{view.sourceRef}</p> : null}
              </article>
            ))}
          </div>
        </>
      ) : null}

      {data.alignment.cards.length > 0 ? (
        <>
          <div className="company-financial-trend-head">
            <h3>股东利益一致性</h3>
          </div>
          <CardGrid cards={data.alignment.cards} columns={2} />
        </>
      ) : null}

      {data.watchlist.length > 0 ? (
        <>
          <div className="company-financial-trend-head">
            <h3>后续观察</h3>
          </div>
          <div className="company-gen-watchlist">
            {data.watchlist.map((item) => (
              <span key={item} className="company-gen-watch-item">
                {item}
              </span>
            ))}
          </div>
        </>
      ) : null}

      <p className="company-gen-disclaimer">
        以上内容由 AI 基于 SEC 公开文件、财务数据与股东信生成，不构成任何投资建议。
      </p>
    </>
  );
}

function fmt(value: number | null, suffix = "") {
  return value != null ? `${value}${suffix}` : "—";
}

export function ValuationAnalysisSection({ artifact }: { artifact: GeneratedArtifact }) {
  const data = parseValuationPayload(artifact.payload);
  if (!data) return null;
  const { metrics } = data;

  const stats = [
    { label: `当前 PE（FY${metrics.latestFiscalYear ?? "—"}）`, value: fmt(metrics.pe.current) },
    { label: "历史区间 低/中/高", value: `${fmt(metrics.pe.min)} / ${fmt(metrics.pe.median)} / ${fmt(metrics.pe.max)}` },
    { label: "历史分位", value: fmt(metrics.pe.percentile, "%") },
    metrics.fcfBasis === "fcf"
      ? { label: "P/FCF", value: fmt(metrics.priceToFcf) }
      : { label: "P/OCF", value: fmt(metrics.priceToOcf) },
  ];

  return (
    <>
      <div className="company-financial-trend-head">
        <h3>估值位置{data.position.verdict ? ` · ${data.position.verdict}` : ""}</h3>
        <GenMeta artifact={artifact} />
      </div>
      <div className="company-val-stats">
        {stats.map((stat) => (
          <div key={stat.label} className="company-val-stat">
            <span className="company-val-stat-value">{stat.value}</span>
            <span className="company-val-stat-label">{stat.label}</span>
          </div>
        ))}
      </div>
      <div className="company-text-card">
        <p>{data.position.narrative}</p>
      </div>

      <div className="company-financial-trend-head">
        <h3>质量与增长</h3>
      </div>
      <div className="company-text-card">
        <p>{data.quality.narrative}</p>
      </div>

      {data.scenarios.items.length > 0 ? (
        <>
          <div className="company-financial-trend-head">
            <h3>情景分析（{data.scenarios.horizonYears} 年）</h3>
          </div>
          <div className="company-scenario-wrap">
            <table className="company-scenario-table">
              <thead>
                <tr>
                  <th>情景</th>
                  <th>EPS 年增速</th>
                  <th>退出 PE</th>
                  <th>隐含价格</th>
                  <th>隐含年化</th>
                  <th>假设依据</th>
                </tr>
              </thead>
              <tbody>
                {data.scenarios.items.map((s) => (
                  <tr key={s.name}>
                    <td>{s.name}</td>
                    <td>{s.growthPct}%</td>
                    <td>{s.exitPe}</td>
                    <td>{s.impliedPrice != null ? `$${s.impliedPrice}` : "—"}</td>
                    <td
                      className={
                        s.impliedAnnualReturnPct != null && s.impliedAnnualReturnPct < 0
                          ? "company-scenario-return company-scenario-return--neg"
                          : "company-scenario-return"
                      }
                    >
                      {s.impliedAnnualReturnPct != null ? `${s.impliedAnnualReturnPct}%` : "—"}
                    </td>
                    <td className="company-scenario-rationale">{s.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.scenarios.note ? <p className="company-gen-source">{data.scenarios.note}</p> : null}
        </>
      ) : null}

      <div className="company-financial-trend-head">
        <h3>估值判断</h3>
      </div>
      <div className="company-text-card">
        <p>{data.conclusion.narrative}</p>
        {data.conclusion.masterContrast ? <p>{data.conclusion.masterContrast}</p> : null}
      </div>

      <p className="company-gen-disclaimer">
        数字由系统从财务与价格数据计算（{metrics.fcfBasis === "fcf" ? "FCF = OCF − CapEx" : "OCF 近似 FCF"}，数据截至{" "}
        {metrics.asOfDate}），叙述由 AI 生成，不构成任何投资建议。
      </p>
    </>
  );
}

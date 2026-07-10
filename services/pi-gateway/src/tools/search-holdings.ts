import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { pool } from "../db.js";

type HoldingRow = {
  shares: string | null;
  value_usd: string | null;
  pct: number | null;
  is_new: boolean | null;
  is_sold: boolean | null;
  change_pct: number | null;
  as_of_date: string;
  security_ticker: string | null;
  title_of_class: string | null;
  company_name: string | null;
  company_ticker: string | null;
  period_year: number;
  period_quarter: number;
};

async function queryHoldings(
  tribeId: string,
  company: string | null,
  year: number | null,
  quarter: number | null,
  topN: number,
): Promise<HoldingRow[]> {
  const params: unknown[] = [tribeId];
  const filters: string[] = [];

  if (year != null) {
    params.push(year);
    filters.push(`es."periodYear" = $${params.length}`);
  }
  if (quarter != null) {
    params.push(quarter);
    filters.push(`es."periodQuarter" = $${params.length}`);
  }
  if (company != null) {
    params.push(company.toUpperCase());
    params.push(`%${company}%`);
    filters.push(`(UPPER(ce.ticker) = $${params.length - 1} OR UPPER(s.ticker) = $${params.length - 1} OR ce."canonicalName" ILIKE $${params.length})`);
  }

  // If no year/quarter specified, default to the most recent available quarter
  const periodFilter = year == null && quarter == null
    ? `AND (es."periodYear", es."periodQuarter") = (
        SELECT es2."periodYear", es2."periodQuarter"
        FROM "ExtSource" es2
        JOIN "Entity" h2 ON h2.id = es2."filerEntityId" AND h2."tribeId" = $1
        WHERE es2.kind = '13f' AND es2."periodYear" IS NOT NULL
        ORDER BY es2."periodYear" DESC, es2."periodQuarter" DESC
        LIMIT 1
      )`
    : "";

  const whereClause = filters.length > 0 ? `AND ${filters.join(" AND ")}` : "";
  params.push(topN);

  const sql = `
    SELECT
      h.shares::text                  AS shares,
      h."valueUsd"::text              AS value_usd,
      h."percentOfPortfolio"          AS pct,
      h."isNewPosition"               AS is_new,
      h."isSoldOut"                   AS is_sold,
      h."positionChangePct"           AS change_pct,
      h."asOfDate"::text              AS as_of_date,
      s.ticker                        AS security_ticker,
      s."titleOfClass"                AS title_of_class,
      ce."canonicalName"              AS company_name,
      ce.ticker                       AS company_ticker,
      es."periodYear"                 AS period_year,
      es."periodQuarter"              AS period_quarter
    FROM "Holding" h
    JOIN "Entity" holder ON holder.id = h."holderEntityId" AND holder."tribeId" = $1
    JOIN "ExtSource" es ON es.id = h."sourceId" AND es.kind = '13f'
    JOIN "Security" s ON s.id = h."securityId"
    LEFT JOIN "Entity" ce ON ce.id = s."companyEntityId"
    WHERE h."isSoldOut" IS NOT TRUE
      ${periodFilter}
      ${whereClause}
    ORDER BY h."percentOfPortfolio" DESC NULLS LAST
    LIMIT $${params.length}
  `;

  const result = await pool.query<HoldingRow>(sql, params);
  return result.rows;
}

function formatUsd(raw: string | null): string {
  if (!raw) return "N/A";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "N/A";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString()}`;
}

function formatShares(raw: string | null): string {
  if (!raw) return "N/A";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "N/A";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

async function getFilerLabels(): Promise<Map<string, string>> {
  const result = await pool.query<{ tribeId: string; name: string }>(
    `SELECT "tribeId", "name" FROM "Filer"`,
  );
  return new Map(result.rows.map((r) => [r.tribeId, r.name]));
}

function formatHoldings(rows: HoldingRow[], masterLabel: string): string {
  if (rows.length === 0) return "No holdings found matching the criteria.";

  const first = rows[0];
  const period = `Q${first.period_quarter} ${first.period_year}`;

  const lines = [`**${masterLabel} — 13F Holdings (${period})**\n`];

  for (const row of rows) {
    const ticker = row.company_ticker ?? row.security_ticker ?? "—";
    const name = row.company_name ?? row.title_of_class ?? "Unknown";
    const pct = row.pct != null ? `${row.pct.toFixed(2)}% of portfolio` : "";
    const value = formatUsd(row.value_usd);
    const shares = formatShares(row.shares);
    const change = row.change_pct != null
      ? `${row.change_pct > 0 ? "+" : ""}${row.change_pct.toFixed(1)}%`
      : null;
    const badges = [
      row.is_new ? "NEW" : null,
      change ? `chg ${change}` : null,
    ].filter(Boolean).join(" · ");

    lines.push(
      `**${ticker}** ${name}` +
      (pct ? `  —  ${pct}` : "") +
      `\n  Shares: ${shares}  |  Value: ${value}` +
      (badges ? `  |  ${badges}` : ""),
    );
  }

  return lines.join("\n\n");
}

export const searchHoldingsTool = defineTool({
  name: "search_holdings",
  label: "Search 13F Holdings",
  description:
    "Look up 13F portfolio holdings for tracked investors (Buffett, Li Lu, Duan Yongping, Gavin Baker, Alex Sacerdote). Returns position size, portfolio weight, and quarter-over-quarter change. Defaults to the most recent available quarter.",
  promptSnippet: "search_holdings(master, company?, year?, quarter?) → 13F holdings data",
  parameters: Type.Object({
    master: Type.String({
      description: "Which investor: buffett | lilu | duan | gavin-baker | alex-sacerdote",
    }),
    company: Type.Optional(Type.String({
      description: "Filter by company ticker (e.g. AAPL) or partial name. Omit to get full portfolio.",
    })),
    year: Type.Optional(Type.Number({
      description: "Filter by year (e.g. 2023). Omit for most recent.",
    })),
    quarter: Type.Optional(Type.Number({
      description: "Filter by quarter 1–4. Omit for most recent.",
    })),
    top_n: Type.Optional(Type.Number({
      description: "Max positions to return (default 15, max 25).",
    })),
  }),
  async execute(_toolCallId, params, signal) {
    const { master, company, year, quarter, top_n } = params;

    const tribeId = master.toLowerCase().trim();
    const filerLabels = await getFilerLabels();
    const masterLabel = filerLabels.get(tribeId);
    if (!masterLabel) {
      return {
        content: [{ type: "text" as const, text: `Unknown master "${master}". Use: ${[...filerLabels.keys()].join(" | ")}` }],
        details: null,
      };
    }

    const limit = Math.min(top_n ?? 15, 25);

    if (signal?.aborted) {
      return { content: [{ type: "text" as const, text: "Search cancelled." }], details: null };
    }

    let rows: HoldingRow[];
    try {
      rows = await queryHoldings(
        tribeId,
        company ?? null,
        year ?? null,
        quarter ?? null,
        limit,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Holdings query failed: ${msg}` }], details: null };
    }

    return {
      content: [{ type: "text" as const, text: formatHoldings(rows, masterLabel) }],
      details: { count: rows.length },
    };
  },
});

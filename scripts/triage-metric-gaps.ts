/**
 * Convert the metric matrix into an actionable, deduplicated gap queue.
 *
 * Usage:
 *   npm run triage:metrics
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type MatrixRow = Record<string, string>;

type TriageRow = {
  priority: "P0" | "P1" | "CLOSED";
  action: string;
  market: string;
  ticker: string;
  metricId: string;
  metricName: string;
  requiredInputs: string;
  latestFiscalYear: string;
  coverageYears: string;
  gapDisposition: string;
  reason: string;
};

const INPUT_PATH = path.join(process.cwd(), "METRIC_VALIDATION_RESULTS.csv");
const OUTPUT_PATH = path.join(process.cwd(), "METRIC_GAP_TRIAGE.csv");

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some(Boolean));
}

function matrixRows(text: string): MatrixRow[] {
  const [header, ...rows] = parseCsv(text);
  return rows.map((values) =>
    Object.fromEntries(
      header.map((column, index) => [column, values[index] ?? ""]),
    ),
  );
}

function recommendation(row: MatrixRow): {
  priority: TriageRow["priority"];
  action: string;
} {
  if (row.validationStatus === "EXEMPT") {
    return {
      priority: "CLOSED",
      action: "evidence_classified",
    };
  }
  if (row.validationStatus === "PARTIAL") {
    return {
      priority: "P1",
      action: "backfill_historical_coverage",
    };
  }

  const metric = `${row.metricName} ${row.requiredInputs}`;
  if (/股数|BPS|PB|CommonStockSharesOutstanding/.test(metric)) {
    return {
      priority: "P0",
      action: "backfill_period_end_shares",
    };
  }
  if (/并购|PurchaseSaleOfBusinessNet/.test(metric)) {
    return {
      priority: "P0",
      action: "verify_no_activity_evidence_or_map_acquisition_tag",
    };
  }
  if (/回购|分红|ShareRepurchaseAmt|DividendsPaid/.test(metric)) {
    return {
      priority: "P0",
      action: "verify_zero_event_evidence_or_map_cash_flow_tag",
    };
  }
  if (/债务|Debt/.test(metric)) {
    return {
      priority: "P0",
      action: "review_debt_component_mapping",
    };
  }
  if (/投资资产|保险合同负债|保险|CombinedRatio|ClaimsRatio/.test(metric)) {
    return {
      priority: "P0",
      action: "review_industry_extractor",
    };
  }
  if (/合同负债|ContractLiabilities/.test(metric)) {
    return {
      priority: "P0",
      action: "review_contract_liability_semantics",
    };
  }
  return {
    priority: "P0",
    action: "review_source_disclosure_and_mapping",
  };
}

function csvEscape(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function main() {
  const rows = matrixRows(readFileSync(INPUT_PATH, "utf8"))
    .filter((row) =>
      ["FAIL", "PARTIAL", "EXEMPT"].includes(row.validationStatus),
    )
    .map((row): TriageRow => {
      const { priority, action } = recommendation(row);
      return {
        priority,
        action,
        market: row.market,
        ticker: row.ticker,
        metricId: row.metricId,
        metricName: row.metricName,
        requiredInputs: row.requiredInputs,
        latestFiscalYear: row.latestFiscalYear,
        coverageYears: row.coverageYears,
        gapDisposition: row.gapDisposition,
        reason: row.reason,
      };
    })
    .sort(
      (a, b) =>
        a.priority.localeCompare(b.priority) ||
        a.action.localeCompare(b.action) ||
        a.ticker.localeCompare(b.ticker) ||
        a.metricId.localeCompare(b.metricId),
    );

  const columns: Array<keyof TriageRow> = [
    "priority",
    "action",
    "market",
    "ticker",
    "metricId",
    "metricName",
    "requiredInputs",
    "latestFiscalYear",
    "coverageYears",
    "gapDisposition",
    "reason",
  ];
  writeFileSync(
    OUTPUT_PATH,
    [
      columns.join(","),
      ...rows.map((row) =>
        columns.map((column) => csvEscape(row[column])).join(","),
      ),
    ].join("\n") + "\n",
    "utf8",
  );

  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.action, (counts.get(row.action) ?? 0) + 1);
  }
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`Open queue items: ${rows.length}`);
  for (const [action, count] of [...counts.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`${count}\t${action}`);
  }
}

main();

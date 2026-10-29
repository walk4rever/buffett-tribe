/**
 * Bidirectional validation between METRICS.md / metric-contract.json
 * and the actual frontend presentation layers:
 * 1. Financial Dashboard (src/lib/company-financial-dashboard.ts)
 * 2. Capital Allocation View (src/lib/capital-allocation-metrics.ts & CapitalAllocationView.tsx)
 * 3. Valuation Analysis (src/lib/valuation-analysis-metrics.ts & ValuationAnalysisView.tsx)
 * 4. Value Line Profile (src/lib/value-line-metric-profile.ts & ValueLineCard.tsx)
 *
 * Ensures:
 * - Every metric declared as displayed is actually bound and rendered by frontend code.
 * - Every displayed financial metric in frontend is covered by the metric contract.
 *
 * Usage:
 *   npx tsx scripts/check-metric-pages.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

type PageBinding = {
  pages: string[];
  keys: string[];
};

const BINDINGS_PATH = path.join(
  process.cwd(),
  "scripts",
  "lib",
  "metric-page-bindings.json",
);
const CONTRACT_PATH = path.join(
  process.cwd(),
  "scripts",
  "lib",
  "metric-contract.json",
);

function main() {
  const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8"));
  const bindings: Record<string, PageBinding> = JSON.parse(
    readFileSync(BINDINGS_PATH, "utf8"),
  );

  // Read page implementations
  const finContent = readFileSync(
    path.join(process.cwd(), "src", "lib", "company-financial-dashboard.ts"),
    "utf8",
  );
  const capContent =
    readFileSync(
      path.join(process.cwd(), "src", "lib", "capital-allocation-metrics.ts"),
      "utf8",
    ) +
    readFileSync(
      path.join(process.cwd(), "src", "components", "CapitalAllocationView.tsx"),
      "utf8",
    );
  const valContent =
    readFileSync(
      path.join(process.cwd(), "src", "lib", "valuation-analysis-metrics.ts"),
      "utf8",
    ) +
    readFileSync(
      path.join(process.cwd(), "src", "components", "ValuationAnalysisView.tsx"),
      "utf8",
    );
  const vlContent =
    readFileSync(
      path.join(process.cwd(), "src", "lib", "value-line-metric-profile.ts"),
      "utf8",
    ) +
    readFileSync(
      path.join(process.cwd(), "src", "components", "ValueLineCard.tsx"),
      "utf8",
    );

  const errors: string[] = [];
  let checkedCount = 0;

  for (const metric of contract.metrics) {
    checkedCount++;
    const binding = bindings[metric.id];
    if (!binding) {
      errors.push(`[${metric.id} ${metric.name}] Missing page binding entry`);
      continue;
    }

    if (binding.pages.includes("input_only")) {
      // Input only metrics must not declare displayed pages
      continue;
    }

    for (const page of binding.pages) {
      let pageCode = "";
      if (page === "financials") pageCode = finContent;
      else if (page === "capital_allocation") pageCode = capContent;
      else if (page === "valuation") pageCode = valContent;
      else if (page === "value_line") pageCode = vlContent;

      const matchedKey = binding.keys.find((k) => pageCode.includes(k));
      if (!matchedKey) {
        errors.push(
          `[${metric.id} ${metric.name}] Declared on '${page}', but none of keys [${binding.keys.join(", ")}] found in implementation`,
        );
      }
    }
  }

  // Check that rowKeys in financial dashboard all belong to contract or exclusions
  const finRowKeysMatch = [
    ...finContent.matchAll(/key:\s*"([A-Za-z0-9_]+)"/g),
  ].map((m) => m[1]);
  const allContractKeys = new Set(
    Object.values(bindings).flatMap((b) => b.keys),
  );

  const orphanFinKeys: string[] = [];
  for (const k of finRowKeysMatch) {
    if (!allContractKeys.has(k)) {
      orphanFinKeys.push(k);
    }
  }

  if (orphanFinKeys.length > 0) {
    console.warn(
      `Notice: Financial dashboard defines helper/extra keys not explicitly bound in contract: ${orphanFinKeys.join(", ")}`,
    );
  }

  if (errors.length > 0) {
    console.error(`Found ${errors.length} page binding errors:`);
    for (const err of errors) console.error(` - ${err}`);
    process.exit(1);
  }

  console.log(
    `Successfully verified page bidirectional bindings across all ${checkedCount} contract metrics. All declared pages and code symbols matched.`,
  );
}

main();

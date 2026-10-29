/**
 * Generate the complete 45-company x contract-metric validation matrix.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/eval-metric-matrix.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import db from "../src/lib/prisma";
import {
  assertMetricContract,
  type DataRequirement,
  type MetricContractArtifact,
  type MetricContractRecord,
  type ValidationRole,
} from "./lib/metric-contract-registry";
import {
  classifyFinancialLineage,
  type FinancialLineage,
} from "./lib/financial-lineage";
import { assessRequirement } from "./lib/metric-coverage";
export { requirementForMetric } from "./lib/metric-contract-rules";

type ValidationCompany = {
  ticker: string;
  name: string;
  market: "us" | "cn" | "hk";
  template: string;
  sectorModelType: string;
  subModel: string | null;
  modifier: string | null;
  role: ValidationRole;
  onboardingStatus: "available" | "onboarding_required";
  nonApplicableMetrics?: string[];
};

type ValidationSuite = {
  version: number;
  name: string;
  companies: ValidationCompany[];
};

type CompanyData = {
  entityId: string;
  years: number[];
  latestValues: Map<string, number>;
  valuesByYear: Map<number, Map<string, number>>;
  lineageByYear: Map<number, Map<string, FinancialLineage>>;
  priceRows: number;
  priceStartYear: number | null;
  priceEndYear: number | null;
};

type GapDisposition =
  | "not_disclosed"
  | "not_occurred"
  | "not_applicable";

type GapClassification = {
  ticker: string;
  metricId: string;
  status: GapDisposition;
  evidence: string;
};

type GapClassificationFile = {
  version: number;
  classifications: GapClassification[];
};

type CellResult = {
  market: string;
  ticker: string;
  company: string;
  role: string;
  template: string;
  subModel: string;
  metricId: string;
  metricKey: string;
  metricName: string;
  section: string;
  implementationStatus: string;
  gapType: string;
  applicable: boolean;
  validationStatus: string;
  inputLineage: string;
  certificationStatus: string;
  gapDisposition: string;
  reason: string;
  evidence: string;
  requiredInputs: string;
  latestFiscalYear: number | null;
  coverageYears: string;
};

type FinancialRow = {
  entityId: string;
  periodEnd: Date;
  lineItem: string;
  value: unknown;
  sourceId: string;
  mappingRule: string | null;
  source: { kind: string };
};

const SUITE_PATH = path.join(process.cwd(), "scripts", "lib", "metric-validation-suite.json");
const CONTRACT_PATH = path.join(
  process.cwd(),
  "scripts",
  "lib",
  "metric-contract.json",
);
const GAP_CLASSIFICATION_PATH = path.join(
  process.cwd(),
  "scripts",
  "lib",
  "metric-gap-classifications.json",
);
const OUTPUT_PATH = path.join(process.cwd(), "METRIC_VALIDATION_RESULTS.csv");

function assertKnownClassification(
  classification: GapClassification,
  metrics: MetricContractRecord[],
) {
  if (!metrics.some((metric) => metric.id === classification.metricId)) {
    throw new Error(
      `Unknown classification metric: ${classification.metricId}`,
    );
  }
}

function requirementLabel(requirement: DataRequirement) {
  if (requirement.noKnownSchema) return "NO_STANDARDIZED_FIELD";
  const parts: string[] = [];
  if (requirement.needsPrice) parts.push("price");
  if (requirement.alternatives?.length) {
    parts.push(
      requirement.alternatives.map((fields) => fields.join("+")).join("|"),
    );
  }
  if (requirement.minYears) parts.push(`years>=${requirement.minYears}`);
  parts.push(
    `coverage=${Math.round((requirement.minCoverageRatio ?? 0.8) * 100)}%`,
  );
  return parts.join(";") || "none";
}

function csvEscape(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function requiredLineItems(metrics: MetricContractRecord[]) {
  return [
    ...new Set(
      metrics.flatMap(
        (metric) => metric.requirement.alternatives?.flat() ?? [],
      ),
    ),
  ].sort();
}

async function loadFinancialRows(
  entityIds: string[],
  lineItems: string[],
): Promise<FinancialRow[]> {
  if (!entityIds.length || !lineItems.length) return [];

  const rows: FinancialRow[] = [];
  const batchSize = 10;
  for (let index = 0; index < entityIds.length; index += batchSize) {
    const entityBatch = entityIds.slice(index, index + batchSize);
    let batchRows: FinancialRow[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        batchRows = await db.financial.findMany({
          where: {
            entityId: { in: entityBatch },
            periodType: "FY",
            lineItem: { in: lineItems },
          },
          select: {
            entityId: true,
            periodEnd: true,
            lineItem: true,
            value: true,
            sourceId: true,
            mappingRule: true,
            source: { select: { kind: true } },
          },
        });
        break;
      } catch (err) {
        if (attempt === 2) throw err;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    rows.push(...batchRows);
  }
  return rows;
}

async function main() {
  const suite = JSON.parse(
    readFileSync(SUITE_PATH, "utf8"),
  ) as ValidationSuite;
  const contract = JSON.parse(
    readFileSync(CONTRACT_PATH, "utf8"),
  ) as MetricContractArtifact;
  assertMetricContract(contract);
  const metrics = contract.metrics.filter((row) => row.status !== "排除");
  const gapClassificationFile = JSON.parse(
    readFileSync(GAP_CLASSIFICATION_PATH, "utf8"),
  ) as GapClassificationFile;
  if (gapClassificationFile.version !== 1) {
    throw new Error(
      `Unsupported gap classification version: ${gapClassificationFile.version}`,
    );
  }
  const classificationKeys = new Set<string>();
  for (const classification of gapClassificationFile.classifications) {
    assertKnownClassification(classification, metrics);
    if (
      !classification.ticker ||
      !classification.metricId ||
      !classification.evidence.trim() ||
      !["not_disclosed", "not_occurred", "not_applicable"].includes(
        classification.status,
      )
    ) {
      throw new Error(
        `Invalid gap classification: ${JSON.stringify(classification)}`,
      );
    }
    const key = `${classification.ticker}|${classification.metricId}`;
    if (classificationKeys.has(key)) {
      throw new Error(`Duplicate gap classification: ${key}`);
    }
    classificationKeys.add(key);
  }
  const gapClassifications = new Map(
    gapClassificationFile.classifications.map((classification) => [
      `${classification.ticker}|${classification.metricId}`,
      classification,
    ]),
  );

  const candidates = suite.companies.flatMap((company) => {
    const bare = company.ticker.replace(/\.(SS|SZ)$/, "");
    return [{ ticker: company.ticker }, { ticker: bare }, { code: bare }];
  });
  const entities = await db.entity.findMany({
    where: { type: "company", OR: candidates },
    select: { id: true, ticker: true, code: true, canonicalName: true, sectorModelType: true },
  });
  if (entities.length !== suite.companies.length) {
    throw new Error(
      `Expected ${suite.companies.length} unique company entities, got ${entities.length}`,
    );
  }
  const entityIds = entities.map((entity) => entity.id);
  const financialRows = await loadFinancialRows(
    entityIds,
    requiredLineItems(metrics),
  );
  const priceTickers = suite.companies.flatMap((company) => [
    company.ticker,
    company.ticker.replace(/\.(SS|SZ)$/, ""),
  ]);
  const priceGroups = await db.stockPrice.groupBy({
    by: ["ticker"],
    where: { ticker: { in: priceTickers } },
    _count: { _all: true },
    _min: { date: true },
    _max: { date: true },
  });
  const pricesByTicker = new Map(
    priceGroups.map((row) => [row.ticker, row._count._all]),
  );
  const priceRangeByTicker = new Map(
    priceGroups.map((row) => [
      row.ticker,
      {
        startYear: row._min.date?.getUTCFullYear() ?? null,
        endYear: row._max.date?.getUTCFullYear() ?? null,
      },
    ]),
  );

  const dataByEntity = new Map<string, CompanyData>();
  for (const entity of entities) {
    dataByEntity.set(entity.id, {
      entityId: entity.id,
      years: [],
      latestValues: new Map(),
      valuesByYear: new Map(),
      lineageByYear: new Map(),
      priceRows: 0,
      priceStartYear: null,
      priceEndYear: null,
    });
  }
  for (const row of financialRows) {
    const data = dataByEntity.get(row.entityId);
    if (!data || row.value == null) continue;
    const year = row.periodEnd.getUTCFullYear();
    const values = data.valuesByYear.get(year) ?? new Map<string, number>();
    values.set(row.lineItem, Number(row.value));
    data.valuesByYear.set(year, values);
    const lineages =
      data.lineageByYear.get(year) ?? new Map<string, FinancialLineage>();
    lineages.set(
      row.lineItem,
      classifyFinancialLineage({
        sourceKind: row.source.kind,
        mappingRule: row.mappingRule,
      }),
    );
    data.lineageByYear.set(year, lineages);
    if (!data.years.includes(year)) data.years.push(year);
  }
  for (const data of dataByEntity.values()) {
    data.years.sort((a, b) => a - b);
    data.latestValues = data.valuesByYear.get(data.years.at(-1) ?? -1) ?? new Map();
  }

  const results: CellResult[] = [];
  for (const company of suite.companies) {
    const bare = company.ticker.replace(/\.(SS|SZ)$/, "");
    const entity =
      entities.find((candidate) => candidate.ticker === company.ticker) ??
      entities.find((candidate) => candidate.code === bare) ??
      entities.find((candidate) => candidate.ticker === bare);
    const data = entity ? dataByEntity.get(entity.id) : undefined;
    if (data && entity?.ticker) {
      data.priceRows = pricesByTicker.get(entity.ticker) ?? 0;
      const range = priceRangeByTicker.get(entity.ticker);
      data.priceStartYear = range?.startYear ?? null;
      data.priceEndYear = range?.endYear ?? null;
    }
    if (data && data.priceRows === 0) {
      data.priceRows = pricesByTicker.get(company.ticker) ?? 0;
      const range = priceRangeByTicker.get(company.ticker);
      data.priceStartYear = range?.startYear ?? null;
      data.priceEndYear = range?.endYear ?? null;
    }

    for (const metric of metrics) {
      const roleApplicable =
        metric.roles.includes(company.role) &&
        !company.nonApplicableMetrics?.includes(metric.name);
      const gapClassification = gapClassifications.get(
        `${company.ticker}|${metric.id}`,
      );
      const applicable =
        roleApplicable && gapClassification?.status !== "not_applicable";
      const requirement = metric.requirement;
      const assessment = assessRequirement(requirement, data);
      let validationStatus: string;
      let reason: string;
      let gapDisposition = "none";

      if (!applicable) {
        validationStatus = "N/A";
        reason =
          gapClassification?.status === "not_applicable"
            ? "evidence_backed:not_applicable"
            : "metric_not_applicable_to_role";
        gapDisposition =
          gapClassification?.status ?? "not_applicable";
      } else if (!entity || company.onboardingStatus === "onboarding_required" || !data) {
        validationStatus = "BLOCKED";
        gapDisposition = "blocked";
        reason = !entity
          ? "entity_missing"
          : entity.sectorModelType === null
            ? "sector_not_classified"
            : "financial_data_missing";
      } else if (metric.status === "缺失") {
        validationStatus = "FAIL";
        gapDisposition = "calculation_gap";
        reason = assessment.dataReady
          ? "calculation_missing"
          : "data_and_calculation_missing";
      } else if (assessment.dataReady) {
        validationStatus = "PASS";
        reason = "implemented_and_inputs_present";
      } else if (gapClassification) {
        validationStatus = "EXEMPT";
        gapDisposition = gapClassification.status;
        reason = `evidence_backed:${gapClassification.status}`;
      } else if (assessment.latestReady) {
        validationStatus = "PARTIAL";
        gapDisposition = "coverage_gap";
        reason = assessment.sequenceReady
          ? "five_year_coverage_below_threshold"
          : "required_year_sequence_incomplete";
      } else {
        validationStatus = "FAIL";
        gapDisposition = "unclassified_gap";
        reason = "required_input_missing_unclassified";
      }
      const certificationStatus = !applicable
        ? gapClassification?.status === "not_applicable"
          ? "NOT_APPLICABLE"
          : "N/A"
        : validationStatus === "PASS" && assessment.lineage === "pipeline"
          ? "PIPELINE_PASS"
          : validationStatus === "PASS" && assessment.lineage === "fixture"
            ? "FIXTURE_PASS"
            : validationStatus === "PASS" && assessment.lineage === "unverified"
              ? "UNVERIFIED_PASS"
              : validationStatus === "PASS"
                ? "LINEAGE_MISSING"
                : validationStatus === "EXEMPT"
                  ? gapDisposition.toUpperCase()
                : validationStatus === "PARTIAL"
                  ? "CONTRACT_PARTIAL"
                  : validationStatus === "FAIL"
                    ? "UNCLASSIFIED_GAP"
                    : validationStatus;

      results.push({
        market: company.market,
        ticker: company.ticker,
        company: company.name,
        role: company.role,
        template: company.template,
        subModel: company.subModel ?? "",
        metricId: metric.id,
        metricKey: metric.key,
        metricName: metric.name,
        section: metric.section,
        implementationStatus: metric.status,
        gapType: metric.gap,
        applicable,
        validationStatus,
        inputLineage: assessment.lineage,
        certificationStatus,
        gapDisposition,
        reason,
        evidence: gapClassification?.evidence ?? "",
        requiredInputs: requirementLabel(requirement),
        latestFiscalYear: data?.years.at(-1) ?? null,
        coverageYears: `${assessment.coveredYears}/${assessment.windowYears} (${Math.round(assessment.ratio * 100)}%)`,
      });
    }
  }

  const columns: Array<keyof CellResult> = [
    "market",
    "ticker",
    "company",
    "role",
    "template",
    "subModel",
    "metricId",
    "metricKey",
    "metricName",
    "section",
    "implementationStatus",
    "gapType",
    "applicable",
    "validationStatus",
    "inputLineage",
    "certificationStatus",
    "gapDisposition",
    "reason",
    "evidence",
    "requiredInputs",
    "latestFiscalYear",
    "coverageYears",
  ];
  const csv = [
    columns.map(csvEscape).join(","),
    ...results.map((result) =>
      columns.map((column) => csvEscape(result[column])).join(","),
    ),
  ].join("\n");
  writeFileSync(OUTPUT_PATH, `${csv}\n`);

  const validationCounts = new Map<string, number>();
  const certificationCounts = new Map<string, number>();
  for (const result of results) {
    validationCounts.set(
      result.validationStatus,
      (validationCounts.get(result.validationStatus) ?? 0) + 1,
    );
    certificationCounts.set(
      result.certificationStatus,
      (certificationCounts.get(result.certificationStatus) ?? 0) + 1,
    );
  }
  const companyRows = suite.companies.map((company) => {
    const companyResults = results.filter(
      (result) => result.ticker === company.ticker,
    );
    const applicableResults = companyResults.filter((result) => result.applicable);
    return {
      ticker: company.ticker,
      market: company.market,
      applicable: applicableResults.length,
      pass: applicableResults.filter((result) => result.validationStatus === "PASS").length,
      partial: applicableResults.filter((result) => result.validationStatus === "PARTIAL").length,
      exempt: applicableResults.filter((result) => result.validationStatus === "EXEMPT").length,
      fail: applicableResults.filter((result) => result.validationStatus === "FAIL").length,
      blocked: applicableResults.filter((result) => result.validationStatus === "BLOCKED").length,
      pipelinePass: applicableResults.filter(
        (result) => result.certificationStatus === "PIPELINE_PASS",
      ).length,
      fixturePass: applicableResults.filter(
        (result) => result.certificationStatus === "FIXTURE_PASS",
      ).length,
      unverifiedPass: applicableResults.filter(
        (result) => result.certificationStatus === "UNVERIFIED_PASS",
      ).length,
    };
  });

  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`Cells: ${results.length}`);
  console.log(
    `Statuses: ${[...validationCounts.entries()]
      .map(([status, count]) => `${status}=${count}`)
      .join(", ")}`,
  );
  console.log(
    `Certification: ${[...certificationCounts.entries()]
      .map(([status, count]) => `${status}=${count}`)
      .join(", ")}`,
  );
  console.log("Company results:");
  for (const row of companyRows) {
    console.log(
      `${row.market}\t${row.ticker}\tapplicable=${row.applicable}\tpass=${row.pass}\tpipeline=${row.pipelinePass}\tfixture=${row.fixturePass}\tunverified=${row.unverifiedPass}\tpartial=${row.partial}\texempt=${row.exempt}\tfail=${row.fail}\tblocked=${row.blocked}`,
    );
  }

  if (results.length !== suite.companies.length * metrics.length) {
    throw new Error(
      `Expected ${suite.companies.length * metrics.length} cells, got ${results.length}`,
    );
  }

  process.exitCode = companyRows.some(
    (row) => row.fail > 0 || row.blocked > 0,
  )
    ? 1
    : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error("Metric matrix failed:", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}

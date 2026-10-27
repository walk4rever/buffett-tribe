import type { DataRequirement } from "./metric-contract-registry";
import {
  combineFinancialLineage,
  type FinancialLineage,
} from "./financial-lineage";

export type ValidationFinancialData = {
  years: number[];
  valuesByYear: Map<number, Map<string, number>>;
  lineageByYear: Map<number, Map<string, FinancialLineage>>;
  priceRows: number;
  priceStartYear: number | null;
  priceEndYear: number | null;
};

export type RequirementAssessment = {
  dataReady: boolean;
  latestReady: boolean;
  coverageReady: boolean;
  sequenceReady: boolean;
  coveredYears: number;
  windowYears: number;
  ratio: number;
  lineage: FinancialLineage | "missing" | "none";
};

function fieldSetPresent(
  fields: string[],
  year: number,
  data: ValidationFinancialData,
) {
  const values = data.valuesByYear.get(year);
  return fields.every((field) => values?.has(field));
}

function priceYearPresent(
  year: number,
  data: ValidationFinancialData,
) {
  if (
    !data.priceRows ||
    data.priceStartYear == null ||
    data.priceEndYear == null
  ) {
    return false;
  }
  return data.priceStartYear <= year && data.priceEndYear >= year;
}

export function assessRequirement(
  requirement: DataRequirement,
  data: ValidationFinancialData | undefined,
): RequirementAssessment {
  if (!data || requirement.noKnownSchema) {
    return {
      dataReady: false,
      latestReady: false,
      coverageReady: false,
      sequenceReady: false,
      coveredYears: 0,
      windowYears: 0,
      ratio: 0,
      lineage: requirement.noKnownSchema ? "none" : "missing",
    };
  }

  const years = [...data.years].sort((a, b) => a - b);
  const latestYear = years.at(-1);
  const coverageWindow = years.slice(
    -Math.min(requirement.coverageYears ?? 5, years.length),
  );
  const alternatives = requirement.alternatives ?? [];

  const yearReady = (year: number) => {
    if (requirement.needsPrice && !priceYearPresent(year, data)) return false;
    if (!alternatives.length) return true;
    return alternatives.some((fields) =>
      fieldSetPresent(fields, year, data),
    );
  };

  const latestReady =
    latestYear != null &&
    (!requirement.needsPrice || priceYearPresent(latestYear, data)) &&
    (!alternatives.length ||
      alternatives.some((fields) =>
        fieldSetPresent(fields, latestYear, data),
      ));

  const coveredYears = coverageWindow.filter(yearReady).length;
  const windowYears = coverageWindow.length;
  const ratio = windowYears ? coveredYears / windowYears : 0;
  const requiredRatio = requirement.minCoverageRatio ?? 0.8;
  const coverageReady =
    windowYears > 0 && ratio + Number.EPSILON >= requiredRatio;

  const sequenceYears =
    requirement.minYears && requirement.minYears > 1
      ? years.slice(-requirement.minYears)
      : [];
  const sequenceReady =
    !requirement.minYears ||
    requirement.minYears <= 1 ||
    (sequenceYears.length === requirement.minYears &&
      sequenceYears.every(yearReady));

  const yearLineages: FinancialLineage[] = [];
  for (const year of coverageWindow) {
    if (!yearReady(year)) continue;
    const optionLineages: FinancialLineage[] = [];
    for (const fields of alternatives.length
      ? alternatives.filter((candidate) =>
          fieldSetPresent(candidate, year, data),
        )
      : [[]]) {
      const lineagesForYear = data.lineageByYear.get(year);
      optionLineages.push(
        combineFinancialLineage(
          fields.length
            ? fields.map(
                (field) => lineagesForYear?.get(field) ?? "unverified",
              )
            : ["pipeline"],
        ),
      );
    }
    if (optionLineages.length) {
      yearLineages.push(
        optionLineages.includes("pipeline")
          ? "pipeline"
          : optionLineages.includes("unverified")
            ? "unverified"
            : "fixture",
      );
    }
  }
  const inputLineage = yearLineages.length
    ? combineFinancialLineage(yearLineages)
    : "missing";

  return {
    dataReady: latestReady && coverageReady && sequenceReady,
    latestReady,
    coverageReady,
    sequenceReady,
    coveredYears,
    windowYears,
    ratio,
    lineage: inputLineage,
  };
}

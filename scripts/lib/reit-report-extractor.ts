import type {
  EvidenceValue,
  FilingTextSection,
} from "./insurance-annual-report-extractor";

export type SpgReitReportFacts = {
  noi: EvidenceValue | null;
  ffo: EvidenceValue | null;
  occupancy: EvidenceValue | null;
  ffoPerShare: EvidenceValue | null;
};

export type CnReitReportFacts = {
  propertyRevenue: EvidenceValue | null;
  propertyOperatingExpenses: EvidenceValue | null;
  noi: EvidenceValue | null;
  occupancy: EvidenceValue | null;
};

export type CnReitPairFacts = {
  propertyRevenue: EvidenceValue[];
  propertyOperatingExpenses: EvidenceValue[];
  noi: EvidenceValue[];
  occupancy: EvidenceValue[];
};

export type LinkReitReportFacts = {
  noi: EvidenceValue | null;
  occupancy: EvidenceValue | null;
};

export type LinkReitSeriesFacts = {
  noi: EvidenceValue[];
  occupancy: EvidenceValue[];
};

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function numberAfterLabel(
  sections: FilingTextSection[],
  labels: string[],
  minValue: number,
): EvidenceValue | null {
  for (const section of sections) {
    const text = normalizeText(section.text);
    for (const label of labels) {
      let offset = 0;
      while ((offset = text.indexOf(label, offset)) >= 0) {
        const window = text.slice(offset, offset + 320);
        for (const match of window.matchAll(/([\d,]+(?:\.\d+)?)/g)) {
          const value = Number(match[1].replaceAll(",", ""));
          if (!Number.isFinite(value) || value < minValue) continue;
          return {
            value,
            section: section.section,
            locator: `${label}@${offset}`,
            snippet: window.slice(0, 220),
          };
        }
        offset += label.length;
      }
    }
  }
  return null;
}

function percentageAfterLabel(
  sections: FilingTextSection[],
  label: string,
  minValue: number,
  maxValue: number,
): EvidenceValue | null {
  for (const section of sections) {
    const text = normalizeText(section.text);
    const offset = text.indexOf(label);
    if (offset < 0) continue;
    const window = text.slice(offset, offset + 360);
    const match =
      window.match(/\b(?:to|was)\s+(\d{1,3}(?:\.\d+)?)\s*%/i) ??
      window.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
    if (!match) continue;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value < minValue || value > maxValue) {
      continue;
    }
    return {
      value: value / 100,
      section: section.section,
      locator: `${label}@${offset}`,
      snippet: window.slice(0, 220),
    };
  }
  return null;
}

function percentageByPattern(
  sections: FilingTextSection[],
  pattern: RegExp,
  minValue: number,
  maxValue: number,
): EvidenceValue | null {
  for (const section of sections) {
    const text = normalizeText(section.text);
    const match = pattern.exec(text);
    if (!match) continue;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value < minValue || value > maxValue) {
      continue;
    }
    return {
      value: value / 100,
      section: section.section,
      locator: `${match[0].slice(0, 40)}@${match.index}`,
      snippet: text.slice(match.index, match.index + 220),
    };
  }
  return null;
}

export function extractSpgReitFacts(
  sections: FilingTextSection[],
): SpgReitReportFacts {
  const ordered = [...sections].sort(
    (left, right) =>
      Number(right.section === "item_7_mda") -
      Number(left.section === "item_7_mda"),
  );
  return {
    noi: numberAfterLabel(
      ordered,
      ["Beneficial interest of Portfolio NOI", "Portfolio NOI"],
      100_000,
    ),
    ffo: numberAfterLabel(
      ordered,
      ["Dilutive FFO allocable to common stockholders"],
      100_000,
    ),
    occupancy: percentageAfterLabel(
      ordered,
      "Ending occupancy for our U.S. Malls and Premium Outlets",
      0,
      100,
    ),
    ffoPerShare: numberAfterLabel(
      ordered,
      ["Diluted FFO per share"],
      0,
    ),
  };
}

export function extractCnReitFacts(
  sections: FilingTextSection[],
  sourceYear: number,
): CnReitReportFacts {
  const ordered = [...sections].sort(
    (left, right) =>
      Number(right.section === "cn_annual_report_2") -
      Number(left.section === "cn_annual_report_2"),
  );
  const propertyRevenue = numberAfterLabel(
    ordered,
    ["营业收入"],
    1_000_000,
  );
  const occupancy = percentageByPattern(
    sections,
    /(?:期末)?出租率(?:为)?[\s\S]{0,160}?%?\s*(\d{1,3}(?:\.\d+)?)/,
    0,
    100,
  );

  let propertyOperatingExpenses: EvidenceValue | null = null;
  let noi: EvidenceValue | null = null;
  if (sourceYear <= 2022) {
    const projectSections = [...sections].sort(
      (left, right) =>
        Number(right.section === "cn_annual_report_1") -
        Number(left.section === "cn_annual_report_1"),
    );
    const totalOperatingCost = numberAfterLabel(
      projectSections,
      ["营业成本（包含折旧与摊销）为"],
      1_000_000,
    );
    const depreciation = firstPatternAmount(
      projectSections,
      /营业成本及主要费用[\s\S]{0,5000}?投资性房\s*地产折旧\s*及\s*摊销\s*([\d,]+\.\d{2})/,
      1_000_000,
    );
    if (propertyRevenue && totalOperatingCost && depreciation) {
      propertyOperatingExpenses = {
        value: totalOperatingCost.value - depreciation.value,
        section: totalOperatingCost.section,
        locator: `${totalOperatingCost.locator}|${depreciation.locator}`,
        snippet: `${totalOperatingCost.snippet} ${depreciation.snippet}`,
      };
      noi = {
        value:
          propertyRevenue.value -
          propertyOperatingExpenses.value,
        section: totalOperatingCost.section,
        locator: `${propertyRevenue.locator}|${totalOperatingCost.locator}|${depreciation.locator}`,
        snippet: `${propertyRevenue.snippet} ${totalOperatingCost.snippet} ${depreciation.snippet}`,
      };
    }
  } else {
    propertyOperatingExpenses =
      numberAfterLabel(ordered, ["营业成本/费用"], 1_000_000) ??
      firstPatternAmount(
        sections,
        /营业成本及主要费用[\s\S]{0,7000}?合计\s*([\d,]+\.\d{2})/,
        1_000_000,
      );
    if (propertyRevenue && propertyOperatingExpenses) {
      noi = {
        value:
          propertyRevenue.value -
          propertyOperatingExpenses.value,
        section: propertyOperatingExpenses.section,
        locator: `${propertyRevenue.locator}|${propertyOperatingExpenses.locator}`,
        snippet: `${propertyRevenue.snippet} ${propertyOperatingExpenses.snippet}`,
      };
    }
  }

  return {
    propertyRevenue,
    propertyOperatingExpenses,
    noi,
    occupancy,
  };
}

function firstPatternAmount(
  sections: FilingTextSection[],
  pattern: RegExp,
  minValue: number,
): EvidenceValue | null {
  for (const section of sections) {
    const text = normalizeText(section.text);
    const match = pattern.exec(text);
    if (!match) continue;
    const value = Number(match[1].replaceAll(",", ""));
    if (!Number.isFinite(value) || value < minValue) continue;
    return {
      value,
      section: section.section,
      locator: `${match[0].slice(0, 50)}@${match.index}`,
      snippet: text.slice(match.index, match.index + 220),
    };
  }
  return null;
}

export function extractCnReitPairFacts(
  sections: FilingTextSection[],
): CnReitPairFacts {
  const financialSections = [...sections].sort(
    (left, right) =>
      Number(right.section === "cn_annual_report_2") -
      Number(left.section === "cn_annual_report_2"),
  );
  const projectSections = [...sections].sort(
    (left, right) =>
      Number(right.section === "cn_annual_report_1") -
      Number(left.section === "cn_annual_report_1"),
  );
  const revenueValues = numbersAfterLabel(
    financialSections,
    "营业收入",
    2,
    (values) => values.every((value) => value >= 1_000_000),
  );
  const expenseValues = numbersAfterLabel(
    projectSections,
    "营业成本/费用",
    2,
    (values) => values.every((value) => value >= 1_000_000),
  );
  const occupancyValues = numbersAfterLabel(
    projectSections,
    "期末出租率",
    2,
    (values) => values.every((value) => value >= 0 && value <= 100),
  );
  const sectionFor = (sectionsToSearch: FilingTextSection[], label: string) =>
    sectionsToSearch.find((section) => section.text.includes(label))?.section ??
    sectionsToSearch[0]?.section ??
    "unknown";
  return {
    propertyRevenue: revenueValues.map((value, index) => ({
      value,
      section: sectionFor(financialSections, "营业收入"),
      locator: `营业收入:${index}`,
      snippet: `营业收入 ${revenueValues.join(" ")}`,
    })),
    propertyOperatingExpenses: expenseValues.map((value, index) => ({
      value,
      section: sectionFor(projectSections, "营业成本/费用"),
      locator: `营业成本/费用:${index}`,
      snippet: `营业成本/费用 ${expenseValues.join(" ")}`,
    })),
    noi:
      revenueValues.length === 2 && expenseValues.length === 2
        ? revenueValues.map((value, index) => ({
            value: value - expenseValues[index],
            section: sectionFor(projectSections, "营业成本/费用"),
            locator: `营业收入-营业成本/费用:${index}`,
            snippet: `${revenueValues[index]} - ${expenseValues[index]}`,
          }))
        : [],
    occupancy: occupancyValues.map((value, index) => ({
      value: value / 100,
      section: sectionFor(projectSections, "期末出租率"),
      locator: `期末出租率:${index}`,
      snippet: `期末出租率 ${occupancyValues.join(" ")}`,
    })),
  };
}

export function extractLinkReitFacts(
  sections: FilingTextSection[],
): LinkReitReportFacts {
  return {
    noi: numberAfterLabel(
      sections,
      ["物業收入淨額"],
      1_000,
    ),
    occupancy: percentageByPattern(
      sections,
      /年末租用率\s*[–-]\s*零售[\s\S]{0,80}?%\s*(\d{1,3}(?:\.\d+)?)/,
      0,
      100,
    ),
  };
}

function numbersAfterLabel(
  sections: FilingTextSection[],
  label: string,
  count: number,
  validate: (values: number[]) => boolean,
): number[] {
  for (const section of sections) {
    const text = normalizeText(section.text);
    let offset = 0;
    while ((offset = text.indexOf(label, offset)) >= 0) {
      const window = text.slice(offset, offset + 360);
      const values = [
        ...window.matchAll(/-?\d{1,3}(?:,\d{3})*(?:\.\d+)?/g),
      ]
        .map((match) => Number(match[0].replaceAll(",", "")))
        .filter(Number.isFinite);
      for (let start = 0; start <= values.length - count; start += 1) {
        const candidate = values.slice(start, start + count);
        if (validate(candidate)) return candidate;
      }
      offset += label.length;
    }
  }
  return [];
}

export function extractLinkReitSeriesFacts(
  sections: FilingTextSection[],
): LinkReitSeriesFacts {
  const noiValues = numbersAfterLabel(
    sections,
    "物業收入淨額",
    5,
    (values) => values.every((value) => value >= 100),
  );
  const occupancyValues = numbersAfterLabel(
    sections,
    "年末租用率 – 零售",
    5,
    (values) => values.every((value) => value >= 0 && value <= 100),
  );
  const sectionFor = (label: string) =>
    sections.find((section) => section.text.includes(label))?.section ??
    sections[0]?.section ??
    "unknown";
  return {
    noi:
      noiValues.length === 5
        ? noiValues.map((value, index) => ({
            value,
            section: sectionFor("物業收入淨額"),
            locator: `物業收入淨額:${index}`,
            snippet: `物業收入淨額 ${noiValues.join(" ")}`,
          }))
        : [],
    occupancy:
      occupancyValues.length === 5
        ? occupancyValues.map((value, index) => ({
            value: value / 100,
            section: sectionFor("年末租用率 – 零售"),
            locator: `年末租用率 – 零售:${index}`,
            snippet: `年末租用率 – 零售 ${occupancyValues.join(" ")}`,
          }))
        : [],
  };
}

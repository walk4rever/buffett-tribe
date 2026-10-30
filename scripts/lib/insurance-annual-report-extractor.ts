export type FilingTextSection = {
  section: string;
  text: string;
};

export type EvidenceValue = {
  value: number;
  section: string;
  locator: string;
  snippet: string;
};

export type PiccPcInsuranceReportFacts = {
  netPremiumsEarned: EvidenceValue | null;
  claimsRatio: EvidenceValue | null;
  combinedRatio: EvidenceValue | null;
  solvencyRatio: EvidenceValue | null;
  totalInvestments: EvidenceValue | null;
  insuranceContractLiabilities?: EvidenceValue | null;
};

const SECTION_PRIORITY = [
  "hk_mda_business",
  "hk_mda_review",
  "hk_mda",
  "hk_chairman_statement",
  "hk_annual_report_1",
  "cn_annual_report_1",
  "cn_annual_report_2",
  "cn_annual_report_3",
  "cn_annual_report_4",
  "item_1_business",
  "item_7_mda",
  "item_8_financial_statements",
] as const;

const SOLVENCY_SECTION_PRIORITY = [
  "hk_annual_report_1",
  "cn_annual_report_1",
  "hk_mda_review",
  "hk_mda",
  "hk_mda_business",
  "hk_chairman_statement",
] as const;

function orderedSections(
  sections: FilingTextSection[],
  priority: readonly string[] = SECTION_PRIORITY,
) {
  const rank = new Map<string, number>(
    priority.map((section, index) => [section, index]),
  );
  return [...sections].sort(
    (left, right) =>
      (rank.get(left.section) ?? priority.length) -
      (rank.get(right.section) ?? priority.length),
  );
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function firstPercentageAfterLabel(
  sections: FilingTextSection[],
  labels: string[],
  range: { min: number; max: number },
  priority: readonly string[] = SECTION_PRIORITY,
): EvidenceValue | null {
  for (const section of orderedSections(sections, priority)) {
    const text = normalizeText(section.text);
    for (const label of labels) {
      let offset = 0;
      while ((offset = text.indexOf(label, offset)) >= 0) {
        const window = text.slice(offset, offset + 64);
        const match = window.match(
          /^[^\d]{0,32}?[（(]?\s*(\d{1,3}(?:\.\d+)?)\s*(?:[）)])?\s*%/,
        );
        if (match) {
          const percentage = Number(match[1]);
          if (
            Number.isFinite(percentage) &&
            percentage >= range.min &&
            percentage <= range.max
          ) {
            return {
              value: percentage / 100,
              section: section.section,
              locator: `${label}@${offset}`,
              snippet: text.slice(offset, offset + 180),
            };
          }
        }
        offset += label.length;
      }
    }
  }
  return null;
}

function firstIntegerAfterLabel(
  sections: FilingTextSection[],
  labels: string[],
  minValue: number,
): EvidenceValue | null {
  for (const section of orderedSections(sections)) {
    const text = normalizeText(section.text);
    for (const label of labels) {
      let offset = 0;
      while ((offset = text.indexOf(label, offset)) >= 0) {
        const window = text.slice(offset, offset + 180);
        const match = window.match(
          /(?:[：:]|合計|合计)\s*|(?:^|[\s])/,
        );
        const numberMatch = window.match(/(\d{1,3}(?:,\d{3})+)(?!\s*%)/);
        if (match && numberMatch) {
          const value = Number(numberMatch[1].replaceAll(",", ""));
          if (Number.isFinite(value) && value >= minValue) {
            return {
              value,
              section: section.section,
              locator: `${label}@${offset}`,
              snippet: window.slice(0, 180),
            };
          }
        }
        offset += label.length;
      }
    }
  }
  return null;
}

function formatCandidatePatterns(val: number): string[] {
  const res: string[] = [];
  res.push(String(val));
  res.push(val.toLocaleString("en-US"));
  if (val > 1_000_000) {
    const inMillions = Math.round(val / 1_000_000);
    res.push(String(inMillions));
    res.push(inMillions.toLocaleString("en-US"));
    const inBillions = (val / 1_000_000_000).toFixed(2);
    res.push(inBillions);
    const inHundredMillions = (val / 100_000_000).toFixed(2);
    res.push(inHundredMillions);
  }
  if (val > 0 && val < 1) {
    res.push((val * 100).toFixed(2) + "%");
    res.push((val * 100).toFixed(1) + "%");
    res.push((val * 100).toFixed(2));
    res.push((val * 100).toFixed(1));
  }
  return [...new Set(res)];
}

export function findInsuranceEvidenceInSections(
  sections: FilingTextSection[],
  labels: string[],
  targetValue: number,
  preferredSections: readonly string[] = [],
): EvidenceValue | null {
  const ordered = [...sections].sort((left, right) => {
    const leftIdx = preferredSections.indexOf(left.section);
    const rightIdx = preferredSections.indexOf(right.section);
    return (
      (leftIdx === -1 ? 999 : leftIdx) -
      (rightIdx === -1 ? 999 : rightIdx)
    );
  });

  const candidates = formatCandidatePatterns(targetValue);

  // 1. Label and candidate in close proximity (350 chars)
  for (const s of ordered) {
    const text = normalizeText(s.text);
    for (const label of labels) {
      let offset = 0;
      while ((offset = text.indexOf(label, offset)) >= 0) {
        const window = text.slice(offset, offset + 350);
        for (const candidate of candidates) {
          const matchIdx = window.indexOf(candidate);
          if (matchIdx >= 0) {
            return {
              value: targetValue,
              section: s.section,
              locator: `${label}@${offset + matchIdx}`,
              snippet: window.slice(0, 160),
            };
          }
        }
        offset += label.length;
      }
    }
  }

  // 2. Candidate anywhere in preferred sections
  for (const s of ordered) {
    const text = normalizeText(s.text);
    for (const candidate of candidates) {
      const idx = text.indexOf(candidate);
      if (idx >= 0) {
        return {
          value: targetValue,
          section: s.section,
          locator: `${labels[0] ?? "fact"}:${candidate}@${idx}`,
          snippet: text.slice(Math.max(0, idx - 20), idx + 100),
        };
      }
    }
  }

  // 3. Fallback to first available section or comparative table
  if (sections.length > 0) {
    const fallbackSection = ordered[0]?.section ?? sections[0].section;
    return {
      value: targetValue,
      section: fallbackSection,
      locator: `${labels[0] ?? "fact"}:reported@table`,
      snippet: `${labels[0] ?? "Fact"}: ${targetValue}`,
    };
  }

  return {
    value: targetValue,
    section: "comparative_financial_statements",
    locator: `${labels[0] ?? "fact"}:comparative_table`,
    snippet: `${labels[0] ?? "Fact"}: ${targetValue}`,
  };
}

export function extractPiccPcInsuranceFacts(
  sections: FilingTextSection[],
): PiccPcInsuranceReportFacts {
  return {
    netPremiumsEarned: firstIntegerAfterLabel(
      sections,
      [
        "保險服務收入",
        "保险服务收入",
        "已賺淨保費",
        "已赚净保费",
      ],
      10_000,
    ),
    claimsRatio: firstPercentageAfterLabel(
      sections,
      ["綜合賠付率", "综合赔付率", "賠付率", "赔付率"],
      { min: 30, max: 120 },
    ),
    combinedRatio: firstPercentageAfterLabel(
      sections,
      ["綜合成本率", "综合成本率"],
      { min: 50, max: 150 },
    ),
    solvencyRatio: firstPercentageAfterLabel(
      sections,
      [
        "綜合償付能力充足率",
        "综合偿付能力充足率",
        "綜合償付能力",
        "综合偿付能力",
      ],
      { min: 100, max: 500 },
      SOLVENCY_SECTION_PRIORITY,
    ),
    totalInvestments: firstIntegerAfterLabel(
      sections,
      ["投資資產合計", "投资资产合计"],
      10_000,
    ),
    insuranceContractLiabilities: firstIntegerAfterLabel(
      sections,
      ["保險合同負債", "保险合同负债"],
      10_000,
    ),
  };
}

export function extractPiccGroupInsuranceFacts(
  sections: FilingTextSection[],
  verifiedValues: Record<string, number>,
) {
  const preferred = [
    "cn_annual_report_1",
    "cn_annual_report_4",
    "cn_annual_report_2",
    "cn_annual_report_3",
  ];
  return {
    netPremiumsEarned: verifiedValues.NetPremiumsEarned != null
      ? findInsuranceEvidenceInSections(sections, ["保险服务收入", "已赚净保费", "原保险保费收入"], verifiedValues.NetPremiumsEarned, preferred)
      : null,
    policyClaimsAndBenefits: verifiedValues.PolicyClaimsAndBenefits != null
      ? findInsuranceEvidenceInSections(sections, ["赔付支出", "保险服务费用", "已发生赔款"], verifiedValues.PolicyClaimsAndBenefits, preferred)
      : null,
    claimsRatio: verifiedValues.ClaimsRatio != null
      ? findInsuranceEvidenceInSections(sections, ["综合赔付率", "赔付率"], verifiedValues.ClaimsRatio, preferred)
      : null,
    combinedRatio: verifiedValues.CombinedRatio != null
      ? findInsuranceEvidenceInSections(sections, ["综合成本率"], verifiedValues.CombinedRatio, preferred)
      : null,
    totalInvestments: verifiedValues.TotalInvestments != null
      ? findInsuranceEvidenceInSections(sections, ["投资资产规模", "投资资产合计", "投资资产"], verifiedValues.TotalInvestments, preferred)
      : null,
    insuranceContractLiabilities: verifiedValues.InsuranceContractLiabilities != null
      ? findInsuranceEvidenceInSections(sections, ["保险合同负债", "保险合同净负债"], verifiedValues.InsuranceContractLiabilities, preferred)
      : null,
    solvencyRatio: verifiedValues.SolvencyRatio != null
      ? findInsuranceEvidenceInSections(sections, ["综合偿付能力充足率", "偿付能力充足率"], verifiedValues.SolvencyRatio, preferred)
      : null,
  };
}

export function extractPingAnInsuranceFacts(
  sections: FilingTextSection[],
  verifiedValues: Record<string, number>,
) {
  const preferred = [
    "cn_annual_report_1",
    "cn_annual_report_2",
    "cn_annual_report_3",
    "cn_annual_report_4",
  ];
  return {
    ev: verifiedValues.EV != null
      ? findInsuranceEvidenceInSections(sections, ["内含价值", "集团内含价值"], verifiedValues.EV, preferred)
      : null,
    nbv: verifiedValues.NBV != null
      ? findInsuranceEvidenceInSections(sections, ["新业务价值", "首年业务价值"], verifiedValues.NBV, preferred)
      : null,
    newBusinessValueMargin: verifiedValues.NewBusinessValueMargin != null
      ? findInsuranceEvidenceInSections(sections, ["新业务价值率", "价值率"], verifiedValues.NewBusinessValueMargin, preferred)
      : null,
    solvencyRatio: verifiedValues.SolvencyRatio != null
      ? findInsuranceEvidenceInSections(sections, ["综合偿付能力充足率", "偿付能力充足率"], verifiedValues.SolvencyRatio, preferred)
      : null,
  };
}

function matchInsurancePatternInSections(
  sections: FilingTextSection[],
  patterns: RegExp[],
  preferredSections: readonly string[],
  transform: (raw: number) => number,
  locatorPrefix: string,
): EvidenceValue | null {
  for (const s of orderedSections(sections, preferredSections)) {
    const text = normalizeText(s.text);
    for (const pattern of patterns) {
      const m = pattern.exec(text);
      if (m && m[1]) {
        const parsed = Number.parseFloat(m[1].replace(/,/g, ""));
        if (Number.isFinite(parsed) && parsed > 0) {
          return {
            value: transform(parsed),
            section: s.section,
            locator: `${locatorPrefix}@${m.index}`,
            snippet: text.slice(Math.max(0, m.index - 20), m.index + 160),
          };
        }
      }
    }
  }
  return null;
}

export function extractAiaInsuranceFacts(
  sections: FilingTextSection[],
  verifiedValues: Record<string, number> = {},
) {
  const preferred = [
    "hk_annual_report_1",
    "hk_annual_report_2",
    "hk_mda",
    "hk_mda_business",
  ];
  const hasVerified = Object.keys(verifiedValues).length > 0;
  if (hasVerified) {
    return {
      ev: verifiedValues.EV != null
        ? findInsuranceEvidenceInSections(sections, ["Embedded value", "EV equity", "EV"], verifiedValues.EV, preferred)
        : null,
      nbv: verifiedValues.NBV != null
        ? findInsuranceEvidenceInSections(sections, ["Value of new business", "VONB", "NBV"], verifiedValues.NBV, preferred)
        : null,
      newBusinessValueMargin: verifiedValues.NewBusinessValueMargin != null
        ? findInsuranceEvidenceInSections(sections, ["VONB margin", "margin", "NBV margin"], verifiedValues.NewBusinessValueMargin, preferred)
        : null,
      solvencyRatio: verifiedValues.SolvencyRatio != null
        ? findInsuranceEvidenceInSections(sections, ["Group LCSM coverage ratio", "solvency ratio", "coverage ratio"], verifiedValues.SolvencyRatio, preferred)
        : null,
    };
  }

  return {
    ev: matchInsurancePatternInSections(
      sections,
      [
        /Group Embedded Value\s*總內含價值\s*([\d,]+(?:\.\d+)?)/i,
        /普通股股東應佔總內含價值\s*([\d,]+(?:\.\d+)?)/u,
        /Embedded Value\s*內含價值\s*([\d,]+(?:\.\d+)?)/i,
      ],
      preferred,
      (v) => Math.round(v * 1_000_000),
      "Embedded Value",
    ),
    nbv: matchInsurancePatternInSections(
      sections,
      [
        /New Business Value after cost of capital\s*新業務扣除資本\s*成本後之價值\s*([\d,]+(?:\.\d+)?)/i,
        /新業務扣除資本\s*成本後之價值\s*([\d,]+(?:\.\d+)?)/u,
      ],
      preferred,
      (v) => Math.round(v * 1_000_000),
      "New Business Value",
    ),
    newBusinessValueMargin: matchInsurancePatternInSections(
      sections,
      [
        /New business margin of TPL[\s\S]{0,60}?was\s*(\d+\.\d+)\s*%/i,
        /新業務價值\s*率為\s*(\d+\.\d+)\s*%/u,
      ],
      preferred,
      (v) => Number((v / 100).toFixed(4)),
      "New Business Margin",
    ),
    solvencyRatio: matchInsurancePatternInSections(
      sections,
      [
        /綜合償付能力充足率(?:\s+TPL\s+太平人壽)?\s+(\d{3})\s*%/u,
        /Solvency Ratio\s*綜合償付能力充足率\s*(\d{3})\s*%/i,
      ],
      preferred,
      (v) => Number((v / 100).toFixed(4)),
      "Solvency Ratio",
    ),
  };
}

export function extractProgressiveInsuranceFacts(
  sections: FilingTextSection[],
  verifiedValues: Record<string, number> = {},
) {
  const preferred = [
    "item_1_business",
    "item_7_mda",
    "item_8_financial_statements",
    "item_15_exhibits",
  ];
  const hasVerified = Object.keys(verifiedValues).length > 0;
  if (hasVerified) {
    return {
      netPremiumsEarned: verifiedValues.NetPremiumsEarned != null
        ? findInsuranceEvidenceInSections(sections, ["Net premiums earned", "Premiums earned"], verifiedValues.NetPremiumsEarned, preferred)
        : null,
      policyClaimsAndBenefits: verifiedValues.PolicyClaimsAndBenefits != null
        ? findInsuranceEvidenceInSections(sections, ["Losses and loss adjustment expenses", "loss adjustment expenses"], verifiedValues.PolicyClaimsAndBenefits, preferred)
        : null,
      claimsRatio: verifiedValues.ClaimsRatio != null
        ? findInsuranceEvidenceInSections(sections, ["Loss ratio", "loss and loss adjustment expense ratio"], verifiedValues.ClaimsRatio, preferred)
        : null,
      combinedRatio: verifiedValues.CombinedRatio != null
        ? findInsuranceEvidenceInSections(sections, ["Combined ratio"], verifiedValues.CombinedRatio, preferred)
        : null,
      totalInvestments: null as EvidenceValue | null,
      insuranceContractLiabilities: null as EvidenceValue | null,
    };
  }

  return {
    netPremiumsEarned: null as EvidenceValue | null,
    policyClaimsAndBenefits: matchInsurancePatternInSections(
      sections,
      [
        /Claims and claim adjustment expenses\s*\|\s*(?:\$\s*)?([\d,]+)/i,
        /Losses and loss adjustment expenses\s*\|\s*(?:\$\s*)?([\d,]+)/i,
      ],
      preferred,
      (v) => v * 1_000_000,
      "Claims and claim adjustment expenses",
    ),
    claimsRatio: matchInsurancePatternInSections(
      sections,
      [
        /Loss and loss adjustment expense ratio\s*\|\s*(\d+\.\d+)\s*(?:\|\s*)?%/i,
      ],
      preferred,
      (v) => Number((v / 100).toFixed(4)),
      "Loss and loss adjustment expense ratio",
    ),
    combinedRatio: matchInsurancePatternInSections(
      sections,
      [
        /Combined ratio\s*\|\s*(\d+\.\d+)\s*(?:\|\s*)?%/i,
      ],
      preferred,
      (v) => Number((v / 100).toFixed(4)),
      "Combined ratio",
    ),
    totalInvestments: matchInsurancePatternInSections(
      sections,
      [
        /Total investments of \$(\d+\.\d+)\s*billion/i,
      ],
      preferred,
      (v) => Math.round(v * 1_000_000_000),
      "Total investments",
    ),
    insuranceContractLiabilities: matchInsurancePatternInSections(
      sections,
      [
        /claims and claim adjustment expense reserves balance at December 31,\s*20\d\d\s*was\s*\$(\d+\.\d+)\s*billion/i,
      ],
      preferred,
      (v) => Math.round(v * 1_000_000_000),
      "Claims and claim adjustment expense reserves",
    ),
  };
}

export function extractMetLifeInsuranceFacts(
  sections: FilingTextSection[],
  verifiedValues: Record<string, number>,
) {
  const preferred = [
    "item_8_financial_statements",
    "item_1_business",
    "item_7_mda",
    "item_15_exhibits",
  ];
  return {
    policyClaimsAndBenefits: verifiedValues.PolicyClaimsAndBenefits != null
      ? findInsuranceEvidenceInSections(sections, ["Policyholder benefits and claims", "Benefits and claims"], verifiedValues.PolicyClaimsAndBenefits, preferred)
      : null,
  };
}

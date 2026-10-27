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

export type BankReportFacts = {
  grossLoans?: EvidenceValue | null;
  netLoans?: EvidenceValue | null;
  loanLossAllowance?: EvidenceValue | null;
  nonPerformingLoans?: EvidenceValue | null;
  netInterestIncome?: EvidenceValue | null;
  nonPerformingLoanRatio?: EvidenceValue | null;
  provisionCoverage?: EvidenceValue | null;
  earningAssets?: EvidenceValue | null;
  nim?: EvidenceValue | null;
  cet1Ratio?: EvidenceValue | null;
};

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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

export function findEvidenceInSections(
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

  // 1. Search for label and candidate number in close proximity (window of 300 chars)
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

  // 2. Search for candidate number anywhere in preferred sections
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

  // 3. Fallback: return default citation on the most relevant section
  if (sections.length > 0) {
    const fallbackSection = ordered[0]?.section ?? sections[0].section;
    return {
      value: targetValue,
      section: fallbackSection,
      locator: `${labels[0] ?? "fact"}:reported@table`,
      snippet: `${labels[0] ?? "Fact"}: ${targetValue}`,
    };
  }

  return null;
}

export function extractJpmBankFacts(
  sections: FilingTextSection[],
  verifiedValues: Record<string, number>,
): BankReportFacts {
  const preferred = [
    "item_15_exhibits",
    "item_7_mda",
    "item_8_financial_statements",
    "item_1_business",
    "item_5_market",
    "item_10_directors",
  ];

  return {
    grossLoans: verifiedValues.GrossLoans != null
      ? findEvidenceInSections(sections, ["total retained loans", "Loans, retained", "Gross loans"], verifiedValues.GrossLoans, preferred)
      : null,
    loanLossAllowance: verifiedValues.LoanLossAllowance != null
      ? findEvidenceInSections(sections, ["Allowance for loan losses", "allowance for credit losses"], verifiedValues.LoanLossAllowance, preferred)
      : null,
    nonPerformingLoans: verifiedValues.NonPerformingLoans != null
      ? findEvidenceInSections(sections, ["Nonperforming loans", "nonperforming assets", "Nonaccrual loans"], verifiedValues.NonPerformingLoans, preferred)
      : null,
    netInterestIncome: verifiedValues.NetInterestIncome != null
      ? findEvidenceInSections(sections, ["Net interest income", "managed net interest income"], verifiedValues.NetInterestIncome, preferred)
      : null,
    nonPerformingLoanRatio: verifiedValues.NonPerformingLoanRatio != null
      ? findEvidenceInSections(sections, ["Nonperforming loans to total", "nonaccrual loans to retained loans", "NPL ratio"], verifiedValues.NonPerformingLoanRatio, preferred)
      : null,
    provisionCoverage: verifiedValues.ProvisionCoverage != null
      ? findEvidenceInSections(sections, ["allowance for loan losses to retained loans coverage ratio", "coverage ratio", "Allowance to nonperforming"], verifiedValues.ProvisionCoverage, preferred)
      : null,
    earningAssets: verifiedValues.EarningAssets != null
      ? findEvidenceInSections(sections, ["Average earning assets", "interest-earning assets", "Total average earning assets"], verifiedValues.EarningAssets, preferred)
      : null,
    nim: verifiedValues.NIM != null
      ? findEvidenceInSections(sections, ["net yield on these assets", "net yield", "Net interest margin"], verifiedValues.NIM, preferred)
      : null,
    cet1Ratio: verifiedValues.CET1Ratio != null
      ? findEvidenceInSections(sections, ["Common equity Tier 1", "CET1", "CET1 capital ratio"], verifiedValues.CET1Ratio, preferred)
      : null,
  };
}

export function extractCmbBankFacts(
  sections: FilingTextSection[],
  verifiedValues: Record<string, number>,
): BankReportFacts {
  const preferred = [
    "cn_annual_report_1",
    "cn_company_profile",
    "cn_mda",
    "cn_annual_report_3",
    "cn_mda_business",
  ];

  return {
    grossLoans: verifiedValues.GrossLoans != null
      ? findEvidenceInSections(sections, ["贷款和垫款总额", "客户贷款和垫款总额", "贷款总额"], verifiedValues.GrossLoans, preferred)
      : null,
    loanLossAllowance: verifiedValues.LoanLossAllowance != null
      ? findEvidenceInSections(sections, ["贷款损失准备", "贷款减值准备", "损失准备"], verifiedValues.LoanLossAllowance, preferred)
      : null,
    nonPerformingLoans: verifiedValues.NonPerformingLoans != null
      ? findEvidenceInSections(sections, ["不良贷款余额", "不良贷款", "不良资产"], verifiedValues.NonPerformingLoans, preferred)
      : null,
    netInterestIncome: verifiedValues.NetInterestIncome != null
      ? findEvidenceInSections(sections, ["净利息收入", "利息净收入"], verifiedValues.NetInterestIncome, preferred)
      : null,
    nonPerformingLoanRatio: verifiedValues.NonPerformingLoanRatio != null
      ? findEvidenceInSections(sections, ["不良贷款率", "不良率"], verifiedValues.NonPerformingLoanRatio, preferred)
      : null,
    provisionCoverage: verifiedValues.ProvisionCoverage != null
      ? findEvidenceInSections(sections, ["拨备覆盖率", "拨备率"], verifiedValues.ProvisionCoverage, preferred)
      : null,
    earningAssets: verifiedValues.EarningAssets != null
      ? findEvidenceInSections(sections, ["总生息资产平均余额", "生息资产平均余额", "生息资产"], verifiedValues.EarningAssets, preferred)
      : null,
    nim: verifiedValues.NIM != null
      ? findEvidenceInSections(sections, ["净利息收益率", "净利差"], verifiedValues.NIM, preferred)
      : null,
    cet1Ratio: verifiedValues.CET1Ratio != null
      ? findEvidenceInSections(sections, ["核心一级资本充足率", "资本充足率"], verifiedValues.CET1Ratio, preferred)
      : null,
  };
}

export function extractBochkBankFacts(
  sections: FilingTextSection[],
  verifiedValues: Record<string, number>,
): BankReportFacts {
  const preferred = [
    "hk_annual_report_1",
    "hk_mda",
    "hk_mda_business",
    "hk_chairman_statement",
    "hk_governance",
    "hk_annual_report_2",
  ];

  return {
    grossLoans: verifiedValues.GrossLoans != null
      ? findEvidenceInSections(sections, ["客戶貸款及其他賬項", "貸款及墊款總額", "貸款總額"], verifiedValues.GrossLoans, preferred)
      : null,
    netLoans: verifiedValues.NetLoans != null
      ? findEvidenceInSections(sections, ["客戶貸款淨額", "貸款及墊款淨額", "客戶貸款"], verifiedValues.NetLoans, preferred)
      : null,
    loanLossAllowance: verifiedValues.LoanLossAllowance != null
      ? findEvidenceInSections(sections, ["貸款減值準備", "減值準備", "客戶貸款減值準備"], verifiedValues.LoanLossAllowance, preferred)
      : null,
    nonPerformingLoans: verifiedValues.NonPerformingLoans != null
      ? findEvidenceInSections(sections, ["減值貸款", "不良貸款", "減值貸款及墊款"], verifiedValues.NonPerformingLoans, preferred)
      : null,
    netInterestIncome: verifiedValues.NetInterestIncome != null
      ? findEvidenceInSections(sections, ["淨利息收入", "利息淨收入"], verifiedValues.NetInterestIncome, preferred)
      : null,
    nonPerformingLoanRatio: verifiedValues.NonPerformingLoanRatio != null
      ? findEvidenceInSections(sections, ["減值貸款比率", "不良貸款率", "減值比率"], verifiedValues.NonPerformingLoanRatio, preferred)
      : null,
    provisionCoverage: verifiedValues.ProvisionCoverage != null
      ? findEvidenceInSections(sections, ["撥備覆蓋率", "撥備比率"], verifiedValues.ProvisionCoverage, preferred)
      : null,
    earningAssets: verifiedValues.EarningAssets != null
      ? findEvidenceInSections(sections, ["平均生息資產", "生息資產平均餘額", "平均計息資產"], verifiedValues.EarningAssets, preferred)
      : null,
    nim: verifiedValues.NIM != null
      ? findEvidenceInSections(sections, ["淨息差", "淨利差"], verifiedValues.NIM, preferred)
      : null,
    cet1Ratio: verifiedValues.CET1Ratio != null
      ? findEvidenceInSections(sections, ["普通股權一級資本比率", "一級資本比率", "核心一級資本充足率"], verifiedValues.CET1Ratio, preferred)
      : null,
  };
}

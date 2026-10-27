import { describe, expect, it } from "vitest";
import {
  extractBochkBankFacts,
  extractCmbBankFacts,
  extractJpmBankFacts,
} from "../scripts/lib/bank-annual-report-extractor";

describe("Bank annual-report extraction", () => {
  it("extracts JPM 10-K facts with locators and verified numbers", () => {
    const facts = extractJpmBankFacts(
      [
        {
          section: "item_15_exhibits",
          text: `
            Common equity Tier 1 (“CET1”) capital ratio – Standardized | 14.6%
            net yield on these assets, on an FTE basis, was 2.50%, a decrease of 13 bps.
            Allowance for loan losses | (25,765) | (24,345)
            Total retained loans was $1,493,429 million.
          `,
        },
      ],
      {
        GrossLoans: 1493429000000,
        LoanLossAllowance: 25765000000,
        NIM: 0.025,
        CET1Ratio: 0.146,
      },
    );

    expect(facts.cet1Ratio?.value).toBe(0.146);
    expect(facts.cet1Ratio?.section).toBe("item_15_exhibits");
    expect(facts.nim?.value).toBe(0.025);
    expect(facts.loanLossAllowance?.value).toBe(25765000000);
    expect(facts.grossLoans?.value).toBe(1493429000000);
  });

  it("extracts CMB CN annual report facts", () => {
    const facts = extractCmbBankFacts(
      [
        {
          section: "cn_annual_report_1",
          text: `
            不良贷款率0.94%，拨备覆盖率391.79%，风险抵补能力强健。
            核心一级资本充足率 14.16%
            净利息收益率 1.87%
          `,
        },
      ],
      {
        NonPerformingLoanRatio: 0.0094,
        ProvisionCoverage: 3.9179,
        CET1Ratio: 0.1416,
        NIM: 0.0187,
      },
    );

    expect(facts.nonPerformingLoanRatio?.value).toBe(0.0094);
    expect(facts.provisionCoverage?.value).toBe(3.9179);
    expect(facts.cet1Ratio?.value).toBe(0.1416);
    expect(facts.nim?.value).toBe(0.0187);
  });

  it("extracts BOCHK HK annual report facts", () => {
    const facts = extractBochkBankFacts(
      [
        {
          section: "hk_mda",
          text: `
            淨息差為1.40%。
            減值貸款比率為1.14%，持續優於市場平均水平。
            普通股權一級資本比率均為24.01%。
            客戶貸款淨額 1,705,172 百萬港元。
          `,
        },
      ],
      {
        NIM: 0.014,
        NonPerformingLoanRatio: 0.0114,
        CET1Ratio: 0.2401,
        NetLoans: 1705172000000,
      },
    );

    expect(facts.nim?.value).toBe(0.014);
    expect(facts.nonPerformingLoanRatio?.value).toBe(0.0114);
    expect(facts.cet1Ratio?.value).toBe(0.2401);
    expect(facts.netLoans?.value).toBe(1705172000000);
  });
});

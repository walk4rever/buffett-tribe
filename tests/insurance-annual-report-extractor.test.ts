import { describe, expect, it } from "vitest";
import { extractPiccPcInsuranceFacts } from "../scripts/lib/insurance-annual-report-extractor";

describe("PICC P&C annual-report extraction", () => {
  it("extracts the pre-IFRS 17 annual-report table", () => {
    const facts = extractPiccPcInsuranceFacts([
      {
        section: "hk_mda",
        text: `
          已賺淨保費 396,997 393,127 1.0
          賠付率73.7%，同比上升7.5個百分點。
          綜合成本率99.6%，同比上升0.7個百分點。
          於2021年12月31日，本公司及子公司投資資產5,340.72億元人民幣。
          投資資產合計 534,072 100.0 5.2 507,525 100.0
          綜合償付能力充足率284%
        `,
      },
    ]);

    expect(facts.claimsRatio?.value).toBeCloseTo(0.737);
    expect(facts.netPremiumsEarned?.value).toBe(396_997);
    expect(facts.combinedRatio?.value).toBeCloseTo(0.996);
    expect(facts.solvencyRatio?.value).toBeCloseTo(2.84);
    expect(facts.totalInvestments?.value).toBe(534_072);
  });

  it("extracts IFRS 17 labels and ignores unrelated note-heading values", () => {
    const facts = extractPiccPcInsuranceFacts([
      {
        section: "hk_mda_business",
        text: `
          保險服務收入
          511,594
          485,223
          綜合賠付率73.9%，同比上升0.9個百分點；
          綜合費用率23.6%，同比下降2.2個百分點；
          綜合成本率97.5%，同比下降1.3個百分點。
          投資資產合計
          760,366
          100.0
          12.4
          676,512
          100.0
        `,
      },
      {
        section: "hk_mda_review",
        text: "綜合償付能力充足率232.4%，較年初下降0.2個百分點",
      },
    ]);

    expect(facts.claimsRatio?.value).toBeCloseTo(0.739);
    expect(facts.netPremiumsEarned?.value).toBe(511_594);
    expect(facts.combinedRatio?.value).toBeCloseTo(0.975);
    expect(facts.solvencyRatio?.value).toBeCloseTo(2.324);
    expect(facts.totalInvestments?.value).toBe(760_366);
  });
});

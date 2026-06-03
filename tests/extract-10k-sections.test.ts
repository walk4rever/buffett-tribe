import { describe, expect, it } from "vitest";

import { extractTargetSections } from "../scripts/lib/extract-10k-sections";

describe("extractTargetSections", () => {
  it("detects 10-K item headings rendered as compact tables", () => {
    const html = `
      <html>
        <body>
          <div>
            <table>
              <tr><td>Item 1.</td><td>BUSINESS.</td></tr>
            </table>
          </div>
          <div><p>The company develops and markets therapeutic products worldwide.</p></div>

          <div>
            <table>
              <tr><td>Item 1A.</td><td>RISK FACTORS.</td></tr>
            </table>
          </div>
          <div><p>The business faces regulatory, clinical, and market risks.</p></div>

          <div>
            <table>
              <tr><td>Item 7.</td><td>MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS.</td></tr>
            </table>
          </div>
          <div><p>Revenue increased due to higher product demand.</p></div>
        </body>
      </html>
    `;

    const sections = extractTargetSections(html, undefined, "10k");

    expect(Object.keys(sections)).toEqual([
      "item_1_business",
      "item_1a_risk_factors",
      "item_7_mda",
    ]);
    expect(sections.item_1_business?.content).toContain("therapeutic products");
    expect(sections.item_1a_risk_factors?.content).toContain("regulatory");
    expect(sections.item_7_mda?.content).toContain("Revenue increased");
  });

  it("extracts 20-F sections from three-column cross-reference tables with page ranges", () => {
    const rows = [
      ["3.", "Key information", "2-3"],
      ["4.", "Information on the company", "4-5"],
      ["5.", "Operating and financial review and prospects", "6"],
      ["6.", "Directors, senior management and employees", "7"],
      ["7.", "Major shareholders and related party transactions", "8"],
      ["8.", "Financial information", "9"],
      ["10.", "Additional information", "10"],
      ["11.", "Quantitative and qualitative disclosures about market risk", "11"],
      ["19.", "Exhibits", "12"],
    ];

    const page = (n: number, text: string) => `
      <div>
        <table><tr><td>${n}</td><td>Example Form 20-F 2025</td></tr></table>
        <p>${text}</p>
      </div>
    `;
    const html = `
      <html>
        <body>
          <div>
            <table>
              <tr><th>Cross reference to Form 20-F</th></tr>
              <tr><th>Item</th><th>Required item in Form 20-F</th><th>Page(s)</th></tr>
              ${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}
            </table>
          </div>
          ${page(2, "Risk factor disclosure appears here.")}
          ${page(3, "Capital and indebtedness disclosure appears here.")}
          ${page(4, "Company history disclosure appears here.")}
          ${page(5, "Business overview disclosure appears here.")}
          ${page(6, "Operating review disclosure appears here.")}
          ${page(7, "Director and employee disclosure appears here.")}
          ${page(8, "Major shareholder disclosure appears here.")}
          ${page(9, "Financial information disclosure appears here.")}
          ${page(10, "Additional information disclosure appears here.")}
          ${page(11, "Market risk disclosure appears here.")}
          ${page(12, "Exhibit disclosure appears here.")}
        </body>
      </html>
    `;

    const sections = extractTargetSections(html, undefined, "20f");

    expect(Object.keys(sections)).toEqual([
      "item_3_key_information",
      "item_4_company_information",
      "item_5_operating_financial_review",
      "item_6_directors_management_employees",
      "item_7_major_shareholders_related_party",
      "item_8_financial_information",
      "item_10_additional_information",
      "item_11_market_risk",
      "item_19_exhibits",
    ]);
    expect(sections.item_3_key_information?.content).toContain("Risk factor disclosure");
    expect(sections.item_3_key_information?.content).toContain("Capital and indebtedness");
    expect(sections.item_4_company_information?.content).toContain("Company history");
    expect(sections.item_19_exhibits?.content).toContain("Exhibit disclosure");
  });
});

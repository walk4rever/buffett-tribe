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
});

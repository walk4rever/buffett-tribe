import { beforeAll, describe, expect, it } from "vitest";

const hasDb = Boolean(process.env.DIRECT_URL);

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  details?: unknown;
}

interface TestTool {
  execute: (id: string, params: Record<string, unknown>, context?: unknown) => Promise<ToolResult>;
}

function textOf(result: ToolResult): string {
  return result.content[0]?.type === "text" ? result.content[0].text ?? "" : "";
}

describe.skipIf(!hasDb)("company qualitative tools (live DB)", () => {
  let overview: TestTool;
  let businessModel: TestTool;
  let moat: TestTool;

  beforeAll(async () => {
    [{ getCompanyOverviewTool: overview }, { getCompanyBusinessModelTool: businessModel }, { getCompanyMoatTool: moat }] =
      await Promise.all([
        import("../../services/pi-gateway/src/tools/get-company-overview.js"),
        import("../../services/pi-gateway/src/tools/get-company-business-model.js"),
        import("../../services/pi-gateway/src/tools/get-company-moat.js"),
      ]);
  });

  it("finds SpaceX by alias and returns only the company overview", async () => {
    const text = textOf(await overview.execute("test", { company: "SpaceX" }, undefined));
    expect(text).toContain("SPACE EXPLORATION TECHNOLOGIES CORP");
    expect(text).toContain("Company Overview");
    expect(text).not.toContain("Business Model Canvas");
    expect(text).not.toContain("Moat / Competitive Advantage");
    expect(text).not.toContain("METASPACEX");
  }, 30_000);

  it("returns the business model canvas without valuation or capital allocation", async () => {
    const text = textOf(await businessModel.execute("test", { company: "AAPL" }, undefined));
    expect(text).toContain("Apple Inc.");
    expect(text).toContain("Business Model Canvas");
    expect(text).not.toContain("Capital Allocation");
    expect(text).not.toContain("Valuation");
  }, 30_000);

  it("returns the moat analysis without management or valuation", async () => {
    const text = textOf(await moat.execute("test", { company: "AAPL" }, undefined));
    expect(text).toContain("Apple Inc.");
    expect(text).toContain("Moat / Competitive Advantage");
    expect(text).not.toContain("Management Analysis");
    expect(text).not.toContain("Valuation Analysis");
  }, 30_000);
});

import { beforeAll, describe, expect, it } from "vitest";

const hasDb = Boolean(process.env.DIRECT_URL);

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  details?: unknown;
}

interface TestTool {
  execute: (id: string, params: Record<string, unknown>, context?: unknown) => Promise<ToolResult>;
}

describe.skipIf(!hasDb)("get_company_analysis golden cases (live DB)", () => {
  let getCompanyAnalysisTool: TestTool;

  beforeAll(async () => {
    const mod = await import("../../services/pi-gateway/src/tools/get-company-analysis.js");
    getCompanyAnalysisTool = mod.getCompanyAnalysisTool;
  });

  it("finds SpaceX by alias and returns company analysis without picking METASPACEX", async () => {
    const result = await getCompanyAnalysisTool.execute(
      "test",
      { company: "SpaceX" },
      undefined,
    );
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("SPACE EXPLORATION TECHNOLOGIES CORP");
    expect(text).toContain("Company Overview");
    expect(text).not.toContain("METASPACEX");
  }, 30_000);

  it("finds Apple by ticker AAPL", async () => {
    const result = await getCompanyAnalysisTool.execute(
      "test",
      { company: "AAPL", artifactType: "overview" },
      undefined,
    );
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("Apple Inc.");
  }, 30_000);
});

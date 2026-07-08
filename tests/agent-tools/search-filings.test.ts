// Agent tool contract test — hits the real Supabase DB + real R2 (no mocks).
// See TODOS.md "测试体系设计" for why L3 deliberately runs against live data:
// this exact case (DIS 2020 10-K, keyword deep in item_1_business) is the
// regression that motivated building this harness — FilingSection.content
// was silently truncated in production and search_filings couldn't find
// keywords past the first ~3000 chars.
//
// Requires DIRECT_URL. Skips (not fails) when it isn't set, so `npm run
// test` stays green with no secrets for local/default runs.
import { describe, expect, it } from "vitest";
import { searchFilingsTool } from "../../services/pi-gateway/src/tools/search-filings.js";

const hasDb = Boolean(process.env.DIRECT_URL);

describe.skipIf(!hasDb)("search_filings golden cases (live DB + R2)", () => {
  it("finds a keyword deep inside Disney's 2020 10-K business section", async () => {
    const result = await searchFilingsTool.execute(
      "test",
      { company: "DIS", section: "business", year: 2020, keyword: "Aspire" },
      undefined,
    );
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("Aspire");
    // Above the tool's own worst-case budget (2 attempts x 45s timeout each):
    // observed R2 body-read latency for this file has ranged from <1s to 2+
    // minutes depending on network conditions, so this must exceed that, not
    // just a "reasonable" test duration.
  }, 120_000);

  it("lists available sections when no section is specified", async () => {
    const result = await searchFilingsTool.execute(
      "test",
      { company: "AAPL" },
      undefined,
    );
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("Filing sections available");
  }, 30_000);
});

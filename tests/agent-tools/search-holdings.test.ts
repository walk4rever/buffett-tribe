// Agent tool contract test — hits the real Supabase DB (no mocks). See
// TODOS.md "测试体系设计" for why L3 runs against live data.
//
// AAPL has been Berkshire's largest 13F position for years; we assert on
// presence, not an exact percentage, since the weight legitimately drifts
// quarter to quarter.
//
// Requires DIRECT_URL. Skips (not fails) when it isn't set.
import { describe, expect, it } from "vitest";
import { searchHoldingsTool } from "../../services/pi-gateway/src/tools/search-holdings.js";

const hasDb = Boolean(process.env.DIRECT_URL);

describe.skipIf(!hasDb)("search_holdings golden cases (live DB)", () => {
  it("finds AAPL in Berkshire's most recent 13F", async () => {
    const result = await searchHoldingsTool.execute(
      "test",
      { master: "buffett", company: "AAPL" },
      undefined,
    );
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("AAPL");
    expect(text).toContain("Berkshire");
  }, 30_000);

  it("returns a ranked portfolio when no company filter is given", async () => {
    const result = await searchHoldingsTool.execute(
      "test",
      { master: "buffett", top_n: 5 },
      undefined,
    );
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("13F Holdings");
    expect(result.details).toMatchObject({ count: 5 });
  }, 30_000);

  it("rejects an unknown master without querying the DB", async () => {
    const result = await searchHoldingsTool.execute(
      "test",
      { master: "not-a-real-master" },
      undefined,
    );
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("Unknown master");
  });
});

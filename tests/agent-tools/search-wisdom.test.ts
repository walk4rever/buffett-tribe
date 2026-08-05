// Agent tool contract test — hits the real Supabase DB (pgvector) and the
// real DashScope embeddings API (no mocks). See TODOS.md "测试体系设计" for why
// L3 runs against live data.
//
// "Circle of competence" is one of Buffett/Munger's most repeated concepts
// across shareholder letters and annual meeting transcripts (1965–2025
// letters + 1994–2023 meeting transcripts are imported), so a semantic
// search for it is expected to always return relevant passages — this is a
// loose existence check, not an exact-content assertion, since embeddings
// are non-deterministic-adjacent (model updates, ranking ties).
//
// Requires DIRECT_URL and DASHSCOPE_API_KEY (real per-call cost). Skips (not
// fails) when either isn't set — this is why it's intentionally left out of
// the default CI gate rather than wired in like search_filings/search_holdings.
import { describe, expect, it } from "vitest";
import { searchWisdomTool } from "../../services/pi-gateway/src/tools/search-wisdom.js";

const hasDeps = Boolean(process.env.DIRECT_URL) && Boolean(process.env.DASHSCOPE_API_KEY);

describe.skipIf(!hasDeps)("search_wisdom golden cases (live DB + DashScope embeddings)", () => {
  it("finds relevant passages for a canonical Buffett/Munger concept", async () => {
    const result = await searchWisdomTool.execute(
      "test",
      { query: "circle of competence", master: "buffett" },
      undefined,
    );
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).not.toBe("No relevant passages found in the wisdom library.");
    expect(result.details).toMatchObject({ count: expect.any(Number) });
    expect((result.details as { count: number }).count).toBeGreaterThan(0);
  }, 30_000);
});

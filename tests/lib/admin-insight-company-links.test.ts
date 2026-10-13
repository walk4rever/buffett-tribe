import { describe, expect, it } from "vitest";
import { buildArticleListParams } from "../../src/lib/admin-insight-company-links";

describe("admin insight company links", () => {
  it("builds article list params with a trimmed search query", () => {
    const params = buildArticleListParams(2, "  Apple  ");

    expect(params.get("type")).toBe("posts");
    expect(params.get("page")).toBe("2");
    expect(params.get("q")).toBe("Apple");
  });

  it("omits an empty search query", () => {
    const params = buildArticleListParams(1, "   ");

    expect(params.toString()).toBe("type=posts&page=1");
  });
});

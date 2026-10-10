import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerSession, mockQueryRaw, mockFindMany } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockQueryRaw: vi.fn(),
  mockFindMany: vi.fn(),
}));

vi.mock("next-auth/next", () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRaw: mockQueryRaw,
    chatTurn: { findMany: mockFindMany },
  },
}));

import { GET } from "../src/app/api/agent-turns/route";
import { summarizeConversationPreview } from "../src/lib/agent-workspace-ui";

describe("Agent turn previews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mockQueryRaw.mockResolvedValue([]);
    mockFindMany.mockResolvedValue([]);
  });

  it("cleans markdown and whitespace from a conversation preview", () => {
    expect(
      summarizeConversationPreview("## 苹果\n\n自由现金流 [分析](https://example.com)"),
    ).toBe("苹果 自由现金流 分析");
  });

  it("truncates long previews without exceeding the requested length", () => {
    expect(summarizeConversationPreview("123456789", 5)).toBe("12345…");
  });

  it("returns an empty preview for blank messages", () => {
    expect(summarizeConversationPreview(" \n  ")).toBe("");
  });

  it("returns the latest turns for multiple companies in one query", async () => {
    mockQueryRaw.mockResolvedValue([
      { contextKey: "company:AAPL", role: "assistant", text: "苹果的现金流持续改善。" },
      { contextKey: "company:TSLA", role: "user", text: "特斯拉的汽车毛利率如何？" },
    ]);

    const response = await GET(
      new Request("http://localhost/api/agent-turns?companyTicker=AAPL&companyTicker=TSLA"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      latestByContextKey: {
        "company:AAPL": { role: "assistant", text: "苹果的现金流持续改善。" },
        "company:TSLA": { role: "user", text: "特斯拉的汽车毛利率如何？" },
      },
    });
    expect(mockQueryRaw).toHaveBeenCalledTimes(1);
  });

  it("requires authentication before returning conversation previews", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/agent-turns?companyTicker=AAPL"),
    );

    expect(response.status).toBe(401);
    expect(mockQueryRaw).not.toHaveBeenCalled();
  });
});

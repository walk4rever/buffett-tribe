import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockEntityFindMany, mockInsightFindMany, mockGetTribeMembers } = vi.hoisted(() => ({
  mockEntityFindMany: vi.fn(),
  mockInsightFindMany: vi.fn(),
  mockGetTribeMembers: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    entity: { findMany: mockEntityFindMany },
    insightPost: { findMany: mockInsightFindMany },
  },
}));

vi.mock("@/lib/tribe", () => ({
  getTribeMembers: mockGetTribeMembers,
}));

import { GET } from "../src/app/api/site-search/route";

describe("GET /api/site-search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEntityFindMany.mockResolvedValue([]);
    mockInsightFindMany.mockResolvedValue([]);
    mockGetTribeMembers.mockResolvedValue([]);
  });

  it("returns empty groups without querying for a blank search", async () => {
    const response = await GET(new NextRequest("http://localhost/api/site-search?q=%20%20"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      masters: [],
      companies: [],
      insights: [],
    });
    expect(mockEntityFindMany).not.toHaveBeenCalled();
    expect(mockInsightFindMany).not.toHaveBeenCalled();
    expect(mockGetTribeMembers).not.toHaveBeenCalled();
  });

  it("does not run broad searches for a single character", async () => {
    const response = await GET(new NextRequest("http://localhost/api/site-search?q=中"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      masters: [],
      companies: [],
      insights: [],
    });
    expect(mockEntityFindMany).not.toHaveBeenCalled();
    expect(mockInsightFindMany).not.toHaveBeenCalled();
    expect(mockGetTribeMembers).not.toHaveBeenCalled();
  });

  it("returns matching masters, public companies, and published insights in separate groups", async () => {
    mockGetTribeMembers.mockResolvedValue([
      {
        id: "buffett",
        name: "Warren Buffett",
        nameZh: "沃伦·巴菲特",
        firm: "Berkshire Hathaway",
      },
    ]);
    mockEntityFindMany.mockResolvedValue([
      {
        id: "company-1",
        canonicalName: "Apple Inc.",
        ticker: "AAPL",
        code: "AAPL",
        market: "us",
        cik: "0000320193",
        metadata: { nameZh: "苹果", nameEnShort: "Apple" },
      },
    ]);
    mockInsightFindMany.mockResolvedValue([
      {
        slug: "apple-capital-allocation",
        title: "苹果的资本配置",
        description: "分析苹果的回购与现金管理",
        source: "Value-Tribe",
        tags: ["苹果", "资本配置"],
      },
    ]);

    const response = await GET(new NextRequest("http://localhost/api/site-search?q=苹果"));
    const data = await response.json();

    expect(data.masters).toEqual([]);
    expect(data.companies).toEqual([
      {
        id: "company-1",
        name: "苹果",
        subtitle: "AAPL · Apple",
        href: "/company/us-0000320193",
      },
    ]);
    expect(data.insights).toEqual([
      {
        slug: "apple-capital-allocation",
        title: "苹果的资本配置",
        subtitle: "分析苹果的回购与现金管理",
        href: "/insights/apple-capital-allocation",
      },
    ]);
    expect(mockEntityFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ type: "company", onboardPhase: { gte: 1 } }),
    }));
    expect(mockInsightFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "published" }),
      take: 5,
    }));
  });

  it("matches masters by Chinese name, English name, or investment firm", async () => {
    mockGetTribeMembers.mockResolvedValue([
      {
        id: "gavin-baker",
        name: "Gavin Baker",
        nameZh: "加文·贝克",
        firm: "Atreides Management",
      },
    ]);

    const response = await GET(new NextRequest("http://localhost/api/site-search?q=Atreides"));

    expect(await response.json()).toMatchObject({
      masters: [{
        id: "gavin-baker",
        name: "加文·贝克",
        subtitle: "Atreides Management",
        href: "/master/gavin-baker",
      }],
      companies: [],
      insights: [],
    });
  });

  it("limits and truncates the query before searching", async () => {
    const longQuery = "巴".repeat(200);
    await GET(new NextRequest(`http://localhost/api/site-search?q=${longQuery}`));

    expect(mockEntityFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          expect.objectContaining({ canonicalName: { contains: "巴".repeat(80), mode: "insensitive" } }),
        ]),
      }),
    }));
  });
});

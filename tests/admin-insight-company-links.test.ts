import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAdminSessionMock,
  entityFindManyMock,
  insightPostCountMock,
  insightPostFindManyMock,
  insightPostFindUniqueMock,
  insightPostUpdateMock,
} = vi.hoisted(() => ({
  getAdminSessionMock: vi.fn(),
  entityFindManyMock: vi.fn(),
  insightPostCountMock: vi.fn(),
  insightPostFindManyMock: vi.fn(),
  insightPostFindUniqueMock: vi.fn(),
  insightPostUpdateMock: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  getAdminSession: getAdminSessionMock,
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    entity: { findMany: entityFindManyMock },
    insightPost: {
      count: insightPostCountMock,
      findMany: insightPostFindManyMock,
      findUnique: insightPostFindUniqueMock,
      update: insightPostUpdateMock,
    },
  },
}));

import { GET, PUT } from "../src/app/api/admin/insight-company-links/route";

describe("/api/admin/insight-company-links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated searches", async () => {
    getAdminSessionMock.mockResolvedValue({ status: "unauthenticated" });

    const response = await GET(
      new Request("http://localhost/api/admin/insight-company-links?type=posts"),
    );

    expect(response.status).toBe(401);
  });

  it("returns the requested article page and total pagination metadata", async () => {
    getAdminSessionMock.mockResolvedValue({ status: "ok", session: {} });
    insightPostCountMock.mockResolvedValue(73);
    insightPostFindManyMock.mockResolvedValue([
      {
        id: "post-51",
        slug: "post-51",
        title: "Article 51",
        source: "Founders",
        status: "published",
        publishedAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        entityIds: [],
      },
    ]);

    const response = await GET(
      new Request("http://localhost/api/admin/insight-company-links?type=posts&q=search&page=2"),
    );
    const data = await response.json();
    const where = {
      OR: [
        { title: { contains: "search", mode: "insensitive" } },
        { slug: { contains: "search", mode: "insensitive" } },
        { source: { contains: "search", mode: "insensitive" } },
      ],
    };

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      page: 2,
      pageSize: 50,
      total: 73,
      totalPages: 2,
      posts: [{ id: "post-51", title: "Article 51", companies: [] }],
    });
    expect(insightPostCountMock).toHaveBeenCalledWith({ where });
    expect(insightPostFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
        skip: 50,
        take: 50,
        orderBy: [
          { publishedAt: { sort: "desc", nulls: "last" } },
          { updatedAt: "desc" },
          { id: "desc" },
        ],
      }),
    );
  });

  it("rejects invalid article page numbers", async () => {
    getAdminSessionMock.mockResolvedValue({ status: "ok", session: {} });

    const response = await GET(
      new Request("http://localhost/api/admin/insight-company-links?type=posts&page=0"),
    );

    expect(response.status).toBe(400);
    expect(insightPostCountMock).not.toHaveBeenCalled();
  });

  it("rejects non-admin association updates", async () => {
    getAdminSessionMock.mockResolvedValue({ status: "forbidden" });

    const response = await PUT(
      new Request("http://localhost/api/admin/insight-company-links", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: "post-1", companyIds: ["company-1"] }),
      }),
    );

    expect(response.status).toBe(403);
    expect(insightPostUpdateMock).not.toHaveBeenCalled();
  });

  it("replaces company links while preserving other entity links", async () => {
    getAdminSessionMock.mockResolvedValue({ status: "ok", session: {} });
    insightPostFindUniqueMock.mockResolvedValue({
      id: "post-1",
      entityIds: ["master-1", "company-old"],
    });
    entityFindManyMock
      .mockResolvedValueOnce([
        {
          id: "company-new",
          canonicalName: "New Company",
          ticker: "NEW",
          cik: "0000000001",
          market: "us",
          code: null,
          metadata: {},
        },
      ])
      .mockResolvedValueOnce([{ id: "company-old" }]);
    insightPostUpdateMock.mockResolvedValue({});

    const response = await PUT(
      new Request("http://localhost/api/admin/insight-company-links", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: "post-1", companyIds: ["company-new"] }),
      }),
    );

    expect(response.status).toBe(200);
    expect(insightPostUpdateMock).toHaveBeenCalledWith({
      where: { id: "post-1" },
      data: { entityIds: ["master-1", "company-new"] },
    });
  });
});

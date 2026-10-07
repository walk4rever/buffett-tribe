import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getAdminSession } from "@/lib/admin-auth";
import {
  mergeCompanyEntityIds,
  parseCompanyEntityIds,
} from "@/lib/insight-company-links";

const MAX_QUERY_LENGTH = 100;
const PAGE_SIZE = 50;
const MAX_COMPANY_RESULTS = 50;
const MAX_BODY_BYTES = 32 * 1024;

type CompanyRecord = {
  id: string;
  canonicalName: string;
  ticker: string | null;
  cik: string | null;
  market: string | null;
  code: string | null;
  metadata: unknown;
};

function companyOption(entity: CompanyRecord) {
  const metadata =
    entity.metadata && typeof entity.metadata === "object" && !Array.isArray(entity.metadata)
      ? (entity.metadata as Record<string, unknown>)
      : {};
  const nameZh = typeof metadata.nameZh === "string" ? metadata.nameZh : null;

  return {
    id: entity.id,
    name: nameZh ?? entity.canonicalName,
    canonicalName: entity.canonicalName,
    ticker: entity.ticker,
    cik: entity.cik,
    market: entity.market,
    code: entity.code,
  };
}

export async function GET(request: Request) {
  const auth = await getAdminSession();
  if (auth.status !== "ok") {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: auth.status === "unauthenticated" ? 401 : 403 },
    );
  }

  const params = new URL(request.url).searchParams;
  const type = params.get("type") ?? "posts";
  const query = (params.get("q") ?? "").trim();
  if (query.length > MAX_QUERY_LENGTH) {
    return NextResponse.json({ error: "Search query is too long" }, { status: 400 });
  }

  if (type === "companies") {
    if (!query) return NextResponse.json({ companies: [] });

    const pattern = `%${query}%`;
    const upperPattern = `%${query.toUpperCase()}%`;
    const companies = await prisma.$queryRaw<CompanyRecord[]>(Prisma.sql`
      SELECT id, "canonicalName", ticker, cik, market, code, metadata
      FROM "Entity"
      WHERE type = 'company'
        AND (
          "canonicalName" ILIKE ${pattern}
          OR ticker ILIKE ${upperPattern}
          OR code ILIKE ${upperPattern}
          OR (metadata->>'nameZh') ILIKE ${pattern}
          OR (metadata->>'nameEnShort') ILIKE ${upperPattern}
          OR array_to_string(aliases, ' ') ILIKE ${pattern}
        )
      ORDER BY "canonicalName" ASC
      LIMIT ${MAX_COMPANY_RESULTS}
    `);

    return NextResponse.json({ companies: companies.map(companyOption) });
  }

  if (type !== "posts") {
    return NextResponse.json({ error: "Invalid search type" }, { status: 400 });
  }

  const requestedPage = Number(params.get("page") ?? "1");
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
    return NextResponse.json({ error: "Invalid page number" }, { status: 400 });
  }

  const where = query
    ? {
        OR: [
          { title: { contains: query, mode: "insensitive" as const } },
          { slug: { contains: query, mode: "insensitive" as const } },
          { source: { contains: query, mode: "insensitive" as const } },
        ],
      }
    : undefined;
  const total = await prisma.insightPost.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const posts = await prisma.insightPost.findMany({
    where,
    select: {
      id: true,
      slug: true,
      title: true,
      source: true,
      status: true,
      publishedAt: true,
      updatedAt: true,
      entityIds: true,
    },
    orderBy: [
      { publishedAt: { sort: "desc", nulls: "last" } },
      { updatedAt: "desc" },
      { id: "desc" },
    ],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  const entityIds = [...new Set(posts.flatMap((post) => post.entityIds))];
  const companies = entityIds.length
    ? await prisma.entity.findMany({
        where: { id: { in: entityIds }, type: "company" },
        select: {
          id: true,
          canonicalName: true,
          ticker: true,
          cik: true,
          market: true,
          code: true,
          metadata: true,
        },
      })
    : [];
  const companyById = new Map(companies.map((company) => [company.id, companyOption(company)]));

  return NextResponse.json({
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages,
    posts: posts.map((post) => ({
      id: post.id,
      slug: post.slug,
      title: post.title,
      source: post.source,
      status: post.status,
      publishedAt: post.publishedAt?.toISOString() ?? null,
      updatedAt: post.updatedAt.toISOString(),
      companies: post.entityIds
        .map((id) => companyById.get(id))
        .filter((company): company is NonNullable<typeof company> => company != null),
    })),
  });
}

export async function PUT(request: Request) {
  const auth = await getAdminSession();
  if (auth.status !== "ok") {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: auth.status === "unauthenticated" ? 401 : 403 },
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return NextResponse.json({ error: "Expected JSON request body" }, { status: 415 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
    }
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  const postId = typeof record.postId === "string" ? record.postId.trim() : "";
  const companyIds = parseCompanyEntityIds(record.companyIds);
  if (!postId || postId.length > 128 || companyIds == null) {
    return NextResponse.json({ error: "Invalid article or company selection" }, { status: 400 });
  }

  const post = await prisma.insightPost.findUnique({
    where: { id: postId },
    select: { id: true, entityIds: true },
  });
  if (!post) return NextResponse.json({ error: "Article not found" }, { status: 404 });

  const selectedCompanies = companyIds.length
    ? await prisma.entity.findMany({
        where: { id: { in: companyIds }, type: "company" },
        select: {
          id: true,
          canonicalName: true,
          ticker: true,
          cik: true,
          market: true,
          code: true,
          metadata: true,
        },
      })
    : [];
  if (selectedCompanies.length !== companyIds.length) {
    return NextResponse.json({ error: "One or more selected companies do not exist" }, { status: 400 });
  }

  const existingCompanies = post.entityIds.length
    ? await prisma.entity.findMany({
        where: { id: { in: post.entityIds }, type: "company" },
        select: { id: true },
      })
    : [];
  const entityIds = mergeCompanyEntityIds(
    post.entityIds,
    existingCompanies.map((entity) => entity.id),
    companyIds,
  );

  await prisma.insightPost.update({
    where: { id: post.id },
    data: { entityIds },
  });

  return NextResponse.json({ companies: selectedCompanies.map(companyOption) });
}

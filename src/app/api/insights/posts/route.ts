import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  isInsightFormat,
  normalizeInsightSlug,
  parseInsightFrontmatter,
  type InsightFormat,
} from "@/lib/insights";

const MAX_CONTENT_BYTES = 1024 * 1024;
const VALID_STATUSES = new Set(["draft", "published", "archived"]);

interface InsightPostPayload {
  externalId?: unknown;
  slug?: unknown;
  format?: unknown;
  title?: unknown;
  description?: unknown;
  source?: unknown;
  sourceUrl?: unknown;
  author?: unknown;
  publishedAt?: unknown;
  date?: unknown;
  tags?: unknown;
  status?: unknown;
  content?: unknown;
}

export async function POST(req: Request) {
  const token = process.env.INSIGHTS_POST_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "INSIGHTS_POST_TOKEN is not configured" }, { status: 503 });
  }

  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_CONTENT_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let payload: InsightPostPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const contentInput = toOptionalString(payload.content);
  if (!contentInput) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  if (Buffer.byteLength(contentInput, "utf8") > MAX_CONTENT_BYTES) {
    return NextResponse.json({ error: "content is too large" }, { status: 413 });
  }

  const format: InsightFormat = isInsightFormat(payload.format) ? payload.format : "markdown";
  const parsed = format === "markdown" ? parseInsightFrontmatter(contentInput) : { content: contentInput, metadata: {} };

  const title = toOptionalString(payload.title) ?? parsed.metadata.title;
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const slug = normalizeInsightSlug(toOptionalString(payload.slug) ?? title);
  if (!slug) {
    return NextResponse.json({ error: "slug is invalid" }, { status: 400 });
  }

  const externalId = toOptionalString(payload.externalId);
  const publishedAt = parseDate(toOptionalString(payload.publishedAt) ?? toOptionalString(payload.date) ?? parsed.metadata.date);
  const status = toOptionalString(payload.status) ?? "published";
  if (!VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: "status is invalid" }, { status: 400 });
  }

  const tags = normalizeTags(payload.tags, parsed.metadata.tags);
  const frontmatterSource = parsed.metadata.source;
  const frontmatterSourceIsUrl = isHttpUrl(frontmatterSource);

  const data = {
    slug,
    title,
    description: toOptionalString(payload.description) ?? parsed.metadata.description ?? null,
    source: toOptionalString(payload.source) ?? (frontmatterSourceIsUrl ? null : frontmatterSource ?? null),
    sourceUrl: toOptionalString(payload.sourceUrl) ?? parsed.metadata.sourceUrl ?? (frontmatterSourceIsUrl ? frontmatterSource : null),
    author: toOptionalString(payload.author) ?? parsed.metadata.author ?? null,
    publishedAt,
    tags,
    format,
    contentRaw: parsed.content,
    contentHtml: null,
    status,
    externalId: externalId ?? null,
  };

  let post;
  try {
    post = await prisma.insightPost.upsert({
      where: externalId ? { externalId } : { slug },
      create: data,
      update: data,
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        updatedAt: true,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021") {
      return NextResponse.json(
        { error: "InsightPost table does not exist. Run prisma migrate deploy first." },
        { status: 503 },
      );
    }
    throw err;
  }

  return NextResponse.json({ post });
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeTags(value: unknown, fallback: string[] | undefined): string[] {
  const source = Array.isArray(value) ? value : fallback ?? [];
  return Array.from(
    new Set(
      source
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 16),
    ),
  );
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isHttpUrl(value: string | undefined): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

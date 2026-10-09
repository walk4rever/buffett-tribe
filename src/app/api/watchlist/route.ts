import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { normalizeTicker } from "@/lib/ticker";
import { getCompanyByTicker, formatCompanyUrl } from "@/lib/company-data";
import { NO_STORE_HEADERS } from "@/lib/http-cache";

export interface WatchlistCompanyDto {
  id: string;
  entityId: string;
  ticker: string;
  companyName: string;
  url: string | null;
  createdAt: string;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "需要登录" }, { status: 401 });
  }

  const items = await prisma.watchlistCompany.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      entity: {
        select: {
          id: true,
          ticker: true,
          canonicalName: true,
          cik: true,
          market: true,
          code: true,
          metadata: true,
        },
      },
    },
  });

  const dtoList: WatchlistCompanyDto[] = items.map((item) => {
    let resolvedName = item.companyName;
    if (!resolvedName && item.entity) {
      if (item.entity.metadata && typeof item.entity.metadata === "object") {
        const meta = item.entity.metadata as Record<string, unknown>;
        if (typeof meta.nameZh === "string" && meta.nameZh.trim()) {
          resolvedName = meta.nameZh.trim();
        }
      }
      if (!resolvedName) {
        resolvedName = item.entity.canonicalName;
      }
    }

    const resolvedTicker = item.ticker || item.entity?.ticker || "";
    const canonicalUrl = item.entity ? formatCompanyUrl(item.entity) : null;

    return {
      id: item.id,
      entityId: item.entityId,
      ticker: resolvedTicker,
      companyName: resolvedName || resolvedTicker,
      url: canonicalUrl,
      createdAt: item.createdAt.toISOString(),
    };
  });

  return NextResponse.json({ items: dtoList }, { headers: NO_STORE_HEADERS });
}

const postBodySchema = z.object({
  entityId: z.string().optional(),
  ticker: z.string().optional(),
  companyName: z.string().optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "需要登录" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = postBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
  }

  let entityId = parsed.data.entityId?.trim();
  const ticker = parsed.data.ticker ? normalizeTicker(parsed.data.ticker.trim()) || parsed.data.ticker.trim().toUpperCase() : undefined;
  let companyName = parsed.data.companyName?.trim();

  // If no entityId, resolve by ticker
  if (!entityId && ticker) {
    const comp = await getCompanyByTicker(ticker).catch(() => null);
    if (comp) {
      entityId = comp.id;
      if (!companyName) companyName = comp.canonicalName;
    }
  }

  if (!entityId) {
    return NextResponse.json({ error: "无法识别对应的公司实体" }, { status: 400 });
  }

  // Ensure entity exists in database
  const entity = await prisma.entity.findUnique({
    where: { id: entityId },
    select: { id: true, ticker: true, canonicalName: true },
  });

  if (!entity) {
    return NextResponse.json({ error: "未找到该公司实体" }, { status: 404 });
  }

  const resolvedTicker = ticker || entity.ticker || "";
  const resolvedName = companyName || entity.canonicalName;

  const item = await prisma.watchlistCompany.upsert({
    where: {
      userId_entityId: {
        userId: session.user.id,
        entityId: entity.id,
      },
    },
    create: {
      userId: session.user.id,
      entityId: entity.id,
      ticker: resolvedTicker,
      companyName: resolvedName,
    },
    update: {
      ticker: resolvedTicker || undefined,
      companyName: resolvedName || undefined,
    },
  });

  return NextResponse.json(
    {
      item: {
        id: item.id,
        entityId: item.entityId,
        ticker: item.ticker || resolvedTicker,
        companyName: item.companyName || resolvedName,
        createdAt: item.createdAt.toISOString(),
      },
      isWatched: true,
    },
    { headers: NO_STORE_HEADERS }
  );
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "需要登录" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  let entityId = searchParams.get("entityId")?.trim();
  const rawTicker = searchParams.get("ticker");

  if (!entityId && rawTicker) {
    const norm = normalizeTicker(rawTicker) || rawTicker.toUpperCase();
    const comp = await getCompanyByTicker(norm).catch(() => null);
    if (comp) {
      entityId = comp.id;
    }
  }

  if (entityId) {
    await prisma.watchlistCompany.deleteMany({
      where: {
        userId: session.user.id,
        entityId,
      },
    });
  } else if (rawTicker) {
    const norm = normalizeTicker(rawTicker) || rawTicker.toUpperCase();
    await prisma.watchlistCompany.deleteMany({
      where: {
        userId: session.user.id,
        ticker: norm,
      },
    });
  }

  return NextResponse.json({ success: true, isWatched: false }, { headers: NO_STORE_HEADERS });
}

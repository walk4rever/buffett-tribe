import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { normalizeTicker } from "@/lib/ticker";
import { getCompanyByTicker } from "@/lib/company-data";
import { NO_STORE_HEADERS } from "@/lib/http-cache";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ isWatched: false }, { headers: NO_STORE_HEADERS });
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
    const count = await prisma.watchlistCompany.count({
      where: {
        userId: session.user.id,
        entityId,
      },
    });
    return NextResponse.json({ isWatched: count > 0 }, { headers: NO_STORE_HEADERS });
  }

  if (rawTicker) {
    const norm = normalizeTicker(rawTicker) || rawTicker.toUpperCase();
    const count = await prisma.watchlistCompany.count({
      where: {
        userId: session.user.id,
        ticker: norm,
      },
    });
    return NextResponse.json({ isWatched: count > 0 }, { headers: NO_STORE_HEADERS });
  }

  return NextResponse.json({ isWatched: false }, { headers: NO_STORE_HEADERS });
}

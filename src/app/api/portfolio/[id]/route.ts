import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { normalizeTicker, isValidTickerFormat, currencyForTicker } from "@/lib/ticker";
import { getCompanyByTicker } from "@/lib/company-data";
import type { PortfolioHoldingDto } from "@/app/api/portfolio/route";

async function requireOwnedHolding(userId: string, id: string) {
  const holding = await prisma.portfolioHolding.findUnique({ where: { id } });
  if (!holding || holding.userId !== userId) return null;
  return holding;
}

async function serializeHolding(holding: {
  id: string;
  ticker: string;
  shares: unknown;
  costBasis: unknown;
  createdAt: Date;
  updatedAt: Date;
}): Promise<PortfolioHoldingDto> {
  const [latestPrice, company] = await Promise.all([
    prisma.stockPrice.findFirst({
      where: { ticker: holding.ticker },
      orderBy: { date: "desc" },
      select: { close: true, date: true },
    }),
    getCompanyByTicker(holding.ticker).catch(() => null),
  ]);

  return {
    id: holding.id,
    ticker: holding.ticker,
    companyName: company?.canonicalName ?? null,
    currency: currencyForTicker(holding.ticker),
    shares: Number(holding.shares),
    costBasis: Number(holding.costBasis),
    currentPrice: latestPrice ? Number(latestPrice.close) : null,
    priceDate: latestPrice ? latestPrice.date.toISOString().slice(0, 10) : null,
    createdAt: holding.createdAt.toISOString(),
    updatedAt: holding.updatedAt.toISOString(),
  };
}

const patchBodySchema = z.object({
  ticker: z.string().min(1).optional(),
  shares: z.number().positive().optional(),
  costBasis: z.number().nonnegative().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "需要登录" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await requireOwnedHolding(session.user.id, id);
  if (!existing) {
    return NextResponse.json({ error: "持仓不存在" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = patchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }

  let ticker: string | undefined;
  if (parsed.data.ticker !== undefined) {
    ticker = normalizeTicker(parsed.data.ticker) ?? undefined;
    if (!ticker || !isValidTickerFormat(ticker)) {
      return NextResponse.json({ error: "股票代码格式不对" }, { status: 400 });
    }
  }

  const holding = await prisma.portfolioHolding.update({
    where: { id },
    data: {
      ...(ticker !== undefined ? { ticker } : {}),
      ...(parsed.data.shares !== undefined ? { shares: parsed.data.shares } : {}),
      ...(parsed.data.costBasis !== undefined ? { costBasis: parsed.data.costBasis } : {}),
    },
  });

  return NextResponse.json({ holding: await serializeHolding(holding) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "需要登录" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await requireOwnedHolding(session.user.id, id);
  if (!existing) {
    return NextResponse.json({ error: "持仓不存在" }, { status: 404 });
  }

  await prisma.portfolioHolding.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}

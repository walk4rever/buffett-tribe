import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { normalizeTicker, isValidTickerFormat } from "@/lib/ticker";
import { getCompanyByTicker } from "@/lib/company-data";

export interface PortfolioHoldingDto {
  id: string;
  ticker: string;
  companyName: string | null;
  shares: number;
  costBasis: number;
  currentPrice: number | null;
  priceDate: string | null;
  createdAt: string;
  updatedAt: string;
}

async function serializeHoldings(
  holdings: { id: string; ticker: string; shares: unknown; costBasis: unknown; createdAt: Date; updatedAt: Date }[],
): Promise<PortfolioHoldingDto[]> {
  const tickers = [...new Set(holdings.map((h) => h.ticker))];

  const priceByTicker = new Map<string, { close: number; date: Date }>();
  const nameByTicker = new Map<string, string | null>();

  await Promise.all(
    tickers.map(async (ticker) => {
      const [latestPrice, company] = await Promise.all([
        prisma.stockPrice.findFirst({
          where: { ticker },
          orderBy: { date: "desc" },
          select: { close: true, date: true },
        }),
        getCompanyByTicker(ticker).catch(() => null),
      ]);
      if (latestPrice) {
        priceByTicker.set(ticker, { close: Number(latestPrice.close), date: latestPrice.date });
      }
      nameByTicker.set(ticker, company?.canonicalName ?? null);
    }),
  );

  return holdings.map((h) => {
    const price = priceByTicker.get(h.ticker);
    return {
      id: h.id,
      ticker: h.ticker,
      companyName: nameByTicker.get(h.ticker) ?? null,
      shares: Number(h.shares),
      costBasis: Number(h.costBasis),
      currentPrice: price?.close ?? null,
      priceDate: price?.date.toISOString().slice(0, 10) ?? null,
      createdAt: h.createdAt.toISOString(),
      updatedAt: h.updatedAt.toISOString(),
    };
  });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "需要登录" }, { status: 401 });
  }

  const holdings = await prisma.portfolioHolding.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ holdings: await serializeHoldings(holdings) });
}

const postBodySchema = z.object({
  ticker: z.string().min(1),
  shares: z.number().positive(),
  costBasis: z.number().nonnegative(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "需要登录" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = postBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }

  const ticker = normalizeTicker(parsed.data.ticker);
  if (!ticker || !isValidTickerFormat(ticker)) {
    return NextResponse.json({ error: "股票代码格式不对" }, { status: 400 });
  }

  const holding = await prisma.portfolioHolding.create({
    data: {
      userId: session.user.id,
      ticker,
      shares: parsed.data.shares,
      costBasis: parsed.data.costBasis,
    },
  });

  const [dto] = await serializeHoldings([holding]);
  return NextResponse.json({ holding: dto }, { status: 201 });
}

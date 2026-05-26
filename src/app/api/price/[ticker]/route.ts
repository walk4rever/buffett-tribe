import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/prisma";

function parseRange(range: string): { days: number; label: string } {
  switch (range) {
    case "1d":
      return { days: 1, label: "1d" };
    case "1w":
      return { days: 7, label: "1w" };
    case "1m":
      return { days: 30, label: "1m" };
    case "3m":
      return { days: 90, label: "3m" };
    case "6m":
      return { days: 180, label: "6m" };
    case "1y":
      return { days: 365, label: "1y" };
    case "5y":
      return { days: 1825, label: "5y" };
    case "max":
      return { days: 36500, label: "max" };
    default:
      return { days: 365, label: "1y" };
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json({ error: "Ticker is required" }, { status: 400 });
  }

  const { searchParams } = new URL(_req.url);
  const range = searchParams.get("range") ?? "1y";
  const { days, label } = parseRange(range);

  try {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const dbPrices = await db.stockPrice.findMany({
      where: {
        ticker,
        ...(range !== "max" ? { date: { gte: cutoff } } : {}),
      },
      orderBy: { date: "asc" },
      select: {
        date: true,
        open: true,
        high: true,
        low: true,
        close: true,
        volume: true,
        adjustedClose: true,
      },
      ...(range !== "max" ? { take: 2000 } : {}),
    });

    if (dbPrices.length === 0) {
      return NextResponse.json(
        { error: "暂无价格数据，请先用脚本同步" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ticker,
      range: label,
      source: "db",
      count: dbPrices.length,
      data: dbPrices.map((p) => ({
        time: p.date.toISOString().slice(0, 10),
        open: p.open != null ? Number(p.open) : null,
        high: p.high != null ? Number(p.high) : null,
        low: p.low != null ? Number(p.low) : null,
        close: Number(p.close),
        volume: p.volume != null ? Number(p.volume) : null,
        adjustedClose: p.adjustedClose != null ? Number(p.adjustedClose) : null,
      })),
    });
  } catch (err) {
    console.error("Price API error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "查询失败" },
      { status: 500 }
    );
  }
}

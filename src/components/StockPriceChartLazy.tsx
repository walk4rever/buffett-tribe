"use client";

import dynamic from "next/dynamic";

const StockPriceChart = dynamic(
  () => import("./StockPriceChart").then((m) => m.StockPriceChart),
  {
    ssr: false,
    loading: () => <div className="stock-price-placeholder">加载价格数据…</div>,
  }
);

export function StockPriceChartLazy({ tickers }: { tickers: string[] }) {
  return <StockPriceChart tickers={tickers} />;
}

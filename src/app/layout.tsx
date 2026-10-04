import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import ErrorBoundary from "@/components/ErrorBoundary";
import { BRAND_FULL } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: BRAND_FULL,
  description: "追踪顶级价值投资人的信件与持仓 — 他们说了什么，他们怎么做的。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <Providers>
          <ErrorBoundary>
            <div className="app-shell">
            <main className="site-main">
              {children}
            </main>
            </div>
          </ErrorBoundary>
        </Providers>
      </body>
    </html>
  );
}

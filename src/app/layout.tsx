import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import ErrorBoundary from "@/components/ErrorBoundary";
import { BRAND_FULL, BRAND_ZH } from "@/lib/brand";
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
            <footer className="site-footer">
              <p className="site-footer-text">
                买股票就是买公司。{BRAND_ZH}用投资大师的框架帮你理解一家公司，不构成任何投资建议。
              </p>
            </footer>
            </div>
          </ErrorBoundary>
        </Providers>
      </body>
    </html>
  );
}

"use client";

import Link from "next/link";

interface Props {
  backHref?: string;
  dvlHref?: string;
  children: React.ReactNode;
}

export function CompanyViewContainer({
  backHref = "/company",
  dvlHref,
  children,
}: Props) {
  return (
    <div className="company-view-wrapper">
      {/* ── Top Bar ── */}
      <nav className="company-top-nav-bar company-view-bar" aria-label="公司页面导航">
        <Link href={backHref} className="company-back-link">
          ← 公司
        </Link>

        {dvlHref ? (
          <Link href={dvlHref} className="company-dvl-link" title="体验基于数字价值线卡片的一体化新版页面">
            体验 DVL 新版 ↗
          </Link>
        ) : null}
      </nav>

      <div className="company-classic-view-container">{children}</div>
    </div>
  );
}


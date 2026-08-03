import Link from "next/link";
import { formatCompanyUrl } from "@/lib/company-data";
import { SiteNav } from "@/components/SiteNav";
import { HeroSearch } from "@/components/HeroSearch";
import { getLatestHomeSignalCards } from "@/lib/home-signals";

export const dynamic = "force-dynamic";

export default async function Home() {
  const signals = await getLatestHomeSignalCards();

  return (
    <div className="home-v2">
      <SiteNav />

      {/* Signals */}
      <section className="home-signals">
        <div className="home-signals-in">
          {signals.map((s) => (
            <div key={s.ticker} className={`home-sig home-sig--${s.type}`}>
              <span className="home-sig-tag">{s.tag}</span>
              <Link href={formatCompanyUrl({ cik: s.cik }) ?? "#"} className="home-sig-ticker">
                {s.tickerLabel}
              </Link>
              <div className="home-sig-company">{s.company}</div>
              <div className="home-sig-body">{s.body}</div>
              <div className="home-sig-chips">
                {s.chips.map((c) => (
                  <span key={c.label} className="home-sig-chip" style={c.style}>
                    {c.label}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Hero search */}
      <section className="home-hero">
        <Link href="/agent" className="home-hero-hitbox" aria-label="进入对话研究室" />
        <h1 className="home-hero-brand">买股票就是买公司</h1>
        <p className="home-hero-sub home-hero-sub--compact">
          用大师的框架，看懂一家公司
        </p>
        <HeroSearch />
      </section>
    </div>
  );
}

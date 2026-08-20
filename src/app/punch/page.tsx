import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { getPunches } from "@/lib/punch";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "打孔 — 巴菲特部落",
  description: "大师做过的、被证明是真正 big bet 的重仓判断——精选出来，面向未来，持续验证。",
};

const STATUS_LABEL: Record<string, string> = {
  active: "进行中",
  exited: "已平仓",
  thesis_broken: "逻辑被推翻",
};

export default async function PunchWallPage() {
  const punches = await getPunches();

  return (
    <div className="home-v2 punch-page">
      <SiteNav />
      <main className="punch-shell">
        <header className="punch-head">
          <h1>打孔</h1>
          <p className="punch-lede">投资就是打孔——真正的致富，一辈子 20 个孔就够了！</p>
          <blockquote className="punch-quote">
            <p className="punch-quote-en">
              &ldquo;&hellip;if you had a punch card with only 20 punches, and you weren&rsquo;t
              going to get another one the rest of your life, you would think a long time before
              every investment decision &ndash; and you would make good ones and you&rsquo;d make
              big ones.&rdquo;
            </p>
            <p className="punch-quote-zh">
              如果你手里有一张只有 20 个孔的打卡卡，这辈子不会再有下一张，你会在每一次投资决策前想很久——然后你做出的决策会又好又重大。
            </p>
            <cite>—— 沃伦·巴菲特，佐治亚大学特里商学院演讲问答，2001 年 7 月 18 日</cite>
          </blockquote>
        </header>

        {punches.length === 0 ? (
          <div className="punch-empty">暂无打孔</div>
        ) : (
          <section className="punch-wall" aria-label="打孔墙">
            {punches.map((p) => (
              <Link key={p.slug} href={`/punch/${p.slug}`} className="punch-card">
                <div className="punch-card-top">
                  {p.masterInitials && (
                    <span className="punch-avatar" style={{ background: p.masterColor ?? undefined }}>
                      {p.masterInitials.slice(0, 2)}
                    </span>
                  )}
                  <div className="punch-card-who">
                    <span className="punch-card-master">{p.masterName ?? "未知投资人"}</span>
                    <span className="punch-card-arrow">→</span>
                    <span className="punch-card-company">
                      {p.companyName ?? "未知公司"}
                      {p.companyTicker ? ` (${p.companyTicker})` : ""}
                    </span>
                  </div>
                </div>
                <h2 className="punch-card-headline">{p.headline}</h2>
                {p.entrySummary && <p className="punch-card-entry">{p.entrySummary}</p>}
                <div className="punch-card-footer">
                  {p.punchYear && <span className="punch-year">{p.punchYear}年</span>}
                  <span className={`punch-status punch-status--${p.status}`}>
                    {STATUS_LABEL[p.status] ?? p.status}
                  </span>
                </div>
              </Link>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}

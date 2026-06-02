import prisma from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { LetterReadingArea } from "@/components/LetterReadingArea";
import { SiteNav } from "@/components/SiteNav";

export const revalidate = 3600; // cache 1 hour — letter content is immutable

interface LetterPageProps {
  params: Promise<{ type: string; year: string }>;
}

const TYPE_LABELS: Record<string, { title: string; subtitle: string }> = {
  shareholder: { title: "致股东信", subtitle: "Letters to Shareholders" },
  partnership: { title: "致合伙人信", subtitle: "Letters to Partners" },
  annual_meeting: { title: "股东大会", subtitle: "Annual Meetings" },
};

export default async function LetterPage({ params }: LetterPageProps) {
  const { type, year: yearParam } = await params;
  const year = parseInt(yearParam, 10);

  const validTypes = ["shareholder", "partnership", "annual_meeting"];
  if (isNaN(year) || !validTypes.includes(type)) {
    notFound();
  }

  // Fetch all years for this type (sidebar navigation)
  const allSources = await prisma.source.findMany({
    where: { type },
    orderBy: { year: "desc" },
    select: { year: true },
  });
  const yearList = Array.from(new Set(allSources.map((s) => s.year))).sort((a, b) => b - a);

  const typeLabel = TYPE_LABELS[type] ?? { title: type, subtitle: "" };

  if (type === "partnership") {
    const letters = await prisma.source.findMany({
      where: { year, type: "partnership" },
      orderBy: { date: "asc" },
      select: { year: true, date: true, title: true, contentMd: true },
    });

    if (letters.length === 0) notFound();

    const combinedMd = letters
      .map((l) => l.contentMd ?? "")
      .filter(Boolean)
      .join("\n\n---\n\n");

    return (
      <div className="letter-page letter-page--v2">
        <SiteNav />
        <div className="letter-reader-shell">
          <aside className="letter-sidebar">
            <div className="letter-sidebar-header">
              <span className="letter-sidebar-title">{typeLabel.title}</span>
              <span className="letter-sidebar-subtitle">{typeLabel.subtitle}</span>
            </div>
            <div className="letter-sidebar-years">
              {yearList.map((y) => (
                <Link
                  key={y}
                  href={`/letters/${type}/${y}`}
                  className={`letter-sidebar-year${y === year ? " letter-sidebar-year--active" : ""}`}
                >
                  {y}
                </Link>
              ))}
            </div>
          </aside>
          <div className="letter-reader-main">
            <LetterReadingArea
              year={year}
              contentMd={combinedMd}
              sourceType="partnership"
            />
          </div>
        </div>
      </div>
    );
  }

  const source = await prisma.source.findFirst({
    where: { year, type },
    select: { year: true, contentMd: true },
  });

  if (!source || !source.contentMd) notFound();

  return (
    <div className="letter-page letter-page--v2">
      <SiteNav />
      <div className="letter-reader-shell">
        <aside className="letter-sidebar">
          <div className="letter-sidebar-header">
            <span className="letter-sidebar-title">{typeLabel.title}</span>
            <span className="letter-sidebar-subtitle">{typeLabel.subtitle}</span>
          </div>
          <div className="letter-sidebar-years">
            {yearList.map((y) => (
              <Link
                key={y}
                href={`/letters/${type}/${y}`}
                className={`letter-sidebar-year${y === year ? " letter-sidebar-year--active" : ""}`}
              >
                {y}
              </Link>
            ))}
          </div>
        </aside>
        <div className="letter-reader-main">
          <LetterReadingArea
            year={source.year}
            contentMd={source.contentMd}
            sourceType={type}
          />
        </div>
      </div>
    </div>
  );
}

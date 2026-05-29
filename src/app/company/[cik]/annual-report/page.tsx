import { notFound, redirect } from "next/navigation";
import { formatCompanyCikSlug, getCompanyAnnualFiling, getCompanyByCik } from "@/lib/company-data";

interface Props {
  params: Promise<{ cik: string }>;
}

export default async function AnnualReportIndexPage({ params }: Props) {
  const { cik: rawCik } = await params;
  const canonicalSlug = formatCompanyCikSlug(rawCik.trim());
  if (!canonicalSlug) notFound();
  if (rawCik.trim() !== canonicalSlug) redirect(`/company/${canonicalSlug}/annual-report`);

  const company = await getCompanyByCik(canonicalSlug);
  if (!company) notFound();

  const latest = await getCompanyAnnualFiling(company.id);
  if (!latest?.periodYear) notFound();

  redirect(`/company/${canonicalSlug}/annual-report/${latest.periodYear}`);
}

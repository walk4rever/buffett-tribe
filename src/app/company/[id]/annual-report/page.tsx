import { notFound, redirect } from "next/navigation";
import { formatCompanyUrl, getCompanyAnnualFiling, getCompanyByIdentifier, parseCompanyIdentifier } from "@/lib/company-data";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function AnnualReportIndexPage({ params }: Props) {
  const { id: rawId } = await params;
  const trimmedId = rawId.trim();
  const parsed = parseCompanyIdentifier(trimmedId);
  if (!parsed) notFound();

  const canonicalUrl = formatCompanyUrl(parsed);
  if (!canonicalUrl) notFound();
  if (`/company/${trimmedId}` !== canonicalUrl) redirect(`${canonicalUrl}/annual-report`);

  const company = await getCompanyByIdentifier(trimmedId);
  if (!company) notFound();

  const latest = await getCompanyAnnualFiling(company.id);
  if (!latest?.periodYear) notFound();

  redirect(`${canonicalUrl}/annual-report/${latest.periodYear}`);
}

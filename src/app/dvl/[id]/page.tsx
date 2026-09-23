import { redirect } from "next/navigation";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function DvlRedirectPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") {
      search.set(key, value);
    } else if (Array.isArray(value)) {
      for (const v of value) search.append(key, v);
    }
  }
  const qs = search.toString();
  redirect(`/company/${id}${qs ? `?${qs}` : ""}`);
}

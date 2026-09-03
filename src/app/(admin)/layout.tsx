import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin-auth";
import { AdminShell } from "@/components/admin/AdminShell";

/** Every page under (admin)/ shares this one gate instead of repeating it —
 *  a new admin page just needs a page.tsx. Not logged in → /login (same
 *  callbackUrl idiom as /agent and /punch). Logged in but not admin → /dashboard,
 *  not /login — the user already has a session, bouncing them to a login form
 *  they don't need is confusing. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const result = await getAdminSession();
  if (result.status === "unauthenticated") {
    redirect("/login?callbackUrl=%2Fadmin");
  }
  if (result.status === "forbidden") {
    redirect("/dashboard");
  }

  return <AdminShell>{children}</AdminShell>;
}

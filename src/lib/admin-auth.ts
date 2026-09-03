import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import type { Session } from "next-auth";

export type AdminSessionResult =
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "ok"; session: Session };

/** `role` is deliberately not stored in the NextAuth session/JWT (auth.ts has
 *  no `jwt()` callback) — a role change takes effect on the very next request
 *  instead of waiting for the session to refresh. `(admin)/layout.tsx` and
 *  every `/api/admin/*` route go through this one function so the role check
 *  only lives in one place. */
export async function getAdminSession(): Promise<AdminSessionResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { status: "unauthenticated" };

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (user?.role !== "admin") return { status: "forbidden" };

  return { status: "ok", session };
}

/** Convenience wrapper for `/api/admin/*` routes that only need a yes/no. */
export async function requireAdminSession(): Promise<Session | null> {
  const result = await getAdminSession();
  return result.status === "ok" ? result.session : null;
}

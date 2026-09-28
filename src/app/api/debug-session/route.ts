import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { cookies } from "next/headers";

export async function GET() {
  const session = await getServerSession(authOptions);
  const cookieStore = await cookies();
  const allCookies = cookieStore.getAll();

  return NextResponse.json({
    hasSession: !!session,
    userId: session?.user?.id || null,
    userEmail: session?.user?.email || null,
    cookies: allCookies.map(c => ({ name: c.name, value: c.value.slice(0, 20) + '...' })),
  });
}

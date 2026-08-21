"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const REOPEN_PARAM = "openAgent";

/**
 * Gates an "AI 解读" trigger behind login. `requireAuth()` returns true when
 * the user is signed in; otherwise it redirects to /login (preserving the
 * current URL as callbackUrl, plus a marker to reopen the panel) and returns
 * false so the caller skips opening. After login redirects back, the marker
 * fires `onReopen` once and is stripped from the URL.
 */
export function useAgentGate(onReopen: () => void) {
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const consumedRef = useRef(false);

  useEffect(() => {
    if (status !== "authenticated" || consumedRef.current) return;
    if (searchParams.get(REOPEN_PARAM) !== "1") return;
    consumedRef.current = true;
    onReopen();
    const params = new URLSearchParams(searchParams);
    params.delete(REOPEN_PARAM);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // onReopen/router/pathname intentionally excluded — this should only
    // re-run when auth status or the URL's query params change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, searchParams]);

  function requireAuth(): boolean {
    if (status === "authenticated") return true;
    if (status === "loading") return false;
    const params = new URLSearchParams(searchParams);
    params.set(REOPEN_PARAM, "1");
    const target = `${pathname}?${params.toString()}`;
    router.push(`/login?callbackUrl=${encodeURIComponent(target)}`);
    return false;
  }

  return { requireAuth };
}

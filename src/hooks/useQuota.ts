"use client";

import { useEffect, useState } from "react";

export interface Quota {
  balance: number;
  period: string;
  monthlyLimit: number;
}

export function useQuota() {
  const [quota, setQuota] = useState<Quota | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/quota", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Quota | null) => {
        if (data) setQuota(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { quota, loading };
}

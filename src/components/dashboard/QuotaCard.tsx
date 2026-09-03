"use client";

import { useQuota } from "@/hooks/useQuota";

export function QuotaCard() {
  const { quota, loading } = useQuota();

  return (
    <section className="dashboard-card">
      <h2>本月额度</h2>
      {loading ? (
        <p className="dashboard-card-loading">加载中…</p>
      ) : quota ? (
        <>
          <p className="dashboard-quota-balance">
            {quota.balance} <span>/ {quota.monthlyLimit}</span>
          </p>
          <p className="dashboard-quota-note">
            {quota.balance > 0 ? "下月自动重置" : "本月额度已用完，下月重置"}
          </p>
        </>
      ) : (
        <p className="dashboard-card-loading">额度信息加载失败</p>
      )}
    </section>
  );
}

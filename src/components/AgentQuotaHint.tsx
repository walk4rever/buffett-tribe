"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

interface QuotaInfo {
  type: "user" | "guest";
  remaining?: number;
  balance?: number;
  used?: number;
  limit: number;
  period: "monthly" | "daily";
  allowed?: boolean;
}

export function AgentQuotaHint() {
  const { data: session, status } = useSession();
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchQuota = () => {
    fetch("/api/quota")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: QuotaInfo | null) => {
        setQuota(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    if (status === "loading") return;
    fetchQuota();
  }, [status, session]);

  // 监听自定义事件，每次发送消息后刷新配额
  useEffect(() => {
    const handleQuotaUpdate = () => fetchQuota();
    window.addEventListener("quota-update", handleQuotaUpdate);
    return () => window.removeEventListener("quota-update", handleQuotaUpdate);
  }, []);

  if (loading || !quota) return null;

  // 已登录用户
  if (quota.type === "user") {
    if (quota.balance === undefined) return null;

    // 余额充足，不显示提示
    if (quota.balance > 50) return null;

    // 余额不足，显示警告
    return (
      <div className="agent-quota-hint agent-quota-hint--warning">
        <span>本月剩余 {quota.balance} 次对话额度</span>
      </div>
    );
  }

  // 未登录用户（访客）
  if (quota.type === "guest") {
    const remaining = quota.remaining ?? 0;

    return (
      <div className="agent-quota-hint agent-quota-hint--guest">
        <span>今日试用：剩余 {remaining}/{quota.limit} 次</span>
        <Link href="/login" className="agent-quota-hint-link">
          登录解锁 1000 次/月 →
        </Link>
      </div>
    );
  }

  return null;
}

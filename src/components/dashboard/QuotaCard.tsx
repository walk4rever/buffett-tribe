"use client";

import Link from "next/link";
import { ArrowUpRight, Zap } from "lucide-react";
import { useQuota } from "@/hooks/useQuota";

export function QuotaCard() {
  const { quota, loading } = useQuota();

  if (loading) {
    return (
      <section className="dashboard-card dashboard-quota-card">
        <div className="dashboard-card-header">
          <div className="dashboard-card-title-wrap">
            <span className="dashboard-card-icon"><Zap size={16} /></span>
            <h2>AI 投研额度</h2>
          </div>
        </div>
        <div className="dashboard-card-loading">
          <div className="dashboard-skeleton dashboard-skeleton-text" />
          <div className="dashboard-skeleton dashboard-skeleton-bar" />
        </div>
      </section>
    );
  }

  if (!quota) {
    return (
      <section className="dashboard-card dashboard-quota-card">
        <div className="dashboard-card-header">
          <div className="dashboard-card-title-wrap">
            <span className="dashboard-card-icon"><Zap size={16} /></span>
            <h2>AI 投研额度</h2>
          </div>
        </div>
        <p className="dashboard-card-error">额度信息加载失败，请刷新页面重试</p>
      </section>
    );
  }

  const limit = quota.monthlyLimit || 1000;
  const balance = quota.balance;
  const used = Math.max(0, limit - balance);
  const remainingPercent = Math.max(0, Math.min(100, Math.round((balance / limit) * 100)));

  return (
    <section className="dashboard-card dashboard-quota-card">
      <div className="dashboard-card-header">
        <div className="dashboard-card-title-wrap">
          <span className="dashboard-card-icon"><Zap size={16} /></span>
          <h2>AI 投研额度</h2>
        </div>
        <span className="dashboard-badge dashboard-badge--blue">当前账期: {quota.period}</span>
      </div>

      <div className="dashboard-quota-main">
        <div className="dashboard-quota-balance-row">
          <div>
            <span className="dashboard-quota-number">{balance.toLocaleString()}</span>
            <span className="dashboard-quota-unit"> 点可用</span>
          </div>
          <div className="dashboard-quota-sub">
            上限 {limit.toLocaleString()} 点
          </div>
        </div>

        <div className="dashboard-progress-track" title={`已用 ${used} 点 (${100 - remainingPercent}%)`}>
          <div
            className={`dashboard-progress-fill ${
              balance === 0
                ? "dashboard-progress-fill--empty"
                : remainingPercent <= 15
                ? "dashboard-progress-fill--warn"
                : ""
            }`}
            style={{ width: `${remainingPercent}%` }}
          />
        </div>

        <div className="dashboard-quota-footer">
          <p className="dashboard-quota-note">
            {balance > 0
              ? `已用 ${used} 点 · 每月 1 日重置为 1,000 点`
              : "本月额度已用完 · 下月 1 日自动重置"}
          </p>
          <Link href="/agent" className="dashboard-quota-cta">
            <span>发起投研</span>
            <ArrowUpRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}

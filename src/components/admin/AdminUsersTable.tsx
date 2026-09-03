"use client";

import { useState, useMemo } from "react";
import { Search, ChevronLeft, ChevronRight, Check, X, Shield } from "lucide-react";
import { useRouter } from "next/navigation";

export interface UserRow {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
  createdAt: string;
  balance: number;
}

const PRESET_ADJUSTS = [100, 500, 1000, -50, -100];
const PAGE_SIZE = 15;

export function AdminUsersTable({ initialUsers }: { initialUsers: UserRow[] }) {
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[]>(initialUsers);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "user">("all");
  const [page, setPage] = useState(1);

  // Modal state
  const [activeUser, setActiveUser] = useState<UserRow | null>(null);
  const [amount, setAmount] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [adjustSuccess, setAdjustSuccess] = useState(false);

  // Filtered list
  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (!q) return true;
      const emailMatch = u.email?.toLowerCase().includes(q);
      const nameMatch = u.name?.toLowerCase().includes(q);
      const idMatch = u.id.toLowerCase().includes(q);
      return emailMatch || nameMatch || idMatch;
    });
  }, [users, search, roleFilter]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedUsers = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredUsers.slice(start, start + PAGE_SIZE);
  }, [filteredUsers, currentPage]);

  const openAdjustModal = (user: UserRow) => {
    setActiveUser(user);
    setAmount("");
    setAdjustError(null);
    setAdjustSuccess(false);
  };

  const closeAdjustModal = () => {
    setActiveUser(null);
    setAmount("");
    setAdjustError(null);
    setAdjustSuccess(false);
  };

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeUser) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value === 0) {
      setAdjustError("请输入非零整数额度（正数增加，负数扣除）");
      return;
    }

    setSubmitting(true);
    setAdjustError(null);
    const delta = Math.trunc(value);

    try {
      const res = await fetch(`/api/admin/users/${activeUser.id}/adjust-credits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: delta }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setAdjustError(body?.error ?? "额度调整失败");
        setSubmitting(false);
        return;
      }

      // Update local state balance immediately
      setUsers((prev) =>
        prev.map((u) =>
          u.id === activeUser.id ? { ...u, balance: u.balance + delta } : u
        )
      );

      setAdjustSuccess(true);
      setTimeout(() => {
        closeAdjustModal();
        router.refresh();
      }, 1000);
    } catch {
      setAdjustError("网络请求超时，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="admin-users-view">
      {/* Search & Filter Toolbar */}
      <div className="admin-toolbar">
        <div className="admin-search-box">
          <Search size={15} className="admin-search-icon" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="搜索邮箱、昵称或用户 ID…"
            className="admin-search-input"
          />
          {search && (
            <button
              onClick={() => {
                setSearch("");
                setPage(1);
              }}
              className="admin-search-clear"
              title="清除搜索"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <div className="admin-filter-group">
          <div className="admin-segmented-control">
            <button
              type="button"
              className={`admin-segment-btn ${roleFilter === "all" ? "admin-segment-btn--active" : ""}`}
              onClick={() => {
                setRoleFilter("all");
                setPage(1);
              }}
            >
              全部 ({users.length})
            </button>
            <button
              type="button"
              className={`admin-segment-btn ${roleFilter === "user" ? "admin-segment-btn--active" : ""}`}
              onClick={() => {
                setRoleFilter("user");
                setPage(1);
              }}
            >
              普通用户
            </button>
            <button
              type="button"
              className={`admin-segment-btn ${roleFilter === "admin" ? "admin-segment-btn--active" : ""}`}
              onClick={() => {
                setRoleFilter("admin");
                setPage(1);
              }}
            >
              管理员
            </button>
          </div>
        </div>
      </div>

      {/* Users Table Card */}
      <div className="admin-table-card">
        <div className="admin-table-container">
          <table className="admin-users-table">
            <thead>
              <tr>
                <th style={{ width: "38%" }}>用户</th>
                <th style={{ width: "16%" }}>角色</th>
                <th style={{ width: "18%" }}>注册时间</th>
                <th style={{ width: "14%", textAlign: "right" }}>本月余额</th>
                <th style={{ width: "14%", textAlign: "center" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {pagedUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="admin-table-empty">
                    未找到匹配的用户数据
                  </td>
                </tr>
              ) : (
                pagedUsers.map((user) => {
                  const initial = (user.name || user.email || "U").slice(0, 1).toUpperCase();
                  const dateStr = user.createdAt
                    ? new Intl.DateTimeFormat("zh-CN", {
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                      }).format(new Date(user.createdAt))
                    : "—";

                  return (
                    <tr key={user.id}>
                      <td>
                        <div className="admin-table-user-cell">
                          <div className="admin-table-avatar">{initial}</div>
                          <div className="admin-table-user-meta">
                            <span className="admin-table-email" title={user.email ?? ""}>
                              {user.email ?? "—"}
                            </span>
                            {user.name && (
                              <span className="admin-table-nickname">{user.name}</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        {user.role === "admin" ? (
                          <span className="admin-badge admin-badge--admin">
                            <Shield size={11} /> Admin
                          </span>
                        ) : (
                          <span className="admin-badge admin-badge--user">User</span>
                        )}
                      </td>
                      <td>
                        <span className="admin-table-date">{dateStr}</span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <span
                          className={`admin-table-balance ${
                            user.balance === 0
                              ? "admin-table-balance--zero"
                              : "admin-table-balance--active"
                          }`}
                        >
                          {user.balance.toLocaleString()}
                        </span>
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <button
                          type="button"
                          onClick={() => openAdjustModal(user)}
                          className="admin-action-btn"
                        >
                          调整额度
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {filteredUsers.length > PAGE_SIZE && (
          <div className="admin-pagination">
            <span className="admin-pagination-info">
              共 {filteredUsers.length} 位用户 · 第 {currentPage} / {totalPages} 页
            </span>
            <div className="admin-pagination-btns">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="admin-pagination-btn"
                title="上一页"
              >
                <ChevronLeft size={16} />
                <span>上一页</span>
              </button>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="admin-pagination-btn"
                title="下一页"
              >
                <span>下一页</span>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Credit Adjustment Modal */}
      {activeUser && (
        <div className="admin-modal-backdrop" onClick={closeAdjustModal}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <div>
                <h3 className="admin-modal-title">调整用户额度</h3>
                <p className="admin-modal-sub">
                  为 {activeUser.email ?? activeUser.name ?? activeUser.id} 增加或扣减可用额度
                </p>
              </div>
              <button
                type="button"
                onClick={closeAdjustModal}
                className="admin-modal-close"
                title="关闭"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAdjustSubmit} className="admin-modal-body">
              {/* Current balance card */}
              <div className="admin-modal-stat-box">
                <span className="admin-modal-stat-label">当前本月余额</span>
                <span className="admin-modal-stat-val">
                  {activeUser.balance.toLocaleString()} 点
                </span>
              </div>

              {/* Presets */}
              <div className="admin-modal-presets">
                <span className="admin-modal-preset-label">快捷增减:</span>
                <div className="admin-modal-preset-tags">
                  {PRESET_ADJUSTS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className="admin-preset-tag"
                      onClick={() => setAmount(String(preset))}
                    >
                      {preset > 0 ? `+${preset}` : preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount input */}
              <div className="admin-modal-field">
                <label className="admin-label">调整数值 (正数增加，负数扣减)</label>
                <input
                  type="number"
                  placeholder="例如: 500 或 -100"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  autoFocus
                  required
                  className="admin-input"
                />
              </div>

              {/* Preview preview */}
              {amount && !Number.isNaN(Number(amount)) && Number(amount) !== 0 && (
                <div className="admin-modal-preview">
                  调整后预计余额:{" "}
                  <strong>{(activeUser.balance + Math.trunc(Number(amount))).toLocaleString()}</strong> 点
                </div>
              )}

              {adjustError && (
                <div className="admin-modal-alert admin-modal-alert--error">{adjustError}</div>
              )}
              {adjustSuccess && (
                <div className="admin-modal-alert admin-modal-alert--success">
                  <Check size={14} /> 额度调整成功！
                </div>
              )}

              <div className="admin-modal-actions">
                <button
                  type="button"
                  onClick={closeAdjustModal}
                  className="admin-btn-ghost"
                  disabled={submitting}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="admin-btn-primary"
                >
                  {submitting ? "提交中…" : "确认调整"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

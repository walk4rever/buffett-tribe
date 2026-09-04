"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import {
  Send,
  Mail,
  CheckCircle2,
  AlertTriangle,
  Search,
  RotateCcw,
  Loader2,
  X,
  History,
  FileText,
  Clock,
  Eye,
  ArrowLeft,
  ArrowRight,
  Edit3,
  Inbox,
  Plus,
  Trash2,
  Check,
  Image as ImageIcon,
} from "lucide-react";
import { buildFullEmailHtml } from "@/lib/email-template";
import { fileToImageAttachment, isSupportedImageFile } from "@/lib/downscale-image";

export interface RecipientUserOption {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
}

export interface AnnouncementHistoryItem {
  id: string;
  subject: string;
  preheader: string | null;
  contentMarkdown: string;
  recipientMode: string;
  recipientsCount: number;
  successCount: number;
  failedCount: number;
  status: string;
  errorSummary: string | null;
  createdAt: string;
  updatedAt?: string;
  sentAt: string | null;
}

interface Props {
  initialUsers: RecipientUserOption[];
  initialHistory: AnnouncementHistoryItem[];
  adminEmail: string;
}

export function AdminAnnouncementsManager({
  initialUsers,
  initialHistory,
  adminEmail,
}: Props) {
  // Navigation Tabs: "editor" | "drafts" | "history"
  const [activeTab, setActiveTab] = useState<"editor" | "drafts" | "history">("editor");

  // Step state within editor: 1 = "编写与测试", 2 = "选择受众与执行发送"
  const [step, setStep] = useState<1 | 2>(1);

  // Toggle between Edit and Preview in the same window
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");

  // Content states
  const [draftId, setDraftId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [preheader, setPreheader] = useState("");
  const [markdown, setMarkdown] = useState("");

  // Autosave & Draft states
  const [saveDraftStatus, setSaveDraftStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const currentDraftIdRef = useRef<string | null>(null);
  currentDraftIdRef.current = draftId;

  // Recipient states (configured in Step 2)
  const [recipientMode, setRecipientMode] = useState<"all" | "selected">("all");
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [userSearch, setUserSearch] = useState("");

  // Test email state (Step 1)
  const [testEmail, setTestEmail] = useState(adminEmail || "");
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Send execution state (Step 2)
  const [confirmInput, setConfirmInput] = useState("");
  const [isSubmittingSend, setIsSubmittingSend] = useState(false);
  const [sendResultAlert, setSendResultAlert] = useState<{
    ok: boolean;
    msg: string;
    detail?: string;
  } | null>(null);

  // Helper to deduplicate announcements by ID
  const deduplicateAnnouncements = (items: AnnouncementHistoryItem[]): AnnouncementHistoryItem[] => {
    const seen = new Set<string>();
    return items.filter((item) => {
      if (!item?.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  };

  // Drafts & History state
  const [drafts, setDrafts] = useState<AnnouncementHistoryItem[]>(() =>
    deduplicateAnnouncements(initialHistory.filter((item) => item.status === "draft"))
  );
  const [history, setHistory] = useState<AnnouncementHistoryItem[]>(() =>
    deduplicateAnnouncements(initialHistory.filter((item) => item.status !== "draft"))
  );
  const [viewHistoryItem, setViewHistoryItem] = useState<AnnouncementHistoryItem | null>(null);

  const uniqueDrafts = useMemo(() => deduplicateAnnouncements(drafts), [drafts]);
  const uniqueHistory = useMemo(() => deduplicateAnnouncements(history), [history]);

  // Filtered users for recipient picker in Step 2
  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return initialUsers;
    return initialUsers.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        (u.name && u.name.toLowerCase().includes(q)) ||
        u.id.toLowerCase().includes(q)
    );
  }, [initialUsers, userSearch]);

  // Target count
  const targetRecipientCount = useMemo(() => {
    if (recipientMode === "all") return initialUsers.length;
    return selectedUserIds.size;
  }, [recipientMode, initialUsers.length, selectedUserIds.size]);

  // Live rendered HTML for preview iframe
  const renderedHtml = useMemo(() => {
    return buildFullEmailHtml({
      subject: subject || "产品发布通知",
      markdown: markdown || "",
      preheader: preheader || undefined,
      user: { name: "投资朋友", email: "user@example.com" },
      baseUrl: "https://vt.air7.fun",
    });
  }, [subject, markdown, preheader]);

  // Insert markdown shortcut
  const handleInsertShortcut = (snippet: string) => {
    setMarkdown((prev) => `${prev}\n\n${snippet}`);
  };

  // Restore draft from localStorage on mount if current state is empty
  useEffect(() => {
    try {
      const raw = localStorage.getItem("bt_admin_announcement_draft");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.subject || parsed.markdown)) {
          setSubject((prev) => prev || parsed.subject || "");
          setPreheader((prev) => prev || parsed.preheader || "");
          setMarkdown((prev) => prev || parsed.markdown || "");
          if (parsed.draftId) {
            setDraftId(parsed.draftId);
            currentDraftIdRef.current = parsed.draftId;
          }
        }
      }
    } catch {}
  }, []);

  // Autosave to localStorage immediately and debounce to database
  useEffect(() => {
    if (!subject.trim() && !markdown.trim()) {
      return;
    }

    try {
      localStorage.setItem(
        "bt_admin_announcement_draft",
        JSON.stringify({
          draftId: currentDraftIdRef.current,
          subject,
          preheader,
          markdown,
          updatedAt: Date.now(),
        })
      );
    } catch {}

    setSaveDraftStatus("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/admin/announcements/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: currentDraftIdRef.current || undefined,
            subject,
            preheader,
            markdown,
            recipientMode,
          }),
        });
        if (!res.ok) throw new Error("Failed to save draft");
        const data = await res.json();
        if (data.draft) {
          setDraftId(data.draft.id);
          currentDraftIdRef.current = data.draft.id;
          const updatedDraft: AnnouncementHistoryItem = {
            id: data.draft.id,
            subject: data.draft.subject,
            preheader: data.draft.preheader,
            contentMarkdown: data.draft.contentMarkdown,
            recipientMode: data.draft.recipientMode,
            recipientsCount: data.draft.recipientsCount ?? 0,
            successCount: data.draft.successCount ?? 0,
            failedCount: data.draft.failedCount ?? 0,
            status: "draft",
            errorSummary: null,
            createdAt: new Date(data.draft.createdAt).toISOString(),
            updatedAt: new Date(data.draft.updatedAt).toISOString(),
            sentAt: null,
          };

          setDrafts((prev) => {
            const idx = prev.findIndex((d) => d.id === data.draft.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = updatedDraft;
              return next;
            }
            return [updatedDraft, ...prev];
          });

          setSaveDraftStatus("saved");
          setLastSavedTime(
            new Date().toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
            })
          );
        }
      } catch (e) {
        console.error("[Autosave draft error]", e);
        setSaveDraftStatus("error");
      }
    }, 1500);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [subject, preheader, markdown, recipientMode]);

  // Handle pasting images from clipboard
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items);
    const imageItems = items.filter(
      (item) => item.kind === "file" && item.type.startsWith("image/")
    );
    if (imageItems.length === 0) return;

    e.preventDefault();
    const files = imageItems
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (files.length === 0) return;

    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? markdown.length;
    const end = textarea?.selectionEnd ?? markdown.length;

    for (const file of files) {
      const uploadToken = Date.now();
      const placeholder = `\n\n![正在上传图片 (${file.name || "截图"})...](${uploadToken})\n\n`;
      setMarkdown((prev) => prev.slice(0, start) + placeholder + prev.slice(end));

      try {
        let uploadedUrl = "";
        if (isSupportedImageFile(file)) {
          const attachment = await fileToImageAttachment(file);
          const res = await fetch("/api/admin/announcements/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: attachment }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "上传失败");
          uploadedUrl = data.url;
        } else {
          const formData = new FormData();
          formData.append("file", file);
          const res = await fetch("/api/admin/announcements/upload", {
            method: "POST",
            body: formData,
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "上传失败");
          uploadedUrl = data.url;
        }

        const imgMarkdown = `\n\n![${file.name || "图片"}](${uploadedUrl})\n\n`;
        setMarkdown((prev) => prev.replace(placeholder, imgMarkdown));
      } catch (err) {
        console.error("Image upload failed:", err);
        setMarkdown((prev) =>
          prev.replace(placeholder, "\n\n<!-- 图片上传失败 -->\n\n")
        );
        setSendResultAlert({
          ok: false,
          msg: "剪贴板图片上传失败",
          detail: err instanceof Error ? err.message : "请检查网络或 R2 存储配置",
        });
      }
    }
  };

  // Handle dropping images into textarea
  const handleDrop = async (e: React.DragEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.dataTransfer.files).filter((file) =>
      file.type.startsWith("image/")
    );
    if (files.length === 0) return;
    e.preventDefault();

    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? markdown.length;

    for (const file of files) {
      const uploadToken = Date.now();
      const placeholder = `\n\n![正在上传图片 (${file.name || "image"})...](${uploadToken})\n\n`;
      setMarkdown((prev) => prev.slice(0, start) + placeholder + prev.slice(start));

      try {
        let uploadedUrl = "";
        if (isSupportedImageFile(file)) {
          const attachment = await fileToImageAttachment(file);
          const res = await fetch("/api/admin/announcements/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: attachment }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "上传失败");
          uploadedUrl = data.url;
        } else {
          const formData = new FormData();
          formData.append("file", file);
          const res = await fetch("/api/admin/announcements/upload", {
            method: "POST",
            body: formData,
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "上传失败");
          uploadedUrl = data.url;
        }

        const imgMarkdown = `\n\n![${file.name || "图片"}](${uploadedUrl})\n\n`;
        setMarkdown((prev) => prev.replace(placeholder, imgMarkdown));
      } catch (err) {
        console.error("Image drop failed:", err);
        setMarkdown((prev) =>
          prev.replace(placeholder, "\n\n<!-- 图片上传失败 -->\n\n")
        );
      }
    }
  };

  // Load draft into editor
  const handleLoadDraftToEditor = (d: AnnouncementHistoryItem) => {
    setDraftId(d.id);
    currentDraftIdRef.current = d.id;
    setSubject(d.subject === "无标题草稿" ? "" : d.subject);
    setPreheader(d.preheader || "");
    setMarkdown(d.contentMarkdown);
    setRecipientMode(d.recipientMode === "selected" ? "selected" : "all");
    setActiveTab("editor");
    setStep(1);
    setViewMode("edit");
    setViewHistoryItem(null);
  };

  // Delete draft
  const handleDeleteDraft = async (id: string) => {
    if (!window.confirm("确定从草稿箱删除此草稿吗？此操作无法撤销。")) return;
    try {
      setDrafts((prev) => prev.filter((d) => d.id !== id));
      if (draftId === id) {
        setDraftId(null);
        currentDraftIdRef.current = null;
        setSubject("");
        setPreheader("");
        setMarkdown("");
        try {
          localStorage.removeItem("bt_admin_announcement_draft");
        } catch {}
      }
      await fetch(`/api/admin/announcements/draft?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    } catch (e) {
      console.error("Failed to delete draft:", e);
    }
  };

  // Start fresh draft
  const handleStartNewDraft = () => {
    if (
      Boolean(subject || markdown) &&
      !window.confirm("确定开始新草稿吗？当前草稿已保存在草稿箱中。")
    ) {
      return;
    }
    setDraftId(null);
    currentDraftIdRef.current = null;
    setSubject("");
    setPreheader("");
    setMarkdown("");
    setStep(1);
    setViewMode("edit");
    setActiveTab("editor");
    try {
      localStorage.removeItem("bt_admin_announcement_draft");
    } catch {}
  };

  const handleToggleUserSelect = (id: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      filteredUsers.forEach((u) => next.add(u.id));
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedUserIds(new Set());
  };

  // Test send handler in Step 1
  const handleSendTest = async () => {
    if (!testEmail || !testEmail.includes("@")) {
      setTestResult({ ok: false, msg: "请输入有效的测试邮箱地址" });
      return;
    }
    if (!subject.trim()) {
      setTestResult({ ok: false, msg: "请输入邮件主题" });
      return;
    }

    setIsSendingTest(true);
    setTestResult(null);

    try {
      const res = await fetch("/api/admin/announcements/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toEmail: testEmail.trim(),
          subject: subject.trim(),
          markdown,
          preheader: preheader.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        setTestResult({
          ok: false,
          msg: data.error || "测试邮件发送失败，请检查 RESEND 配置",
        });
      } else {
        setTestResult({
          ok: true,
          msg: `已成功向 ${testEmail} 发送测试邮件，请查收验证！`,
        });
      }
    } catch (err: unknown) {
      setTestResult({
        ok: false,
        msg: err instanceof Error ? err.message : "测试邮件请求失败",
      });
    } finally {
      setIsSendingTest(false);
    }
  };

  // Official send handler in Step 2
  const handleConfirmSend = async () => {
    if (recipientMode === "all" && confirmInput.trim().toUpperCase() !== "SEND") {
      alert("全员发送请在确认框中输入 SEND");
      return;
    }
    if (recipientMode === "selected" && selectedUserIds.size === 0) {
      alert("请至少勾选一位目标收件用户");
      return;
    }

    setIsSubmittingSend(true);
    try {
      const res = await fetch("/api/admin/announcements/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          preheader: preheader.trim() || undefined,
          markdown,
          recipientMode,
          userIds: recipientMode === "selected" ? Array.from(selectedUserIds) : undefined,
          draftId: draftId || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        setSendResultAlert({
          ok: false,
          msg: data.error || "群发邮件失败",
          detail: data.errors?.join("; "),
        });
      } else {
        setSendResultAlert({
          ok: true,
          msg: `🎉 发布成功！共推送 ${data.totalCount} 封邮件 (成功 ${data.successCount}，失败 ${data.failedCount})`,
          detail: data.errors ? `部分异常：${data.errors.join("; ")}` : undefined,
        });

        // Add to history list immediately
        const newRecord: AnnouncementHistoryItem = {
          id: data.announcementId,
          subject: subject.trim(),
          preheader: preheader.trim() || null,
          contentMarkdown: markdown,
          recipientMode,
          recipientsCount: data.totalCount,
          successCount: data.successCount,
          failedCount: data.failedCount,
          status: data.failedCount === 0 ? "sent" : data.successCount > 0 ? "partial" : "failed",
          errorSummary: data.errors?.join("\n") || null,
          createdAt: new Date().toISOString(),
          sentAt: new Date().toISOString(),
        };

        // Add to history list, replacing any existing item with same ID
        setHistory((prev) => [newRecord, ...prev.filter((h) => h.id !== newRecord.id)]);

        // Remove from drafts if draftId or announcementId was present in drafts
        setDrafts((prev) =>
          prev.filter((d) => d.id !== draftId && d.id !== data.announcementId)
        );
        setDraftId(null);
        currentDraftIdRef.current = null;
        try {
          localStorage.removeItem("bt_admin_announcement_draft");
        } catch {}

        setActiveTab("history");
        setStep(1);
        setConfirmInput("");
      }
    } catch (err: unknown) {
      setSendResultAlert({
        ok: false,
        msg: err instanceof Error ? err.message : "提交发送请求异常",
      });
    } finally {
      setIsSubmittingSend(false);
    }
  };

  // Load history item into editor
  const handleLoadHistoryToEditor = (item: AnnouncementHistoryItem) => {
    if (
      window.confirm(
        `是否载入「${item.subject}」的内容到编辑器？当前未保存的内容将被覆盖。`
      )
    ) {
      setSubject(item.subject);
      setPreheader(item.preheader || "");
      setMarkdown(item.contentMarkdown);
      setActiveTab("editor");
      setStep(1);
      setViewMode("edit");
      setViewHistoryItem(null);
    }
  };

  return (
    <div className="admin-announcements-wrap">
      {/* Top Tab Switcher */}
      <div className="admin-toolbar" style={{ marginBottom: "1.25rem" }}>
        <div className="admin-segmented-control">
          <button
            type="button"
            onClick={() => setActiveTab("editor")}
            className={`admin-segment-btn${activeTab === "editor" ? " admin-segment-btn--active" : ""}`}
          >
            <FileText size={14} style={{ marginRight: 6, display: "inline-block", verticalAlign: "-2px" }} />
            新建发布
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("drafts")}
            className={`admin-segment-btn${activeTab === "drafts" ? " admin-segment-btn--active" : ""}`}
          >
            <Inbox size={14} style={{ marginRight: 6, display: "inline-block", verticalAlign: "-2px" }} />
            草稿箱 ({uniqueDrafts.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("history")}
            className={`admin-segment-btn${activeTab === "history" ? " admin-segment-btn--active" : ""}`}
          >
            <History size={14} style={{ marginRight: 6, display: "inline-block", verticalAlign: "-2px" }} />
            发送历史 ({uniqueHistory.length})
          </button>
        </div>

        {activeTab === "editor" && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
            {saveDraftStatus === "saving" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.75rem", color: "#64748b" }}>
                <Loader2 size={11} className="admin-spin" /> 正在写入草稿箱...
              </span>
            )}
            {saveDraftStatus === "saved" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.75rem", color: "#16a34a" }}>
                <Check size={12} /> 已写入草稿箱 {lastSavedTime ? `(${lastSavedTime})` : ""}
              </span>
            )}
            {saveDraftStatus === "error" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "0.75rem", color: "#ef4444" }}>
                <AlertTriangle size={12} /> 草稿同步异常
              </span>
            )}
            <span style={{ fontSize: "0.82rem", color: "rgba(0,0,0,0.45)" }}>
              步骤：{step === 1 ? "1. 撰写与测试" : "2. 选择受众与发送"}
            </span>
          </div>
        )}
      </div>

      {/* Global Notification Banner */}
      {sendResultAlert && (
        <div
          className={`admin-announcement-banner ${
            sendResultAlert.ok
              ? "admin-announcement-banner--success"
              : "admin-announcement-banner--error"
          }`}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            {sendResultAlert.ok ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            <span style={{ fontWeight: 600 }}>{sendResultAlert.msg}</span>
          </div>
          {sendResultAlert.detail && (
            <p style={{ margin: "0.4rem 0 0", fontSize: "0.82rem", opacity: 0.9 }}>
              {sendResultAlert.detail}
            </p>
          )}
          <button
            type="button"
            onClick={() => setSendResultAlert(null)}
            className="admin-announcement-banner-close"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* TAB 1: COMPOSE & SEND */}
      {activeTab === "editor" && (
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          {/* ================= STEP 1: COMPOSE & PREVIEW (SINGLE WINDOW) ================= */}
          {step === 1 && (
            <div>
              {/* 1. Subject & Preheader */}
              <div className="admin-card" style={{ padding: "1.25rem", marginBottom: "1.25rem" }}>
                <div style={{ marginBottom: "1rem" }}>
                  <label className="admin-form-label">
                    邮件标题 (Subject) <span style={{ color: "#ef4444" }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="例如：泡泡玛特值得买吗？大师会怎么分析这家公司"
                    className="admin-form-input"
                  />
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <label className="admin-form-label">
                      预览文案 (Preheader)
                    </label>
                    <span style={{ fontSize: "0.74rem", color: "rgba(0,0,0,0.4)" }}>
                      收件箱列表显示的摘要灰字
                    </span>
                  </div>
                  <input
                    type="text"
                    value={preheader}
                    onChange={(e) => setPreheader(e.target.value)}
                    placeholder="例如：Value Tribe 核心功能上线：投资研究 Agent、大师知识库与公司研究画布"
                    className="admin-form-input"
                  />
                </div>
              </div>

              {/* 2. Content Card with Edit / Preview Switcher */}
              <div className="admin-card" style={{ padding: "1.25rem", marginBottom: "1.25rem" }}>
                {/* Header Switcher: Edit vs Preview */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "0.85rem",
                    paddingBottom: "0.75rem",
                    borderBottom: "1px solid rgba(0,0,0,0.06)",
                  }}
                >
                  <div className="admin-segmented-control">
                    <button
                      type="button"
                      onClick={() => setViewMode("edit")}
                      className={`admin-segment-btn${viewMode === "edit" ? " admin-segment-btn--active" : ""}`}
                      style={{ padding: "0.35rem 0.85rem" }}
                    >
                      <Edit3 size={13} style={{ marginRight: 5, display: "inline-block", verticalAlign: "-1px" }} />
                      编辑正文
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("preview")}
                      className={`admin-segment-btn${viewMode === "preview" ? " admin-segment-btn--active" : ""}`}
                      style={{ padding: "0.35rem 0.85rem" }}
                    >
                      <Eye size={13} style={{ marginRight: 5, display: "inline-block", verticalAlign: "-1px" }} />
                      效果预览
                    </button>
                  </div>

                  {viewMode === "edit" && Boolean(subject || preheader || markdown) && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm("确定清空当前输入的内容吗？")) {
                          setDraftId(null);
                          currentDraftIdRef.current = null;
                          setMarkdown("");
                          setSubject("");
                          setPreheader("");
                          try {
                            localStorage.removeItem("bt_admin_announcement_draft");
                          } catch {}
                        }
                      }}
                      className="admin-btn-ghost"
                      style={{ fontSize: "0.74rem", display: "flex", alignItems: "center", gap: "4px" }}
                    >
                      <RotateCcw size={12} />
                      清空内容
                    </button>
                  )}
                </div>

                {/* EDIT MODE: TOOLBAR & TEXTAREA */}
                {viewMode === "edit" && (
                  <div>
                    <div className="admin-announcement-toolbar">
                      <button
                        type="button"
                        title="二级标题"
                        onClick={() => handleInsertShortcut("## 核心功能介绍")}
                        className="admin-toolbar-btn"
                      >
                        H2
                      </button>
                      <button
                        type="button"
                        title="三级标题"
                        onClick={() => handleInsertShortcut("### 功能亮点")}
                        className="admin-toolbar-btn"
                      >
                        H3
                      </button>
                      <button
                        type="button"
                        title="加粗"
                        onClick={() => handleInsertShortcut("**重点强调文字**")}
                        className="admin-toolbar-btn"
                      >
                        B
                      </button>
                      <button
                        type="button"
                        title="项目列表"
                        onClick={() => handleInsertShortcut("- 亮点一：说明文字\n- 亮点二：说明文字")}
                        className="admin-toolbar-btn"
                      >
                        • 列表
                      </button>
                      <button
                        type="button"
                        title="引用特性卡片"
                        onClick={() =>
                          handleInsertShortcut(
                            "> **功能模块**\n> 这一模块专为价值投资研究量身打造，支持一键穿透。"
                          )
                        }
                        className="admin-toolbar-btn"
                      >
                        “ 引用卡片
                      </button>
                      <button
                        type="button"
                        title="插入行动按钮 (CTA Button)"
                        onClick={() =>
                          handleInsertShortcut("[立即体验新功能 →](https://vt.air7.fun/agent#button)")
                        }
                        className="admin-toolbar-btn admin-toolbar-btn--accent"
                      >
                        🔘 CTA 按钮
                      </button>
                      <button
                        type="button"
                        title="在正文插入微信交流与二维码"
                        onClick={() =>
                          handleInsertShortcut(
                            "有任何问题，欢迎加我微信交流，或者直接回复本邮件！\n\n![微信二维码](https://pub-675abd2580e643e89dde5e766edae1b7.r2.dev/buffett-tribe/email/announcement-2026-06/wechat-qr.jpeg#wechat)"
                          )
                        }
                        className="admin-toolbar-btn admin-toolbar-btn--wechat"
                      >
                        💬 微信
                      </button>
                      <button
                        type="button"
                        title="插入用户昵称占位符"
                        onClick={() => handleInsertShortcut("{{name}}")}
                        className="admin-toolbar-btn"
                      >
                        {`{{name}}`}
                      </button>
                      <button
                        type="button"
                        title="插入分割线"
                        onClick={() => handleInsertShortcut("---")}
                        className="admin-toolbar-btn"
                      >
                        — 分割线
                      </button>
                      <span
                        style={{
                          fontSize: "0.72rem",
                          color: "#9ca3af",
                          marginLeft: "auto",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <ImageIcon size={12} /> 支持从剪贴板 Cmd+V 粘贴图片
                      </span>
                    </div>

                    <textarea
                      ref={textareaRef}
                      value={markdown}
                      onChange={(e) => setMarkdown(e.target.value)}
                      onPaste={handlePaste}
                      onDrop={handleDrop}
                      onDragOver={(e) => e.preventDefault()}
                      rows={16}
                      placeholder="在此编写 Markdown 格式的宣传内容...（支持直接从剪贴板 Cmd+V 粘贴截图/图片，内容实时自动写入草稿箱）"
                      className="admin-form-textarea"
                      style={{
                        fontFamily:
                          "-apple-system-monospaced, Menlo, Monaco, Consolas, monospace",
                        fontSize: "0.85rem",
                        lineHeight: 1.6,
                      }}
                    />
                  </div>
                )}

                {/* PREVIEW MODE: SANDBOXED IFRAME */}
                {viewMode === "preview" && (
                  <div
                    style={{
                      background: "#f5f5f7",
                      borderRadius: "8px",
                      border: "1px solid rgba(0,0,0,0.08)",
                      overflow: "hidden",
                      height: "660px",
                    }}
                  >
                    <iframe
                      title="Email Live Preview"
                      srcDoc={renderedHtml}
                      style={{ width: "100%", height: "100%", border: "none", display: "block" }}
                    />
                  </div>
                )}
              </div>

              {/* 3. Test Email Box & Next Step Action */}
              <div className="admin-card" style={{ padding: "1.25rem" }}>
                <div style={{ fontSize: "0.84rem", fontWeight: 600, color: "var(--apple-near-black)", marginBottom: 6 }}>
                  📧 发送真实测试邮件（自测排版）
                </div>
                <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <input
                    type="email"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    placeholder="输入测试收件邮箱..."
                    className="admin-form-input"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    disabled={isSendingTest}
                    onClick={handleSendTest}
                    className="admin-btn-secondary"
                    style={{ minWidth: "120px", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                  >
                    {isSendingTest ? (
                      <>
                        <Loader2 size={14} className="admin-spin" />
                        发送中...
                      </>
                    ) : (
                      <>
                        <Mail size={14} />
                        发送测试
                      </>
                    )}
                  </button>
                </div>

                {testResult && (
                  <div
                    style={{
                      marginBottom: "0.75rem",
                      fontSize: "0.8rem",
                      color: testResult.ok ? "#16a34a" : "#dc2626",
                    }}
                  >
                    {testResult.msg}
                  </div>
                )}

                <hr style={{ border: "none", borderTop: "1px solid rgba(0,0,0,0.06)", margin: "1rem 0" }} />

                {/* Move to Step 2 Button */}
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    disabled={!subject.trim() || !markdown.trim()}
                    onClick={() => setStep(2)}
                    className="admin-btn-primary"
                    style={{
                      padding: "0.65rem 1.6rem",
                      fontSize: "0.9rem",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    下一步：选择发送对象并正式发布
                    <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ================= STEP 2: SELECT RECIPIENTS & MASS SEND ================= */}
          {step === 2 && (
            <div>
              {/* Top Navigation */}
              <div style={{ marginBottom: "1.25rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="admin-shell-back-link"
                  style={{ fontSize: "0.85rem", cursor: "pointer", border: "none", background: "none" }}
                >
                  <ArrowLeft size={14} />
                  <span>返回修改正文与预览</span>
                </button>
                <div style={{ fontSize: "0.82rem", color: "rgba(0,0,0,0.5)" }}>
                  步骤 2 / 2
                </div>
              </div>

              {/* Email Content Summary Card */}
              <div className="admin-card" style={{ padding: "1.25rem", marginBottom: "1.25rem" }}>
                <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "rgba(0,0,0,0.45)", textTransform: "uppercase", marginBottom: 6 }}>
                  待推送邮件
                </div>
                <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--apple-near-black)", marginBottom: 4 }}>
                  {subject}
                </div>
                {preheader && (
                  <div style={{ fontSize: "0.82rem", color: "rgba(0,0,0,0.55)", marginBottom: "0.5rem" }}>
                    摘要：{preheader}
                  </div>
                )}
                <div style={{ fontSize: "0.78rem", color: "rgba(0,0,0,0.4)" }}>
                  正文长度：{markdown.length} 字符 · 发送人：价值部落 &lt;buffet@air7.fun&gt;
                </div>
              </div>

              {/* Recipient Audience Selection Card */}
              <div className="admin-card" style={{ padding: "1.5rem", marginBottom: "1.25rem" }}>
                <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 0.5rem" }}>
                  选择发送受众
                </h2>
                <p style={{ fontSize: "0.82rem", color: "rgba(0,0,0,0.5)", margin: "0 0 1.25rem" }}>
                  选择将此邮件广播至全站注册用户，或挑选特定目标用户组发送
                </p>

                <div className="admin-recipient-mode-group" style={{ marginBottom: "1.25rem" }}>
                  <label
                    className={`admin-recipient-mode-card${
                      recipientMode === "all" ? " admin-recipient-mode-card--active" : ""
                    }`}
                  >
                    <input
                      type="radio"
                      name="recipientMode"
                      value="all"
                      checked={recipientMode === "all"}
                      onChange={() => setRecipientMode("all")}
                      style={{ marginRight: 10, marginTop: 3 }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>全部注册用户</div>
                      <div style={{ fontSize: "0.8rem", color: "rgba(0,0,0,0.5)", marginTop: 4 }}>
                        广播至全站所有 <strong>{initialUsers.length}</strong> 位已注册用户
                      </div>
                    </div>
                  </label>

                  <label
                    className={`admin-recipient-mode-card${
                      recipientMode === "selected" ? " admin-recipient-mode-card--active" : ""
                    }`}
                  >
                    <input
                      type="radio"
                      name="recipientMode"
                      value="selected"
                      checked={recipientMode === "selected"}
                      onChange={() => setRecipientMode("selected")}
                      style={{ marginRight: 10, marginTop: 3 }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>
                        指定注册用户 ({selectedUserIds.size} 人)
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "rgba(0,0,0,0.5)", marginTop: 4 }}>
                        定向发送给特定内测组或挑选的用户
                      </div>
                    </div>
                  </label>
                </div>

                {/* Selected Users Table / Selector */}
                {recipientMode === "selected" && (
                  <div className="admin-user-picker-wrap" style={{ marginTop: "1rem" }}>
                    <div className="admin-user-picker-header">
                      <div style={{ position: "relative", width: "260px" }}>
                        <Search size={14} className="admin-search-icon" />
                        <input
                          type="text"
                          value={userSearch}
                          onChange={(e) => setUserSearch(e.target.value)}
                          placeholder="搜索用户姓名或邮箱..."
                          className="admin-search-input"
                          style={{ fontSize: "0.82rem", padding: "0.35rem 0.5rem 0.35rem 2.2rem" }}
                        />
                      </div>

                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <button
                          type="button"
                          onClick={handleSelectAllFiltered}
                          className="admin-btn-secondary"
                          style={{ fontSize: "0.78rem", padding: "0.35rem 0.75rem" }}
                        >
                          全选当前筛选 ({filteredUsers.length})
                        </button>
                        <button
                          type="button"
                          onClick={handleClearSelection}
                          className="admin-btn-secondary"
                          style={{ fontSize: "0.78rem", padding: "0.35rem 0.75rem" }}
                        >
                          清空选择
                        </button>
                      </div>
                    </div>

                    <div className="admin-user-picker-list" style={{ maxHeight: "280px" }}>
                      {filteredUsers.length === 0 ? (
                        <div style={{ padding: "1.5rem", textAlign: "center", color: "rgba(0,0,0,0.4)" }}>
                          无匹配用户
                        </div>
                      ) : (
                        filteredUsers.map((u) => {
                          const isChecked = selectedUserIds.has(u.id);
                          return (
                            <div
                              key={u.id}
                              onClick={() => handleToggleUserSelect(u.id)}
                              className={`admin-user-picker-item${
                                isChecked ? " admin-user-picker-item--selected" : ""
                              }`}
                              style={{ padding: "0.5rem 0.85rem" }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {}}
                                style={{ marginRight: 10 }}
                              />
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flex: 1 }}>
                                <span style={{ fontWeight: 500 }}>{u.email}</span>
                                {u.name && (
                                  <span style={{ color: "rgba(0,0,0,0.45)", fontSize: "0.8rem" }}>
                                    ({u.name})
                                  </span>
                                )}
                              </div>
                              {u.role === "admin" && (
                                <span
                                  className="admin-badge admin-badge--admin"
                                  style={{ fontSize: "0.68rem" }}
                                >
                                  Admin
                                </span>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Safety Confirmation & Send Trigger Card */}
              <div className="admin-card" style={{ padding: "1.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                  <div>
                    <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--apple-near-black)" }}>
                      即将发送至{" "}
                      <span style={{ color: "var(--apple-blue)" }}>
                        {targetRecipientCount}
                      </span>{" "}
                      位注册用户
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "rgba(0,0,0,0.5)", marginTop: 2 }}>
                      {recipientMode === "all"
                        ? "模式：全员群发推送"
                        : `模式：定向发送 (已选中 ${selectedUserIds.size} 人)`}
                    </div>
                  </div>
                </div>

                {recipientMode === "all" && (
                  <div
                    style={{
                      background: "#fef2f2",
                      border: "1px solid #fecaca",
                      borderRadius: "8px",
                      padding: "1rem",
                      marginBottom: "1.25rem",
                    }}
                  >
                    <label style={{ display: "block", fontSize: "0.84rem", color: "#991b1b", fontWeight: 600, marginBottom: 6 }}>
                      ⚠️ 全员发送安全保护：请输入大写 <span style={{ textDecoration: "underline" }}>SEND</span> 确认操作
                    </label>
                    <input
                      type="text"
                      value={confirmInput}
                      onChange={(e) => setConfirmInput(e.target.value)}
                      placeholder="输入 SEND 激活发送按钮"
                      className="admin-form-input"
                      style={{
                        maxWidth: "240px",
                        textTransform: "uppercase",
                        borderColor: confirmInput.trim().toUpperCase() === "SEND" ? "#16a34a" : undefined,
                      }}
                    />
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="admin-btn-secondary"
                    style={{ padding: "0.6rem 1.2rem" }}
                  >
                    ← 返回修改内容
                  </button>

                  <button
                    type="button"
                    disabled={
                      isSubmittingSend ||
                      targetRecipientCount === 0 ||
                      (recipientMode === "all" && confirmInput.trim().toUpperCase() !== "SEND")
                    }
                    onClick={handleConfirmSend}
                    className="admin-btn-primary"
                    style={{
                      padding: "0.65rem 1.75rem",
                      fontSize: "0.92rem",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    {isSubmittingSend ? (
                      <>
                        <Loader2 size={16} className="admin-spin" />
                        正在批量推送中...
                      </>
                    ) : (
                      <>
                        <Send size={16} />
                        确认正式执行发布 ({targetRecipientCount} 封)
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB: DRAFTS BOX */}
      {activeTab === "drafts" && (
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "1rem",
            }}
          >
            <div>
              <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "#0f172a" }}>
                草稿箱 ({drafts.length})
              </div>
              <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "#64748b" }}>
                在编辑正文时自动实时写入草稿箱，可随时切换并继续编辑。
              </p>
            </div>
            <button
              type="button"
              onClick={handleStartNewDraft}
              className="admin-btn-primary"
              style={{
                fontSize: "0.82rem",
                padding: "0.45rem 0.95rem",
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Plus size={14} /> 新建空白发布
            </button>
          </div>

          {uniqueDrafts.length === 0 ? (
            <div
              className="admin-card"
              style={{ padding: "3.5rem 1rem", textAlign: "center", background: "#ffffff" }}
            >
              <Inbox size={40} style={{ color: "#9ca3af", margin: "0 auto 12px", display: "block" }} />
              <div style={{ fontWeight: 600, fontSize: "0.95rem", color: "#374151" }}>草稿箱为空</div>
              <p style={{ margin: "6px 0 0", fontSize: "0.82rem", color: "#9ca3af" }}>
                在「新建发布」中编辑的主题和正文会自动实时保存到草稿箱。
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
              {uniqueDrafts.map((d) => (
                <div
                  key={d.id}
                  className="admin-card"
                  style={{
                    padding: "1.25rem",
                    background: "#ffffff",
                    border: d.id === draftId ? "1.5px solid var(--apple-blue)" : undefined,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: "1rem",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          marginBottom: "0.4rem",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "0.7rem",
                            fontWeight: 600,
                            padding: "0.15rem 0.5rem",
                            background: "#f1f5f9",
                            color: "#475569",
                            borderRadius: "4px",
                          }}
                        >
                          草稿
                        </span>
                        {d.id === draftId && (
                          <span
                            style={{
                              fontSize: "0.7rem",
                              fontWeight: 600,
                              padding: "0.15rem 0.5rem",
                              background: "#eff6ff",
                              color: "#2563eb",
                              borderRadius: "4px",
                            }}
                          >
                            当前编辑中
                          </span>
                        )}
                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: "0.95rem",
                            color: "#0f172a",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {d.subject || "无标题草稿"}
                        </span>
                      </div>

                      {d.preheader && (
                        <p style={{ margin: "0 0 0.4rem", fontSize: "0.82rem", color: "#475569" }}>
                          <span style={{ color: "#94a3b8" }}>摘要：</span>
                          {d.preheader}
                        </p>
                      )}

                      <p
                        style={{
                          margin: "0 0 0.55rem",
                          fontSize: "0.8rem",
                          color: "#64748b",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {d.contentMarkdown.slice(0, 140) || "（正文内容为空）"}
                      </p>

                      <div style={{ fontSize: "0.74rem", color: "#9ca3af" }}>
                        最近更新：
                        {d.updatedAt
                          ? new Date(d.updatedAt).toLocaleString("zh-CN")
                          : new Date(d.createdAt).toLocaleString("zh-CN")}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={() => handleLoadDraftToEditor(d)}
                        className="admin-btn-primary"
                        style={{
                          fontSize: "0.8rem",
                          padding: "0.35rem 0.8rem",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <Edit3 size={13} /> 继续编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteDraft(d.id)}
                        className="admin-btn-ghost"
                        style={{
                          fontSize: "0.8rem",
                          color: "#ef4444",
                          padding: "0.35rem 0.6rem",
                        }}
                        title="删除此草稿"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: SENDING HISTORY */}
      {activeTab === "history" && (
        <div className="admin-table-card">
          {uniqueHistory.length === 0 ? (
            <div style={{ padding: "3rem", textAlign: "center", color: "rgba(0,0,0,0.45)" }}>
              <Clock size={32} style={{ margin: "0 auto 12px", opacity: 0.5 }} />
              <div>暂无群发历史记录</div>
              <p style={{ fontSize: "0.82rem", marginTop: 4 }}>
                完成邮件推送后，发送状态、成功率与时间记录将展示在这里
              </p>
            </div>
          ) : (
            <div className="admin-table-container">
              <table className="admin-users-table">
                <thead>
                  <tr>
                    <th>邮件主题 / 摘要</th>
                    <th>受众模式</th>
                    <th>目标人数</th>
                    <th>发送结果</th>
                    <th>发送时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {uniqueHistory.map((item) => {
                    const formattedDate = new Intl.DateTimeFormat("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(item.createdAt));

                    return (
                      <tr key={item.id}>
                        <td style={{ maxWidth: "300px" }}>
                          <div style={{ fontWeight: 600, color: "var(--apple-near-black)" }}>
                            {item.subject}
                          </div>
                          {item.preheader && (
                            <div
                              style={{
                                fontSize: "0.76rem",
                                color: "rgba(0,0,0,0.45)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {item.preheader}
                            </div>
                          )}
                        </td>
                        <td>
                          {item.recipientMode === "all" ? (
                            <span className="admin-badge">全部用户</span>
                          ) : (
                            <span className="admin-badge">指定用户</span>
                          )}
                        </td>
                        <td>
                          <span style={{ fontWeight: 600 }}>{item.recipientsCount}</span> 人
                        </td>
                        <td>
                          {item.status === "sent" ? (
                            <span className="admin-badge admin-badge--active">
                              成功 {item.successCount}
                            </span>
                          ) : item.status === "partial" ? (
                            <span className="admin-badge" style={{ background: "#fef3c7", color: "#d97706" }}>
                              部分成功 ({item.successCount}/{item.recipientsCount})
                            </span>
                          ) : item.status === "sending" ? (
                            <span className="admin-badge" style={{ background: "#e0e7ff", color: "#4338ca" }}>
                              发送中...
                            </span>
                          ) : (
                            <span className="admin-badge admin-badge--admin">
                              失败 {item.failedCount}
                            </span>
                          )}
                        </td>
                        <td>
                          <time style={{ fontSize: "0.78rem", color: "rgba(0,0,0,0.45)" }}>
                            {formattedDate}
                          </time>
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: "0.5rem" }}>
                            <button
                              type="button"
                              onClick={() => setViewHistoryItem(item)}
                              className="admin-btn-ghost"
                              style={{ fontSize: "0.78rem" }}
                            >
                              查看
                            </button>
                            <button
                              type="button"
                              onClick={() => handleLoadHistoryToEditor(item)}
                              className="admin-btn-secondary"
                              style={{ fontSize: "0.78rem", padding: "0.25rem 0.5rem" }}
                            >
                              载入草稿
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* DETAIL MODAL FOR HISTORY VIEW */}
      {viewHistoryItem && (
        <div className="admin-modal-backdrop">
          <div className="admin-modal-card" style={{ maxWidth: "720px", width: "95%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1.05rem" }}>{viewHistoryItem.subject}</h3>
                <p style={{ margin: "2px 0 0", fontSize: "0.78rem", color: "rgba(0,0,0,0.5)" }}>
                  发送于 {new Date(viewHistoryItem.createdAt).toLocaleString()} · 成功 {viewHistoryItem.successCount} 封
                </p>
              </div>
              <button
                type="button"
                onClick={() => setViewHistoryItem(null)}
                className="admin-btn-ghost"
              >
                <X size={18} />
              </button>
            </div>

            <div
              style={{
                height: "400px",
                border: "1px solid rgba(0,0,0,0.1)",
                borderRadius: "8px",
                overflow: "hidden",
                background: "#f5f5f7",
              }}
            >
              <iframe
                title="History Email Preview"
                srcDoc={buildFullEmailHtml({
                  subject: viewHistoryItem.subject,
                  markdown: viewHistoryItem.contentMarkdown,
                  preheader: viewHistoryItem.preheader || undefined,
                  user: { name: "示例收件人", email: "user@example.com" },
                })}
                style={{ width: "100%", height: "100%", border: "none" }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1rem" }}>
              <button
                type="button"
                onClick={() => handleLoadHistoryToEditor(viewHistoryItem)}
                className="admin-btn-primary"
              >
                载入到编辑器
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

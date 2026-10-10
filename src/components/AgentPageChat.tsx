"use client";

import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useSession } from "next-auth/react";
import {
  PanelLeftClose,
  PanelLeft,
  Building2,
  MessageSquare,
  ExternalLink,
  X,
} from "lucide-react";
import { AgentChat } from "@/components/AgentChat";
import { WorkspaceSidebar } from "@/components/agent-workspace/WorkspaceSidebar";
import { NoteEditor } from "@/components/agent-workspace/NoteEditor";
import { CompanyChatPane } from "@/components/agent-workspace/CompanyChatPane";
import { useAgentChat, type Message } from "@/hooks/useAgentChat";
import { useNotes } from "@/hooks/useNotes";
import { useWatchlist, type WatchlistCompanyItem } from "@/hooks/useWatchlist";
import {
  getNextChatTabIndex,
  summarizeConversationPreview,
  type AgentTurnPreview,
} from "@/lib/agent-workspace-ui";

interface AgentPageChatProps {
  initialMessages?: Message[];
}

export interface ChatTab {
  id: string; // "global" | `company:${ticker}`
  title: string;
  ticker?: string;
  companyName?: string;
  companyUrl?: string | null;
  closable: boolean;
}

export function AgentPageChat({ initialMessages }: AgentPageChatProps) {
  const { data: session } = useSession();

  // Global conversation
  const {
    messages,
    input,
    setInput,
    streaming,
    sendMessage,
    abort,
    pendingImages,
    addImage,
    removeImage,
  } = useAgentChat({ initialMessages });

  // Notes state
  const {
    notes,
    activeNote,
    draft,
    saveStatus,
    openNote,
    closeEditor,
    flushPendingSave,
    createNote,
    updateDraft,
    deleteNote,
    saveAsNote,
  } = useNotes();

  // Watchlist state
  const {
    items: watchlistItems,
    loading: watchlistLoading,
    removeWatchlist,
  } = useWatchlist();

  const [watchlistExpanded, setWatchlistExpanded] = useState(false);
  const [latestByContextKey, setLatestByContextKey] = useState<Record<string, AgentTurnPreview>>({});
  const [loadedTickerKey, setLoadedTickerKey] = useState("");
  const [failedTickerKey, setFailedTickerKey] = useState("");
  const companyTickers = useMemo(
    () => [...new Set(watchlistItems.map((item) => item.ticker.trim()).filter(Boolean))],
    [watchlistItems],
  );
  const tickerKey = JSON.stringify(companyTickers);
  const previewsLoading =
    watchlistExpanded &&
    companyTickers.length > 0 &&
    loadedTickerKey !== tickerKey &&
    failedTickerKey !== tickerKey;
  const previewsError = failedTickerKey === tickerKey;

  useEffect(() => {
    if (companyTickers.length === 0 || !watchlistExpanded || loadedTickerKey === tickerKey) return;

    let cancelled = false;
    const query = new URLSearchParams();
    companyTickers.forEach((ticker) => query.append("companyTicker", ticker));

    fetch(`/api/agent-turns?${query}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load company turn previews");
        return response.json() as Promise<{
          latestByContextKey?: Record<string, AgentTurnPreview>;
        }>;
      })
      .then((data) => {
        if (cancelled) return;
        setLatestByContextKey(data.latestByContextKey ?? {});
        setLoadedTickerKey(tickerKey);
        setFailedTickerKey("");
      })
      .catch(() => {
        if (!cancelled) setFailedTickerKey(tickerKey);
      });

    return () => {
      cancelled = true;
    };
  }, [companyTickers, loadedTickerKey, tickerKey, watchlistExpanded]);

  const handleLatestTurnChange = useCallback((ticker: string, preview: AgentTurnPreview) => {
    const text = summarizeConversationPreview(preview.text) || "发送了图片";
    setLatestByContextKey((prev) => ({
      ...prev,
      [`company:${ticker}`]: { role: preview.role, text },
    }));
  }, []);

  // Multi-tab state: default is "global" ("主对话")
  const [tabs, setTabs] = useState<ChatTab[]>([
    { id: "global", title: "主对话", closable: false },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>("global");

  const [leftOpen, setLeftOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const handleResize = () => {
      const desktop = window.innerWidth >= 1280;
      setIsDesktop(desktop);
      if (desktop && session) {
        setLeftOpen(true);
      } else {
        setLeftOpen(false);
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [session]);

  const activeCompanyTicker = tabs.find((t) => t.id === activeTabId)?.ticker ?? null;

  const handleSelectCompany = (company: WatchlistCompanyItem) => {
    const tabId = `company:${company.ticker.toUpperCase()}`;
    const exists = tabs.some((t) => t.id === tabId);
    if (!exists) {
      const displayName = company.companyName || company.ticker;
      const displaySuffix =
        company.ticker && company.companyName && company.companyName !== company.ticker
          ? ` (${company.ticker})`
          : "";
      const newTab: ChatTab = {
        id: tabId,
        title: `${displayName}${displaySuffix}`,
        ticker: company.ticker,
        companyName: company.companyName || company.ticker,
        companyUrl: company.url,
        closable: true,
      };
      setTabs((prev) => [...prev, newTab]);
    }
    setActiveTabId(tabId);
    if (!isDesktop) setLeftOpen(false);
  };

  const handleCloseTab = (tabId: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId) {
        const closedIndex = prev.findIndex((t) => t.id === tabId);
        const fallbackTab = next[Math.max(0, closedIndex - 1)] ?? next[0];
        setActiveTabId(fallbackTab ? fallbackTab.id : "global");
      }
      return next;
    });
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex = getNextChatTabIndex(event.key, index, tabs.length);
    if (nextIndex === null) return;
    event.preventDefault();
    setActiveTabId(tabs[nextIndex].id);
    document.getElementById(`agent-chat-tab-${nextIndex}`)?.focus();
  };

  return (
    <div className="agent-workspace">
      {/* Main Workspace Body */}
      <div className="agent-workspace-body">
        {/* Mobile/Tablet Backdrop when drawer is open */}
        {!isDesktop && leftOpen && (
          <div
            className="agent-drawer-backdrop"
            onClick={() => {
              setLeftOpen(false);
            }}
          />
        )}

        {/* Left Sidebar (Research Materials & Watchlist) - 仅登录用户可见 */}
        {session && (
          <aside
            className={`agent-workspace-sidebar agent-workspace-sidebar-left ${
              leftOpen ? "is-open" : "is-closed"
            }`}
          >
            <div className="agent-sidebar-header agent-sidebar-header--nav">
              <div className="agent-sidebar-header-left">
                <button
                  type="button"
                  className="agent-sidebar-toggle-btn"
                  onClick={() => setLeftOpen(false)}
                  title="收起工作区"
                  aria-label="收起工作区"
                >
                  <PanelLeftClose size={15} strokeWidth={1.8} />
                </button>
                <span className="agent-sidebar-title">工作区</span>
              </div>
            </div>
            <div className="agent-sidebar-content">
              <WorkspaceSidebar
                notes={notes}
                activeNoteId={activeNote?.id ?? null}
                onOpenNote={(id) => {
                  openNote(id);
                  if (!isDesktop) setLeftOpen(false);
                }}
                onCreateNote={() => {
                  void createNote();
                  if (!isDesktop) setLeftOpen(false);
                }}
                watchlistItems={watchlistItems}
                activeCompanyTicker={activeCompanyTicker}
                onSelectCompany={handleSelectCompany}
                onRemoveCompany={(ticker) => {
                  void removeWatchlist(ticker);
                }}
                watchlistLoading={watchlistLoading}
                onWatchlistOpenChange={setWatchlistExpanded}
                latestByContextKey={latestByContextKey}
                previewsLoading={previewsLoading}
                previewsError={previewsError}
              />
            </div>
          </aside>
        )}

        {/* Center Main Stage (Note Editor + Chat Pane) */}
        <div className="agent-workspace-main">
          {/* Side-by-side Note Editor Pane - 仅登录用户可见 */}
          {session && activeNote && draft && (
            <div className="agent-workspace-note-pane">
              <NoteEditor
                key={activeNote.id}
                title={draft.title}
                content={draft.content}
                onChangeTitle={(title) => updateDraft({ title })}
                onChangeContent={(content) => updateDraft({ content })}
                saveStatus={saveStatus}
                onRetrySave={() => void flushPendingSave()}
                onClose={closeEditor}
                onDelete={() => void deleteNote(activeNote.id)}
              />
            </div>
          )}

          {/* Agent Chat Pane with Multi-Tab Navigation */}
          <div className="agent-workspace-chat-pane">
            {/* Multi-Tab Bar (rendered when session or tabs > 1) */}
            <div className="agent-chat-tabs-bar">
              {/* Workspace Toggle inside Tab Bar (when Sidebar is Closed) - 仅登录用户可见 */}
              {session && !leftOpen && (
                <div className="agent-tabs-sidebar-ctrl">
                  <button
                    type="button"
                    className="agent-tabs-sidebar-toggle"
                    onClick={() => setLeftOpen(true)}
                    title="展开工作区"
                    aria-label="展开工作区"
                  >
                    <PanelLeft size={14} strokeWidth={2} />
                    <span>工作区</span>
                  </button>
                  <span className="agent-tabs-sidebar-divider" aria-hidden="true" />
                </div>
              )}

              <div
                className="agent-chat-tabs-scroll"
                role="tablist"
                aria-label="投研对话"
                aria-orientation="horizontal"
              >
                {tabs.map((tab, index) => {
                  const isActive = tab.id === activeTabId;
                  return (
                    <div
                      key={tab.id}
                      className={`agent-chat-tab-group ${isActive ? "is-active" : ""}`}
                      role="presentation"
                    >
                      <button
                        id={`agent-chat-tab-${index}`}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        aria-controls={`agent-chat-panel-${index}`}
                        tabIndex={isActive ? 0 : -1}
                        className={`agent-chat-tab ${isActive ? "is-active" : ""}`}
                        onClick={() => setActiveTabId(tab.id)}
                        onKeyDown={(event) => handleTabKeyDown(event, index)}
                        title={tab.title}
                      >
                        <span className="agent-chat-tab-icon">
                          {tab.id === "global" ? (
                            <MessageSquare size={14} strokeWidth={2} />
                          ) : (
                            <Building2 size={14} strokeWidth={2} />
                          )}
                        </span>
                        <span className="agent-chat-tab-title">
                          {tab.companyUrl ? (
                            <>
                              {tab.companyName || tab.ticker}
                              {tab.ticker && tab.companyName && tab.companyName !== tab.ticker && (
                                <span className="agent-chat-tab-ticker"> ({tab.ticker})</span>
                              )}
                            </>
                          ) : (
                            tab.title
                          )}
                        </span>
                      </button>
                      {tab.companyUrl && (
                        <a
                          href={tab.companyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="agent-chat-tab-ext-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                          title={`在新标签页中打开 ${tab.companyName || tab.ticker} 公司主页`}
                          aria-label={`打开 ${tab.companyName || tab.ticker} 公司主页`}
                        >
                          <ExternalLink size={11} strokeWidth={2} />
                        </a>
                      )}
                      {tab.closable && (
                        <button
                          type="button"
                          className="agent-chat-tab-close"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCloseTab(tab.id);
                          }}
                          title="关闭此对话"
                          aria-label={`关闭 ${tab.companyName || tab.title}`}
                        >
                          <X size={11} strokeWidth={2.2} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Global Chat Tab */}
            <div
              id="agent-chat-panel-0"
              role="tabpanel"
              aria-labelledby="agent-chat-tab-0"
              tabIndex={0}
              aria-hidden={activeTabId !== "global"}
              className="agent-workspace-chat-tab-content"
              style={{
                display: activeTabId === "global" ? "flex" : "none",
                flex: 1,
                minHeight: 0,
                flexDirection: "column",
              }}
            >
              <AgentChat
                messages={messages}
                input={input}
                setInput={setInput}
                streaming={streaming}
                sendMessage={sendMessage}
                abort={abort}
                pendingImages={pendingImages}
                onAddImage={addImage}
                onRemoveImage={removeImage}
                onSaveAsNote={
                  session
                    ? (text) => {
                        void saveAsNote(text);
                      }
                    : undefined
                }
              />
            </div>

            {/* Company Chat Tabs */}
            {tabs
              .map((tab, index) => ({ tab, index }))
              .filter(({ tab }) => tab.id !== "global")
              .map(({ tab, index }) => (
                <div
                  key={tab.id}
                  id={`agent-chat-panel-${index}`}
                  role="tabpanel"
                  aria-labelledby={`agent-chat-tab-${index}`}
                  tabIndex={0}
                  aria-hidden={activeTabId !== tab.id}
                  className="agent-workspace-chat-tab-content"
                  style={{
                    display: activeTabId === tab.id ? "flex" : "none",
                    flex: 1,
                    minHeight: 0,
                    flexDirection: "column",
                  }}
                >
                  <CompanyChatPane
                    companyName={tab.companyName!}
                    ticker={tab.ticker!}
                    companyUrl={tab.companyUrl}
                    onLatestTurnChange={handleLatestTurnChange}
                    onSaveAsNote={
                      session
                        ? (text) => {
                            void saveAsNote(text);
                          }
                        : undefined
                    }
                  />
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

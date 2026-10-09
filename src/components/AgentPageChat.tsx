"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  PanelLeftClose,
  PanelLeft,
  Compass,
  Sparkles,
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
    openNote,
    closeEditor,
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
                onClose={closeEditor}
                onDelete={() => void deleteNote(activeNote.id)}
              />
            </div>
          )}

          {/* Agent Chat Pane with Multi-Tab Navigation */}
          <div className="agent-workspace-chat-pane">
            {/* Multi-Tab Bar (rendered when session or tabs > 1) */}
            <div className="agent-chat-tabs-bar" role="tablist">
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

              <div className="agent-chat-tabs-scroll">
                {tabs.map((tab) => {
                  const isActive = tab.id === activeTabId;
                  return (
                    <div
                      key={tab.id}
                      role="tab"
                      aria-selected={isActive}
                      className={`agent-chat-tab ${isActive ? "is-active" : ""}`}
                      onClick={() => setActiveTabId(tab.id)}
                      title={tab.title}
                    >
                      <span className="agent-chat-tab-icon">
                        {tab.id === "global" ? (
                          <Compass size={13} strokeWidth={2} />
                        ) : (
                          <Sparkles size={13} strokeWidth={2} />
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
                          aria-label="关闭"
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
              .filter((t) => t.id !== "global")
              .map((tab) => (
                <div
                  key={tab.id}
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

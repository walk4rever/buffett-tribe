"use client";

import {
  Children,
  isValidElement,
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import type { ReactElement, ReactNode } from "react";
import type { ValueLineData } from "@/lib/value-line-data";
import { ValueLineHeader, ValueLineBody } from "@/components/ValueLineCard";

export type CompanySectionTab = {
  id: string;
  label: string;
  note?: string;
  desc?: string;
  disabled?: boolean;
};

type CompanySectionTabsProps = {
  tabs: CompanySectionTab[];
  children: ReactNode;
  initialTabId?: string;
  valueLineData?: ValueLineData | null;
  initialTicker?: string;
  fallbackHeader?: ReactNode;
};

export function CompanySectionTabs({
  tabs,
  children,
  initialTabId,
  valueLineData,
  initialTicker,
  fallbackHeader,
}: CompanySectionTabsProps) {
  const firstEnabledTabId = tabs.find((t) => !t.disabled)?.id ?? "";
  const resolvedInitialTab =
    initialTabId && tabs.some((t) => t.id === initialTabId && !t.disabled)
      ? initialTabId
      : firstEnabledTabId;
  const [activeTab, setActiveTab] = useState(resolvedInitialTab);
  const [isMatrixOpen, setIsMatrixOpen] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const [selectedTicker, setSelectedTicker] = useState<string>(
    initialTicker || valueLineData?.selectedTicker || valueLineData?.ticker || ""
  );

  const activeSecurity = useMemo(() => {
    const secs = valueLineData?.availableSecurities ?? [];
    if (secs.length === 0) return null;
    return (
      secs.find(
        (s) => s.ticker.toUpperCase() === selectedTicker.toUpperCase()
      ) ?? secs[0]
    );
  }, [valueLineData?.availableSecurities, selectedTicker]);

  const handleTickerSelect = (t: string) => {
    setSelectedTicker(t);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("ticker", t);
      window.history.replaceState(null, "", url.toString());
    }
  };

  const handleTabSelect = (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab || tab.disabled) return;
    setActiveTab(tabId);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (tabId === "valueline") {
        url.searchParams.delete("tab");
      } else {
        url.searchParams.set("tab", tabId);
      }
      window.history.replaceState(null, "", url.toString());
    }
  };

  const navRef = useRef<HTMLDivElement | null>(null);
  const tabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Check horizontal scroll bounds for edge fade indicator
  const updateScrollState = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 6);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 6);
  }, []);

  useEffect(() => {
    updateScrollState();
    const el = navRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
    };
  }, [updateScrollState]);

  const isFirstMountRef = useRef(true);

  // Horizontally center active tab inside the nav bar container ONLY
  const centerTabInNav = useCallback((tabId: string, smooth: boolean) => {
    const nav = navRef.current;
    const btn = tabButtonRefs.current[tabId];
    if (!nav || !btn) return;

    const targetLeft =
      btn.offsetLeft - nav.clientWidth / 2 + btn.clientWidth / 2;

    nav.scrollTo({
      left: Math.max(0, targetLeft),
      behavior: smooth ? "smooth" : "auto",
    });
  }, []);

  // Center active tab horizontally inside the nav bar on user switch, never moving window vertical scroll
  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      centerTabInNav(activeTab, false);
      updateScrollState();
      return;
    }

    centerTabInNav(activeTab, true);
    const timer = setTimeout(updateScrollState, 250);
    return () => clearTimeout(timer);
  }, [activeTab, centerTabInNav, updateScrollState]);

  // Handle ESC and prevent body scroll when sheet is open
  useEffect(() => {
    if (!isMatrixOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsMatrixOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [isMatrixOpen]);

  const panels = Children.toArray(children).filter(
    isValidElement
  ) as Array<ReactElement<{ "data-tab-panel"?: string }>>;
  const activePanel =
    panels.find((panel) => panel.props["data-tab-panel"] === activeTab) ??
    panels[0] ??
    null;

  return (
    <article className="value-line-card dvl-workspace-card">
      {/* ── 1. Master Company Header (Brand Identity, Live Price, Ticker Switcher) ── */}
      {valueLineData ? (
        <ValueLineHeader
          data={valueLineData}
          selectedTicker={selectedTicker}
          activeSecurity={activeSecurity}
          onSelectTicker={handleTickerSelect}
        />
      ) : fallbackHeader ? (
        fallbackHeader
      ) : null}

      {/* ── 2. Unified 8-Tab Navigation Bar ── */}
      <div className="company-tabs-head">
        <div className="company-tabs-bar-wrap">
          {/* Left edge fade hint */}
          <div
            className={`company-tabs-fade company-tabs-fade--left${
              canScrollLeft ? " is-visible" : ""
            }`}
            aria-hidden="true"
          />

          {/* Scrollable nav list */}
          <div
            ref={navRef}
            className="company-tabs-nav"
            role="tablist"
            aria-label="公司分析维度切换"
          >
            {tabs.map((tab) => {
              const active = tab.id === activeTab;
              const disabled = !!tab.disabled;
              return (
                <button
                  key={tab.id}
                  ref={(el) => {
                    tabButtonRefs.current[tab.id] = el;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-disabled={disabled || undefined}
                  aria-controls={`company-tab-${tab.id}`}
                  id={`company-tab-trigger-${tab.id}`}
                  className={`company-tab${active ? " company-tab--active" : ""}${disabled ? " company-tab--disabled" : ""}`}
                  onClick={() => handleTabSelect(tab.id)}
                  tabIndex={disabled ? -1 : undefined}
                >
                  <span className="company-tab-label">{tab.label}</span>
                  {tab.note && !disabled ? (
                    <span className="company-tab-note">{tab.note}</span>
                  ) : null}
                  {disabled ? (
                    <span className="company-tab-lock" aria-hidden="true">🔒</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Right edge fade hint */}
          <div
            className={`company-tabs-fade company-tabs-fade--right${
              canScrollRight ? " is-visible" : ""
            }`}
            aria-hidden="true"
          />

          {/* "All Dimensions ⊞" matrix button */}
          <button
            type="button"
            className="company-tabs-matrix-trigger"
            onClick={() => setIsMatrixOpen(true)}
            aria-label={`查看全部 ${tabs.length} 大投研分析维度`}
            title={`全部 ${tabs.length} 大投研维度`}
          >
            <svg
              className="company-tabs-matrix-icon"
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden="true"
            >
              <rect x="2" y="2" width="5" height="5" rx="1.5" />
              <rect x="9" y="2" width="5" height="5" rx="1.5" />
              <rect x="2" y="9" width="5" height="5" rx="1.5" />
              <rect x="9" y="9" width="5" height="5" rx="1.5" />
            </svg>
            <span className="company-tabs-matrix-badge">{tabs.length}</span>
          </button>
        </div>
      </div>

      {/* Drawer / Bottom Sheet Modal for Dimensions */}
      {isMatrixOpen ? (
        <div
          className="company-tabs-sheet-backdrop"
          onClick={() => setIsMatrixOpen(false)}
          aria-hidden="true"
        >
          <div
            className="company-tabs-sheet"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="深度投研维度导航"
          >
            <div className="company-tabs-sheet-handle-bar" />
            <div className="company-tabs-sheet-header">
              <div className="company-tabs-sheet-title-group">
                <h3 className="company-tabs-sheet-title">深度投研全景</h3>
                <span className="company-tabs-sheet-subtitle">
                  {tabs.length} 大核心维度 · 点击直接跳转
                </span>
              </div>
              <button
                type="button"
                className="company-tabs-sheet-close"
                onClick={() => setIsMatrixOpen(false)}
                aria-label="关闭维度导航"
              >
                ✕
              </button>
            </div>

            <div className="company-tabs-sheet-grid">
              {tabs.map((tab, idx) => {
                const active = tab.id === activeTab;
                const disabled = !!tab.disabled;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    className={`company-tabs-sheet-card${
                      active ? " company-tabs-sheet-card--active" : ""
                    }${disabled ? " company-tabs-sheet-card--disabled" : ""}`}
                    onClick={() => {
                      if (disabled) return;
                      handleTabSelect(tab.id);
                      setIsMatrixOpen(false);
                    }}
                    aria-disabled={disabled || undefined}
                    tabIndex={disabled ? -1 : undefined}
                  >
                    <div className="sheet-card-top">
                      <span className="sheet-card-index">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      {active ? (
                        <span className="sheet-card-tag">当前阅读</span>
                      ) : disabled ? (
                        <span className="sheet-card-note">待构建</span>
                      ) : tab.note ? (
                        <span className="sheet-card-note">{tab.note}</span>
                      ) : null}
                    </div>
                    <div className="sheet-card-main">
                      <span className="sheet-card-label">{tab.label}</span>
                      {tab.desc ? (
                        <span className="sheet-card-desc">{tab.desc}</span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── 3. Tab Body / Panels Area ── */}
      <div className="company-tabs-body">
        {activeTab === "valueline" ? (
          <div
            id="company-tab-valueline"
            role="tabpanel"
            aria-labelledby="company-tab-trigger-valueline"
            className="company-tabs-panel"
          >
            {valueLineData ? (
              <ValueLineBody data={valueLineData} activeSecurity={activeSecurity} />
            ) : (
              <div className="company-empty">该标的暂无完整数字价值线数据</div>
            )}
          </div>
        ) : activePanel ? (
          <div
            id={`company-tab-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`company-tab-trigger-${activeTab}`}
            className="company-tabs-panel"
          >
            {activePanel}
          </div>
        ) : null}
      </div>
    </article>
  );
}

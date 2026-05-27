"use client";

import { Children, isValidElement, useState } from "react";
import type { ReactElement, ReactNode } from "react";

export type CompanySectionTab = {
  id: string;
  label: string;
  note?: string;
};

type CompanySectionTabsProps = {
  tabs: CompanySectionTab[];
  children: ReactNode;
};

export function CompanySectionTabs({ tabs, children }: CompanySectionTabsProps) {
  const [activeTab, setActiveTab] = useState(tabs[0]?.id ?? "");

  const panels = Children.toArray(children).filter(isValidElement) as Array<ReactElement<{ "data-tab-panel"?: string }>>;
  const activePanel = panels.find((panel) => panel.props["data-tab-panel"] === activeTab) ?? panels[0] ?? null;

  return (
    <div className="company-tabs-shell">
      <div className="company-tabs-head">
        <div className="company-tabs-nav" role="tablist" aria-label="公司分析切换">
          {tabs.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`company-tab-${tab.id}`}
                id={`company-tab-trigger-${tab.id}`}
                className={`company-tab${active ? " company-tab--active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="company-tab-label">{tab.label}</span>
                {tab.note ? <span className="company-tab-note">{tab.note}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="company-tabs-body">
        {activePanel ? (
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
    </div>
  );
}

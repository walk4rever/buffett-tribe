"use client";

import { CollapsibleSection } from "@/components/agent-workspace/CollapsibleSection";
import { PortfolioPanel } from "@/components/agent-workspace/PortfolioPanel";
import { WatchlistSection } from "@/components/agent-workspace/WatchlistSection";

export function RightWorkspaceSidebar() {
  return (
    <div className="agent-workspace-sections">
      <PortfolioPanel />
      <CollapsibleSection title="关注列表" align="right">
        <WatchlistSection />
      </CollapsibleSection>
    </div>
  );
}

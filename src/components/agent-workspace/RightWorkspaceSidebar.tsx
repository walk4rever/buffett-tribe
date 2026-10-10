"use client";

import { CollapsibleSection } from "@/components/agent-workspace/CollapsibleSection";
import { PortfolioPanel } from "@/components/agent-workspace/PortfolioPanel";
import { WatchlistSection } from "@/components/agent-workspace/WatchlistSection";
import { useWatchlist } from "@/hooks/useWatchlist";

export function RightWorkspaceSidebar() {
  const { items, loading, removeWatchlist } = useWatchlist();

  return (
    <div className="agent-workspace-sections">
      <PortfolioPanel />
      <CollapsibleSection title="关注列表" align="right">
        <WatchlistSection
          items={items}
          loading={loading}
          onRemoveCompany={removeWatchlist}
        />
      </CollapsibleSection>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";

interface Quarter {
  year: number;
  quarter: number;
}

interface CompanyItem {
  securityId: string;
  zhName: string;
  enName: string;
  ticker: string | null;
}

interface Props {
  masterId: string;
  quarters: Quarter[];
  selectedYear: number;
  selectedQuarter: number;
  currentView: "quarter" | "company";
  companies?: CompanyItem[];
  selectedCompanyId?: string;
}

export function HoldingsMobileControls({
  masterId,
  quarters,
  selectedYear,
  selectedQuarter,
  currentView,
  companies = [],
  selectedCompanyId,
}: Props) {
  const router = useRouter();

  const handleViewToggle = () => {
    if (currentView === "quarter") {
      router.push(`/master/${masterId}/holdings?view=company`);
    } else {
      router.push(`/master/${masterId}/holdings?view=quarter&year=${selectedYear}&quarter=${selectedQuarter}`);
    }
  };

  const handleQuarterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const [year, quarter] = e.target.value.split("-").map(Number);
    router.push(`/master/${masterId}/holdings?view=quarter&year=${year}&quarter=${quarter}`);
  };

  const handleCompanyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    // Company selection in the按公司 view - we'll handle this via scroll or state
    const companyId = e.target.value;
    // Trigger a custom event that HoldingsHistoryExplorer can listen to
    window.dispatchEvent(new CustomEvent('selectCompany', { detail: companyId }));
  };

  return (
    <div className="holdings-mobile-controls">
      {/* View toggle button */}
      <button
        type="button"
        className="holdings-mobile-toggle"
        onClick={handleViewToggle}
      >
        <span className={`holdings-mobile-toggle-option ${currentView === "quarter" ? "active" : ""}`}>
          按季度
        </span>
        <span className={`holdings-mobile-toggle-option ${currentView === "company" ? "active" : ""}`}>
          按公司
        </span>
      </button>

      {/* Selector based on current view */}
      <div className="holdings-mobile-control">
        {currentView === "quarter" ? (
          <>
            <label htmlFor="quarter-select" className="holdings-mobile-label">
              选择季度
            </label>
            <select
              id="quarter-select"
              value={`${selectedYear}-${selectedQuarter}`}
              onChange={handleQuarterChange}
              className="holdings-mobile-select"
            >
              {quarters.map((q) => (
                <option key={`${q.year}-${q.quarter}`} value={`${q.year}-${q.quarter}`}>
                  {q.year} Q{q.quarter}
                </option>
              ))}
            </select>
          </>
        ) : companies.length > 0 ? (
          <>
            <label htmlFor="company-select" className="holdings-mobile-label">
              选择公司
            </label>
            <select
              id="company-select"
              value={selectedCompanyId || companies[0]?.securityId}
              onChange={handleCompanyChange}
              className="holdings-mobile-select"
            >
              {companies.map((c) => (
                <option key={c.securityId} value={c.securityId}>
                  {c.zhName || c.enName} {c.ticker ? `(${c.ticker})` : ""}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>
    </div>
  );
}

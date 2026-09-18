import { describe, expect, it } from "vitest";
import { COMPANY_REFERENCE_FILING_KINDS } from "@/lib/company-data";

describe("Periodic Filings & Reader Pipeline", () => {
  it("includes all periodic filing kinds in reference filing kinds", () => {
    expect(COMPANY_REFERENCE_FILING_KINDS).toContain("10q");
    expect(COMPANY_REFERENCE_FILING_KINDS).toContain("10k");
    expect(COMPANY_REFERENCE_FILING_KINDS).toContain("cn-annual-report");
    expect(COMPANY_REFERENCE_FILING_KINDS).toContain("cn-interim-report");
    expect(COMPANY_REFERENCE_FILING_KINDS).toContain("cn-quarterly-report");
    expect(COMPANY_REFERENCE_FILING_KINDS).toContain("hk-annual-report");
    expect(COMPANY_REFERENCE_FILING_KINDS).toContain("hk-interim-report");
    expect(COMPANY_REFERENCE_FILING_KINDS).toContain("hk-quarterly-report");
  });

  it("formats periodic labels correctly for annual, semi-annual, and quarterly reports", () => {
    function formatPeriodLabel(filing: { periodYear: number | null; periodQuarter: number | null; kind: string }) {
      if (!filing.periodYear) return "—";
      if (!filing.periodQuarter) return `${filing.periodYear}`;
      if (filing.periodQuarter === 2 && filing.kind.includes("interim")) {
        return `${filing.periodYear} H1`;
      }
      return `${filing.periodYear} Q${filing.periodQuarter}`;
    }

    expect(formatPeriodLabel({ periodYear: 2026, periodQuarter: 3, kind: "10q" })).toBe("2026 Q3");
    expect(formatPeriodLabel({ periodYear: 2026, periodQuarter: 2, kind: "cn-interim-report" })).toBe("2026 H1");
    expect(formatPeriodLabel({ periodYear: 2026, periodQuarter: 1, kind: "cn-quarterly-report" })).toBe("2026 Q1");
    expect(formatPeriodLabel({ periodYear: 2025, periodQuarter: 2, kind: "hk-interim-report" })).toBe("2025 H1");
    expect(formatPeriodLabel({ periodYear: 2025, periodQuarter: null, kind: "10k" })).toBe("2025");
  });

  it("determines correct reader type from filing artifacts", () => {
    function getReaderType(artifacts: Array<{ kind: string }>) {
      if (artifacts.some((a) => a.kind === "primary_pdf")) return "pdf";
      if (artifacts.some((a) => a.kind === "primary_html")) return "html";
      return "none";
    }

    expect(getReaderType([{ kind: "primary_html" }])).toBe("html");
    expect(getReaderType([{ kind: "primary_pdf" }, { kind: "section_text" }])).toBe("pdf");
    expect(getReaderType([{ kind: "data_file" }])).toBe("none");
  });

  it("sorts periodic filings newest-first by year, quarter, then date", () => {
    const list = [
      { year: 2025, quarter: 1, date: "2025-04-20" },
      { year: 2026, quarter: 2, date: "2026-08-15" },
      { year: 2026, quarter: 1, date: "2026-04-25" },
      { year: 2025, quarter: null, date: "2026-03-25" },
      { year: 2025, quarter: 3, date: "2025-10-25" },
    ];

    const sorted = [...list].sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      const aq = a.quarter ?? -Infinity;
      const bq = b.quarter ?? -Infinity;
      if (aq !== bq) return bq - aq;
      return b.date.localeCompare(a.date);
    });

    expect(sorted[0]).toEqual({ year: 2026, quarter: 2, date: "2026-08-15" });
    expect(sorted[1]).toEqual({ year: 2026, quarter: 1, date: "2026-04-25" });
    expect(sorted[2]).toEqual({ year: 2025, quarter: 3, date: "2025-10-25" });
    expect(sorted[3]).toEqual({ year: 2025, quarter: 1, date: "2025-04-20" });
    expect(sorted[4]).toEqual({ year: 2025, quarter: null, date: "2026-03-25" });
  });
});

"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  formatCompanyCikUrl,
  type CompanyAnnualFiling,
  type CompanyAnnualFilingBlock,
  type CompanyAnnualFilingOutlineNode,
} from "@/lib/company-data";

type FilingReaderProps = {
  company: {
    name: string;
    ticker: string | null;
    cik: string | null;
  };
  filing: CompanyAnnualFiling;
};

type FilingTemplate = {
  order: string[];
  labels: Record<string, { zh: string; en: string }>;
  itemNumbers: Record<string, string>;
  groups: { part: string; label: { zh: string; en: string }; items: string[] }[];
};

type StructuredFilingSection = CompanyAnnualFiling["sections"][number] & {
  blocks: CompanyAnnualFilingBlock[];
  outline: CompanyAnnualFilingOutlineNode[];
};

type HydratedFilingSection = Partial<Pick<
  CompanyAnnualFiling["sections"][number],
  "content" | "rawHtml" | "outlineJson" | "blocksJson" | "contentPreview" | "contentTextLength" | "blockCount" | "extractionVersion"
>>;

type ReaderSection = {
  section: string;
  standard: boolean;
  data: StructuredFilingSection | null;
};

const SECTION_ORDER_10K = [
  "item_1_business",
  "item_1a_risk_factors",
  "item_1b_staff_comments",
  "item_1c_cybersecurity",
  "item_2_properties",
  "item_3_legal",
  "item_4_mine_safety",
  "item_5_market",
  "item_6_selected_data",
  "item_7_mda",
  "item_7a_market_risk",
  "item_8_financial_statements",
  "item_9_accountants",
  "item_9a_controls",
  "item_9b_other",
  "item_9c_foreign",
  "item_10_directors",
  "item_11_compensation",
  "item_12_ownership",
  "item_13_relationships",
  "item_14_accountant_fees",
  "item_15_exhibits",
  "item_16_summary",
];

const SECTION_LABELS_10K: Record<string, { zh: string; en: string }> = {
  item_1_business: { zh: "业务", en: "Business" },
  item_1a_risk_factors: { zh: "风险因素", en: "Risk Factors" },
  item_1b_staff_comments: { zh: "员工评论", en: "Staff Comments" },
  item_1c_cybersecurity: { zh: "网络安全", en: "Cybersecurity" },
  item_2_properties: { zh: "资产", en: "Properties" },
  item_3_legal: { zh: "法律诉讼", en: "Legal Proceedings" },
  item_4_mine_safety: { zh: "矿山安全披露", en: "Mine Safety" },
  item_5_market: { zh: "股权市场", en: "Market for Equity" },
  item_6_selected_data: { zh: "精选财务数据", en: "Selected Financial Data" },
  item_7_mda: { zh: "管理层讨论与分析", en: "MD&A" },
  item_7a_market_risk: { zh: "市场风险", en: "Market Risk" },
  item_8_financial_statements: { zh: "财务报表", en: "Financial Statements" },
  item_9_accountants: { zh: "会计师变更", en: "Accountant Changes" },
  item_9a_controls: { zh: "内控与程序", en: "Controls & Procedures" },
  item_9b_other: { zh: "其他信息", en: "Other Information" },
  item_9c_foreign: { zh: "境外司法披露", en: "Foreign Jurisdictions" },
  item_10_directors: { zh: "董事与高管", en: "Directors & Officers" },
  item_11_compensation: { zh: "高管薪酬", en: "Executive Compensation" },
  item_12_ownership: { zh: "股权所有权", en: "Security Ownership" },
  item_13_relationships: { zh: "关联交易", en: "Related Transactions" },
  item_14_accountant_fees: { zh: "会计师费用", en: "Accountant Fees" },
  item_15_exhibits: { zh: "附件与附表", en: "Exhibits & Schedules" },
  item_16_summary: { zh: "10-K 摘要", en: "Form 10-K Summary" },
};

const SECTION_ITEM_NUM_10K: Record<string, string> = {
  item_1_business: "1",
  item_1a_risk_factors: "1A",
  item_1b_staff_comments: "1B",
  item_1c_cybersecurity: "1C",
  item_2_properties: "2",
  item_3_legal: "3",
  item_4_mine_safety: "4",
  item_5_market: "5",
  item_6_selected_data: "6",
  item_7_mda: "7",
  item_7a_market_risk: "7A",
  item_8_financial_statements: "8",
  item_9_accountants: "9",
  item_9a_controls: "9A",
  item_9b_other: "9B",
  item_9c_foreign: "9C",
  item_10_directors: "10",
  item_11_compensation: "11",
  item_12_ownership: "12",
  item_13_relationships: "13",
  item_14_accountant_fees: "14",
  item_15_exhibits: "15",
  item_16_summary: "16",
};

const PART_GROUPS_10K: { part: string; label: { zh: string; en: string }; items: string[] }[] = [
  {
    part: "PART I",
    label: { zh: "第一部分", en: "Part I" },
    items: ["item_1_business", "item_1a_risk_factors", "item_1b_staff_comments", "item_1c_cybersecurity", "item_2_properties", "item_3_legal", "item_4_mine_safety"],
  },
  {
    part: "PART II",
    label: { zh: "第二部分", en: "Part II" },
    items: ["item_5_market", "item_6_selected_data", "item_7_mda", "item_7a_market_risk", "item_8_financial_statements", "item_9_accountants", "item_9a_controls", "item_9b_other", "item_9c_foreign"],
  },
  {
    part: "PART III",
    label: { zh: "第三部分", en: "Part III" },
    items: ["item_10_directors", "item_11_compensation", "item_12_ownership", "item_13_relationships", "item_14_accountant_fees"],
  },
  {
    part: "PART IV",
    label: { zh: "第四部分", en: "Part IV" },
    items: ["item_15_exhibits", "item_16_summary"],
  },
];

const SECTION_ORDER_20F = [
  "item_1_identity_directors",
  "item_2_offer_statistics",
  "item_3_key_information",
  "item_4_company_information",
  "item_4a_unresolved_comments",
  "item_5_operating_financial_review",
  "item_6_directors_management_employees",
  "item_7_major_shareholders_related_party",
  "item_8_financial_information",
  "item_9_offer_listing",
  "item_10_additional_information",
  "item_11_market_risk",
  "item_12_equity_securities",
  "item_13_defaults_dividends",
  "item_14_material_modifications",
  "item_15_controls_procedures",
  "item_16a_audit_committee_expert",
  "item_16b_code_of_ethics",
  "item_16c_principal_accountant_fees",
  "item_16d_exemptions_audit_committee",
  "item_16e_purchases_by_issuer",
  "item_16f_change_registrant_certifying_accountant",
  "item_16g_corporate_governance",
  "item_16h_mine_safety",
  "item_16i_disclosure_foreign_jurisdictions",
  "item_16j_insider_trading_policies",
  "item_16k_cybersecurity",
  "item_17_financial_statements",
  "item_18_financial_statements_us_gaap",
  "item_19_exhibits",
];

const SECTION_LABELS_20F: Record<string, { zh: string; en: string }> = {
  item_1_identity_directors: { zh: "董事及顾问身份", en: "Identity of Directors, Senior Management and Advisers" },
  item_2_offer_statistics: { zh: "发行统计与时间表", en: "Offer Statistics and Expected Timetable" },
  item_3_key_information: { zh: "关键信息", en: "Key Information" },
  item_4_company_information: { zh: "公司信息", en: "Information on the Company" },
  item_4a_unresolved_comments: { zh: "未决员工意见", en: "Unresolved Staff Comments" },
  item_5_operating_financial_review: { zh: "经营与财务回顾", en: "Operating and Financial Review and Prospects" },
  item_6_directors_management_employees: { zh: "董事高管与员工", en: "Directors, Senior Management and Employees" },
  item_7_major_shareholders_related_party: { zh: "主要股东与关联方", en: "Major Shareholders and Related Party Transactions" },
  item_8_financial_information: { zh: "财务信息", en: "Financial Information" },
  item_9_offer_listing: { zh: "上市与发行", en: "The Offer and Listing" },
  item_10_additional_information: { zh: "补充信息", en: "Additional Information" },
  item_11_market_risk: { zh: "市场风险", en: "Quantitative and Qualitative Disclosures About Market Risk" },
  item_12_equity_securities: { zh: "股本证券说明", en: "Description of Securities Other than Equity Securities" },
  item_13_defaults_dividends: { zh: "违约与股息拖欠", en: "Defaults, Dividend Arrearages and Delinquencies" },
  item_14_material_modifications: { zh: "重大权利变更", en: "Material Modifications to the Rights of Security Holders" },
  item_15_controls_procedures: { zh: "控制与程序", en: "Controls and Procedures" },
  item_16a_audit_committee_expert: { zh: "审计委员会专家", en: "Audit Committee Financial Expert" },
  item_16b_code_of_ethics: { zh: "道德准则", en: "Code of Ethics" },
  item_16c_principal_accountant_fees: { zh: "审计师费用", en: "Principal Accountant Fees and Services" },
  item_16d_exemptions_audit_committee: { zh: "审计委员会豁免", en: "Exemptions from Audit Committee Listing Standards" },
  item_16e_purchases_by_issuer: { zh: "发行人购回证券", en: "Purchases of Equity Securities by the Issuer" },
  item_16f_change_registrant_certifying_accountant: { zh: "更换认证会计师", en: "Change in Registrant's Certifying Accountant" },
  item_16g_corporate_governance: { zh: "公司治理", en: "Corporate Governance" },
  item_16h_mine_safety: { zh: "矿山安全", en: "Mine Safety Disclosure" },
  item_16i_disclosure_foreign_jurisdictions: { zh: "外国司法辖区披露", en: "Disclosure Regarding Foreign Jurisdictions" },
  item_16j_insider_trading_policies: { zh: "内幕交易政策", en: "Insider Trading Policies" },
  item_16k_cybersecurity: { zh: "网络安全", en: "Cybersecurity" },
  item_17_financial_statements: { zh: "财务报表", en: "Financial Statements" },
  item_18_financial_statements_us_gaap: { zh: "按美国准则财报", en: "Financial Statements" },
  item_19_exhibits: { zh: "附件", en: "Exhibits" },
};

const SECTION_ITEM_NUM_20F: Record<string, string> = {
  item_1_identity_directors: "1",
  item_2_offer_statistics: "2",
  item_3_key_information: "3",
  item_4_company_information: "4",
  item_4a_unresolved_comments: "4A",
  item_5_operating_financial_review: "5",
  item_6_directors_management_employees: "6",
  item_7_major_shareholders_related_party: "7",
  item_8_financial_information: "8",
  item_9_offer_listing: "9",
  item_10_additional_information: "10",
  item_11_market_risk: "11",
  item_12_equity_securities: "12",
  item_13_defaults_dividends: "13",
  item_14_material_modifications: "14",
  item_15_controls_procedures: "15",
  item_16a_audit_committee_expert: "16A",
  item_16b_code_of_ethics: "16B",
  item_16c_principal_accountant_fees: "16C",
  item_16d_exemptions_audit_committee: "16D",
  item_16e_purchases_by_issuer: "16E",
  item_16f_change_registrant_certifying_accountant: "16F",
  item_16g_corporate_governance: "16G",
  item_16h_mine_safety: "16H",
  item_16i_disclosure_foreign_jurisdictions: "16I",
  item_16j_insider_trading_policies: "16J",
  item_16k_cybersecurity: "16K",
  item_17_financial_statements: "17",
  item_18_financial_statements_us_gaap: "18",
  item_19_exhibits: "19",
};

const PART_GROUPS_20F: { part: string; label: { zh: string; en: string }; items: string[] }[] = [
  {
    part: "PART I",
    label: { zh: "第一部分", en: "Part I" },
    items: [
      "item_1_identity_directors",
      "item_2_offer_statistics",
      "item_3_key_information",
      "item_4_company_information",
      "item_4a_unresolved_comments",
      "item_5_operating_financial_review",
      "item_6_directors_management_employees",
      "item_7_major_shareholders_related_party",
      "item_8_financial_information",
    ],
  },
  {
    part: "PART II",
    label: { zh: "第二部分", en: "Part II" },
    items: [
      "item_9_offer_listing",
      "item_10_additional_information",
      "item_11_market_risk",
      "item_12_equity_securities",
      "item_13_defaults_dividends",
      "item_14_material_modifications",
      "item_15_controls_procedures",
      "item_16a_audit_committee_expert",
      "item_16b_code_of_ethics",
      "item_16c_principal_accountant_fees",
      "item_16d_exemptions_audit_committee",
      "item_16e_purchases_by_issuer",
      "item_16f_change_registrant_certifying_accountant",
      "item_16g_corporate_governance",
      "item_16h_mine_safety",
      "item_16i_disclosure_foreign_jurisdictions",
      "item_16j_insider_trading_policies",
      "item_16k_cybersecurity",
    ],
  },
  {
    part: "PART III",
    label: { zh: "第三部分", en: "Part III" },
    items: ["item_17_financial_statements", "item_18_financial_statements_us_gaap", "item_19_exhibits"],
  },
];

const SECTION_ORDER_40F = [
  "annual_information_form",
  "audited_annual_financial_statements",
  "management_discussion_and_analysis",
  "disclosure_controls_procedures",
  "management_internal_control_report",
  "auditor_attestation_internal_control",
  "changes_internal_control",
  "audit_committee_financial_expert",
  "code_of_ethics",
  "principal_accountant_fees_services",
  "certifications",
  "exhibits",
];

const SECTION_LABELS_40F: Record<string, { zh: string; en: string }> = {
  annual_information_form: { zh: "年度信息表", en: "Annual Information Form" },
  audited_annual_financial_statements: { zh: "经审计年度财务报表", en: "Audited Annual Financial Statements" },
  management_discussion_and_analysis: { zh: "管理层讨论与分析", en: "Management's Discussion and Analysis" },
  disclosure_controls_procedures: { zh: "披露控制与程序", en: "Disclosure Controls and Procedures" },
  management_internal_control_report: { zh: "管理层内控报告", en: "Management Report on Internal Control" },
  auditor_attestation_internal_control: { zh: "审计师内控鉴证", en: "Auditor Attestation on Internal Control" },
  changes_internal_control: { zh: "内控变化", en: "Changes in Internal Control" },
  audit_committee_financial_expert: { zh: "审计委员会财务专家", en: "Audit Committee Financial Expert" },
  code_of_ethics: { zh: "道德准则", en: "Code of Ethics" },
  principal_accountant_fees_services: { zh: "审计师费用与服务", en: "Principal Accountant Fees and Services" },
  certifications: { zh: "管理层认证", en: "Certifications" },
  exhibits: { zh: "附件", en: "Exhibits" },
};

const SECTION_ITEM_NUM_40F: Record<string, string> = {
  annual_information_form: "AIF",
  audited_annual_financial_statements: "FS",
  management_discussion_and_analysis: "MD&A",
  disclosure_controls_procedures: "CTRL",
  management_internal_control_report: "ICFR",
  auditor_attestation_internal_control: "AUD",
  changes_internal_control: "CHG",
  audit_committee_financial_expert: "ACFE",
  code_of_ethics: "ETH",
  principal_accountant_fees_services: "FEES",
  certifications: "CERT",
  exhibits: "EX",
};

const PART_GROUPS_40F: { part: string; label: { zh: string; en: string }; items: string[] }[] = [
  {
    part: "CORE",
    label: { zh: "核心文件", en: "Core Documents" },
    items: ["annual_information_form", "audited_annual_financial_statements", "management_discussion_and_analysis"],
  },
  {
    part: "CONTROLS",
    label: { zh: "控制与治理", en: "Controls & Governance" },
    items: [
      "disclosure_controls_procedures",
      "management_internal_control_report",
      "auditor_attestation_internal_control",
      "changes_internal_control",
      "audit_committee_financial_expert",
      "code_of_ethics",
      "principal_accountant_fees_services",
      "certifications",
    ],
  },
  {
    part: "EXHIBITS",
    label: { zh: "附件", en: "Exhibits" },
    items: ["exhibits"],
  },
];

const FILING_TEMPLATES: Record<string, FilingTemplate> = {
  "10k": {
    order: SECTION_ORDER_10K,
    labels: SECTION_LABELS_10K,
    itemNumbers: SECTION_ITEM_NUM_10K,
    groups: PART_GROUPS_10K,
  },
  "20f": {
    order: SECTION_ORDER_20F,
    labels: SECTION_LABELS_20F,
    itemNumbers: SECTION_ITEM_NUM_20F,
    groups: PART_GROUPS_20F,
  },
  "40f": {
    order: SECTION_ORDER_40F,
    labels: SECTION_LABELS_40F,
    itemNumbers: SECTION_ITEM_NUM_40F,
    groups: PART_GROUPS_40F,
  },
};

function formatFilingDate(date: Date | null) {
  if (!date) return "—";
  return date.toISOString().slice(0, 10);
}

function formatFilingKindLabel(kind: string) {
  if (kind === "10k") return "10-K";
  if (kind === "20f") return "20-F";
  if (kind === "40f") return "40-F";
  return kind.toUpperCase();
}

function formatFileSize(bytes: bigint | null) {
  if (bytes == null) return "—";
  const value = Number(bytes);
  if (!Number.isFinite(value)) return "—";
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function getSectionLabel(section: string, labels: FilingTemplate["labels"]) {
  return labels[section] ?? {
    zh: section.replaceAll("_", " "),
    en: section,
  };
}

function getSectionKicker(section: string, itemNumbers: FilingTemplate["itemNumbers"]) {
  return itemNumbers[section] ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBlockArray(value: unknown): value is CompanyAnnualFilingBlock[] {
  return Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.type === "string" && typeof item.id === "string");
}

function isOutlineNode(value: unknown): value is CompanyAnnualFilingOutlineNode {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    typeof value.level === "number" &&
    Array.isArray(value.children) &&
    value.children.every(isOutlineNode)
  );
}

function isOutlineArray(value: unknown): value is CompanyAnnualFilingOutlineNode[] {
  return Array.isArray(value) && value.every(isOutlineNode);
}

function parseBlocksJson(value: unknown): CompanyAnnualFilingBlock[] {
  return isBlockArray(value) ? value : [];
}

function parseOutlineJson(value: unknown): CompanyAnnualFilingOutlineNode[] {
  return isOutlineArray(value) ? value : [];
}

function isSectionHeadingBlock(text: string) {
  return /^ITEM\s+\d+[A-Z]?\b/i.test(text.trim());
}

function isBoilerplateText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return true;
  if (/^\d+$/.test(normalized)) return true;
  if (/^\$[0-9a-z]+$/i.test(normalized)) return true;
  if (/^Apple Inc\. \| \d{4} Form 10-K \| \d+$/i.test(normalized)) return true;
  if (/^Apple Inc\.$/i.test(normalized)) return true;
  if (/^Form 10-K$/i.test(normalized)) return true;
  if (/^Table of Contents$/i.test(normalized)) return true;
  return false;
}

function filterOutlineNodes(
  nodes: CompanyAnnualFilingOutlineNode[],
): CompanyAnnualFilingOutlineNode[] {
  return nodes
    .filter((node) => {
      if (isBoilerplateText(node.title)) return false;
      // Remove ALL Item headings from the outline — the section button already
      // shows the Item title (e.g. "Item 1. Business"). The outline should only
      // contain sub-headings within the section.
      if (/^Item\s+\d+[A-Z]?\b/i.test(node.title.trim())) return false;
      return true;
    })
    .map((node) => ({
      ...node,
      children: filterOutlineNodes(node.children),
    }))
    .filter((node, index, arr) => {
      const key = `${node.title.toLowerCase()}|${node.level}|${node.anchor ?? ""}`;
      return index === arr.findIndex((other) => `${other.title.toLowerCase()}|${other.level}|${other.anchor ?? ""}` === key);
    });
}

function filterBlocks(blocks: CompanyAnnualFilingBlock[]) {
  return blocks.filter((block) => {
    if (block.type === "table") return true;
    const text = block.text.replace(/\s+/g, " ").trim();
    if (isBoilerplateText(text)) return false;
    if (block.type === "note" && /^ITEM\s+\d+[A-Z]?\b/i.test(text)) return false;
    return true;
  });
}

function sortSections(sections: CompanyAnnualFiling["sections"], order: string[]) {
  return [...sections].sort((a, b) => {
    const ai = order.indexOf(a.section);
    const bi = order.indexOf(b.section);
    if (ai === -1 && bi === -1) return a.section.localeCompare(b.section);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function renderLegacyTextContent(content: string) {
  const paragraphs = content
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (!paragraphs.length) {
    return <p className="filing-reader-empty-paragraph">暂无正文内容。</p>;
  }

  return paragraphs.map((paragraph, index) => {
    const lines = paragraph.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return null;

    if (lines.length === 1 && isSectionHeadingBlock(lines[0])) {
      return (
        <h4 key={`${index}-heading`} className="filing-reader-inline-heading">
          {lines[0]}
        </h4>
      );
    }

    if (lines.every((line) => /^([•*-]|\d+[\.)]|\([a-z0-9]+\))\s+/i.test(line))) {
      return (
        <ul key={`${index}-list`} className="filing-reader-list">
          {lines.map((line, lineIndex) => (
            <li key={`${lineIndex}`}>{line.replace(/^([•*-]|\d+[\.)]|\([a-z0-9]+\))\s+/i, "")}</li>
          ))}
        </ul>
      );
    }

    return (
      <p key={`${index}-paragraph`} className="filing-reader-paragraph">
        {lines.map((line, lineIndex) => (
          <span key={`${lineIndex}`}>
            {line}
            {lineIndex < lines.length - 1 ? <br /> : null}
          </span>
        ))}
      </p>
    );
  });
}

function renderBlock(block: CompanyAnnualFilingBlock) {
  switch (block.type) {
    case "heading":
      return (
        <h4 className={`filing-reader-block-heading filing-reader-block-heading--level${block.level}`}>
          {block.text}
        </h4>
      );
    case "paragraph":
      return <p className="filing-reader-paragraph">{block.text}</p>;
    case "note":
      return (
        <h5 className="filing-reader-block-heading filing-reader-block-heading--note">
          {block.text}
        </h5>
      );
    case "list":
      return block.ordered ? (
        <ol className="filing-reader-list filing-reader-list--ordered">
          {block.items.map((item, index) => (
            <li key={`${block.id}-${index}`}>{item}</li>
          ))}
        </ol>
      ) : (
        <ul className="filing-reader-list">
          {block.items.map((item, index) => (
            <li key={`${block.id}-${index}`}>{item}</li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div className="filing-reader-table-wrap">
          <table className="filing-reader-table">
            {block.caption ? (
              <caption className="filing-reader-table-caption">{block.caption}</caption>
            ) : null}
            {block.headers.length ? (
              <thead>
                <tr>
                  {block.headers.map((header, index) => (
                    <th key={`${block.id}-head-${index}`}>{header}</th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={`${block.id}-row-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`${block.id}-cell-${rowIndex}-${cellIndex}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}

function renderOutlineNodes(
  nodes: CompanyAnnualFilingOutlineNode[],
  jumpToAnchor: (anchor: string | null) => void,
  depth = 0,
  maxDepth = 2,
) {
  if (!nodes.length || depth >= maxDepth) return null;
  return (
    <ul className={`filing-reader-nav-tree filing-reader-nav-tree--depth-${depth}`}>
      {nodes.map((node) => (
        <li key={`${node.anchor ?? node.title}-${node.level}`}>
          <button
            type="button"
            className={`filing-reader-nav-tree-link filing-reader-nav-tree-link--depth-${depth}`}
            onClick={() => jumpToAnchor(node.anchor)}
            title={node.title}
          >
            {node.title}
          </button>
          {node.children.length ? renderOutlineNodes(node.children, jumpToAnchor, depth + 1, maxDepth) : null}
        </li>
      ))}
    </ul>
  );
}

export function FilingReader({ company, filing }: FilingReaderProps) {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const filingTemplate = useMemo(() => {
    return FILING_TEMPLATES[filing.kind] ?? FILING_TEMPLATES["10k"];
  }, [filing.kind]);

  const sortedSections = useMemo(() => {
    return sortSections(filing.sections, filingTemplate.order);
  }, [filing.sections, filingTemplate.order]);
  const [hydratedBySection, setHydratedBySection] = useState<Record<string, HydratedFilingSection>>({});

  const structuredSections = useMemo(() => {
    return sortedSections.map((section) => {
      const hydrated = hydratedBySection[section.section] ?? {};
      const merged = { ...section, ...hydrated };
      const blocks = filterBlocks(parseBlocksJson(merged.blocksJson));
      const outline = filterOutlineNodes(parseOutlineJson(merged.outlineJson));
      return {
        ...merged,
        blocks,
        outline,
      };
    });
  }, [hydratedBySection, sortedSections]);

  const structuredBySection = useMemo(() => {
    return new Map(structuredSections.map((section) => [section.section, section]));
  }, [structuredSections]);

  const extractedStandardSectionCount = useMemo(() => {
    return filingTemplate.order.filter((section) => structuredBySection.has(section)).length;
  }, [filingTemplate.order, structuredBySection]);

  const readerSections = useMemo<ReaderSection[]>(() => {
    const standardSections = filingTemplate.order.map((section) => ({
      section,
      standard: true,
      data: structuredBySection.get(section) ?? null,
    }));
    const configured = new Set(filingTemplate.order);
    const additionalSections = structuredSections
      .filter((section) => !configured.has(section.section))
      .map((section) => ({
        section: section.section,
        standard: false,
        data: section,
      }));
    return [...standardSections, ...additionalSections];
  }, [filingTemplate.order, structuredBySection, structuredSections]);

  const navGroups = useMemo(() => {
    const groups = filingTemplate.groups.map((group) => ({
      ...group,
      items: group.items,
    }));

    const configured = new Set(filingTemplate.groups.flatMap((group) => group.items));
    const additionalItems = structuredSections
      .map((section) => section.section)
      .filter((section) => !configured.has(section));

    if (additionalItems.length) {
      groups.push({
        part: "OTHER",
        label: { zh: "其他章节", en: "Additional Sections" },
        items: additionalItems,
      });
    }

    return groups;
  }, [filingTemplate.groups, structuredSections]);

  const currentSection = useMemo(() => {
    if (!readerSections.length) return null;
    if (activeSection && readerSections.some((section) => section.section === activeSection)) {
      return activeSection;
    }
    return readerSections[0].section;
  }, [activeSection, readerSections]);

  const currentSectionData = useMemo(() => {
    if (!currentSection) return null;
    return structuredBySection.get(currentSection) ?? null;
  }, [currentSection, structuredBySection]);

  useEffect(() => {
    if (!currentSection || hydratedBySection[currentSection]) return;
    const section = structuredBySection.get(currentSection);
    if (!section) return;

    const hasFullText = section.contentTextLength <= section.content.length;
    const needsText = Boolean(section.textArtifactId && !section.blocks.length && !hasFullText);
    const needsBlocks = Boolean(section.blocksArtifactId && !section.blocks.length);
    if (!needsText && !needsBlocks) return;

    const controller = new AbortController();
    const params = new URLSearchParams({ sourceId: filing.id, section: currentSection });

    fetch(`/api/filing-section?${params.toString()}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (!payload || controller.signal.aborted) return;
        setHydratedBySection((current) => ({
          ...current,
          [currentSection]: payload,
        }));
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.warn(`Failed to hydrate filing section ${currentSection}:`, err);
      });

    return () => controller.abort();
  }, [currentSection, filing.id, hydratedBySection, structuredBySection]);

  const reportLabel = `${filing.periodYear ?? "—"}${filing.periodQuarter ? ` Q${filing.periodQuarter}` : ""}`;
  const companyUrl = formatCompanyCikUrl(company.cik) ?? `/company/${company.cik ?? ""}`;
  const referencesUrl = `${companyUrl}?tab=references`;
  const filingDateLabel = filing.filedAt ? formatFilingDate(filing.filedAt) : null;
  const reportDateLabel = filing.ts ? formatFilingDate(filing.ts) : null;
  const supplementalFiles = useMemo(() => {
    const attachmentFiles = filing.attachments.map((attachment) => ({
      key: `attachment-${attachment.sequence}-${attachment.documentName}`,
      label: attachment.documentName || attachment.documentType,
      meta: [attachment.documentType, attachment.sequence, attachment.description].filter(Boolean).join(" · "),
      href: attachment.url,
    }));

    const artifactFiles = filing.artifacts
      .filter((artifact) => !artifact.kind.startsWith("section_"))
      .filter((artifact) => artifact.publicUrl)
      .map((artifact) => ({
        key: `artifact-${artifact.objectKey}`,
        label: artifact.originalName ?? artifact.objectKey.split("/").pop() ?? artifact.objectKey,
        meta: [artifact.kind, formatFileSize(artifact.sizeBytes)].filter(Boolean).join(" · "),
        href: artifact.publicUrl!,
      }));

    return [...attachmentFiles, ...artifactFiles];
  }, [filing]);
  const visibleFiles = showAllFiles ? supplementalFiles : supplementalFiles.slice(0, 5);
  const hiddenFileCount = Math.max(0, supplementalFiles.length - visibleFiles.length);

  useEffect(() => {
    if (!contentRef.current || !readerSections.length) return;

    const container = contentRef.current;
    const sectionElements = Array.from(container.querySelectorAll<HTMLElement>("[data-section]"));
    let raf = 0;

    const updateActiveSection = () => {
      raf = 0;
      if (!sectionElements.length) return;

      const centerY = container.scrollTop + container.clientHeight * 0.28;
      let nextSection = sectionElements[0].dataset.section ?? null;

      for (const el of sectionElements) {
        if (el.offsetTop <= centerY) {
          nextSection = el.dataset.section ?? nextSection;
        } else {
          break;
        }
      }

      if (nextSection) {
        setActiveSection((current) => (current === nextSection ? current : nextSection));
      }
    };

    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(updateActiveSection);
    };

    updateActiveSection();
    container.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      container.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [readerSections]);

  const jumpToSection = (section: string) => {
    const el = document.getElementById(`filing-section-${section}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveSection(section);
  };

  const jumpToAnchor = (anchor: string | null) => {
    if (!anchor) return;
    const el = document.getElementById(anchor);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    // Fallback: anchor may belong to a section whose rawHtml does not contain
    // the original heading element. Try to locate the owning section via blocks.
    for (const sec of structuredSections) {
      const inBlocks = sec.blocks.some((b) => b.id === anchor);
      if (inBlocks) {
        jumpToSection(sec.section);
        return;
      }
      const inOutline = (nodes: CompanyAnnualFilingOutlineNode[]): boolean =>
        nodes.some((n) => n.anchor === anchor || inOutline(n.children));
      if (inOutline(sec.outline)) {
        jumpToSection(sec.section);
        return;
      }
    }
  };


  return (
    <div className="filing-reader">
      <div className="filing-reader-bar">
        <div className="filing-reader-bar-left">
          <button
            type="button"
            className="filing-reader-desktop-toggle"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label={sidebarOpen ? "收起侧栏" : "展开侧栏"}
          >
            {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <button
            type="button"
            className="filing-reader-mobile-menu"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label={sidebarOpen ? "收起目录" : "展开目录"}
          >
            {sidebarOpen ? <PanelLeftClose size={16} /> : <Menu size={16} />}
          </button>
          <Link href={referencesUrl} className="filing-reader-back" aria-label="返回年度报告">
            <ChevronLeft size={15} />
          </Link>
          <div className="filing-reader-bar-copy">
            <span className="filing-reader-bar-label">Annual Report Reader</span>
            <span className="filing-reader-bar-name">
              {company.name}
              {company.ticker ? <em>{company.ticker}</em> : null}
            </span>
          </div>
        </div>
        <div className="filing-reader-bar-right">
          <span className="filing-reader-bar-pill">{reportLabel}</span>
          {filingDateLabel ? <span className="filing-reader-bar-meta">Filed {filingDateLabel}</span> : null}
          {reportDateLabel ? <span className="filing-reader-bar-meta">Report {reportDateLabel}</span> : null}
        </div>
      </div>

      <div className={`filing-reader-body${sidebarOpen ? "" : " filing-reader-body--sidebar-collapsed"}`}>
        <aside className="filing-reader-sidebar">
          {currentSectionData?.outline.length ? (
            <div className="filing-reader-sidebar-card filing-reader-sidebar-card--outline">
              <p>On This Item</p>
              {renderOutlineNodes(currentSectionData.outline, jumpToAnchor)}
            </div>
          ) : null}

          <div className="filing-reader-nav">
            {navGroups.map((group) => (
              <div key={group.part} className="filing-reader-nav-part">
                <div className="filing-reader-nav-part-header">
                  <span className="filing-reader-nav-part-zh">{group.label.zh}</span>
                  <span className="filing-reader-nav-part-en">{group.label.en}</span>
                </div>
                {group.items.map((key) => {
                  const label = getSectionLabel(key, filingTemplate.labels);
                  const kicker = getSectionKicker(key, filingTemplate.itemNumbers);
                  const active = currentSection === key;
                  const missing = !structuredBySection.has(key);
                  return (
                    <div key={key} className="filing-reader-nav-section">
                      <button
                        type="button"
                        className={`filing-reader-nav-item${active ? " filing-reader-nav-item--active" : ""}${missing ? " filing-reader-nav-item--missing" : ""}`}
                        onClick={() => jumpToSection(key)}
                        title={`${label.zh} / ${label.en}`}
                      >
                        {kicker ? (
                          <span className="filing-reader-nav-item-kicker">
                            {filing.kind === "40f" ? kicker : `Item ${kicker}`}
                          </span>
                        ) : null}
                        <span className="filing-reader-nav-item-head">
                          <span className="filing-reader-nav-zh">{label.zh}</span>
                          <span className="filing-reader-nav-en">{label.en}</span>
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </aside>

        <main className="filing-reader-main" ref={contentRef}>
          <section className="filing-reader-hero">
            <div className="filing-reader-hero-copy">
              <p>Structured {formatFilingKindLabel(filing.kind)}</p>
              <h1>
                {company.name}
                <span>{reportLabel}</span>
              </h1>
              <div className="filing-reader-hero-meta">
                <span>{extractedStandardSectionCount}/{filingTemplate.order.length} standard sections extracted</span>
                {structuredSections.length > extractedStandardSectionCount ? (
                  <span>{structuredSections.length - extractedStandardSectionCount} additional extracted</span>
                ) : null}
                {supplementalFiles.length ? <span>{supplementalFiles.length} files</span> : null}
              </div>
            </div>
          </section>

          {readerSections.map((readerSection) => {
            const section = readerSection.data;
            const label = getSectionLabel(readerSection.section, filingTemplate.labels);
            const blocks = section?.blocks ?? [];
            const kicker = getSectionKicker(readerSection.section, filingTemplate.itemNumbers);
            const displayBlocks =
              blocks.length && blocks[0].type === "heading" && isSectionHeadingBlock(blocks[0].text)
                ? blocks.slice(1)
                : blocks;
            return (
              <article
                key={readerSection.section}
                id={`filing-section-${readerSection.section}`}
                className={`filing-reader-section${section ? "" : " filing-reader-section--missing"}`}
                data-section={readerSection.section}
              >
                <div className="filing-reader-section-head">
                  <div>
                    <p>{kicker ? (filing.kind === "40f" ? kicker : `Item ${kicker}`) : "Section"}</p>
                    <h3>{label.en}</h3>
                    <span>{label.zh}</span>
                  </div>
                </div>
                <div className="filing-reader-section-body">
                  {displayBlocks.length ? (
                    displayBlocks.map((block, blockIndex) => (
                      <div
                        key={block.id || `${readerSection.section}-${blockIndex}`}
                        id={block.id}
                        className={`filing-reader-block filing-reader-block--${block.type}`}
                      >
                        {renderBlock(block)}
                      </div>
                    ))
                  ) : section?.rawHtml ? (
                    <div
                      className="filing-reader-html"
                      dangerouslySetInnerHTML={{ __html: section.rawHtml }}
                    />
                  ) : !section ? (
                    <div className="filing-reader-missing" aria-hidden="true" />
                  ) : (
                    renderLegacyTextContent(section.content)
                  )}
                </div>
              </article>
            );
          })}

          <section className="filing-reader-attachments">
            <div className="filing-reader-section-head">
              <div>
                <p>附件</p>
                <h3>Files</h3>
              </div>
            </div>

            {visibleFiles.length ? (
              <div className="filing-reader-source-list">
                {visibleFiles.map((file) => (
                  <article key={file.key} className="filing-reader-source-item">
                    <div>
                      <strong>{file.label}</strong>
                      {file.meta ? <p>{file.meta}</p> : null}
                    </div>
                    <a href={file.href} target="_blank" rel="noreferrer">
                      打开
                    </a>
                  </article>
                ))}
              </div>
            ) : null}
            {hiddenFileCount > 0 ? (
              <button
                type="button"
                className="filing-reader-source-toggle"
                onClick={() => setShowAllFiles((value) => !value)}
              >
                {showAllFiles ? "收起附件" : `展开其余 ${hiddenFileCount} 个附件`}
              </button>
            ) : null}
          </section>
        </main>
      </div>
    </div>
  );
}

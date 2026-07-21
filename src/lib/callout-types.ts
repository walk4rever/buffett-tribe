// Single source of truth for insight callout types. Add a new type by adding
// one entry here — src/lib/insights.ts (parsing) and globals.css (styling)
// both derive from this list and never need to change for a new type.
//
// Spec: ~/R129/Vault/播客全文翻译与发布指南.md §3.1（七层评注分类与命名规范）

export type CalloutBorderSide = "top" | "left";

export interface CalloutTypeConfig {
  /** Canonical tag matched in `[!TAG]`, matched case-insensitively. */
  tag: string;
  /** Legacy/alternate tag spellings that resolve to this same type. */
  aliases?: string[];
  /** Short badge label shown in the callout header, e.g. "Overview". */
  label: string;
  /** Localized title used when the author didn't put one after the tag. */
  defaultTitle: string;
  /** Accent/border color. A second color renders a diagonal gradient tint. */
  color: string;
  color2?: string;
  borderSide: CalloutBorderSide;
}

export const CALLOUT_TYPES: CalloutTypeConfig[] = [
  {
    tag: "HIGHLIGHTS",
    label: "Highlights",
    defaultTitle: "核心看点",
    color: "#dc2626",
    color2: "#d4a017",
    borderSide: "top",
  },
  {
    tag: "OVERVIEW",
    label: "Overview",
    defaultTitle: "背景概览",
    color: "#777777",
    borderSide: "top",
  },
  {
    tag: "TIPS",
    aliases: ["TIP"],
    label: "Tips",
    defaultTitle: "知识科普",
    color: "#1e88e5",
    borderSide: "left",
  },
  {
    tag: "FACTS",
    aliases: ["IMPORTANT"],
    label: "Facts",
    defaultTitle: "时空复盘",
    color: "#2e7d32",
    borderSide: "top",
  },
  {
    tag: "VALUE",
    label: "Value",
    defaultTitle: "价值视角",
    color: "#5e35b1",
    borderSide: "left",
  },
  {
    tag: "INVERSE",
    aliases: ["WARNING"],
    label: "Inverse",
    defaultTitle: "反向思考",
    color: "#e65100",
    borderSide: "top",
  },
  {
    tag: "TAKEAWAY",
    aliases: ["CAUTION"],
    label: "Takeaway",
    defaultTitle: "实操启示",
    color: "#00796b",
    borderSide: "top",
  },
];

/** Fallback type for `[!NOTE]` and any tag that doesn't match a configured type. */
export const CALLOUT_FALLBACK: CalloutTypeConfig = {
  tag: "NOTE",
  label: "Note",
  defaultTitle: "NOTE",
  color: "#1a1a1a",
  borderSide: "left",
};

const CALLOUT_LOOKUP = new Map<string, CalloutTypeConfig>();
for (const config of CALLOUT_TYPES) {
  CALLOUT_LOOKUP.set(config.tag, config);
  for (const alias of config.aliases ?? []) CALLOUT_LOOKUP.set(alias, config);
}
CALLOUT_LOOKUP.set(CALLOUT_FALLBACK.tag, CALLOUT_FALLBACK);

/** Resolve a raw `[!TAG]` string (any case) to its config. Unknown tags fall back to Note. */
export function getCalloutConfig(tag: string): CalloutTypeConfig {
  return CALLOUT_LOOKUP.get(tag.toUpperCase()) ?? CALLOUT_FALLBACK;
}

/** The lowercase class-name suffix / `data-base-callout` value for a resolved type. */
export function calloutBaseType(config: CalloutTypeConfig): string {
  return config.tag.toLowerCase();
}

/** All recognized tag spellings (canonical + aliases + fallback), for building the parser regex. */
export const CALLOUT_TAG_NAMES: string[] = [
  ...CALLOUT_TYPES.flatMap((c) => [c.tag, ...(c.aliases ?? [])]),
  CALLOUT_FALLBACK.tag,
];

/** `NOTE|TIP|...` alternation — embed in a regex to recognize any known `[!TAG]`. */
export const CALLOUT_TAG_PATTERN = CALLOUT_TAG_NAMES.join("|");

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const value = parseInt(clean, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Computes the inline `style` string for a callout's colors and border, so adding a
 *  type never requires a globals.css change — the shared `.insight-callout*` rules
 *  consume these CSS custom properties directly. */
export function calloutInlineStyle(config: CalloutTypeConfig): string {
  const borderColor = config.color2 ?? config.color;
  const background = config.color2
    ? `linear-gradient(135deg, ${hexToRgba(config.color, 0.08)}, ${hexToRgba(config.color2, 0.1)})`
    : hexToRgba(config.color, 0.04);
  const topWidth = config.borderSide === "top" ? "6px" : "1.5px";
  const leftWidth = config.borderSide === "left" ? "6px" : "1.5px";

  return [
    `--insight-callout-accent-color: ${config.color}`,
    `--insight-callout-border-color: ${borderColor}`,
    `background: ${background}`,
    `border: 1.5px solid ${borderColor}`,
    `border-top-width: ${topWidth}`,
    `border-left-width: ${leftWidth}`,
  ].join("; ");
}

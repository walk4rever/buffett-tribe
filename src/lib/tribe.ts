export interface TribeMember {
  id: string;
  name: string;
  nameZh: string;
  firm: string;
  color: string;
  initials: string;
  aum?: string;
  materialLabel: string;
  materialSub: string;
  materialHref: string;
  holdingsHref: string;
  hasData: boolean;
  icon: string;
}

export const TRIBE_MEMBERS: TribeMember[] = [
  {
    id: "buffett",
    name: "Warren Buffett",
    nameZh: "巴菲特",
    firm: "Berkshire Hathaway",
    color: "#8b0000",
    initials: "巴",
    aum: "$294B",
    materialLabel: "信件档案",
    materialSub: "1958–2025",
    materialHref: "/master/buffett/library?category=document",
    holdingsHref: "/master/buffett/holdings",
    hasData: true,
    icon: "📝",
  },
  {
    id: "lilu",
    name: "Li Lu",
    nameZh: "李录",
    firm: "喜马拉雅资本",
    color: "#1d4ed8",
    initials: "李",
    aum: "$3.6B",
    materialLabel: "资料库",
    materialSub: "1997–至今",
    materialHref: "/master/lilu/library?category=document",
    holdingsHref: "/master/lilu/holdings",
    hasData: true,
    icon: "🎙",
  },
  {
    id: "duan",
    name: "Duan Yongping",
    nameZh: "段永平",
    firm: "H&H International Investment",
    color: "#059669",
    initials: "段",
    aum: "$14.5B",
    materialLabel: "资料库",
    materialSub: "2006–至今",
    materialHref: "/master/duan/library?category=document",
    holdingsHref: "/master/duan/holdings",
    hasData: true,
    icon: "✍️",
  },
];

export function getTribeMember(id: string): TribeMember | null {
  return TRIBE_MEMBERS.find((m) => m.id === id) ?? null;
}

export function formatAumForHome(aum: string | undefined): string | null {
  if (!aum) return null;
  const compact = aum.replace(/\s+/g, "");
  const match = compact.match(/^\$?([\d.]+)([BTM])$/i);
  if (!match) return aum;

  const value = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(value)) return aum;

  const unit = (match[2] ?? "").toUpperCase();
  const yiMultiplier = unit === "T" ? 10000 : unit === "B" ? 10 : unit === "M" ? 0.01 : 1;
  const yiValue = value * yiMultiplier;
  const text = Number.isInteger(yiValue) ? String(yiValue) : yiValue.toFixed(1).replace(/\.0$/, "");
  return `$${text}亿`;
}

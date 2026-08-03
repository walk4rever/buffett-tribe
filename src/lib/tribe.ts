export interface TribeMember {
  id: string;
  category: "core" | "alpha";
  displayGroup: string;
  name: string;
  nameZh: string;
  firm: string;
  initials: string;
  materialLabel: string;
  materialSub: string;
  materialHref: string;
  holdingsHref: string;
  hasData: boolean;
  icon: string;
}

// One color per tribe, not per member — a per-person palette doesn't scale
// (every new Alpha onboarding would need a fresh color pick). Buffett Tribe
// members all share the brand red; Alpha Tribe members all share amber.
const CATEGORY_COLOR: Record<TribeMember["category"], string> = {
  core: "#8b0000",
  alpha: "#d97706",
};

export function getTribeMemberColor(member: Pick<TribeMember, "category">): string {
  return CATEGORY_COLOR[member.category];
}

export const TRIBE_MEMBERS: TribeMember[] = [
  {
    id: "buffett",
    category: "core",
    displayGroup: "部落成员",
    name: "Warren Buffett",
    nameZh: "巴菲特",
    firm: "Berkshire Hathaway",
    initials: "巴",
    materialLabel: "信件档案",
    materialSub: "1958–2025",
    materialHref: "/master/buffett/library?category=document",
    holdingsHref: "/master/buffett/holdings",
    hasData: true,
    icon: "📝",
  },
  {
    id: "lilu",
    category: "core",
    displayGroup: "部落成员",
    name: "Li Lu",
    nameZh: "李录",
    firm: "Himalaya Capital Management LLC",
    initials: "李",
    materialLabel: "资料库",
    materialSub: "1997–至今",
    materialHref: "/master/lilu/library?category=document",
    holdingsHref: "/master/lilu/holdings",
    hasData: true,
    icon: "🎙",
  },
  {
    id: "duan",
    category: "core",
    displayGroup: "部落成员",
    name: "Duan Yongping",
    nameZh: "段永平",
    firm: "H&H International Investment",
    initials: "段",
    materialLabel: "资料库",
    materialSub: "2006–至今",
    materialHref: "/master/duan/library?category=document",
    holdingsHref: "/master/duan/holdings",
    hasData: true,
    icon: "✍️",
  },
  {
    id: "gavin-baker",
    category: "alpha",
    displayGroup: "Alpha 部落",
    name: "Gavin Baker",
    nameZh: "Gavin Baker",
    firm: "Atreides Management, LP",
    initials: "GB",
    materialLabel: "访谈与观点",
    materialSub: "建设中",
    materialHref: "/master/gavin-baker#library",
    holdingsHref: "/master/gavin-baker/holdings",
    hasData: true,
    icon: "A",
  },
  {
    id: "alex-sacerdote",
    category: "alpha",
    displayGroup: "Alpha 部落",
    name: "Alex Sacerdote",
    nameZh: "Alex Sacerdote",
    firm: "Whale Rock Capital Management",
    initials: "AS",
    materialLabel: "访谈与观点",
    materialSub: "建设中",
    materialHref: "/master/alex-sacerdote#library",
    holdingsHref: "/master/alex-sacerdote/holdings",
    hasData: true,
    icon: "A",
  },
  {
    id: "leopold-aschenbrenner",
    category: "alpha",
    displayGroup: "Alpha 部落",
    name: "Leopold Aschenbrenner",
    nameZh: "Leopold Aschenbrenner",
    firm: "Situational Awareness LP",
    initials: "LA",
    materialLabel: "访谈与观点",
    materialSub: "建设中",
    materialHref: "/master/leopold-aschenbrenner#library",
    holdingsHref: "/master/leopold-aschenbrenner/holdings",
    hasData: true,
    icon: "A",
  },
  {
    id: "christopher-begg",
    category: "alpha",
    displayGroup: "Alpha 部落",
    name: "Christopher Begg",
    nameZh: "Christopher Begg",
    firm: "East Coast Asset Management, LLC",
    initials: "CB",
    materialLabel: "访谈与观点",
    materialSub: "建设中",
    materialHref: "/master/christopher-begg#library",
    holdingsHref: "/master/christopher-begg/holdings",
    hasData: true,
    icon: "A",
  },
  {
    id: "micky-malka",
    category: "alpha",
    displayGroup: "Alpha 部落",
    name: "Micky Malka",
    nameZh: "Micky Malka",
    firm: "Ribbit Management Company, LLC",
    initials: "MM",
    materialLabel: "访谈与观点",
    materialSub: "建设中",
    materialHref: "/master/micky-malka#library",
    holdingsHref: "/master/micky-malka/holdings",
    hasData: true,
    icon: "A",
  },
];

export const CORE_TRIBE_MEMBERS = TRIBE_MEMBERS.filter((m) => m.category === "core");
export const ALPHA_TRIBE_MEMBERS = TRIBE_MEMBERS.filter((m) => m.category === "alpha");

export function getTribeMember(id: string): TribeMember | null {
  return TRIBE_MEMBERS.find((m) => m.id === id) ?? null;
}

export type DocumentOwnerId = "buffett" | "duan" | "lilu";

export type DocumentItem = {
  id: string;
  ownerId: DocumentOwnerId;
  title: string;
  subtitle: string;
  badge: string;
  rawPath: string;
  readerHref: string;
  rawHref: string;
};

const DOCUMENTS: DocumentItem[] = [
  {
    id: "buffett-annual-meeting-unscripted",
    ownerId: "buffett",
    title: "Buffett & Munger Unscripted",
    subtitle: "历年股东大会问答实录。",
    badge: "书籍",
    rawPath: "data/documents/raw/master/buffett/annual-meeting-unscripted.pdf",
    readerHref: "/documents/buffett/unscripted",
    rawHref: "/api/documents/buffett/unscripted",
  },
  {
    id: "duan-investment",
    ownerId: "duan",
    title: "段永平投资问答录 · 投资篇",
    subtitle: "估值、仓位、长期持有与认知边界。",
    badge: "书籍",
    rawPath: "data/documents/raw/master/duan/investment.pdf",
    readerHref: "/documents/duan/investment",
    rawHref: "/api/documents/duan/investment",
  },
  {
    id: "duan-business",
    ownerId: "duan",
    title: "段永平投资问答录 · 商业篇",
    subtitle: "商业模式、护城河、本分文化。",
    badge: "书籍",
    rawPath: "data/documents/raw/master/duan/business.pdf",
    readerHref: "/documents/duan/business",
    rawHref: "/api/documents/duan/business",
  },
  {
    id: "lilu-global-value-investing-2024",
    ownerId: "lilu",
    title: "全球价值投资与时代（2024年12月）",
    subtitle: "2024年12月，李录谈价值投资的全球化与时代机遇。",
    badge: "演讲",
    rawPath: "data/documents/raw/master/lilu/global-value-investing-2024.pdf",
    readerHref: "/documents/lilu/global-value-investing-2024",
    rawHref: "/api/documents/lilu/global-value-investing-2024",
  },
  {
    id: "lilu-value-investing-china-2015",
    ownerId: "lilu",
    title: "价值投资在中国的展望（2015年10月）",
    subtitle: "2015年10月23日，李录北京大学演讲。",
    badge: "演讲",
    rawPath: "data/documents/raw/master/lilu/value-investing-china-2015.pdf",
    readerHref: "/documents/lilu/value-investing-china-2015",
    rawHref: "/api/documents/lilu/value-investing-china-2015",
  },
  {
    id: "lilu-modernization-us-china",
    ownerId: "lilu",
    title: "李录谈现代化：从文明史看中美关系（2018年12月）",
    subtitle: "2018年12月，从人类文明史角度审视中美关系走向。",
    badge: "文章",
    rawPath: "data/documents/raw/master/lilu/modernization-us-china.pdf",
    readerHref: "/documents/lilu/modernization-us-china",
    rawHref: "/api/documents/lilu/modernization-us-china",
  },
  {
    id: "lilu-modernization-full-2014",
    ownerId: "lilu",
    title: "李录谈现代化（全文）（2014年7月）",
    subtitle: "2014年7月，李录关于现代化的长篇论述。",
    badge: "文章",
    rawPath: "data/documents/raw/master/lilu/modernization-full-2014.pdf",
    readerHref: "/documents/lilu/modernization-full-2014",
    rawHref: "/api/documents/lilu/modernization-full-2014",
  },
  {
    id: "lilu-civilization-modernization-value",
    ownerId: "lilu",
    title: "文明、现代化、价值投资与中国（2020年2月）",
    subtitle: "李录 2020 年出版，系统阐释文明演进、现代化路径与价值投资理念。",
    badge: "书籍",
    rawPath: "data/documents/raw/master/lilu/civilization-modernization-value-investing-china.pdf",
    readerHref: "/documents/lilu/civilization-modernization-value-investing-china",
    rawHref: "/api/documents/lilu/civilization-modernization-value-investing-china",
  },
];

export function getDocumentsForOwner(ownerId: DocumentOwnerId): DocumentItem[] {
  return DOCUMENTS.filter((doc) => doc.ownerId === ownerId);
}

export function getDocumentById(id: string): DocumentItem | null {
  return DOCUMENTS.find((doc) => doc.id === id) ?? null;
}

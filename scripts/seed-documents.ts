/**
 * Seed the Document table from the hardcoded list in src/lib/documents.ts.
 * Safe to re-run: upserts on id.
 */

import prisma from "../src/lib/prisma";

const DOCUMENTS = [
  {
    id: "buffett-annual-meeting-unscripted",
    ownerId: "buffett",
    title: "Buffett & Munger Unscripted",
    subtitle: "历年股东大会问答实录。",
    badge: "书籍",
    rawPath: "data/documents/raw/master/buffett/annual-meeting-unscripted.pdf",
    readerPath: "/documents/buffett/unscripted",
    apiPath: "/api/documents/buffett/unscripted",
    sortOrder: 0,
  },
  {
    id: "duan-investment",
    ownerId: "duan",
    title: "段永平投资问答录 · 投资篇",
    subtitle: "估值、仓位、长期持有与认知边界。",
    badge: "书籍",
    rawPath: "data/documents/raw/master/duan/investment.pdf",
    readerPath: "/documents/duan/investment",
    apiPath: "/api/documents/duan/investment",
    sortOrder: 0,
  },
  {
    id: "duan-business",
    ownerId: "duan",
    title: "段永平投资问答录 · 商业篇",
    subtitle: "商业模式、护城河、本分文化。",
    badge: "书籍",
    rawPath: "data/documents/raw/master/duan/business.pdf",
    readerPath: "/documents/duan/business",
    apiPath: "/api/documents/duan/business",
    sortOrder: 1,
  },
  {
    id: "lilu-global-value-investing-2024",
    ownerId: "lilu",
    title: "全球价值投资与时代（2024年12月）",
    subtitle: "2024年12月，李录谈价值投资的全球化与时代机遇。",
    badge: "演讲",
    rawPath: "data/documents/raw/master/lilu/global-value-investing-2024.pdf",
    readerPath: "/documents/lilu/global-value-investing-2024",
    apiPath: "/api/documents/lilu/global-value-investing-2024",
    sortOrder: 0,
  },
  {
    id: "lilu-value-investing-china-2015",
    ownerId: "lilu",
    title: "价值投资在中国的展望（2015年10月）",
    subtitle: "2015年10月23日，李录北京大学演讲。",
    badge: "演讲",
    rawPath: "data/documents/raw/master/lilu/value-investing-china-2015.pdf",
    readerPath: "/documents/lilu/value-investing-china-2015",
    apiPath: "/api/documents/lilu/value-investing-china-2015",
    sortOrder: 1,
  },
  {
    id: "lilu-modernization-us-china",
    ownerId: "lilu",
    title: "李录谈现代化：从文明史看中美关系（2018年12月）",
    subtitle: "2018年12月，从人类文明史角度审视中美关系走向。",
    badge: "文章",
    rawPath: "data/documents/raw/master/lilu/modernization-us-china.pdf",
    readerPath: "/documents/lilu/modernization-us-china",
    apiPath: "/api/documents/lilu/modernization-us-china",
    sortOrder: 2,
  },
  {
    id: "lilu-modernization-full-2014",
    ownerId: "lilu",
    title: "李录谈现代化（全文）（2014年7月）",
    subtitle: "2014年7月，李录关于现代化的长篇论述。",
    badge: "文章",
    rawPath: "data/documents/raw/master/lilu/modernization-full-2014.pdf",
    readerPath: "/documents/lilu/modernization-full-2014",
    apiPath: "/api/documents/lilu/modernization-full-2014",
    sortOrder: 3,
  },
  {
    id: "lilu-civilization-modernization-value",
    ownerId: "lilu",
    title: "文明、现代化、价值投资与中国（2020年2月）",
    subtitle: "李录 2020 年出版，系统阐释文明演进、现代化路径与价值投资理念。",
    badge: "书籍",
    rawPath:
      "data/documents/raw/master/lilu/civilization-modernization-value-investing-china.pdf",
    readerPath: "/documents/lilu/civilization-modernization-value-investing-china",
    apiPath: "/api/documents/lilu/civilization-modernization-value-investing-china",
    sortOrder: 4,
  },
  {
    id: "bill-ackman-2q26-letter",
    ownerId: "bill-ackman",
    title: "Pershing Square, Inc. 2026年第二季度致股东信",
    subtitle: "Bill Ackman 致 Pershing Square, Inc. 股东的季度信件。",
    badge: "信件",
    rawPath: "data/documents/raw/master/bill-ackman/2q26-letter-to-shareholders.pdf",
    readerPath: "/documents/bill-ackman/2q26-letter",
    apiPath: "/api/documents/bill-ackman/2q26-letter",
    sortOrder: 0,
  },
];

async function main() {
  let upserted = 0;
  for (const doc of DOCUMENTS) {
    await prisma.document.upsert({
      where: { id: doc.id },
      create: doc,
      update: {
        title: doc.title,
        subtitle: doc.subtitle,
        badge: doc.badge,
        rawPath: doc.rawPath,
        readerPath: doc.readerPath,
        apiPath: doc.apiPath,
        sortOrder: doc.sortOrder,
      },
    });
    upserted++;
  }
  console.log(`[seed-documents] upserted ${upserted} documents`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[seed-documents] fatal", err);
  await prisma.$disconnect();
  process.exit(1);
});

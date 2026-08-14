/**
 * Upload all PDFs from data/documents/raw/ to Cloudflare R2.
 * Run: node --env-file=.env.local ./node_modules/.bin/tsx scripts/upload-documents-to-r2.ts
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { uploadToR2 } from '../src/lib/r2';

interface DocEntry {
  id: string;
  rawPath: string;
  title: string;
  badge: string;
}

// Mirror the document entries from src/lib/documents.ts
const DOCUMENTS: DocEntry[] = [
  {
    id: "buffett-unscripted",
    rawPath: "data/documents/raw/master/buffett/annual-meeting-unscripted.pdf",
    title: "历年股东大会问答实录",
    badge: "书籍",
  },
  {
    id: "duan-business",
    rawPath: "data/documents/raw/master/duan/business.pdf",
    title: "段永平投资问答录 · 商业篇",
    badge: "书籍",
  },
  {
    id: "duan-investment",
    rawPath: "data/documents/raw/master/duan/investment.pdf",
    title: "段永平投资问答录 · 投资篇",
    badge: "书籍",
  },
  {
    id: "lilu-global-value-investing-2024",
    rawPath: "data/documents/raw/master/lilu/global-value-investing-2024.pdf",
    title: "全球价值投资与时代（2024年12月）",
    badge: "演讲",
  },
  {
    id: "lilu-value-investing-china-2015",
    rawPath: "data/documents/raw/master/lilu/value-investing-china-2015.pdf",
    title: "价值投资在中国的展望（2015年10月）",
    badge: "演讲",
  },
  {
    id: "lilu-modernization-us-china",
    rawPath: "data/documents/raw/master/lilu/modernization-us-china.pdf",
    title: "李录谈现代化：从文明史看中美关系（2018年12月）",
    badge: "文章",
  },
  {
    id: "lilu-modernization-full-2014",
    rawPath: "data/documents/raw/master/lilu/modernization-full-2014.pdf",
    title: "李录谈现代化（全文）（2014年7月）",
    badge: "文章",
  },
  {
    id: "lilu-civilization-modernization-value",
    rawPath: "data/documents/raw/master/lilu/civilization-modernization-value-investing-china.pdf",
    title: "文明、现代化、价值投资与中国（2020年2月）",
    badge: "书籍",
  },
  {
    id: "bill-ackman-2q26-letter",
    rawPath: "data/documents/raw/master/bill-ackman/2q26-letter-to-shareholders.pdf",
    title: "Pershing Square, Inc. 2026年第二季度致股东信",
    badge: "信件",
  },
];

function r2Key(rawPath: string): string {
  // Strip data/documents/raw/ prefix, add buffett-tribe/ namespace
  return "buffett-tribe/" + rawPath.replace(/^data\/documents\/raw\//, "");
}

async function main() {
  console.log(`Uploading ${DOCUMENTS.length} documents to R2 bucket "${process.env.CLOUDFLARE_R2_BUCKET_NAME}"...\n`);

  for (const doc of DOCUMENTS) {
    const localPath = join(process.cwd(), doc.rawPath);
    const key = r2Key(doc.rawPath);

    if (!existsSync(localPath)) {
      console.error(`  ✗ MISSING: ${localPath}`);
      continue;
    }

    try {
      const buffer = readFileSync(localPath);
      await uploadToR2(key, buffer, 'application/pdf');
      console.log(`  ✓ ${doc.badge} "${doc.title}" → ${key} (${(buffer.length / 1024).toFixed(0)} KB)`);
    } catch (err) {
      console.error(`  ✗ FAILED "${doc.title}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('\nDone.');
}

main().catch(console.error);

/**
 * 上传公告邮件截图到 R2，打印公开 URL
 * 用法：npm run send:announcement:upload-images
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFile } from "fs/promises";
import path from "path";

const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.CLOUDFLARE_R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME!;
const PUBLIC_URL = process.env.CLOUDFLARE_R2_PUBLIC_URL!;
const VAULT_ASSETS = "/Users/rafael/R129/Vault/assets";

// 6 张截图，按邮件三个功能区分组
const IMAGES = [
  // 功能一：Agent
  { file: "Pasted image 20260625162818.png", key: "buffett-tribe/email/announcement-2026-06/agent-1.png" },
  { file: "Pasted image 20260625162837.png", key: "buffett-tribe/email/announcement-2026-06/agent-2.png" },
  // 功能二：大师知识图谱
  { file: "Pasted image 20260625162532.png", key: "buffett-tribe/email/announcement-2026-06/master-1.png" },
  { file: "Pasted image 20260625162928.png", key: "buffett-tribe/email/announcement-2026-06/master-2.png" },
  // 功能三：公司研究画布
  { file: "Pasted image 20260625162457.png", key: "buffett-tribe/email/announcement-2026-06/company-1.png" },
  { file: "Pasted image 20260625163007.png", key: "buffett-tribe/email/announcement-2026-06/company-2.png" },
];

async function main() {
  console.log(`上传 ${IMAGES.length} 张截图到 R2...\n`);

  for (const { file, key } of IMAGES) {
    const filePath = path.join(VAULT_ASSETS, file);
    const body = await readFile(filePath);
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: "image/png",
    }));
    const url = `${PUBLIC_URL}/${key}`;
    console.log(`✓ ${key}`);
    console.log(`  ${url}\n`);
  }

  console.log("完成。将上方 URL 填入 send-announcement.ts 的 SCREENSHOTS 常量。");
}

main().catch((e) => { console.error(e); process.exit(1); });

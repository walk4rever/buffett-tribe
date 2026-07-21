import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { uploadToR2 } from "../../src/lib/r2";

// Matches markdown image syntax `![alt](path)` (group 1=alt, group 2=path) or a
// raw `<img src="path">` tag (group 3=src). Only local (non-http, non-data-URI)
// references get uploaded — anything already hosted elsewhere passes through untouched.
const IMAGE_REFERENCE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*\/?>/gi;

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

export interface InsightImageUpload {
  localRef: string;
  absolutePath: string;
  publicUrl: string;
}

export interface UploadInsightImagesResult {
  content: string;
  uploads: InsightImageUpload[];
}

function isLocalReference(ref: string): boolean {
  return !/^(https?:|data:|\/\/)/i.test(ref);
}

function guessContentType(filePath: string): string {
  return CONTENT_TYPE_BY_EXT[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function contentHash(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 8);
}

/** Scans markdown for local image references, uploads each to R2 under
 *  `insights/<slug>/<contentHash>-<filename>`, and rewrites the content to
 *  point at the resulting public URLs. Keying by content hash (not just
 *  filename) keeps re-imports idempotent and avoids serving stale bytes from
 *  a previous upload at the same path — uploadToR2 sets an immutable,
 *  year-long Cache-Control, so reusing a key across different file content
 *  would silently keep serving the old image to anyone with a warm cache. */
export async function uploadInsightLocalImages(
  content: string,
  sourceDir: string,
  slug: string,
  options: { dryRun?: boolean } = {},
): Promise<UploadInsightImagesResult> {
  const refs = new Set<string>();
  for (const match of content.matchAll(IMAGE_REFERENCE_PATTERN)) {
    const ref = match[2] ?? match[3];
    if (ref && isLocalReference(ref)) refs.add(ref);
  }

  if (refs.size === 0) return { content, uploads: [] };

  const urlByRef = new Map<string, string>();
  const uploads: InsightImageUpload[] = [];

  for (const ref of refs) {
    const absolutePath = path.resolve(sourceDir, ref);
    if (!fs.existsSync(absolutePath)) {
      console.warn(`[insight-media] Referenced image not found, skipping: ${ref} (resolved: ${absolutePath})`);
      continue;
    }

    const buffer = fs.readFileSync(absolutePath);
    const key = `insights/${slug}/${contentHash(buffer)}-${path.basename(absolutePath)}`;
    const publicUrl = options.dryRun
      ? `<would-upload:${key}>`
      : await uploadToR2(key, buffer, guessContentType(absolutePath));

    urlByRef.set(ref, publicUrl);
    uploads.push({ localRef: ref, absolutePath, publicUrl });
  }

  if (urlByRef.size === 0) return { content, uploads };

  const rewritten = content.replace(IMAGE_REFERENCE_PATTERN, (fullMatch, altText, mdRef, imgRef) => {
    const ref: string | undefined = mdRef ?? imgRef;
    const publicUrl = ref ? urlByRef.get(ref) : undefined;
    if (!publicUrl) return fullMatch;
    return mdRef ? `![${altText ?? ""}](${publicUrl})` : fullMatch.replace(imgRef, publicUrl);
  });

  return { content: rewritten, uploads };
}

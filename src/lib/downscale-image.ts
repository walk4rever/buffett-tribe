import { ALLOWED_IMAGE_MIME_TYPES, type ImageAttachment } from "@/lib/image-attachment";

// DeepSeek's vision model caps useful detail at ~384 tokens per image
// regardless of resolution, so there's no benefit to sending a full-res
// screenshot — downscale before it ever leaves the browser.
const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.82;

export function isSupportedImageFile(file: File): boolean {
  return ALLOWED_IMAGE_MIME_TYPES.has(file.type);
}

export async function fileToImageAttachment(file: File): Promise<ImageAttachment> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not supported in this browser");
    ctx.drawImage(bitmap, 0, 0, width, height);

    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return { mimeType: "image/jpeg", data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
  } finally {
    bitmap.close();
  }
}

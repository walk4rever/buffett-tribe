export interface ImageAttachment {
  mimeType: string;
  data: string;
}

export const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
export const MAX_IMAGES_PER_MESSAGE = 4;

const IMAGE_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** File extension to use for an R2 object key — falls back to "bin" for a
 *  mime type outside ALLOWED_IMAGE_MIME_TYPES (shouldn't happen post-validation). */
export function imageExtensionForMimeType(mimeType: string): string {
  return IMAGE_EXTENSION_BY_MIME_TYPE[mimeType] ?? "bin";
}

// Downscaled client-side before this ever arrives, so 8M base64 chars (~6MB
// decoded) is a generous ceiling, not the expected size.
const MAX_IMAGE_BASE64_LENGTH = 8_000_000;

/** Validates and narrows an untrusted `images` request field. Throws with a
 *  user-facing message on the first invalid entry; returns undefined for an
 *  absent/empty field. */
export function validateImageAttachments(input: unknown): ImageAttachment[] | undefined {
  if (input === undefined || input === null) return undefined;
  if (!Array.isArray(input)) {
    throw new Error("images must be an array");
  }
  if (input.length === 0) return undefined;
  if (input.length > MAX_IMAGES_PER_MESSAGE) {
    throw new Error(`最多支持 ${MAX_IMAGES_PER_MESSAGE} 张图片`);
  }

  return input.map((raw) => {
    const img = raw as { mimeType?: unknown; data?: unknown };
    const mimeType = typeof img.mimeType === "string" ? img.mimeType : "";
    const data = typeof img.data === "string" ? img.data : "";
    if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType) || data.length === 0 || data.length > MAX_IMAGE_BASE64_LENGTH) {
      throw new Error("图片格式不受支持或体积过大");
    }
    return { mimeType, data };
  });
}

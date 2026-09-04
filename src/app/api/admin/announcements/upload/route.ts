import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { imageExtensionForMimeType, validateImageAttachments } from "@/lib/image-attachment";
import { uploadToR2 } from "@/lib/r2";

export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const contentType = req.headers.get("content-type") || "";

    // 1. JSON payload with base64 image data
    if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => null);
      let images;
      try {
        images = validateImageAttachments(body?.image ? [body.image] : undefined);
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "图片格式不正确" },
          { status: 400 }
        );
      }
      const image = images?.[0];
      if (!image) {
        return NextResponse.json({ error: "缺少图片数据" }, { status: 400 });
      }

      const ext = imageExtensionForMimeType(image.mimeType);
      const key = `buffett-tribe/announcements/${randomUUID()}.${ext}`;
      const url = await uploadToR2(key, Buffer.from(image.data, "base64"), image.mimeType);
      return NextResponse.json({ url }, { status: 201 });
    }

    // 2. FormData payload
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "缺少文件" }, { status: 400 });
      }

      const mimeType = file.type || "image/jpeg";
      const ext = imageExtensionForMimeType(mimeType);
      const buffer = Buffer.from(await file.arrayBuffer());
      const key = `buffett-tribe/announcements/${randomUUID()}.${ext}`;
      const url = await uploadToR2(key, buffer, mimeType);
      return NextResponse.json({ url }, { status: 201 });
    }

    return NextResponse.json({ error: "Unsupported Content-Type" }, { status: 400 });
  } catch (err) {
    console.error("[admin/announcements/upload] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "上传图片失败" },
      { status: 500 }
    );
  }
}

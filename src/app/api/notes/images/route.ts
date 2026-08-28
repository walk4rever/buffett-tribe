import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { imageExtensionForMimeType, validateImageAttachments } from "@/lib/image-attachment";
import { buildUserObjectKey, uploadToR2 } from "@/lib/r2";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "需要登录" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);

  let images;
  try {
    images = validateImageAttachments(body?.image ? [body.image] : undefined);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "invalid image" }, { status: 400 });
  }
  const image = images?.[0];
  if (!image) {
    return NextResponse.json({ error: "image required" }, { status: 400 });
  }

  const ext = imageExtensionForMimeType(image.mimeType);
  const key = buildUserObjectKey(session.user.id, "note-images", `${randomUUID()}.${ext}`);

  try {
    const url = await uploadToR2(key, Buffer.from(image.data, "base64"), image.mimeType);
    return NextResponse.json({ url }, { status: 201 });
  } catch (err) {
    console.error("note image upload failed", key, err);
    return NextResponse.json({ error: "上传失败" }, { status: 502 });
  }
}

import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { buildFullEmailHtml } from "@/lib/email-template";

export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { subject = "", markdown = "", preheader = "", mockName = "张三" } = body;

    const html = buildFullEmailHtml({
      subject: subject || "产品发布通知",
      markdown: markdown || "",
      preheader,
      user: { name: mockName, email: "preview@example.com" },
    });

    return NextResponse.json({ html });
  } catch (err: unknown) {
    console.error("[admin/announcements/preview] POST error:", err);
    return NextResponse.json(
      { error: "Failed to render preview" },
      { status: 500 }
    );
  }
}

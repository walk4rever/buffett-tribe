import { NextRequest, NextResponse } from "next/server";
import { runPhase3Update } from "@/lib/phase3-update";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id.trim() : undefined;
    const ticker = typeof body?.ticker === "string" ? body.ticker.trim() : undefined;

    if (!id && !ticker) {
      return NextResponse.json(
        { error: "缺少标的标识符 (请提供 id 或 ticker)" },
        { status: 400 }
      );
    }

    const result = await runPhase3Update({
      entityId: id,
      ticker,
      dryRun: false,
    });

    return NextResponse.json({
      success: true,
      message: "Phase 3 态势即时更新成功",
      data: result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/company/phase3] Update error:", message);
    return NextResponse.json(
      { error: message || "Phase 3 更新失败" },
      { status: 500 }
    );
  }
}

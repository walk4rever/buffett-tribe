import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    const key = typeof body?.key === "string" ? body.key.trim() : "";

    if (!id && !key) {
      return NextResponse.json(
        { error: "缺少标的标识符 (id 或 key)" },
        { status: 400 }
      );
    }

    // Locate the entity
    let entity = null;
    if (id) {
      entity = await prisma.entity.findUnique({
        where: { id },
        select: {
          id: true,
          canonicalName: true,
          ticker: true,
          code: true,
          market: true,
          onboardPhase: true,
          priority: true,
          metadata: true,
        },
      });
    }

    if (!entity && key) {
      // Key can be CIK (10 digits / numeric), or market-code (e.g. hk-00700, cn-600519), or ticker
      if (/^\d{1,10}$/.test(key)) {
        entity = await prisma.entity.findFirst({
          where: { cik: key.padStart(10, "0") },
          select: {
            id: true,
            canonicalName: true,
            ticker: true,
            code: true,
            market: true,
            onboardPhase: true,
            priority: true,
            metadata: true,
          },
        });
      }

      if (!entity && key.includes("-")) {
        const [mkt, ...rest] = key.split("-");
        const code = rest.join("-");
        entity = await prisma.entity.findFirst({
          where: { market: mkt, code },
          select: {
            id: true,
            canonicalName: true,
            ticker: true,
            code: true,
            market: true,
            onboardPhase: true,
            priority: true,
            metadata: true,
          },
        });
      }

      if (!entity) {
        entity = await prisma.entity.findFirst({
          where: {
            OR: [
              { ticker: key.toUpperCase() },
              { code: key },
            ],
          },
          select: {
            id: true,
            canonicalName: true,
            ticker: true,
            code: true,
            market: true,
            onboardPhase: true,
            priority: true,
            metadata: true,
          },
        });
      }
    }

    if (!entity) {
      return NextResponse.json(
        { error: "未找到对应的公司标的" },
        { status: 404 }
      );
    }

    // If already Phase 1 or higher, no fast-track queueing needed
    if (entity.onboardPhase >= 1) {
      return NextResponse.json({
        success: true,
        alreadyComplete: true,
        message: "该标的已完成建档，无需排队",
      });
    }

    // Calculate updated priority: base 100 on first request, increment by 10 on repeated requests
    const currentPriority = entity.priority ?? 0;
    const increment = currentPriority === 0 ? 100 : 10;
    const newPriority = currentPriority + increment;

    const currentMeta = (entity.metadata as Record<string, unknown>) || {};
    const updatedMeta = {
      ...currentMeta,
      fastTrack: true,
      fastTrackRequestedAt: new Date().toISOString(),
      fastTrackRequests: ((currentMeta.fastTrackRequests as number) || 0) + 1,
    };

    await prisma.entity.update({
      where: { id: entity.id },
      data: {
        priority: newPriority,
        priorityRequestedAt: new Date(),
        metadata: updatedMeta,
      },
    });

    const displayName =
      (typeof currentMeta.nameZh === "string" && currentMeta.nameZh) ||
      entity.canonicalName;

    return NextResponse.json({
      success: true,
      entityId: entity.id,
      priority: newPriority,
      message: `已为 ${displayName} 开启快速通道优先建档，下次批处理将优先插队执行`,
    });
  } catch (error) {
    console.error("[fast-track] Failed to expedite company:", error);
    return NextResponse.json(
      { error: "服务器内部异常，快速通道申请失败" },
      { status: 500 }
    );
  }
}

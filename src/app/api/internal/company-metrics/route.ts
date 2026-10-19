import { NextRequest, NextResponse } from "next/server";
import {
  buildCapitalAllocationAgentPayload,
  buildValuationAgentPayload,
} from "@/lib/agent-company-metrics";
import { isValidAgentSecret } from "@/lib/agent-secret";
import { getValueLineData } from "@/lib/value-line-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_COMPANY_LENGTH = 80;

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!process.env.PI_AGENT_SECRET) {
    return jsonError("Agent metrics are not configured", 503);
  }
  if (!isValidAgentSecret(request.headers.get("x-agent-secret"))) {
    return jsonError("Unauthorized", 401);
  }

  const company = request.nextUrl.searchParams.get("company")?.trim() ?? "";
  const view = request.nextUrl.searchParams.get("view")?.trim() ?? "";
  if (!company || company.length > MAX_COMPANY_LENGTH) {
    return jsonError("company is required and must be 1-80 characters", 400);
  }
  if (view !== "capital_allocation" && view !== "valuation") {
    return jsonError("view must be capital_allocation or valuation", 400);
  }

  try {
    const data = await getValueLineData(company, undefined, { includeHolders: false });
    if (!data) return jsonError("Company not found", 404);

    const payload =
      view === "capital_allocation"
        ? buildCapitalAllocationAgentPayload(data)
        : buildValuationAgentPayload(data);

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[api/internal/company-metrics] failed", error);
    return jsonError("Company metrics unavailable", 500);
  }
}

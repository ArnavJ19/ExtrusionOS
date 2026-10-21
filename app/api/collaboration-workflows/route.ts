import { NextResponse } from "next/server";
import { collaborationWorkflowAction } from "@/lib/actions/collaboration-workflows";

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return NextResponse.json({ success: false, error: "Use a JSON workflow request." }, { status: 415 });
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ success: false, error: "Cross-origin requests are not permitted." }, { status: 403 });
  try {
    const result = await collaborationWorkflowAction(await request.json());
    return NextResponse.json(result, { status: result.success ? 200 : result.unavailable ? 503 : result.uncertain ? 502 : 400 });
  } catch { return NextResponse.json({ success: false, error: "Invalid workflow request." }, { status: 400 }); }
}

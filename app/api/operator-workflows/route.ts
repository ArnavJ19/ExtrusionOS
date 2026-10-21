import { NextResponse } from "next/server";
import { operatorWorkflowAction } from "@/lib/actions/operator-workflows";

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return NextResponse.json({ success: false, error: "Use a JSON workflow request." }, { status: 415 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ success: false, error: "Cross-origin workflow requests are not permitted." }, { status: 403 });
  try {
    const result = await operatorWorkflowAction(await request.json());
    return NextResponse.json(result, { status: result.success ? 200 : result.unavailable ? 503 : result.uncertain ? 502 : 400 });
  } catch {
    return NextResponse.json({ success: false, error: "Invalid workflow request." }, { status: 400 });
  }
}

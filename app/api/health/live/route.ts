import { NextResponse } from "next/server";

// FS-07: unauthenticated liveness for an external uptime monitor. No database call and no data.
export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { autopilotAction } from "@/lib/actions/autopilot";
import { UNDO_KIND_KEYS } from "@/lib/undo/registry";

// AP-093: records that an Undo was used, and marks the person's own notification unread again. Called with fetch so the
// shared screens that offer Undo bundle no server code. public.ap_undo takes the person from the session.
const bodySchema = z.object({ kind: z.enum(UNDO_KIND_KEYS), target: z.string().min(1).max(80), id: z.string().uuid().optional() }).strict();

export async function POST(request: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
    body = parsed.data;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
  }
  const result = body.kind === "notification.read" && body.id
    ? await autopilotAction("ap_undo", "notification_unread", { id: body.id })
    : await autopilotAction("ap_undo", "record", { kind: body.kind, target: body.target });
  return NextResponse.json(result.success ? { success: true } : { success: false, error: result.error }, { headers: { "Cache-Control": "private, no-store" } });
}

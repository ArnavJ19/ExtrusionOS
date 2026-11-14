import { NextResponse } from "next/server";
import { z } from "zod";
import { clearDefaultViewAction, defaultViewAction, deleteViewAction, listViewsAction, saveViewAction, setDefaultViewAction } from "@/lib/actions/saved-views";

// AP-092: the saved-view commands for the browser. Called with fetch so the shared database page never bundles server
// code. Each command is validated by Zod in lib/actions/saved-views and again by public.ap_views, which takes the person
// from the session.
const bodySchema = z.object({ command: z.enum(["list", "default", "save", "set_default", "clear_default", "delete"]), payload: z.record(z.unknown()) }).strict();

export async function POST(request: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
    body = parsed.data;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
  }
  const p = body.payload as Record<string, string | boolean | undefined>;
  const result = body.command === "list" ? await listViewsAction(String(p.page_key ?? ""))
    : body.command === "default" ? await defaultViewAction(String(p.page_key ?? ""))
    : body.command === "save" ? await saveViewAction(p as { page_key: string; name: string; query: string; make_default?: boolean })
    : body.command === "set_default" ? await setDefaultViewAction(String(p.id ?? ""))
    : body.command === "clear_default" ? await clearDefaultViewAction(String(p.page_key ?? ""))
    : await deleteViewAction(String(p.id ?? ""));
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}

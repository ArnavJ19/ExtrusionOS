import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { SECTION_ROLES, controlTotalsSchema } from "@/lib/cutover/cutover";
import { CUTOVER_SECTION_KEYS } from "@/lib/master-data/import/definitions";
import { MAX_SHEET_BYTES } from "@/lib/master-data/import/spreadsheet";
import { loadCutoverUpload } from "@/lib/master-data/import/upload";
import { createClient } from "@/lib/supabase/server";

// AP-007: load one opening-balance section from its go-live sheet with the totals signed on that sheet.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await getSessionContext();
  const form = await request.formData().catch(() => null);
  const section = z.enum(CUTOVER_SECTION_KEYS).safeParse(form?.get("section"));
  if (!section.success) return NextResponse.json({ error: "Choose the section to load." }, { status: 400 });
  if (context.dealerId || !SECTION_ROLES[section.data].includes(context.role)) return NextResponse.json({ error: "Your role cannot load this section." }, { status: 403 });
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_SHEET_BYTES) return NextResponse.json({ error: "Upload the section sheet (up to 4 MB)." }, { status: 400 });
  let control: z.infer<typeof controlTotalsSchema>;
  try {
    const parsed = controlTotalsSchema.safeParse(JSON.parse(String(form?.get("control") ?? "")));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter the signed control totals." }, { status: 400 });
    control = parsed.data;
  } catch { return NextResponse.json({ error: "Enter the signed control totals." }, { status: 400 }); }
  const outcome = await loadCutoverUpload(await createClient(), { section: section.data, fileName: file.name, buffer: Buffer.from(await file.arrayBuffer()), control });
  return outcome.ok ? NextResponse.json(outcome.data) : NextResponse.json({ error: outcome.error }, { status: outcome.status });
}

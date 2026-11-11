import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { MASTER_KEYS } from "@/lib/master-data/import/definitions";
import { MAX_SHEET_BYTES } from "@/lib/master-data/import/spreadsheet";
import { previewMasterUpload } from "@/lib/master-data/import/upload";
import { createClient } from "@/lib/supabase/server";

// AP-006: upload a master sheet, map its columns and stage a reviewed batch. Nothing is imported here.
export const dynamic = "force-dynamic";
const mappingSchema = z.record(z.string().max(120), z.string().regex(/^[a-z_]{2,40}$/).nullable()).nullable();

export async function POST(request: Request) {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin"].includes(context.role)) return NextResponse.json({ error: "Only the owner or an admin can import masters." }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const master = z.enum(MASTER_KEYS).safeParse(form?.get("master"));
  const file = form?.get("file");
  if (!master.success || !(file instanceof File)) return NextResponse.json({ error: "Choose what to import and the sheet to upload." }, { status: 400 });
  if (file.size === 0 || file.size > MAX_SHEET_BYTES) return NextResponse.json({ error: "Upload a sheet between 1 byte and 4 MB." }, { status: 400 });
  let mapping: z.infer<typeof mappingSchema> = null;
  const rawMapping = form?.get("mapping");
  if (typeof rawMapping === "string" && rawMapping) {
    try {
      const parsed = mappingSchema.safeParse(JSON.parse(rawMapping));
      if (!parsed.success) return NextResponse.json({ error: "The column choices could not be read." }, { status: 400 });
      mapping = parsed.data;
    } catch { return NextResponse.json({ error: "The column choices could not be read." }, { status: 400 }); }
  }
  const outcome = await previewMasterUpload(await createClient(), { master: master.data, fileName: file.name, buffer: Buffer.from(await file.arrayBuffer()), mapping });
  return outcome.ok ? NextResponse.json(outcome.data) : NextResponse.json({ error: outcome.error }, { status: outcome.status });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can, type Resource } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { loadPdf, PDF_KINDS, type PdfKind } from "@/lib/pdf/loaders";
import { MAX_BATCH_DOCUMENTS, mergePdfs } from "@/lib/pdf/merge";

// AP-091: print selected records as one PDF. Each record is loaded through the person's own session, so a record they
// may not read is refused, never silently skipped; if any record cannot be printed nothing is merged and the reasons are
// listed, so a stack of challans is never short by one without anyone noticing.
const RESOURCE: Record<PdfKind, Resource> = { invoice: "financials", quote: "quotes", challan: "dispatches", job_card: "production" };
const TITLE: Record<PdfKind, string> = { invoice: "Invoices", quote: "Quotations", challan: "Delivery challans", job_card: "Job cards" };
const bodySchema = z.object({
  kind: z.enum(PDF_KINDS),
  ids: z.array(z.string().uuid()).min(1).max(MAX_BATCH_DOCUMENTS).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
}).strict().refine(v => Boolean(v.ids) !== Boolean(v.date), { message: "Choose the records, or a day of challans" })
  .refine(v => !v.date || v.kind === "challan", { message: "Only challans can be printed for a whole day" });

export async function POST(request: Request) {
  const context = await getSessionContext();
  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (context.dealerId || !can(context.role, "read", RESOURCE[body.kind])) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  const supabase = await createClient();
  let ids = [...new Set(body.ids ?? [])];
  if (body.date) {
    const day = await supabase.from("dispatches").select("id").eq("company_id", context.companyId).eq("dispatch_date", body.date).order("dispatch_number").limit(MAX_BATCH_DOCUMENTS + 1);
    if (day.error) return NextResponse.json({ error: "Dispatches for that day are unavailable. Retry in a moment." }, { status: 503 });
    if (!(day.data ?? []).length) return NextResponse.json({ error: "No dispatch is dated that day." }, { status: 404 });
    if ((day.data ?? []).length > MAX_BATCH_DOCUMENTS) return NextResponse.json({ error: `More than ${MAX_BATCH_DOCUMENTS} dispatches are dated that day. Select them in pages instead.` }, { status: 413 });
    ids = (day.data ?? []).map(row => String(row.id));
  }
  const parts: Uint8Array[] = []; const problems: string[] = [];
  // Sequential on purpose: PDF generation is memory-heavy and the order printed is the order selected.
  for (const id of ids) {
    try {
      const result = await loadPdf(body.kind, supabase, context, id);
      if (result.ok) parts.push(result.bytes); else problems.push(`${result.label ?? "A selected record"}: ${result.error}`);
    } catch {
      problems.push("A selected record could not be generated.");
    }
  }
  if (problems.length) return NextResponse.json({ error: `${problems.length} of ${ids.length} could not be printed, so nothing was merged.`, problems: problems.slice(0, 20) }, { status: 409 });
  const merged = await mergePdfs(parts, `${TITLE[body.kind]} (${ids.length})`);
  return new NextResponse(Buffer.from(merged), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${body.kind}-${body.date ?? "selected"}-${ids.length}.pdf"`, "Cache-Control": "private, no-store" } });
}

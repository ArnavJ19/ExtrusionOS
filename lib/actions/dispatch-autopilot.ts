"use server";

// Autopilot batch 4 server actions that need more than one database call. Completing a load (AP-018) sends the scanned
// bundles through the existing dispatch writer (saveDispatchAction → save_ready_dispatch_atomic), so the dispatch lines
// are never typed and every stock and readiness check of that writer still applies. The e-way bill (AP-081) and Tally
// (AP-083) files are built here from database facts and recorded as exported only after the file is built.
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { saveDispatchAction } from "@/lib/actions/dispatches";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import type { DuplicateConfirmation, DuplicateMatch } from "@/lib/order-to-cash/duplicates";
import { EWAY_SCHEMA_VERSION, buildEwayExport, type EwayIssue, type EwaySource } from "@/lib/compliance/eway-bill";
import { buildTallyExport, type TallyIssue, type TallyMapping, type TallyVoucher } from "@/lib/integrations/tally-xml";
import { DISPATCH_FLOOR_ROLES, EWAY_ROLES } from "@/lib/dispatch-autopilot/commands";

type Result<T> = { success: true; data: T } | { success: false; error: string; duplicates?: DuplicateMatch[] };
type DbError = { code?: string; message?: string } | null;

function dbMessage(error: DbError, fallback: string) {
  const message = error?.message ?? "";
  if (error?.code === "42501") return "This action is not available to your current session.";
  if (message.startsWith("AP: ")) return message.slice(4);
  return fallback;
}

async function context(roles: readonly string[]) {
  const ctx = await getSessionContext();
  if (ctx.dealerId || !roles.includes(ctx.role)) throw new Error("permission");
  return ctx;
}

const bundleRows = z.array(z.object({ bundle_number: z.string(), source_line_id: z.string().uuid(), number_of_pieces: z.number().int().positive(),
  net_length_m: z.coerce.number().positive(), gross_weight_kg: z.coerce.number().positive(), tare_weight_kg: z.coerce.number().nonnegative() })).min(1);
const loadSchema = z.object({ session_id: z.string().uuid(), order_id: z.string().uuid(), vehicle_number: z.string().nullable(), transporter_name: z.string().nullable(),
  driver_name: z.string().nullable(), driver_phone: z.string().nullable(), lr_number: z.string().nullable(), already_dispatched: z.string().uuid().nullable(), bundles: bundleRows });

/** AP-018: writes the dispatch from the session's scanned bundles, then closes the session against it. Safe to retry. */
export async function completeLoadingAction(input: { sessionId: string; confirmDuplicate?: DuplicateConfirmation }): Promise<Result<{ dispatchId: string }>> {
  try {
    await context(DISPATCH_FLOOR_ROLES);
    const sessionId = z.string().uuid().parse(input.sessionId);
    const supabase = await createClient();
    const read = await supabase.rpc("ap_dispatch", { p_command: "bundles_for_dispatch", p_payload: { id: sessionId } });
    if (read.error) return { success: false, error: dbMessage(read.error, "The loading session could not be read. Refresh and try again.") };
    const load = loadSchema.parse(read.data);
    let dispatchId = load.already_dispatched;
    if (!dispatchId) {
      const saved = await saveDispatchAction({
        order_id: load.order_id, dispatch_date: getBusinessDateBoundaries().today, delivery_status: "dispatched",
        transporter_name: load.transporter_name ?? "", vehicle_number: load.vehicle_number ?? "", driver_name: load.driver_name ?? "", driver_phone: load.driver_phone ?? "",
        lr_number: load.lr_number ?? "", eway_bill_number: "", proof_of_delivery_url: "", packing_list_url: "", remarks: `Loaded by scan (loading session ${sessionId.slice(0, 8)})`,
        bundles: load.bundles.map(b => ({ bundle_number: b.bundle_number, source_line_id: b.source_line_id, number_of_pieces: b.number_of_pieces, net_length_m: b.net_length_m,
          gross_weight_kg: b.gross_weight_kg, tare_weight_kg: b.tare_weight_kg })),
        confirm_duplicate: input.confirmDuplicate
      });
      if (!saved.success) return { success: false, error: saved.error, duplicates: saved.duplicates };
      if (!saved.dispatchId) return { success: false, error: "The dispatch was not created. Refresh the session and try again." };
      dispatchId = saved.dispatchId;
    }
    const done = await supabase.rpc("ap_dispatch", { p_command: "complete", p_payload: { id: sessionId, dispatch_id: dispatchId } });
    if (done.error) return { success: false, error: dbMessage(done.error, "The dispatch was written but the session could not be closed. Tap Complete again to finish.") };
    for (const path of ["/dispatches", "/dispatches/loading", "/dispatches/gate", "/dispatches/ready"]) { try { revalidatePath(path); } catch { /* outcome stands */ } }
    return { success: true, data: { dispatchId } };
  } catch (error) {
    if (error instanceof Error && error.message === "permission") return { success: false, error: "Only dispatch, stores or a factory supervisor can complete a load." };
    return { success: false, error: "The load could not be completed. Check your connection and try again." };
  }
}

export type EwayExportResult = { json: string; filename: string; included: { dispatch_number: string; doc_no: string }[]; skipped: { dispatch_number: string; issues: EwayIssue[] }[] };

/** AP-081: builds the portal's bulk-upload JSON for the valid dispatches and records the export (schema version, file hash). */
export async function exportEwayAction(dispatchIds: string[]): Promise<Result<EwayExportResult>> {
  try {
    await context(EWAY_ROLES);
    const ids = z.array(z.string().uuid()).min(1).max(50).parse(dispatchIds);
    const supabase = await createClient();
    const read = await supabase.rpc("ap_eway", { p_command: "sources", p_payload: { dispatch_ids: ids } });
    if (read.error) return { success: false, error: dbMessage(read.error, "The dispatches could not be read.") };
    const built = buildEwayExport((read.data ?? []) as EwaySource[]);
    const skipped = built.skipped.map(s => ({ dispatch_number: s.source.dispatch_number, issues: s.issues }));
    if (!built.included.length) return { success: true, data: { json: "", filename: "", included: [], skipped } };
    const json = JSON.stringify(built.file, null, 2);
    const sha = createHash("sha256").update(json).digest("hex");
    const recorded = await supabase.rpc("ap_eway", { p_command: "record_export", p_payload: { schema_version: EWAY_SCHEMA_VERSION, file_sha256: sha,
      docs: built.included.map(s => ({ dispatch_id: s.dispatch_id, doc_no: s.invoice!.number, doc_date: s.invoice!.date, total_value: s.invoice!.total })) } });
    if (recorded.error) return { success: false, error: dbMessage(recorded.error, "The export could not be recorded; the file was not issued.") };
    try { revalidatePath("/dispatches/eway"); } catch { /* outcome stands */ }
    return { success: true, data: { json, filename: `eway-bills-${getBusinessDateBoundaries().today}.json`,
      included: built.included.map(s => ({ dispatch_number: s.dispatch_number, doc_no: s.invoice!.number })), skipped } };
  } catch (error) {
    if (error instanceof Error && error.message === "permission") return { success: false, error: "Only accounts, dispatch or an admin can export e-way bills." };
    return { success: false, error: "The e-way bill file could not be prepared. Try again." };
  }
}

export type TallyExportResult = { xml: string; filename: string; exported: number; issues: TallyIssue[]; byKind: Record<string, number> };
const tallyInput = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kinds: z.array(z.enum(["sales", "receipt", "on_account", "purchase", "credit_note"])).max(5).optional() }).strict();

/** AP-083: builds the Tally import XML for the period's unexported vouchers and marks each exported voucher once. */
export async function exportTallyAction(input: z.input<typeof tallyInput>): Promise<Result<TallyExportResult>> {
  try {
    await context(["owner", "admin", "accounts"]);
    const parsed = tallyInput.parse(input);
    const supabase = await createClient();
    const read = await supabase.rpc("ap_tally", { p_command: "vouchers_data", p_payload: parsed });
    if (read.error) return { success: false, error: dbMessage(read.error, "The vouchers could not be read.") };
    const data = read.data as { company: { name: string }; vouchers: TallyVoucher[]; mappings: TallyMapping[] };
    const built = buildTallyExport(data.company?.name ?? "Omalco Extrusion", data.vouchers ?? [], data.mappings ?? []);
    const byKind = built.exported.reduce<Record<string, number>>((acc, v) => { acc[v.kind] = (acc[v.kind] ?? 0) + 1; return acc; }, {});
    if (!built.exported.length) return { success: true, data: { xml: "", filename: "", exported: 0, issues: built.issues, byKind } };
    const sha = createHash("sha256").update(built.xml).digest("hex");
    const recorded = await supabase.rpc("ap_tally", { p_command: "record_export", p_payload: { ...parsed, file_sha256: sha, vouchers: built.exported.map(v => ({ kind: v.kind, id: v.id })) } });
    if (recorded.error) return { success: false, error: dbMessage(recorded.error, "The export could not be recorded; the file was not issued.") };
    try { revalidatePath("/invoices/tally"); } catch { /* outcome stands */ }
    return { success: true, data: { xml: built.xml, filename: `tally-vouchers-${parsed.from}-to-${parsed.to}.xml`, exported: built.exported.length, issues: built.issues, byKind } };
  } catch (error) {
    if (error instanceof Error && error.message === "permission") return { success: false, error: "Only accounts, an admin or the owner can export to Tally." };
    return { success: false, error: "The Tally file could not be prepared. Try again." };
  }
}

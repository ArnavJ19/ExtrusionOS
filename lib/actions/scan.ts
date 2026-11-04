"use server";

import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can, type Resource } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { parseScanInput, type QrEntityType } from "@/lib/qr/payload";
import { QR_ENTITY_LABELS, QR_ENTITY_TABLES } from "@/lib/qr/entities";
import { SCAN_TASKS, scanActions, scanWarnings, type ScanAction, type ScanTask, type ScanWarning } from "@/lib/qr/scan-task";
import { canReadImprovement } from "@/lib/workflow/improvement";
import { canUseLifecycleAction } from "@/lib/workflow/lifecycle";

const SCAN_ROLES = ["owner", "admin", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "quality"];
// Business-safe fields only: no prices, costs or customer contact details.
const SCAN_FIELDS: Record<QrEntityType, string> = {
  profile: "id, profile_code, profile_name, section_weight_kg_per_m", die: "id, die_number, die_status, rack_location, die_type",
  billet_batch: "id, batch_number, alloy, temper, status", inventory_batch: "id, bundle_number, status, qc_status, quantity_pieces, total_weight_kg, location",
  inventory_item: "id, item_code, item_name, item_category, current_stock, unit, location", order: "id, order_number, current_stage, expected_dispatch_date",
  quote: "id, quote_number, status, quote_date", production_job: "id, job_number, status, planned_date", dispatch_package: "id, bundle_number, number_of_pieces, net_weight_kg",
  dispatch: "id, dispatch_number, delivery_status, vehicle_number", certificate: "id, file_name, document_type, approval_status, expiry_date", machine: "id, machine_code, machine_name, status",
  maintenance: "id, machine_type, maintenance_type, status, next_due_date", document: "id, file_name, document_type, approval_status"
};
const LABEL_KEYS = ["die_number", "bundle_number", "profile_code", "batch_number", "item_code", "order_number", "quote_number", "job_number", "dispatch_number", "machine_code", "file_name"];

export type ScanResolution = { ok: true; qrId: string | null; entityType: QrEntityType; entityTypeLabel: string; entityId: string; label: string; details: Record<string, string | number | boolean | null>; warnings: ScanWarning[]; actions: ScanAction[] }
  | { ok: false; error: string };

type Client = Awaited<ReturnType<typeof createClient>>;
type Context = Awaited<ReturnType<typeof getSessionContext>>;

async function resolve(supabase: Client, context: Context, raw: string): Promise<ScanResolution> {
  const input = parseScanInput(raw);
  if (input.kind === "rejected") return { ok: false, error: input.reason };
  if (input.kind === "v1" && input.payload.companyId !== context.companyId) return { ok: false, error: "This label belongs to another company and cannot be opened." };
  const qrColumns = "id, entity_type, entity_id, status, expires_at";
  const base = () => supabase.from("qr_codes").select(qrColumns).eq("company_id", context.companyId);
  let qr = (await base().eq("qr_value", input.raw).maybeSingle()).data as { id: string; entity_type: string; entity_id: string; status: string; expires_at: string | null } | null;
  if (!qr && (input.kind === "v1" || input.kind === "v2")) {
    const type = input.kind === "v1" ? input.payload.entityType : input.entityType, entityId = input.kind === "v1" ? input.payload.entityId : input.entityId;
    qr = (await base().eq("entity_type", type).eq("entity_id", entityId).order("created_at", { ascending: false }).limit(1).maybeSingle()).data as typeof qr;
  }
  if (!qr && input.kind === "uuid") qr = (await base().eq("entity_id", input.entityId).order("created_at", { ascending: false }).limit(1).maybeSingle()).data as typeof qr;
  if (qr && qr.status !== "active") return { ok: false, error: "This label was withdrawn or replaced. Use the current label, or ask for an authorized reprint." };
  if (qr?.expires_at && new Date(qr.expires_at).getTime() < Date.now()) return { ok: false, error: "This label has expired. Ask for an authorized reprint before using it." };
  const entityType = (qr?.entity_type ?? (input.kind === "v2" ? input.entityType : null)) as QrEntityType | null;
  const entityId = qr?.entity_id ?? (input.kind === "v2" ? input.entityId : null);
  if (!entityType || !entityId || !(entityType in SCAN_FIELDS)) return { ok: false, error: "No current record uses this code. Check the label, or search for the record instead." };
  const { data, error } = await supabase.from(QR_ENTITY_TABLES[entityType] as any).select(SCAN_FIELDS[entityType]).eq("company_id", context.companyId).eq("id", entityId).maybeSingle();
  if (error) return { ok: false, error: "The record could not be checked. Retry the scan." };
  if (!data) return { ok: false, error: "This record is no longer available to you." };
  const row = data as unknown as Record<string, unknown>;
  const details = Object.fromEntries(Object.entries(row).filter(([key]) => key !== "id").map(([key, value]) => [key, typeof value === "object" ? null : value as string | number | boolean | null]));
  const label = String(LABEL_KEYS.map(key => row[key]).find(value => typeof value === "string" && value) ?? QR_ENTITY_LABELS[entityType]);
  const permissions = { read: (resource: string) => can(context.role, "read", resource as Resource), create: (resource: string) => can(context.role, "create", resource as Resource),
    readDieHistory: canReadImprovement(context.role, "dies"), splitBundles: canUseLifecycleAction(context.role, "bundle.split") };
  return { ok: true, qrId: qr?.id ?? null, entityType, entityTypeLabel: QR_ENTITY_LABELS[entityType], entityId, label, details, warnings: scanWarnings(entityType, row), actions: scanActions(entityType, row, permissions) };
}

async function scanContext() {
  const context = await getSessionContext();
  if (context.dealerId || !SCAN_ROLES.includes(context.role)) return null;
  return context;
}

/** NOV-017: resolve one scan through an authenticated, company-scoped lookup and log the view. */
export async function resolveScanAction(raw: string): Promise<ScanResolution> {
  try {
    const value = z.string().max(400).parse(raw);
    const context = await scanContext();
    if (!context) return { ok: false, error: "Scanning is not available for your role." };
    const supabase = await createClient();
    const result = await resolve(supabase, context, value);
    if (result.ok) {
      // The view log is evidence of the scan only; its failure never blocks the lookup.
      await supabase.from("scan_events").insert({ company_id: context.companyId, qr_code_id: result.qrId, entity_type: result.entityType, entity_id: result.entityId, scanned_by: context.userId, action_type: "viewed", metadata_json: { source: "scanner" } }).then(() => undefined, () => undefined);
      if (result.qrId) await supabase.from("qr_codes").update({ last_scanned_at: new Date().toISOString() }).eq("id", result.qrId).eq("company_id", context.companyId).then(() => undefined, () => undefined);
    }
    return result;
  } catch { return { ok: false, error: "The scan could not be checked. Retry, or type the code." }; }
}

export type ScanSessionResult = { ok: true; recorded: { label: string; warnings: string[] }[]; refused: { code: string; reason: string }[] } | { ok: false; error: string };

/**
 * Records a bounded scan session after review. Each code is resolved again now, so a bundle held or
 * consumed since it was scanned is caught. Dispatch loading refuses held or consumed material.
 */
export async function recordScanSessionAction(input: { task: ScanTask; codes: string[] }): Promise<ScanSessionResult> {
  try {
    const parsed = z.object({ task: z.enum(["stock_checked", "die_checked", "loaded_for_dispatch"]), codes: z.array(z.string().min(1).max(400)).min(1).max(100) }).strict().parse(input);
    const context = await scanContext();
    if (!context) return { ok: false, error: "Scanning is not available for your role." };
    const supabase = await createClient();
    const sessionId = crypto.randomUUID();
    const seen = new Set<string>();
    const recorded: { label: string; warnings: string[] }[] = [], refused: { code: string; reason: string }[] = [], rows: Record<string, unknown>[] = [];
    for (const code of parsed.codes) {
      const result = await resolve(supabase, context, code);
      if (!result.ok) { refused.push({ code, reason: result.error }); continue; }
      const key = `${result.entityType}:${result.entityId}`;
      if (seen.has(key)) { refused.push({ code, reason: `${result.label} was already scanned in this session.` }); continue; }
      seen.add(key);
      if (!SCAN_TASKS[parsed.task].accepts.includes(result.entityType)) { refused.push({ code, reason: `${result.entityTypeLabel} labels are not part of a ${SCAN_TASKS[parsed.task].label.toLowerCase()}.` }); continue; }
      if (parsed.task === "loaded_for_dispatch" && result.warnings.some(warning => warning.tone === "critical")) { refused.push({ code, reason: `${result.label}: ${result.warnings.find(warning => warning.tone === "critical")!.text}` }); continue; }
      rows.push({ company_id: context.companyId, qr_code_id: result.qrId, entity_type: result.entityType, entity_id: result.entityId, scanned_by: context.userId, action_type: parsed.task,
        metadata_json: { session_id: sessionId, warnings: result.warnings.map(warning => warning.text) } });
      recorded.push({ label: result.label, warnings: result.warnings.map(warning => warning.text) });
    }
    if (rows.length) {
      const { error } = await supabase.from("scan_events").insert(rows);
      if (error) return { ok: false, error: "The scans could not be recorded. Nothing from this session was saved; retry." };
    }
    return { ok: true, recorded, refused };
  } catch { return { ok: false, error: "The scan session could not be recorded. Check the list and retry." }; }
}

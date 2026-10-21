"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";
import { canRunErpControl, type ErpControlKey } from "@/lib/workflow/erp-control-roles";

// Server entry point for the audited ERP workflows added by the EXOS-AUD remediation.
// Every action calls a SECURITY DEFINER RPC that re-checks the role and company; the
// role list here only gives an early, readable refusal.

const uuid = z.string().uuid();
const reason = (min: number) => z.string().trim().min(min, `Give a reason of at least ${min} characters.`);
const positive = z.coerce.number().positive("Enter a positive number.");
const optionalNumber = z.union([z.literal(""), z.null(), z.undefined(), z.coerce.number()]).transform((value) => (value === "" || value == null ? null : Number(value)));
const optionalText = z.union([z.string(), z.null(), z.undefined()]).transform((value) => (value ?? "").trim() || null);
const uuidList = z.array(uuid).min(1, "Select at least one row.");

type Spec = {
  schema: z.ZodTypeAny;
  rpc: string;
  args: (input: any) => Record<string, unknown>;
  paths: (input: any) => string[];
};

const specs: Record<ErpControlKey, Spec> = {
  order_short_close: {
    schema: z.object({ order_id: uuid, reason: reason(10) }),
    rpc: "short_close_order_delivery_atomic",
    args: (i) => ({ p_order_id: i.order_id, p_reason: i.reason }),
    paths: (i) => [`/orders/${i.order_id}`, "/orders", "/dispatches"]
  },
  production_input_exception: {
    schema: z.object({ job_id: uuid, reason: reason(10), input_source: z.enum(["not_tracked", "customer_supplied", "external_billets"]).default("not_tracked") }),
    rpc: "record_production_input_exception",
    args: (i) => ({ p_job_id: i.job_id, p_reason: i.reason, p_input_source: i.input_source }),
    paths: (i) => [`/production/${i.job_id}`]
  },
  production_issue_billets: {
    schema: z.object({ job_id: uuid, billet_ids: uuidList }),
    rpc: "issue_production_billets",
    args: (i) => ({ p_job_id: i.job_id, p_billet_ids: i.billet_ids }),
    paths: (i) => [`/production/${i.job_id}`, "/foundry/billets"]
  },
  scrap_reverse: {
    schema: z.object({ scrap_record_id: uuid, job_id: uuid.optional(), reason: reason(10) }),
    rpc: "reverse_process_scrap_posting",
    args: (i) => ({ p_scrap_record_id: i.scrap_record_id, p_reason: i.reason }),
    paths: (i) => [i.job_id ? `/production/${i.job_id}` : "/production", "/foundry/scrap"]
  },
  dispatch_amend_documents: {
    schema: z.object({
      dispatch_id: uuid, reason: reason(10),
      transporter_name: optionalText, vehicle_number: optionalText, driver_name: optionalText,
      driver_phone: optionalText, eway_bill_number: optionalText, lr_number: optionalText
    }),
    rpc: "amend_dispatch_transport_documents",
    args: (i) => {
      const changes: Record<string, string> = {};
      for (const field of ["transporter_name", "vehicle_number", "driver_name", "driver_phone", "eway_bill_number", "lr_number"]) {
        if (i[field]) changes[field] = i[field];
      }
      return { p_dispatch_id: i.dispatch_id, p_changes: changes, p_reason: i.reason };
    },
    paths: (i) => [`/dispatches/${i.dispatch_id}`]
  },
  dispatch_return_disposition: {
    schema: z.object({ dispatch_id: uuid, packing_list_item_id: uuid, disposition: z.enum(["quarantine", "rework", "scrap", "return_to_stock", "scrap_sale", "write_off"]), weight_kg: positive, pieces: optionalNumber, reason: reason(5) }),
    rpc: "record_material_disposition",
    args: (i) => ({ p_source_type: "dispatch_return", p_source_id: i.dispatch_id, p_packing_list_item_id: i.packing_list_item_id, p_disposition: i.disposition, p_weight_kg: i.weight_kg, p_pieces: i.pieces, p_reason: i.reason }),
    paths: (i) => [`/dispatches/${i.dispatch_id}`, "/inventory/reservations", "/foundry/scrap"]
  },
  dispatch_partial_credit: {
    schema: z.object({ dispatch_id: uuid, packing_list_item_ids: uuidList, reason: reason(8), idempotency_key: uuid }),
    rpc: "issue_partial_return_credit_note_atomic",
    args: (i) => ({ p_dispatch_id: i.dispatch_id, p_packing_list_item_ids: i.packing_list_item_ids, p_reason: i.reason, p_idempotency_key: i.idempotency_key }),
    paths: (i) => [`/dispatches/${i.dispatch_id}`, "/invoices", "/payments", "/analytics"]
  },
  qc_reject_disposition: {
    schema: z.object({ inspection_id: uuid, disposition: z.enum(["quarantine", "rework", "scrap", "scrap_sale"]), weight_kg: positive, reason: reason(5) }),
    rpc: "record_material_disposition",
    args: (i) => ({ p_source_type: "qc_reject", p_source_id: i.inspection_id, p_packing_list_item_id: null, p_disposition: i.disposition, p_weight_kg: i.weight_kg, p_pieces: null, p_reason: i.reason }),
    paths: (i) => [`/quality/${i.inspection_id}`, "/foundry/scrap"]
  },
  finishing_reject_disposition: {
    schema: z.object({ finishing_job_id: uuid, disposition: z.enum(["quarantine", "rework", "scrap", "scrap_sale"]), weight_kg: positive, reason: reason(5) }),
    rpc: "record_material_disposition",
    args: (i) => ({ p_source_type: "finishing_reject", p_source_id: i.finishing_job_id, p_packing_list_item_id: null, p_disposition: i.disposition, p_weight_kg: i.weight_kg, p_pieces: null, p_reason: i.reason }),
    paths: (i) => [`/production/finishing/${i.finishing_job_id}`, "/foundry/scrap"]
  },
  machine_return_to_service: {
    schema: z.object({ machine_id: uuid, note: reason(10) }),
    rpc: "return_machine_to_service_atomic",
    args: (i) => ({ p_machine_id: i.machine_id, p_note: i.note }),
    paths: (i) => [`/machines/${i.machine_id}`, "/maintenance", "/production/schedule"]
  },
  maintenance_complete: {
    schema: z.object({ schedule_id: uuid, done_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the done date."), note: optionalText }),
    rpc: "complete_maintenance_schedule_atomic",
    args: (i) => ({ p_schedule_id: i.schedule_id, p_done_date: i.done_date, p_note: i.note }),
    paths: () => ["/maintenance"]
  },
  books_lock: {
    schema: z.object({ locked_through: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the lock date."), reason: reason(10) }),
    rpc: "set_books_locked_through",
    args: (i) => ({ p_locked_through: i.locked_through, p_reason: i.reason }),
    paths: () => ["/settings", "/invoices", "/expenses"]
  },
  foundry_cast_result: {
    schema: z.object({ batch_id: uuid, good_count: z.coerce.number().int().min(0), measured_good_kg: z.coerce.number().min(0), dross_kg: optionalNumber, reject_reason: optionalText }),
    rpc: "record_foundry_cast_result",
    args: (i) => ({ p_batch_id: i.batch_id, p_good_count: i.good_count, p_measured_good_kg: i.measured_good_kg, p_dross_kg: i.dross_kg ?? 0, p_reject_reason: i.reject_reason }),
    paths: (i) => [`/foundry/${i.batch_id}`, "/foundry/billets"]
  },
  foundry_chemistry_record: {
    schema: z.object({
      batch_id: uuid, sample_stage: z.enum(["melt", "cast", "retest"]), result: z.enum(["pass", "fail"]), spectrometer_reference: optionalText, notes: optionalText,
      si: optionalNumber, fe: optionalNumber, cu: optionalNumber, mn: optionalNumber, mg: optionalNumber, cr: optionalNumber, zn: optionalNumber, ti: optionalNumber
    }),
    rpc: "record_foundry_chemistry_test",
    args: (i) => {
      const composition: Record<string, number> = {};
      for (const element of ["si", "fe", "cu", "mn", "mg", "cr", "zn", "ti"]) {
        if (i[element] != null) composition[element.charAt(0).toUpperCase() + element.slice(1)] = i[element];
      }
      return { p_batch_id: i.batch_id, p_sample_stage: i.sample_stage, p_composition: composition, p_result: i.result, p_spectrometer_reference: i.spectrometer_reference, p_notes: i.notes };
    },
    paths: (i) => [`/foundry/${i.batch_id}`]
  },
  foundry_chemistry_approve: {
    schema: z.object({ test_id: uuid, batch_id: uuid }),
    rpc: "approve_foundry_chemistry_test",
    args: (i) => ({ p_test_id: i.test_id }),
    paths: (i) => [`/foundry/${i.batch_id}`]
  },
  billet_reject: {
    schema: z.object({ billet_id: uuid, reason: reason(5) }),
    rpc: "reject_foundry_billet",
    args: (i) => ({ p_billet_id: i.billet_id, p_reason: i.reason }),
    paths: (i) => [`/foundry/billets/${i.billet_id}`, "/foundry/billets", "/foundry/scrap"]
  },
  alloy_deviation: {
    schema: z.object({ source_table: z.enum(["foundry_aluminium_scrap", "foundry_external_aluminium_sources"]), source_id: uuid, batch_alloy: z.string().trim().min(2), reason: reason(10) }),
    rpc: "approve_foundry_alloy_deviation",
    args: (i) => ({ p_source_table: i.source_table, p_source_id: i.source_id, p_batch_alloy: i.batch_alloy, p_reason: i.reason }),
    paths: (i) => [i.source_table === "foundry_aluminium_scrap" ? `/foundry/scrap/${i.source_id}` : `/foundry/external-sources/${i.source_id}`]
  },
  stock_from_surplus: {
    schema: z.object({ job_id: uuid, weight_kg: positive, pieces: z.coerce.number().int().positive(), piece_length_m: positive, bundle_number: optionalText, location: optionalText, notes: optionalText }),
    rpc: "create_stock_from_production_surplus",
    args: (i) => ({ p_production_job_id: i.job_id, p_weight_kg: i.weight_kg, p_pieces: i.pieces, p_piece_length_m: i.piece_length_m, p_bundle_number: i.bundle_number, p_location: i.location, p_notes: i.notes }),
    paths: (i) => [`/production/${i.job_id}`, "/inventory/reservations"]
  },
  stock_opening: {
    schema: z.object({ profile_id: uuid, finish: z.string().trim().min(1), weight_kg: positive, pieces: z.coerce.number().int().positive(), piece_length_m: positive, alloy: optionalText, temper: optionalText, bundle_number: optionalText, location: optionalText, reason: reason(10) }),
    rpc: "record_opening_stock_batch",
    args: (i) => ({ p_profile_id: i.profile_id, p_finish: i.finish, p_weight_kg: i.weight_kg, p_pieces: i.pieces, p_piece_length_m: i.piece_length_m, p_alloy: i.alloy, p_temper: i.temper, p_bundle_number: i.bundle_number, p_location: i.location, p_reason: i.reason }),
    paths: () => ["/inventory/reservations", "/inventory"]
  },
  stock_qc_release: {
    schema: z.object({ batch_id: uuid, decision: z.enum(["released", "rejected"]), note: optionalText }),
    rpc: "release_stock_batch_qc",
    args: (i) => ({ p_batch_id: i.batch_id, p_decision: i.decision, p_note: i.note }),
    paths: () => ["/inventory/reservations", "/inventory"]
  },
  inventory_adjust: {
    schema: z.object({ item_id: uuid, direction: z.enum(["in", "out"]), quantity: positive, reason: reason(10) }),
    rpc: "post_inventory_adjustment",
    args: (i) => ({ p_item_id: i.item_id, p_direction: i.direction, p_quantity: i.quantity, p_reason: i.reason }),
    paths: (i) => [`/inventory/${i.item_id}`, "/inventory"]
  },
  profile_spec_change: {
    schema: z.object({
      profile_id: uuid, reason: reason(10), section_weight_kg_per_m: optionalNumber, alloy: optionalText, temper: optionalText,
      billet_diameter_required_inch: optionalNumber, weight_tolerance_percent: optionalNumber, hardness_requirement: optionalText
    }),
    rpc: "approve_profile_spec_change",
    args: (i) => {
      const changes: Record<string, unknown> = {};
      for (const field of ["section_weight_kg_per_m", "alloy", "temper", "billet_diameter_required_inch", "weight_tolerance_percent", "hardness_requirement"]) {
        if (i[field] != null) changes[field] = i[field];
      }
      return { p_profile_id: i.profile_id, p_changes: changes, p_reason: i.reason };
    },
    paths: (i) => [`/profiles/${i.profile_id}`]
  }
};

export type ErpControlResult = { success: true; id: string | null } | { success: false; error: string };

export async function runErpControlAction(key: ErpControlKey, input: Record<string, unknown>): Promise<ErpControlResult> {
  try {
    const spec = specs[key];
    if (!spec) return { success: false, error: "Unknown action." };
    const context = await getSessionContext();
    if (!canRunErpControl(context.role, key)) {
      return { success: false, error: "Your role cannot perform this action." };
    }
    const parsed = spec.schema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the details." };
    const supabase = await createClient();
    const result = await supabase.rpc(spec.rpc as any, spec.args(parsed.data) as any);
    if (result.error) throw result.error;
    for (const path of spec.paths(parsed.data)) revalidatePath(path);
    return { success: true, id: result.data == null ? null : String(result.data) };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "The action could not be completed.") };
  }
}

const companyControlsSchema = z.object({
  delivery_completion_tolerance_percent: z.coerce.number().min(0).max(10),
  metal_receipt_max_kg: z.coerce.number().positive(),
  metal_receipt_weighbridge_threshold_kg: z.coerce.number().positive()
}).refine((value) => value.metal_receipt_weighbridge_threshold_kg <= value.metal_receipt_max_kg, { message: "The weighbridge threshold cannot exceed the receipt limit." });

export async function saveCompanyControlSettingsAction(input: Record<string, unknown>): Promise<ErpControlResult> {
  try {
    const context = await getSessionContext();
    if (!["owner", "admin"].includes(context.role)) return { success: false, error: "Only an owner or admin can change these controls." };
    const parsed = companyControlsSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the control values." };
    const supabase = await createClient();
    const { error } = await supabase.from("company_settings").update(parsed.data as any).eq("company_id", context.companyId);
    if (error) throw error;
    revalidatePath("/settings");
    return { success: true, id: null };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not save the controls.") };
  }
}

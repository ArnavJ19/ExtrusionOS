import type { ErpControlAction } from "@/components/modules/erp-control-panel";
import { canRunErpControl } from "@/lib/workflow/erp-control-roles";
import type { SessionContext } from "@/types/app";

// Builds the audited-workflow actions shown on each detail page (EXOS-AUD remediation).
// Queries run under the user's RLS session; the RPCs re-validate everything.

type Db = any;
const kg = (value: unknown) => Number(value ?? 0).toFixed(3);
const reasonField = (label = "Reason", min = 10) => ({ name: "reason", label: `${label} (min ${min} characters)`, type: "textarea" as const, required: true });

export async function productionJobControls(db: Db, context: SessionContext, jobId: string): Promise<ErpControlAction[]> {
  const role = context.role;
  const [jobResult, billetResult, exceptionResult, scrapResult] = await Promise.all([
    db.from("production_jobs").select("id, status, job_number, actual_quantity_kg, pieces, length_per_piece_m").eq("company_id", context.companyId).eq("id", jobId).maybeSingle(),
    db.from("foundry_billets").select("id, billet_code, status, weight_kg, measured_weight_kg").eq("company_id", context.companyId).eq("production_job_id", jobId).limit(200),
    db.from("production_input_exceptions").select("id").eq("company_id", context.companyId).eq("production_job_id", jobId).maybeSingle(),
    db.from("scrap_records").select("id, weight_kg, scrap_category, recorded_date").eq("company_id", context.companyId).eq("production_job_id", jobId).limit(50)
  ]);
  const job = jobResult.data;
  if (!job) return [];
  const billets = billetResult.data ?? [];
  const open = !["completed", "cancelled"].includes(job.status);
  const actions: ErpControlAction[] = [];

  const allocated = billets.filter((billet: any) => billet.status === "allocated");
  if (open && allocated.length && canRunErpControl(role, "production_issue_billets")) {
    actions.push({
      key: "production_issue_billets", title: "Issue billets to the press",
      description: "Record the billets physically taken to the press. Planning only links billets; a job that needs billets cannot start until at least one is issued.",
      submitLabel: "Issue selected billets", fixed: { job_id: jobId },
      fields: [{ name: "billet_ids", label: "Linked billets", type: "checklist", required: true, options: allocated.map((billet: any) => ({ value: billet.id, label: `${billet.billet_code} · ${kg(billet.measured_weight_kg ?? billet.weight_kg)} kg` })) }]
    });
  }
  const hasInput = billets.some((billet: any) => ["allocated", "issued", "consumed"].includes(billet.status));
  if (open && !hasInput && !exceptionResult.data && canRunErpControl(role, "production_input_exception")) {
    actions.push({
      key: "production_input_exception", title: "Record an input exception",
      description: "This job has no linked billets. Completion needs linked billets or a manager-approved exception (reported separately in recovery).",
      submitLabel: "Record exception", fixed: { job_id: jobId },
      fields: [
        { name: "input_source", label: "Metal input", type: "select", required: true, defaultValue: "not_tracked", options: [{ value: "not_tracked", label: "Input not tracked" }, { value: "customer_supplied", label: "Customer-supplied billets" }, { value: "external_billets", label: "External billets not in stock" }] },
        reasonField()
      ]
    });
  }
  if (job.status === "completed" && canRunErpControl(role, "stock_from_surplus")) {
    actions.push({
      key: "stock_from_surplus", title: "Move unshipped surplus to finished stock",
      description: "Only QC-released output of this job that has not been shipped or stocked can be moved. The stock batch keeps the job, alloy and temper.",
      submitLabel: "Create stock batch", fixed: { job_id: jobId },
      fields: [
        { name: "weight_kg", label: "Weight kg", type: "number", step: "0.001", required: true },
        { name: "pieces", label: "Pieces", type: "number", step: "1", required: true },
        { name: "piece_length_m", label: "Length per piece m", type: "number", step: "0.001", required: true, defaultValue: job.length_per_piece_m ? String(job.length_per_piece_m) : "" },
        { name: "bundle_number", label: "Bundle number" },
        { name: "location", label: "Location", defaultValue: "Finished goods store" },
        { name: "notes", label: "Notes", type: "textarea" }
      ]
    });
  }
  const scrapIds = (scrapResult.data ?? []).map((row: any) => row.id);
  if (scrapIds.length && canRunErpControl(role, "scrap_reverse")) {
    const reversals = await db.from("scrap_record_reversals").select("scrap_record_id").eq("company_id", context.companyId).in("scrap_record_id", scrapIds);
    const reversed = new Set((reversals.data ?? []).map((row: any) => row.scrap_record_id));
    const reversible = (scrapResult.data ?? []).filter((row: any) => !reversed.has(row.id));
    if (reversible.length) {
      actions.push({
        key: "scrap_reverse", title: "Reverse an erroneous scrap posting",
        description: "Retires the furnace scrap lots made from the posting, only if none of that metal has been charged.",
        submitLabel: "Reverse posting", fixed: { job_id: jobId },
        fields: [
          { name: "scrap_record_id", label: "Scrap posting", type: "select", required: true, options: reversible.map((row: any) => ({ value: row.id, label: `${kg(row.weight_kg)} kg · ${String(row.scrap_category ?? "unclassified").replace(/_/g, " ")} · ${row.recorded_date ?? ""}` })) },
          reasonField()
        ]
      });
    }
  }
  return actions;
}

export async function orderControls(db: Db, context: SessionContext, orderId: string, currentStage: string | null): Promise<ErpControlAction[]> {
  if (currentStage !== "dispatched" || !canRunErpControl(context.role, "order_short_close")) return [];
  const { data } = await db.from("dispatches").select("delivery_status, total_weight_kg").eq("company_id", context.companyId).eq("order_id", orderId);
  const rows = data ?? [];
  const open = rows.filter((row: any) => ["dispatched", "in_transit", "delayed"].includes(row.delivery_status)).length;
  const delivered = rows.filter((row: any) => row.delivery_status === "delivered").reduce((sum: number, row: any) => sum + Number(row.total_weight_kg ?? 0), 0);
  return [{
    key: "order_short_close", title: "Short-close delivery",
    description: `Close the order at the delivered quantity (${kg(delivered)} kg) when the customer accepts a shortfall. The closure and reason are recorded.`,
    submitLabel: "Short-close order", fixed: { order_id: orderId },
    disabledReason: open > 0 ? `${open} shipment(s) are still in transit.` : delivered <= 0 ? "No shipment has been delivered yet." : null,
    fields: [reasonField()]
  }];
}

export async function dispatchControls(db: Db, context: SessionContext, dispatch: { id: string; delivery_status: string }, hasInvoice: boolean): Promise<ErpControlAction[]> {
  const role = context.role;
  const actions: ErpControlAction[] = [];
  if (dispatch.delivery_status !== "pending" && canRunErpControl(role, "dispatch_amend_documents")) {
    actions.push({
      key: "dispatch_amend_documents", title: "Amend transport documents",
      description: "Recorded e-way bill, LR, vehicle and transporter details are frozen after dispatch. Fill only the fields that change; every change is logged with the old value.",
      submitLabel: "Record amendment", fixed: { dispatch_id: dispatch.id },
      fields: [
        { name: "eway_bill_number", label: "New e-way bill number" }, { name: "lr_number", label: "New LR number" },
        { name: "vehicle_number", label: "New vehicle number" }, { name: "transporter_name", label: "New transporter" },
        { name: "driver_name", label: "New driver name" }, { name: "driver_phone", label: "New driver phone" },
        reasonField("Amendment reason")
      ]
    });
  }
  if (!["returned", "damaged", "delivered"].includes(dispatch.delivery_status)) return actions;
  const [packingResult, dispositionResult] = await Promise.all([
    db.from("packing_list_items").select("id, bundle_number, net_weight_kg, number_of_pieces").eq("company_id", context.companyId).eq("dispatch_id", dispatch.id).order("bundle_number"),
    db.from("material_dispositions").select("packing_list_item_id, disposition, weight_kg").eq("company_id", context.companyId).eq("dispatch_id", dispatch.id)
  ]);
  const packing = packingResult.data ?? [];
  const dispositioned = new Set((dispositionResult.data ?? []).filter((row: any) => row.disposition !== "quarantine").map((row: any) => row.packing_list_item_id));
  const bundleOptions = packing.map((row: any) => ({ value: row.id, label: `Bundle ${row.bundle_number ?? "-"} · ${kg(row.net_weight_kg)} kg · ${row.number_of_pieces ?? 0} pcs` }));
  if (packing.length && canRunErpControl(role, "dispatch_return_disposition")) {
    actions.push({
      key: "dispatch_return_disposition", title: "Disposition returned material",
      description: "Record what happened to a returned or damaged bundle: back to stock (on QC hold), scrap (to the furnace store), rework, scrap sale or write-off.",
      submitLabel: "Record disposition", fixed: { dispatch_id: dispatch.id },
      fields: [
        { name: "packing_list_item_id", label: "Bundle", type: "select", required: true, options: bundleOptions },
        { name: "disposition", label: "Disposition", type: "select", required: true, options: [
          { value: "return_to_stock", label: "Return to stock (QC hold)" }, { value: "scrap", label: "Scrap to furnace store" }, { value: "rework", label: "Rework" },
          { value: "scrap_sale", label: "Sell as scrap" }, { value: "write_off", label: "Write off (lost/destroyed)" }, { value: "quarantine", label: "Quarantine (decide later)" }] },
        { name: "weight_kg", label: "Weight kg", type: "number", step: "0.001", required: true },
        { name: "pieces", label: "Pieces", type: "number", step: "1" },
        reasonField("Reason", 5)
      ]
    });
  }
  if (hasInvoice && canRunErpControl(role, "dispatch_partial_credit")) {
    const creditable = packing.filter((row: any) => dispositioned.has(row.id));
    actions.push({
      key: "dispatch_partial_credit", title: "Partial credit note for returned bundles",
      description: "Credits only the invoice lines of the selected bundles (value plus GST at each line's rate). A bundle must have a recorded return disposition first.",
      submitLabel: "Issue partial credit note", fixed: { dispatch_id: dispatch.id }, idempotent: true,
      disabledReason: creditable.length ? null : "Record the return disposition of the returned bundles first.",
      fields: [
        { name: "packing_list_item_ids", label: "Bundles to credit", type: "checklist", required: true, options: bundleOptions.filter((option: any) => dispositioned.has(option.value)) },
        reasonField("Credit reason", 8)
      ]
    });
  }
  return actions;
}

export function qualityRejectControls(context: SessionContext, inspection: { id: string; status: string; quantity_checked_kg: number | null }): ErpControlAction[] {
  if (inspection.status !== "rejected" || !canRunErpControl(context.role, "qc_reject_disposition")) return [];
  return [{
    key: "qc_reject_disposition", title: "Disposition rejected material",
    description: `Up to ${kg(inspection.quantity_checked_kg)} kg. Scrap goes to the furnace store with the job alloy; rejected profiles cannot return to sellable stock.`,
    submitLabel: "Record disposition", fixed: { inspection_id: inspection.id },
    fields: [
      { name: "disposition", label: "Disposition", type: "select", required: true, options: [{ value: "scrap", label: "Scrap to furnace store" }, { value: "rework", label: "Rework" }, { value: "scrap_sale", label: "Sell as scrap" }, { value: "quarantine", label: "Quarantine (decide later)" }] },
      { name: "weight_kg", label: "Weight kg", type: "number", step: "0.001", required: true },
      reasonField("Reason", 5)
    ]
  }];
}

export function finishingRejectControls(context: SessionContext, job: { id: string; rejection_weight_kg: number | null }): ErpControlAction[] {
  if (Number(job.rejection_weight_kg ?? 0) <= 0 || !canRunErpControl(context.role, "finishing_reject_disposition")) return [];
  return [{
    key: "finishing_reject_disposition", title: "Disposition finishing rejects",
    description: `Up to ${kg(job.rejection_weight_kg)} kg of finishing rejection. Coated scrap is recorded as painted.`,
    submitLabel: "Record disposition", fixed: { finishing_job_id: job.id },
    fields: [
      { name: "disposition", label: "Disposition", type: "select", required: true, options: [{ value: "scrap", label: "Scrap to furnace store" }, { value: "rework", label: "Rework / re-coat" }, { value: "scrap_sale", label: "Sell as scrap" }, { value: "quarantine", label: "Quarantine (decide later)" }] },
      { name: "weight_kg", label: "Weight kg", type: "number", step: "0.001", required: true },
      reasonField("Reason", 5)
    ]
  }];
}

export async function machineControls(db: Db, context: SessionContext, machineId: string): Promise<ErpControlAction[]> {
  if (!canRunErpControl(context.role, "machine_return_to_service")) return [];
  const [{ data: machine }, { data: openBreakdowns }] = await Promise.all([
    db.from("machines").select("id, status").eq("company_id", context.companyId).eq("id", machineId).maybeSingle(),
    db.from("breakdown_logs").select("id").eq("company_id", context.companyId).eq("machine_ref_id", machineId).neq("status", "resolved")
  ]);
  if (!machine || !["breakdown", "maintenance"].includes(machine.status)) return [];
  const open = (openBreakdowns ?? []).length;
  return [{
    key: "machine_return_to_service", title: "Return to service sign-off",
    description: "A machine locked out by a breakdown or maintenance becomes schedulable again only through this sign-off.",
    submitLabel: "Return to service", fixed: { machine_id: machineId },
    disabledReason: open ? `Resolve the ${open} open breakdown(s) in Maintenance first.` : null,
    fields: [{ name: "note", label: "Sign-off note (min 10 characters)", type: "textarea", required: true }]
  }];
}

export async function foundryBatchControls(db: Db, context: SessionContext, batchId: string): Promise<ErpControlAction[]> {
  const role = context.role;
  const [{ data: batch }, { data: cast }, { data: tests }] = await Promise.all([
    db.from("foundry_batches").select("id, status, billet_count, billet_weight_density_kg, alloy").eq("company_id", context.companyId).eq("id", batchId).maybeSingle(),
    db.from("foundry_cast_results").select("id").eq("company_id", context.companyId).eq("foundry_batch_id", batchId).maybeSingle(),
    db.from("foundry_chemistry_tests").select("id, result, sample_stage, tested_at, approved_at, tested_by").eq("company_id", context.companyId).eq("foundry_batch_id", batchId).order("tested_at", { ascending: false }).limit(20)
  ]);
  if (!batch || ["planned", "cancelled"].includes(batch.status)) return [];
  const actions: ErpControlAction[] = [];
  if (["cast", "homogenizing"].includes(batch.status) && !cast && canRunErpControl(role, "foundry_cast_result")) {
    actions.push({
      key: "foundry_cast_result", title: "Record cast result",
      description: `Planned ${batch.billet_count} billets at ${kg(batch.billet_weight_density_kg)} kg each. Billets above the good count become scrap (to the furnace store); good billets take the measured weight. Required before release.`,
      submitLabel: "Record cast result", fixed: { batch_id: batchId },
      fields: [
        { name: "good_count", label: "Good billets", type: "number", step: "1", required: true, defaultValue: String(batch.billet_count ?? "") },
        { name: "measured_good_kg", label: "Measured weight of good billets kg", type: "number", step: "0.001", required: true },
        { name: "dross_kg", label: "Dross / skim kg", type: "number", step: "0.001" },
        { name: "reject_reason", label: "Reject reason (if any billets rejected)", type: "textarea" }
      ]
    });
  }
  if (canRunErpControl(role, "foundry_chemistry_record") && !["ready", "issued"].includes(batch.status)) {
    const element = (name: string, label: string) => ({ name, label: `${label} %`, type: "number" as const, step: "0.001" });
    actions.push({
      key: "foundry_chemistry_record", title: "Record spectrometer chemistry",
      description: `Alloy ${batch.alloy ?? "-"}. The latest test must be an approved pass before the batch can be released.`,
      submitLabel: "Record chemistry", fixed: { batch_id: batchId },
      fields: [
        { name: "sample_stage", label: "Sample", type: "select", required: true, defaultValue: "cast", options: [{ value: "melt", label: "Melt" }, { value: "cast", label: "Cast" }, { value: "retest", label: "Retest" }] },
        { name: "result", label: "Result", type: "select", required: true, options: [{ value: "pass", label: "Pass" }, { value: "fail", label: "Fail" }] },
        element("si", "Si"), element("fe", "Fe"), element("cu", "Cu"), element("mn", "Mn"), element("mg", "Mg"), element("cr", "Cr"), element("zn", "Zn"), element("ti", "Ti"),
        { name: "spectrometer_reference", label: "Spectrometer report ref" }, { name: "notes", label: "Notes", type: "textarea" }
      ]
    });
  }
  const pending = (tests ?? []).filter((test: any) => !test.approved_at && (test.tested_by !== context.userId || role === "owner"));
  if (pending.length && canRunErpControl(role, "foundry_chemistry_approve")) {
    actions.push({
      key: "foundry_chemistry_approve", title: "Approve chemistry test",
      description: "Approval must come from someone other than the person who recorded the test (except the owner).",
      submitLabel: "Approve test", fixed: { batch_id: batchId },
      fields: [{ name: "test_id", label: "Test", type: "select", required: true, options: pending.map((test: any) => ({ value: test.id, label: `${test.sample_stage} · ${test.result} · ${String(test.tested_at).slice(0, 16).replace("T", " ")}` })) }]
    });
  }
  return actions;
}

export function billetControls(context: SessionContext, billet: { id: string; status: string; production_job_id: string | null }): ErpControlAction[] {
  if (!["planned", "cast", "allocated"].includes(billet.status) || billet.production_job_id || !canRunErpControl(context.role, "billet_reject")) return [];
  return [{
    key: "billet_reject", title: "Reject billet",
    description: "Moves a defective billet to scrap (furnace store, same alloy) and releases its order allocation.",
    submitLabel: "Reject billet", fixed: { billet_id: billet.id },
    fields: [reasonField("Defect / reason", 5)]
  }];
}

export function alloyDeviationControls(context: SessionContext, sourceTable: "foundry_aluminium_scrap" | "foundry_external_aluminium_sources", sourceId: string, sourceAlloy: string | null): ErpControlAction[] {
  if (!canRunErpControl(context.role, "alloy_deviation")) return [];
  return [{
    key: "alloy_deviation", title: "Approve alloy deviation",
    description: `Source alloy: ${sourceAlloy || "not recorded"}. Furnace batches accept only the same alloy or primary aluminium unless a deviation for the batch alloy is approved here.`,
    submitLabel: "Approve deviation", fixed: { source_table: sourceTable, source_id: sourceId },
    fields: [{ name: "batch_alloy", label: "Batch alloy it may be charged into", required: true, placeholder: "6063" }, reasonField("Metallurgical justification")]
  }];
}

// EXOS-AUD2-004: lot status changes only through this audited disposition.
const metalReleaseRoles = ["owner", "admin", "factory_manager", "quality"];
export function metalSourceDispositionControls(
  context: SessionContext,
  sourceTable: "foundry_aluminium_scrap" | "foundry_external_aluminium_sources",
  source: { id: string; status: string | null; available_weight_kg?: number | string | null; scrap_source?: string | null }
): ErpControlAction[] {
  if (!canRunErpControl(context.role, "metal_source_disposition")) return [];
  const fixed = { source_table: sourceTable, source_id: source.id };
  const actions: ErpControlAction[] = [];
  const status = source.status ?? "";
  if (["available", "reserved"].includes(status)) {
    actions.push({
      key: "metal_source_disposition", title: "Put lot on hold",
      description: "Blocks furnace charging until QC or a factory manager releases the lot.",
      submitLabel: "Put on hold", fixed: { ...fixed, disposition: "hold" }, fields: [reasonField("Reason for the hold")]
    });
  }
  if (status === "rejected" && metalReleaseRoles.includes(context.role)) {
    actions.push({
      key: "metal_source_disposition", title: "Release lot",
      description: "Makes the lot chargeable again. The person who placed the hold cannot release it (owner excepted).",
      submitLabel: "Release lot", fixed: { ...fixed, disposition: "release" }, fields: [reasonField("Release justification / test reference")]
    });
  }
  if (["available", "reserved", "rejected"].includes(status) && source.scrap_source !== "in_house" && Number(source.available_weight_kg ?? 0) > 0) {
    actions.push({
      key: "metal_source_disposition", title: "Return to vendor",
      description: `Returns the unused ${kg(source.available_weight_kg)} kg: it leaves inventory and the credit due from the vendor is recorded for accounts. This is final.`,
      submitLabel: "Return to vendor", fixed: { ...fixed, disposition: "return" }, fields: [reasonField("Return reason / gate pass reference")]
    });
  }
  return actions;
}

export function inventoryControls(context: SessionContext, itemId: string): ErpControlAction[] {
  if (!canRunErpControl(context.role, "inventory_adjust")) return [];
  return [{
    key: "inventory_adjust", title: "Stock adjustment",
    description: "Stock moves only through receipts, issues and recorded adjustments. Negative stock is rejected.",
    submitLabel: "Post adjustment", fixed: { item_id: itemId },
    fields: [
      { name: "direction", label: "Direction", type: "select", required: true, options: [{ value: "in", label: "Add stock" }, { value: "out", label: "Remove stock" }] },
      { name: "quantity", label: "Quantity", type: "number", step: "0.001", required: true },
      reasonField("Reason / physical count reference")
    ]
  }];
}

export function profileSpecControls(context: SessionContext, profileId: string): ErpControlAction[] {
  if (!canRunErpControl(context.role, "profile_spec_change")) return [];
  return [{
    key: "profile_spec_change", title: "Approve specification change with open work",
    description: "Section weight, alloy, temper, billet size, weight tolerance and hardness cannot be edited while the profile has open jobs, requirements, reservations or order lines. Fill only the fields that change; the open work affected is recorded.",
    submitLabel: "Approve and apply", fixed: { profile_id: profileId },
    fields: [
      { name: "section_weight_kg_per_m", label: "Section weight kg/m", type: "number", step: "0.001" },
      { name: "alloy", label: "Alloy" }, { name: "temper", label: "Temper" },
      { name: "billet_diameter_required_inch", label: "Billet diameter inch", type: "number", step: "0.01" },
      { name: "weight_tolerance_percent", label: "Weight tolerance %", type: "number", step: "0.01" },
      { name: "hardness_requirement", label: "Hardness requirement", placeholder: ">= 12 HW" },
      reasonField()
    ]
  }];
}

export async function stockQcControls(db: Db, context: SessionContext): Promise<ErpControlAction[]> {
  const actions: ErpControlAction[] = [];
  if (canRunErpControl(context.role, "stock_opening")) {
    const { data: profiles } = await db.from("aluminium_profiles").select("id, profile_code, profile_name, alloy, temper").eq("company_id", context.companyId).eq("is_active", true).order("profile_code").limit(300);
    actions.push({
      key: "stock_opening", title: "Record opening finished stock",
      description: "For stock that existed before ExtrusionOS. It starts on QC hold; quality must release it before it can be reserved. Weight must reconcile with pieces x length x kg/m within 10%.",
      submitLabel: "Record opening stock", fixed: {},
      fields: [
        { name: "profile_id", label: "Profile", type: "select", required: true, options: (profiles ?? []).map((row: any) => ({ value: row.id, label: `${row.profile_code} · ${row.profile_name}` })) },
        { name: "finish", label: "Finish", required: true, defaultValue: "mill_finish" },
        { name: "weight_kg", label: "Weight kg", type: "number", step: "0.001", required: true },
        { name: "pieces", label: "Pieces", type: "number", step: "1", required: true },
        { name: "piece_length_m", label: "Length per piece m", type: "number", step: "0.001", required: true, defaultValue: "5.8" },
        { name: "alloy", label: "Alloy" }, { name: "temper", label: "Temper" },
        { name: "bundle_number", label: "Bundle number" }, { name: "location", label: "Location" },
        reasonField("Stock-take reference")
      ]
    });
  }
  if (!canRunErpControl(context.role, "stock_qc_release")) return actions;
  const { data } = await db.from("profile_stock_batches").select("id, bundle_number, total_weight_kg, origin_type, aluminium_profiles(profile_code)")
    .eq("company_id", context.companyId).eq("qc_status", "on_hold").order("created_at", { ascending: false }).limit(50);
  if (!(data ?? []).length) return actions;
  return [...actions, {
    key: "stock_qc_release", title: "Release stock on QC hold",
    description: "Opening balances and customer returns start on QC hold and cannot be reserved until released.",
    submitLabel: "Record QC decision", fixed: {},
    fields: [
      { name: "batch_id", label: "Stock batch", type: "select", required: true, options: (data ?? []).map((row: any) => ({ value: row.id, label: `${row.aluminium_profiles?.profile_code ?? "Profile"} · ${row.bundle_number ?? "no bundle"} · ${kg(row.total_weight_kg)} kg · ${String(row.origin_type).replace(/_/g, " ")}` })) },
      { name: "decision", label: "Decision", type: "select", required: true, options: [{ value: "released", label: "Release" }, { value: "rejected", label: "Reject" }] },
      { name: "note", label: "Note", type: "textarea" }
    ]
  }];
}

export async function maintenanceControls(db: Db, context: SessionContext): Promise<ErpControlAction[]> {
  const actions: ErpControlAction[] = [];
  if (canRunErpControl(context.role, "machine_return_to_service")) {
    const [{ data: locked }, { data: openBreakdowns }] = await Promise.all([
      db.from("machines").select("id, machine_name, machine_code, status").eq("company_id", context.companyId).in("status", ["breakdown", "maintenance"]).limit(50),
      db.from("breakdown_logs").select("machine_ref_id").eq("company_id", context.companyId).neq("status", "resolved").not("machine_ref_id", "is", null)
    ]);
    const blocked = new Set((openBreakdowns ?? []).map((row: any) => row.machine_ref_id));
    const ready = (locked ?? []).filter((row: any) => !blocked.has(row.id));
    if ((locked ?? []).length) {
      actions.push({
        key: "machine_return_to_service", title: "Return a machine to service",
        description: `${(locked ?? []).length} machine(s) are locked out; ${blocked.size} still have unresolved breakdowns. Only machines with every breakdown resolved can be signed off.`,
        submitLabel: "Return to service", fixed: {},
        disabledReason: ready.length ? null : "Resolve the open breakdowns first.",
        fields: [
          { name: "machine_id", label: "Machine", type: "select", required: true, options: ready.map((row: any) => ({ value: row.id, label: `${row.machine_name ?? row.machine_code} (${row.status})` })) },
          { name: "note", label: "Sign-off note (min 10 characters)", type: "textarea", required: true }
        ]
      });
    }
  }
  if (!canRunErpControl(context.role, "maintenance_complete")) return actions;
  const { data } = await db.from("maintenance_schedules").select("id, machine_id, maintenance_type, next_due_date, status")
    .eq("company_id", context.companyId).in("status", ["scheduled", "overdue", "in_progress"]).order("next_due_date", { ascending: true, nullsFirst: false }).limit(50);
  if (!(data ?? []).length) return actions;
  return [...actions, {
    key: "maintenance_complete", title: "Complete maintenance",
    description: "Rolls the schedule forward to its next due date and logs the completion.",
    submitLabel: "Mark done", fixed: {},
    fields: [
      { name: "schedule_id", label: "Schedule", type: "select", required: true, options: (data ?? []).map((row: any) => ({ value: row.id, label: `${row.machine_id} · ${String(row.maintenance_type).replace(/_/g, " ")} · due ${row.next_due_date ?? "-"}${row.status === "overdue" ? " (overdue)" : ""}` })) },
      { name: "done_date", label: "Done on", type: "date", required: true },
      { name: "note", label: "Work done", type: "textarea" }
    ]
  }];
}

export function booksLockControls(context: SessionContext, lockedThrough: string | null): ErpControlAction[] {
  if (!canRunErpControl(context.role, "books_lock")) return [];
  return [{
    key: "books_lock", title: "Close the books",
    description: `Currently closed through ${lockedThrough ?? "— (no lock)"}. Invoices, receipts, credit notes and expenses dated on or before the lock date cannot be added, deleted or re-dated. Only the owner can reopen.`,
    submitLabel: "Set lock date", fixed: {},
    fields: [{ name: "locked_through", label: "Books closed through", type: "date", required: true }, reasonField("Reason (e.g. GSTR-1 filed)")]
  }];
}

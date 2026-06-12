/**
 * PCDA Report Readiness Checker
 * 
 * Validates that required fields are present before allowing report generation.
 * Returns missing fields list so the UI can show what data is needed.
 */

export type ReadinessResult = {
  ready: boolean;
  missingFields: string[];
};

export type PcdaLineKind = "quote" | "order";

export type ReportReadinessTemplateKey =
  | "quote_line"
  | "order_line"
  | "profile_technical"
  | "die_technical"
  | "die_trial"
  | "production_batch"
  | "quality_inspection"
  | "packing"
  | "dispatch"
  | "export"
  | "compliance"
  | "profitability"
  | string;

/**
 * Check die technical sheet readiness.
 * Requires: die_number, die_status, profile linkage.
 */
export function checkDieTechnicalReadiness(die: Record<string, any>): ReadinessResult {
  const missing: string[] = [];
  if (!die.die_number) missing.push("Die number");
  if (!die.die_status) missing.push("Die status");
  if (!die.profile_id) missing.push("Linked profile");
  return { ready: missing.length === 0, missingFields: missing };
}

/**
 * Check profile technical sheet readiness.
 * Requires: profile_code, profile_name, section_weight_kg_per_m.
 */
export function checkProfileTechnicalReadiness(profile: Record<string, any>): ReadinessResult {
  const missing: string[] = [];
  if (!profile.profile_code) missing.push("Profile code");
  if (!profile.profile_name) missing.push("Profile name");
  if (!profile.section_weight_kg_per_m) missing.push("Section weight kg/m");
  return { ready: missing.length === 0, missingFields: missing };
}

/**
 * Check quote line report readiness.
 * Requires: section_code or profile_id, quantity, rate.
 */
export function checkQuoteLineReadiness(line: Record<string, any>): ReadinessResult {
  const missing: string[] = [];
  const hasSection = typeof line.section_code === "string" && line.section_code.trim().length > 0;
  const hasPositiveValue = (...values: unknown[]) => values.some((value) => Number(value) > 0);
  if (!hasSection && !line.profile_id) missing.push("Section code or linked profile");
  if (!hasPositiveValue(line.order_quantity, line.quantity_pieces)) missing.push("Quantity");
  if (!hasPositiveValue(line.net_rate, line.price_per_kg)) missing.push("Rate/Price");
  return { ready: missing.length === 0, missingFields: missing };
}

export function checkPcdaLineReadiness(
  line: Record<string, any>,
  kind: PcdaLineKind
): ReadinessResult {
  const result = checkQuoteLineReadiness(line);
  const parentField = kind === "quote" ? "quote_id" : "order_id";
  if (!line[parentField]) {
    result.missingFields.unshift(kind === "quote" ? "Linked quote" : "Linked order");
  }
  return {
    ready: result.missingFields.length === 0,
    missingFields: result.missingFields,
  };
}

/**
 * Check production batch report readiness.
 * Requires: job_number, profile_id, planned_quantity_kg.
 */
export function checkProductionBatchReadiness(job: Record<string, any>): ReadinessResult {
  const missing: string[] = [];
  if (!job.job_number) missing.push("Job number");
  if (!job.profile_id) missing.push("Linked profile");
  if (!job.planned_quantity_kg && !job.actual_quantity_kg) missing.push("Planned or actual quantity");
  return { ready: missing.length === 0, missingFields: missing };
}

/**
 * Generic readiness check — verifies that specified fields are non-null/non-empty.
 */
export function checkFieldsPresent(record: Record<string, any>, requiredFields: { field: string; label: string }[]): ReadinessResult {
  const missing: string[] = [];
  for (const { field, label } of requiredFields) {
    const val = record[field];
    if (val === null || val === undefined || val === "" || val === 0) {
      missing.push(label);
    }
  }
  return { ready: missing.length === 0, missingFields: missing };
}

export async function checkReportReadiness(
  templateKey: ReportReadinessTemplateKey,
  recordId: string,
  companyId: string,
  supabaseClient?: any
): Promise<ReadinessResult> {
  const supabase = supabaseClient ?? await import("@/lib/supabase/server").then((mod) => mod.createClient());

  if (templateKey === "quote_line") {
    const { data, error } = await supabase.from("quote_items").select("*").eq("id", recordId).eq("company_id", companyId).single();
    if (error || !data) return { ready: false, missingFields: ["Quote line"] };
    const lineReadiness = checkPcdaLineReadiness(data, "quote");
    if (!lineReadiness.ready) return lineReadiness;
    const parent = await supabase.from("quotes").select("id").eq("id", data.quote_id).eq("company_id", companyId).single();
    return parent.error || !parent.data
      ? { ready: false, missingFields: ["Linked quote"] }
      : lineReadiness;
  }

  if (templateKey === "order_line") {
    const { data, error } = await supabase.from("order_items").select("*").eq("id", recordId).eq("company_id", companyId).single();
    if (error || !data) return { ready: false, missingFields: ["Order line"] };
    const lineReadiness = checkPcdaLineReadiness(data, "order");
    if (!lineReadiness.ready) return lineReadiness;
    const parent = await supabase.from("orders").select("id").eq("id", data.order_id).eq("company_id", companyId).single();
    return parent.error || !parent.data
      ? { ready: false, missingFields: ["Linked order"] }
      : lineReadiness;
  }

  if (templateKey === "profile_technical") {
    const { data, error } = await supabase.from("aluminium_profiles").select("*").eq("id", recordId).eq("company_id", companyId).single();
    if (error || !data) return { ready: false, missingFields: ["Profile"] };
    return checkProfileTechnicalReadiness(data);
  }

  if (templateKey === "die_technical") {
    const { data, error } = await supabase.from("dies").select("*").eq("id", recordId).eq("company_id", companyId).single();
    if (error || !data) return { ready: false, missingFields: ["Die"] };
    return checkDieTechnicalReadiness(data);
  }

  if (templateKey === "production_batch") {
    const { data, error } = await supabase.from("production_jobs").select("*").eq("id", recordId).eq("company_id", companyId).single();
    if (error || !data) return { ready: false, missingFields: ["Production job"] };
    return checkProductionBatchReadiness(data);
  }

  if (templateKey === "dispatch") {
    const { data, error } = await supabase.from("dispatches").select("*").eq("id", recordId).eq("company_id", companyId).single();
    if (error || !data) return { ready: false, missingFields: ["Dispatch"] };
    return checkFieldsPresent(data, [
      { field: "dispatch_number", label: "Dispatch number" },
      { field: "dispatch_date", label: "Dispatch date" },
      { field: "delivery_status", label: "Delivery status" },
    ]);
  }

  if (templateKey === "die_trial") {
    const { data, error } = await supabase.from("die_trials").select("*").eq("id", recordId).eq("company_id", companyId).single();
    if (error || !data) return { ready: false, missingFields: ["Die trial"] };
    return checkFieldsPresent(data, [
      { field: "die_id", label: "Linked die" },
      { field: "trial_date", label: "Trial date" },
      { field: "trial_result", label: "Trial result" },
    ]);
  }

  if (templateKey === "quality_inspection") {
    const { data, error } = await supabase.from("quality_inspections").select("*").eq("id", recordId).eq("company_id", companyId).single();
    if (error || !data) return { ready: false, missingFields: ["Quality inspection"] };
    return checkFieldsPresent(data, [
      { field: "profile_id", label: "Linked profile" },
      { field: "inspection_date", label: "Inspection date" },
      { field: "status", label: "Inspection status" },
    ]);
  }

  if (templateKey === "packing") {
    const { data, error } = await supabase.from("packing_list_items").select("*").eq("id", recordId).eq("company_id", companyId).single();
    if (error || !data) return { ready: false, missingFields: ["Packing list item"] };
    return checkFieldsPresent(data, [
      { field: "dispatch_id", label: "Linked dispatch" },
      { field: "bundle_number", label: "Bundle number" },
      { field: "profile_id", label: "Linked profile" },
    ]);
  }

  if (templateKey === "export") {
    const { data, error } = await supabase.from("export_orders").select("*").eq("id", recordId).eq("company_id", companyId).single();
    if (error || !data) return { ready: false, missingFields: ["Export order"] };
    return checkFieldsPresent(data, [
      { field: "export_customer_name", label: "Export customer" },
      { field: "destination_country", label: "Destination country" },
      { field: "incoterm", label: "Incoterm" },
      { field: "status", label: "Export status" },
    ]);
  }

  if (templateKey === "compliance") {
    const standardResult = await supabase.from("compliance_standards").select("*").eq("id", recordId).eq("company_id", companyId).maybeSingle();
    if (standardResult.data) {
      return checkFieldsPresent(standardResult.data, [
        { field: "standard_code", label: "Standard code" },
        { field: "standard_name", label: "Standard name" },
        { field: "product_category", label: "Product category" },
      ]);
    }

    const auditResult = await supabase.from("compliance_audit_records").select("*").eq("id", recordId).eq("company_id", companyId).maybeSingle();
    if (auditResult.data) {
      return checkFieldsPresent(auditResult.data, [
        { field: "audit_name", label: "Audit name" },
        { field: "audit_date", label: "Audit date" },
        { field: "status", label: "Audit status" },
      ]);
    }

    const calibrationResult = await supabase.from("calibration_records").select("*").eq("id", recordId).eq("company_id", companyId).maybeSingle();
    if (calibrationResult.data) {
      return checkFieldsPresent(calibrationResult.data, [
        { field: "equipment_name", label: "Equipment name" },
        { field: "calibration_date", label: "Calibration date" },
        { field: "next_due_date", label: "Next due date" },
        { field: "status", label: "Calibration status" },
      ]);
    }

    return { ready: false, missingFields: ["Compliance record"] };
  }

  if (templateKey === "profitability") {
    const { data, error } = await supabase.from("order_cost_breakdown").select("*").eq("id", recordId).eq("company_id", companyId).single();
    if (error || !data) return { ready: false, missingFields: ["Profitability record"] };
    return checkFieldsPresent(data, [
      { field: "customer_name", label: "Customer" },
      { field: "month_key", label: "Month" },
      { field: "revenue", label: "Revenue" },
    ]);
  }

  return { ready: true, missingFields: [] };
}

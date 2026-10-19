"use server";

import { loadReservationConsumptionTotals } from "@/lib/inventory/reservation-consumption";
import { isUsableProductionDieForProfile, usableProductionDieStatuses } from "@/lib/workflow/production-dies";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { calculateSystemConfiguration, type ComponentRole, type HardwareCategory, type PanelLayout, type SystemTemplate, type SystemType } from "./formula-engine";
import { optimizeProfileCuts } from "./profile-optimization";
import { buildProductionJobRemarks, getProductionHandoffReadiness, groupProfileCutsForProduction } from "./production-handoff";
import { getBatchAvailablePieces, getBatchReservationAllocation, groupProfileReservationRequirements } from "./inventory-reservation";
import { hasCriticalWarnings } from "./warning-categories";
import { getSystemsConfiguratorContext } from "./access";
import { loadCompleteSystemProfileSeries } from "./profile-library";
import {
  finishOptionSchema,
  glassItemSchema,
  hardwareItemSchema,
  assertSafeFormulaJson,
  parseJsonObject,
  systemConfigurationDraftSchema,
  systemProfileSchema,
  systemSeriesSchema,
  systemTemplateSchema,
  templateJsonSchema
} from "@/lib/validations/systems-configurator";

function formEntries(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

async function assertCanManageLibraries() {
  const context = await getSystemsConfiguratorContext("create");
  if (!["owner", "admin", "sales_manager"].includes(context.role)) redirect("/systems-configurator");
  return context;
}

export async function loadSystemProfilesForSeriesAction(seriesId: string) {
  try {
    const context = await getSystemsConfiguratorContext("read");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(seriesId)) {
      return { success: false as const, error: "Select a valid system series." };
    }

    const supabase = await createClient();
    const { data: series, error: seriesError } = await supabase
      .from("system_series")
      .select("id")
      .eq("company_id", context.companyId)
      .eq("id", seriesId)
      .maybeSingle();
    if (seriesError) return { success: false as const, error: "Could not validate the selected system series." };
    if (!series) return { success: false as const, error: "The selected system series is not available in your company." };

    const data = await loadCompleteSystemProfileSeries(supabase, context.companyId, seriesId);
    return { success: true as const, data };
  } catch {
    return { success: false as const, error: "Could not load the selected series profile library." };
  }
}

export async function createSystemSeries(formData: FormData) {
  const context = await assertCanManageLibraries();
  const parsed = systemSeriesSchema.parse(formEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.from("system_series").insert({ ...parsed, company_id: context.companyId, created_by: context.userId });
  if (error) throw error;
  revalidatePath("/systems-configurator/libraries");
  revalidatePath("/systems-configurator/templates");
}

export async function createSystemProfile(formData: FormData) {
  const context = await assertCanManageLibraries();
  const parsed = systemProfileSchema.parse(formEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.from("system_profiles").insert({ ...parsed, company_id: context.companyId });
  if (error) throw error;
  revalidatePath("/systems-configurator/libraries");
}

export async function createHardwareItem(formData: FormData) {
  const context = await assertCanManageLibraries();
  const parsed = hardwareItemSchema.parse(formEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.from("hardware_items").insert({ ...parsed, company_id: context.companyId });
  if (error) throw error;
  revalidatePath("/systems-configurator/libraries");
}

export async function createGlassItem(formData: FormData) {
  const context = await assertCanManageLibraries();
  const parsed = glassItemSchema.parse(formEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.from("glass_items").insert({ ...parsed, company_id: context.companyId });
  if (error) throw error;
  revalidatePath("/systems-configurator/libraries");
}

export async function createFinishOption(formData: FormData) {
  const context = await assertCanManageLibraries();
  const parsed = finishOptionSchema.parse(formEntries(formData));
  const supabase = await createClient();
  const { error } = await supabase.from("finish_options").insert({ ...parsed, company_id: context.companyId, vendor_id: parsed.vendor_id || null });
  if (error) throw error;
  revalidatePath("/systems-configurator/libraries");
}

export async function createSystemTemplate(formData: FormData) {
  const context = await assertCanManageLibraries();
  const parsed = systemTemplateSchema.parse(formEntries(formData));
  const supabase = await createClient();
  const formulaJson = {
    requiredComponents: [],
    profileRules: [],
    glassRules: {},
    beadingRules: {},
    hardwareRules: {},
    wastageRules: {},
    costingRules: {}
  };
  const { error } = await supabase.from("system_templates").insert({
    ...parsed,
    company_id: context.companyId,
    created_by: context.userId,
    series_id: parsed.series_id || null,
    formula_json: formulaJson,
    validation_rules_json: {},
    preview_config_json: {}
  });
  if (error) throw error;
  revalidatePath("/systems-configurator/templates");
}

export async function updateSystemTemplateJson(templateId: string, formData: FormData) {
  const context = await getSystemsConfiguratorContext("update");
  if (!["owner", "admin"].includes(context.role)) redirect(`/systems-configurator/templates/${templateId}`);
  const parsed = templateJsonSchema.parse(formEntries(formData));
  const formulaJson = parseJsonObject(parsed.formula_json, "Formula JSON");
  const validationRulesJson = parseJsonObject(parsed.validation_rules_json, "Validation JSON");
  const previewConfigJson = parseJsonObject(parsed.preview_config_json, "Preview JSON");
  assertSafeFormulaJson(formulaJson);
  const supabase = await createClient();
  const { error } = await supabase
    .from("system_templates")
    .update({ formula_json: formulaJson, validation_rules_json: validationRulesJson, preview_config_json: previewConfigJson })
    .eq("id", templateId)
    .eq("company_id", context.companyId);
  if (error) throw error;
  revalidatePath(`/systems-configurator/templates/${templateId}`);
  revalidatePath(`/systems-configurator/templates/${templateId}/formula`);
}

export async function saveSystemConfigurationDraft(formData: FormData) {
  const context = await getSystemsConfiguratorContext("create");
  const parsed = systemConfigurationDraftSchema.parse(formEntries(formData));
  const panelLayoutJson = parseJsonObject(parsed.panel_layout_json, "Panel layout JSON");
  const optionsJson = parseJsonObject(parsed.options_json, "Options JSON");
  const supabase = await createClient();
  const noOfPanels = parsed.panel_count;

  const { data, error } = await supabase
    .from("system_configurations")
    .insert({
      company_id: context.companyId,
      created_by: context.userId,
      project_name: parsed.project_name,
      customer_id: parsed.customer_id || null,
      system_type: parsed.system_type,
      series_id: parsed.series_id,
      template_id: parsed.template_id || null,
      design_reference: parsed.design_reference,
      location_label: parsed.location_label || null,
      width_mm: parsed.width_mm,
      height_mm: parsed.height_mm,
      quantity: parsed.quantity,
      no_of_panels: noOfPanels,
      measurement_type: parsed.measurement_type,
      view_direction: parsed.view_direction,
      panel_layout_json: panelLayoutJson,
      options_json: optionsJson,
      finish_id: parsed.finish_id || null,
      glass_id: parsed.glass_id || null,
      status: "draft",
      notes: parsed.notes || null
    })
    .select("id")
    .single();

  if (error || !data) throw error ?? new Error("Could not save configuration");
  revalidatePath("/systems-configurator/projects");
  redirect(`/systems-configurator/projects/${data.id}`);
}

export async function updateSystemConfigurationDraft(configurationId: string, formData: FormData) {
  await getSystemsConfiguratorContext("update");
  const parsed = systemConfigurationDraftSchema.parse(formEntries(formData));
  const panelLayoutJson = parseJsonObject(parsed.panel_layout_json, "Panel layout JSON");
  const optionsJson = parseJsonObject(parsed.options_json, "Options JSON");
  const supabase = await createClient();

  const { error } = await supabase.rpc("save_system_configuration_atomic", {
    p_configuration_id: configurationId,
    p_mode: "draft",
    p_expected_updated_at: null,
    p_rows: {},
    p_header: {
      project_name: parsed.project_name,
      customer_id: parsed.customer_id || null,
      system_type: parsed.system_type,
      series_id: parsed.series_id,
      template_id: parsed.template_id || null,
      design_reference: parsed.design_reference,
      location_label: parsed.location_label || null,
      width_mm: parsed.width_mm,
      height_mm: parsed.height_mm,
      quantity: parsed.quantity,
      no_of_panels: parsed.panel_count,
      measurement_type: parsed.measurement_type,
      view_direction: parsed.view_direction,
      panel_layout_json: panelLayoutJson,
      options_json: optionsJson,
      finish_id: parsed.finish_id || null,
      glass_id: parsed.glass_id || null,
      status: "draft",
      subtotal: 0,
      gst_amount: 0,
      grand_total: 0,
      internal_cost: 0,
      selling_price: 0,
      quote_id: null,
      notes: parsed.notes || null
    }
  });

  if (error) throw error;

  revalidatePath(`/systems-configurator/projects/${configurationId}`);
  revalidatePath(`/systems-configurator/projects/${configurationId}/edit`);
  revalidatePath("/systems-configurator/projects");
  redirect(`/systems-configurator/projects/${configurationId}`);
}

function toNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function templateFromRows(templateRow: any, systemType: SystemType, systemProfiles: any[]): SystemTemplate {
  const formula = templateRow?.formula_json && typeof templateRow.formula_json === "object" ? templateRow.formula_json : {};
  const profileRules = Array.isArray(formula.profileRules) ? formula.profileRules : [];
  return {
    id: templateRow?.id,
    templateCode: templateRow?.template_code ?? "system-default",
    templateName: templateRow?.template_name ?? "System default",
    systemType,
    formulaVersion: Number(templateRow?.formula_version ?? 1),
    requiredComponents: Array.isArray(formula.requiredComponents) ? formula.requiredComponents : systemProfiles.filter((item) => item.is_required).map((item) => item.component_role),
    profileRules: profileRules.map((rule: any) => ({
      componentRole: rule.componentRole ?? rule.component_role,
      profileCode: rule.profileCode ?? rule.profile_code,
      quantityFormula: rule.quantityFormula ?? rule.quantity_formula ?? "1 * Q",
      lengthFormula: rule.lengthFormula ?? rule.length_formula ?? "W",
      deductionMm: toNumber(rule.deductionMm ?? rule.deduction_mm, 0),
      additionMm: toNumber(rule.additionMm ?? rule.addition_mm, 0),
      remarks: rule.remarks
    })).filter((rule: any) => rule.componentRole && rule.quantityFormula && rule.lengthFormula),
    glassRules: formula.glassRules ?? {},
    beadingRules: formula.beadingRules ?? {},
    hardwareRules: formula.hardwareRules ?? {},
    wastageRules: formula.wastageRules ?? {},
    validationRules: templateRow?.validation_rules_json ?? {}
  };
}

export async function calculateSystemConfigurationProject(configurationId: string) {
  const context = await getSystemsConfiguratorContext("read");
  if (!['owner', 'admin'].includes(context.role)) throw new Error("Only owners and admins can calculate internal system costing.");
  const supabase = await createClient();
  const { data: configuration, error: configurationError } = await supabase
    .from("system_configurations_authorized")
    .select("*")
    .eq("id", configurationId)
    .eq("company_id", context.companyId)
    .single();
  if (configurationError || !configuration) throw configurationError ?? new Error("Configuration not found");

  const [series, systemProfiles, hardwareItems, glassItem, finishOption, template, settings] = await Promise.all([
    supabase.from("system_series").select("*").eq("id", configuration.series_id).eq("company_id", context.companyId).single(),
    loadCompleteSystemProfileSeries(supabase, context.companyId, configuration.series_id),
    supabase.from("hardware_items_authorized").select("*").eq("company_id", context.companyId).eq("is_active", true),
    configuration.glass_id ? supabase.from("glass_items_authorized").select("*").eq("id", configuration.glass_id).eq("company_id", context.companyId).single() : Promise.resolve({ data: null, error: null }),
    configuration.finish_id ? supabase.from("finish_options_authorized").select("*").eq("id", configuration.finish_id).eq("company_id", context.companyId).single() : Promise.resolve({ data: null, error: null }),
    configuration.template_id ? supabase.from("system_templates_authorized").select("*").eq("id", configuration.template_id).eq("company_id", context.companyId).single() : Promise.resolve({ data: null, error: null }),
    supabase.from("company_settings_authorized").select("default_gst_percent, default_margin_percent, default_conversion_charge_per_kg, default_transport_charge").eq("company_id", context.companyId).maybeSingle()
  ]);

  if (series.error || !series.data) throw series.error ?? new Error("Series not found");
  if (hardwareItems.error) throw hardwareItems.error;
  if (glassItem.error) throw glassItem.error;
  if (finishOption.error) throw finishOption.error;
  if (template.error) throw template.error;
  if (settings.error) throw settings.error;

  const activeSystemProfiles = systemProfiles.filter((item: any) => item.is_active !== false);

  const panelLayout = (configuration.panel_layout_json && typeof configuration.panel_layout_json === "object" ? configuration.panel_layout_json : { panels: [] }) as PanelLayout;
  const options = (configuration.options_json && typeof configuration.options_json === "object" ? configuration.options_json : {}) as Record<string, number | string | boolean | null>;
  const stockLengthMm = toNumber(series.data.stock_length_mm, 6000);
  const result = calculateSystemConfiguration({
    widthMm: toNumber(configuration.width_mm),
    heightMm: toNumber(configuration.height_mm),
    quantity: toNumber(configuration.quantity, 1),
    systemType: configuration.system_type as SystemType,
    seriesId: configuration.series_id,
    template: templateFromRows(template.data, configuration.system_type as SystemType, activeSystemProfiles),
    panelLayout,
    selectedProfiles: activeSystemProfiles.map((item: any) => ({
      id: item.id,
      profileId: item.profile_id,
      profileCode: item.aluminium_profiles?.profile_code ?? item.display_name,
      profileName: item.aluminium_profiles?.profile_name ?? item.display_name,
      componentRole: item.component_role as ComponentRole,
      sectionWeightKgPerM: toNumber(item.aluminium_profiles?.section_weight_kg_per_m, 0),
      stockLengthMm,
      deductionMm: toNumber(item.deduction_mm, 0),
      additionMm: toNumber(item.addition_mm, 0),
      quantityFormula: item.default_quantity_formula,
      lengthFormula: item.default_length_formula,
      isRequired: item.is_required
    })),
    selectedHardware: (hardwareItems.data ?? []).map((item: any) => ({ id: item.id, itemCode: item.item_code, itemName: item.item_name, category: item.hardware_category as HardwareCategory, unit: item.unit, rate: toNumber(item.default_rate, 0) })),
    selectedGlass: glassItem.data ? { id: glassItem.data.id, glassCode: glassItem.data.glass_code, glassName: glassItem.data.glass_name, glassType: glassItem.data.glass_type, thicknessMm: toNumber(glassItem.data.thickness_mm, 0), ratePerSqft: toNumber(glassItem.data.rate_per_sqft, 0), ratePerSqm: toNumber(glassItem.data.rate_per_sqm, 0) } : undefined,
    selectedFinish: finishOption.data ? { id: finishOption.data.id, finishCode: finishOption.data.finish_code, finishName: finishOption.data.finish_name, finishType: finishOption.data.finish_type, rateType: finishOption.data.rate_type, rate: toNumber(finishOption.data.rate, 0) } : undefined,
    companySettings: { stockLengthMm, sawKerfMm: toNumber(options.saw_kerf_mm, 3), minimumReusableLeftoverMm: toNumber(options.minimum_reusable_leftover_mm, 300), defaultWastagePercent: toNumber(series.data.wastage_percent_default, 5) },
    costing: {
      aluminiumRatePerKg: toNumber(options.aluminium_rate_per_kg, 280),
      fabricationLaborRate: toNumber(options.fabrication_labor_rate, settings.data?.default_conversion_charge_per_kg ?? 85),
      installationRate: toNumber(options.installation_rate, 45),
      transportAmount: toNumber(options.transport_amount, settings.data?.default_transport_charge ?? 0),
      wastagePercent: toNumber(options.wastage_percent, series.data.wastage_percent_default ?? 5),
      marginPercent: toNumber(options.margin_percent, configuration.margin_percent || settings.data?.default_margin_percent || 15),
      gstPercent: toNumber(options.gst_percent, configuration.gst_percent || settings.data?.default_gst_percent || 18),
      discountAmount: toNumber(options.discount_amount, 0)
    },
    options
  });

  const rows = {
    system_profile_cuts: result.profileCuts.map((cut, index) => ({ profile_id: cut.profileId ?? null, component_role: cut.componentRole, profile_code: cut.profileCode, profile_name: cut.profileName, cut_length_mm: cut.cutLengthMm, quantity: cut.quantity, total_length_m: cut.totalLengthM, section_weight_kg_per_m: cut.sectionWeightKgPerM, total_weight_kg: cut.totalWeightKg, angle_left: cut.angleLeft, angle_right: cut.angleRight, deduction_mm: cut.deductionMm, addition_mm: cut.additionMm, stock_length_mm: cut.stockLengthMm, wastage_percent: cut.wastagePercent, remarks: cut.remarks ?? null, sort_order: index })),
    system_glass_cuts: result.glassCuts.map((cut) => ({ glass_id: cut.glassId ?? null, panel_index: cut.panelIndex, glass_label: cut.glassLabel, width_mm: cut.widthMm, height_mm: cut.heightMm, quantity: cut.quantity, area_sqft: cut.areaSqft, area_sqm: cut.areaSqm, glass_type: cut.glassType ?? null, thickness_mm: cut.thicknessMm ?? 0, rate: cut.rate, amount: cut.amount, deduction_width_mm: cut.deductionWidthMm, deduction_height_mm: cut.deductionHeightMm, remarks: cut.remarks ?? null })),
    system_beading_cuts: result.beadingCuts.map((cut) => ({ profile_id: cut.profileId ?? null, panel_index: cut.panelIndex, bead_position: cut.beadPosition, cut_length_mm: cut.cutLengthMm, quantity: cut.quantity, total_length_m: cut.totalLengthM, remarks: cut.remarks ?? `${cut.profileCode ?? "Bead"} ${cut.profileName ?? ""}`.trim() })),
    system_hardware_bom: result.hardwareBom.map((item) => ({ hardware_item_id: item.hardwareItemId ?? null, item_code: item.itemCode, item_name: item.itemName, hardware_category: item.hardwareCategory, quantity: item.quantity, unit: item.unit, rate: item.rate, amount: item.amount, remarks: item.remarks ?? null })),
    system_material_summary: result.materialSummary.map((item) => ({ material_type: item.materialType, item_id: item.itemId ?? null, item_code: item.itemCode ?? null, item_name: item.itemName, quantity: item.quantity, unit: item.unit, total_weight_kg: item.totalWeightKg, total_length_m: item.totalLengthM, total_area_sqft: item.totalAreaSqft, total_area_sqm: item.totalAreaSqm, rate: item.rate, amount: item.amount }))
  };
  const costing = result.costingSummary;
  const hasCriticalCalculationWarnings = hasCriticalWarnings(result.warnings);
  const { error: updateError } = await supabase.rpc("save_system_configuration_atomic", {
    p_configuration_id: configurationId,
    p_mode: "calculation",
    p_expected_updated_at: configuration.updated_at,
    p_rows: rows,
    p_header: { status: hasCriticalCalculationWarnings ? "draft" : "calculated", subtotal: costing?.subtotalBeforeGst ?? 0, gst_amount: costing?.gstAmount ?? 0, grand_total: costing?.grandTotal ?? 0, internal_cost: costing?.internalCost ?? 0, selling_price: costing?.grandTotal ?? 0, margin_percent: toNumber(options.margin_percent, configuration.margin_percent || settings.data?.default_margin_percent || 15), gst_percent: toNumber(options.gst_percent, configuration.gst_percent || settings.data?.default_gst_percent || 18) }
  });
  if (updateError) throw updateError;

  revalidatePath(`/systems-configurator/projects/${configurationId}`);
  revalidatePath(`/systems-configurator/projects/${configurationId}/cutting-list`);
  revalidatePath(`/systems-configurator/projects/${configurationId}/glass-list`);
  revalidatePath(`/systems-configurator/projects/${configurationId}/bom`);
  revalidatePath(`/systems-configurator/projects/${configurationId}/quote`);
  revalidatePath("/systems-configurator/projects");
}

export async function runProfileOptimization(configurationId: string) {
  const context = await getSystemsConfiguratorContext("update");
  const supabase = await createClient();
  const [configurationResult, cutsResult, previousRunsResult] = await Promise.all([
    supabase.from("system_configurations_authorized").select("id, options_json, system_series(stock_length_mm)").eq("id", configurationId).eq("company_id", context.companyId).single(),
    supabase.from("system_profile_cuts").select("id, profile_code, profile_name, component_role, cut_length_mm, quantity, stock_length_mm").eq("company_id", context.companyId).eq("configuration_id", configurationId),
    supabase.from("profile_optimization_runs").select("run_number").eq("company_id", context.companyId).eq("configuration_id", configurationId).order("run_number", { ascending: false }).limit(1)
  ]);

  if (configurationResult.error || !configurationResult.data) throw configurationResult.error ?? new Error("Configuration not found");
  if (cutsResult.error) throw cutsResult.error;
  if (previousRunsResult.error) throw previousRunsResult.error;
  if (!(cutsResult.data ?? []).length) throw new Error("Calculate the configuration before running profile optimization.");

  const options = configurationResult.data.options_json && typeof configurationResult.data.options_json === "object" ? configurationResult.data.options_json as Record<string, unknown> : {};
  const configurationSeries = configurationResult.data.system_series as any;
  const stockLengthMm = toNumber(configurationSeries?.stock_length_mm, 6000);
  const result = optimizeProfileCuts((cutsResult.data ?? []).map((cut: any) => ({
    id: cut.id,
    profileCode: cut.profile_code,
    profileName: cut.profile_name,
    componentRole: cut.component_role,
    cutLengthMm: toNumber(cut.cut_length_mm),
    stockLengthMm: cut.stock_length_mm == null ? stockLengthMm : toNumber(cut.stock_length_mm),
    quantity: toNumber(cut.quantity)
  })), {
    stockLengthMm,
    sawKerfMm: toNumber(options.saw_kerf_mm, 3),
    minimumReusableLeftoverMm: toNumber(options.minimum_reusable_leftover_mm, 300)
  });

  const runNumber = (previousRunsResult.data?.[0]?.run_number ?? 0) + 1;
  const { error } = await supabase.from("profile_optimization_runs").insert({
    company_id: context.companyId,
    configuration_id: configurationId,
    run_number: runNumber,
    stock_length_mm: result.stockLengthMm,
    input_cuts_json: cutsResult.data ?? [],
    optimized_output_json: result,
    total_stock_bars: result.totalStockBars,
    total_used_length_mm: result.totalUsedLengthMm,
    total_waste_mm: result.totalWasteMm,
    waste_percent: result.wastePercent,
    created_by: context.userId
  });
  if (error) throw error;

  revalidatePath(`/systems-configurator/projects/${configurationId}`);
  revalidatePath(`/systems-configurator/projects/${configurationId}/optimization`);
  revalidatePath("/systems-configurator/reports");
}

export async function handoffSystemConfigurationToProduction(configurationId: string, formData?: FormData) {
  const context = await getSessionContext();
  if (!can(context.role, "create", "production")) redirect("/dashboard");
  const supabase = await createClient();
  const [configurationResult, cutsResult, beadingResult] = await Promise.all([
    supabase.from("system_configurations_authorized").select("id, company_id, configuration_number, project_name, design_reference, customer_id, quote_id, order_id, status, grand_total").eq("id", configurationId).eq("company_id", context.companyId).single(),
    supabase.from("system_profile_cuts").select("profile_id, profile_code, profile_name, total_weight_kg, total_length_m").eq("company_id", context.companyId).eq("configuration_id", configurationId),
    supabase.from("system_beading_cuts").select("profile_id, total_length_m, aluminium_profiles(profile_code, profile_name, section_weight_kg_per_m)").eq("company_id", context.companyId).eq("configuration_id", configurationId)
  ]);

  if (configurationResult.error || !configurationResult.data) throw configurationResult.error ?? new Error("Configuration not found");
  if (cutsResult.error) throw cutsResult.error;
  if (beadingResult.error) throw beadingResult.error;

  const configuration = configurationResult.data;
  const beadingCuts = (beadingResult.data ?? []).map((cut: any) => ({ ...cut, profile_code: cut.aluminium_profiles?.profile_code, profile_name: cut.aluminium_profiles?.profile_name, total_weight_kg: Math.round(Number(cut.total_length_m) * Number(cut.aluminium_profiles?.section_weight_kg_per_m) * 1000) / 1000 }));
  if (beadingCuts.some((cut: any) => !Number.isFinite(cut.total_weight_kg) || cut.total_weight_kg <= 0)) throw new Error("Every beading cut needs a verified profile weight before production handoff.");
  const jobGroups = groupProfileCutsForProduction([...(cutsResult.data ?? []), ...beadingCuts]);
  let existingOrderId = configuration.order_id as string | null;
  if (!existingOrderId && configuration.quote_id) {
    const existingOrderResult = await supabase.from("orders").select("id").eq("company_id", context.companyId).eq("quote_id", configuration.quote_id).maybeSingle();
    if (existingOrderResult.error) throw existingOrderResult.error;
    existingOrderId = existingOrderResult.data?.id ?? null;
  }
  if (configuration.quote_id && !existingOrderId) throw new Error("Convert the approved quote to an order before production handoff.");

  const remarks = buildProductionJobRemarks(configuration.configuration_number, configuration.design_reference);
  const existingJobsForConfiguration = existingOrderId
    ? await supabase.from("production_jobs").select("id").eq("company_id", context.companyId).eq("order_id", existingOrderId).ilike("remarks", `%${configuration.configuration_number ?? "System configuration"}%`)
    : { data: [], error: null };
  if (existingJobsForConfiguration.error) throw existingJobsForConfiguration.error;

  const readiness = getProductionHandoffReadiness({ status: configuration.status, customer_id: configuration.customer_id, order_id: existingOrderId }, jobGroups, existingJobsForConfiguration.data?.length ?? 0);
  if (!readiness.ready) throw new Error(readiness.reason ?? "Configuration is not ready for production handoff.");
  const profileIds = jobGroups.map((group) => group.profileId);
  const diesResult = await supabase
    .from("dies")
    .select("id, profile_id, die_status")
    .eq("company_id", context.companyId)
    .in("profile_id", profileIds)
    .in("die_status", usableProductionDieStatuses)
    .order("id", { ascending: true });
  if (diesResult.error) throw diesResult.error;
  const usableDies = new Map<string, string>();
  for (const die of diesResult.data ?? []) {
    if (profileIds.includes(die.profile_id) && isUsableProductionDieForProfile(die, die.profile_id) && !usableDies.has(die.profile_id)) {
      usableDies.set(die.profile_id, die.id);
    }
  }
  const missingDie = jobGroups.find((group) => !usableDies.has(group.profileId));
  if (missingDie) throw new Error(`${missingDie.profileCode} ${missingDie.profileName} needs a usable die before production handoff.`);

  const jobRows = jobGroups.map((group) => ({
    profile_id: group.profileId,
    source_line_id: String(formData?.get(`source_line_${group.profileId}`) ?? "") || null,
    die_id: usableDies.get(group.profileId),
    planned_quantity_kg: group.plannedQuantityKg,
    planned_meters: group.plannedMeters,
    remarks: `${remarks} / ${group.profileCode} ${group.profileName}`
  }));
  const handoffResult = await supabase.rpc("handoff_system_configuration_to_production_atomic", {
    p_configuration_id: configurationId,
    p_jobs: jobRows,
    p_remarks: remarks
  });
  if (handoffResult.error || !handoffResult.data) throw handoffResult.error ?? new Error("Could not hand off configuration to production");

  revalidatePath(`/systems-configurator/projects/${configurationId}`);
  revalidatePath(`/systems-configurator/projects/${configurationId}/quote`);
  revalidatePath("/systems-configurator/projects");
  revalidatePath("/systems-configurator/reports");
  revalidatePath("/production");
  revalidatePath("/production/database");
  redirect(`/production`);
}

export async function generateSystemQuote(configurationId: string) {
  const context = await getSystemsConfiguratorContext("create");
  if (!["owner", "admin"].includes(context.role)) throw new Error("An owner or admin must price this configuration.");
  const parsedId = z.string().uuid().parse(configurationId);
  const supabase = await createClient();
  const result = await supabase.rpc("generate_system_quote_atomic", { p_configuration_id: parsedId });
  if (result.error) throw result.error;
  const quoteId = z.string().uuid().parse(result.data);
  revalidatePath(`/systems-configurator/projects/${parsedId}`);
  revalidatePath(`/systems-configurator/projects/${parsedId}/quote`);
  revalidatePath("/quotes");
  revalidatePath("/quotes/database");
  redirect(`/quotes/${quoteId}`);
}

export async function reserveSystemBomProfileStock(configurationId: string) {
  const context = await getSystemsConfiguratorContext("read");
  if (!can(context.role, "reserve", "inventory_reservations")) redirect(`/systems-configurator/projects/${configurationId}/bom`);
  const supabase = await createClient();
  const [configurationResult, cutsResult, materialSummaryResult] = await Promise.all([
    supabase.from("system_configurations_authorized").select("id, order_id, configuration_number").eq("id", configurationId).eq("company_id", context.companyId).single(),
    supabase.from("system_profile_cuts").select("profile_id, profile_code, profile_name, total_weight_kg, total_length_m").eq("company_id", context.companyId).eq("configuration_id", configurationId),
    supabase.from("system_material_summary_authorized").select("item_id, item_code, item_name, total_weight_kg, total_length_m, material_type").eq("company_id", context.companyId).eq("configuration_id", configurationId).eq("material_type", "aluminium_profile")
  ]);
  if (configurationResult.error || !configurationResult.data) throw configurationResult.error ?? new Error("Configuration not found");
  if (cutsResult.error) throw cutsResult.error;
  if (materialSummaryResult.error) throw materialSummaryResult.error;
  const configuration = configurationResult.data;
  if (!configuration.order_id) throw new Error("Convert this configuration to an order before reserving profile stock.");
  const materialRows = (materialSummaryResult.data ?? []).map((item: any) => ({ profile_id: item.item_id, profile_code: item.item_code, profile_name: item.item_name, total_weight_kg: item.total_weight_kg, total_length_m: item.total_length_m }));
  const requirements = groupProfileReservationRequirements(materialRows.length ? materialRows : cutsResult.data ?? []);
  if (!requirements.length) throw new Error("Calculate profile cuts before reserving stock.");

  const profileIds = requirements.map((item) => item.profileId);
  const [stockResult, reservationsResult] = await Promise.all([
    supabase
    .from("profile_stock_batches")
      .select("id, profile_id, total_weight_kg, length_m, quantity_pieces, bundle_number, created_at, status")
    .eq("company_id", context.companyId)
    .in("status", ["available", "reserved"])
    .in("profile_id", profileIds)
    .order("created_at", { ascending: true }),
    supabase
      .from("profile_stock_reservations")
      .select("id, profile_stock_batch_id, profile_id, order_id, configuration_id, reserved_weight_kg, reserved_pieces, status")
      .eq("company_id", context.companyId)
      .eq("status", "active")
      .in("profile_id", profileIds)
  ]);
  if (stockResult.error) throw stockResult.error;
  if (reservationsResult.error) throw reservationsResult.error;

  const activeReservations = reservationsResult.data ?? [];
  const reservationIds = activeReservations.map((reservation: any) => reservation.id);
  const consumptionByReservation = await loadReservationConsumptionTotals(supabase, reservationIds);
  const reservationsWithConsumption = activeReservations.map((reservation: any) => ({
    ...reservation,
    consumed_weight_kg: consumptionByReservation.get(reservation.id)?.weightKg ?? 0,
    consumed_length_m: consumptionByReservation.get(reservation.id)?.lengthM ?? 0,
    consumed_pieces: consumptionByReservation.get(reservation.id)?.pieces ?? 0
  }));

  const existingForConfiguration = reservationsWithConsumption.filter((reservation: any) => reservation.configuration_id === configurationId && reservation.order_id === configuration.order_id);
  if (existingForConfiguration.length) throw new Error("Profile stock is already reserved for this configuration and order.");

  const reservationRows: Record<string, any>[] = [];
  for (const requirement of requirements) {
    let remainingLength = requirement.requiredLengthM;
    let remainingWeight = requirement.requiredWeightKg;
    const batches = (stockResult.data ?? []).filter((batch: any) => batch.profile_id === requirement.profileId);
    for (const batch of batches) {
      if (remainingWeight <= 0 && remainingLength <= 0) break;
      const availablePieces = getBatchAvailablePieces(batch, reservationsWithConsumption);
      if (availablePieces <= 0) continue;
      const allocation = getBatchReservationAllocation(batch, availablePieces, remainingWeight, remainingLength);
      if (!allocation) continue;
      reservationRows.push({
        company_id: context.companyId,
        profile_stock_batch_id: batch.id,
        profile_id: requirement.profileId,
        order_id: configuration.order_id,
        configuration_id: configurationId,
        reserved_weight_kg: allocation.weightKg,
        reserved_pieces: allocation.pieces,
        reserved_length_m: allocation.lengthM,
        status: "active",
        notes: `Reserved from system configuration ${configuration.configuration_number ?? configurationId}`,
        created_by: context.userId
      });
      remainingWeight = Math.round((remainingWeight - allocation.weightKg + Number.EPSILON) * 1000) / 1000;
      remainingLength = Math.round((remainingLength - allocation.lengthM + Number.EPSILON) * 1000) / 1000;
    }
    if (remainingWeight > 0.001 || remainingLength > 0.001) {
      throw new Error(`${requirement.profileCode} has insufficient available stock for ${requirement.requiredWeightKg.toFixed(3)} kg and ${requirement.requiredLengthM.toFixed(3)} m of configured demand.`);
    }
  }

  if (reservationRows.length) {
    const reserveResult = await supabase.from("profile_stock_reservations").insert(reservationRows);
    if (reserveResult.error) throw reserveResult.error;
  }

  revalidatePath(`/systems-configurator/projects/${configurationId}/bom`);
  revalidatePath(`/systems-configurator/projects/${configurationId}`);
  revalidatePath("/inventory");
  revalidatePath("/inventory/database");
  revalidatePath(`/orders/${configuration.order_id}`);
}

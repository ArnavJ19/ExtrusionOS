"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { nextBusinessNumber } from "@/lib/utils/numbering";
import { calculateSystemConfiguration, type ComponentRole, type HardwareCategory, type PanelLayout, type SystemTemplate, type SystemType } from "./formula-engine";
import { optimizeProfileCuts } from "./profile-optimization";
import { buildProductionJobRemarks, getProductionHandoffReadiness, groupProfileCutsForProduction } from "./production-handoff";
import { getBatchAvailableWeightKg, groupProfileReservationRequirements } from "./inventory-reservation";
import { buildSystemQuoteDescription } from "./quote-integration";
import { hasCriticalWarnings } from "./warning-categories";
import { assertSystemQuoteReady } from "./quote-readiness";
import { getSystemsConfiguratorContext } from "./access";
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

function nextConfigurationNumber(existingNumbers: string[], date = new Date()) {
  const year = date.getFullYear();
  const pattern = new RegExp(`^SC-${year}-(\\d{4})$`);
  const max = existingNumbers.reduce((current, value) => {
    const match = value.match(pattern);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `SC-${year}-${String(max + 1).padStart(4, "0")}`;
}

function nextQuoteNumber(existingNumbers: string[], date = new Date()) {
  const year = date.getFullYear();
  const pattern = new RegExp(`^Q-${year}-(\\d{4})$`);
  const max = existingNumbers.reduce((current, value) => {
    const match = value.match(pattern);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `Q-${year}-${String(max + 1).padStart(4, "0")}`;
}

async function assertCanManageLibraries() {
  const context = await getSystemsConfiguratorContext("create");
  if (!["owner", "admin", "sales_manager"].includes(context.role)) redirect("/systems-configurator");
  return context;
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
  const existing = await supabase.from("system_configurations").select("configuration_number").eq("company_id", context.companyId);
  if (existing.error) throw existing.error;
  const configurationNumber = nextConfigurationNumber((existing.data ?? []).map((row: any) => row.configuration_number).filter(Boolean));
  const noOfPanels = parsed.panel_count;

  const { data, error } = await supabase
    .from("system_configurations")
    .insert({
      company_id: context.companyId,
      created_by: context.userId,
      configuration_number: configurationNumber,
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
  const context = await getSystemsConfiguratorContext("update");
  const parsed = systemConfigurationDraftSchema.parse(formEntries(formData));
  const panelLayoutJson = parseJsonObject(parsed.panel_layout_json, "Panel layout JSON");
  const optionsJson = parseJsonObject(parsed.options_json, "Options JSON");
  const supabase = await createClient();

  const { error } = await supabase
    .from("system_configurations")
    .update({
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
    })
    .eq("id", configurationId)
    .eq("company_id", context.companyId);

  if (error) throw error;

  await Promise.all([
    supabase.from("system_profile_cuts").delete().eq("company_id", context.companyId).eq("configuration_id", configurationId),
    supabase.from("system_glass_cuts").delete().eq("company_id", context.companyId).eq("configuration_id", configurationId),
    supabase.from("system_beading_cuts").delete().eq("company_id", context.companyId).eq("configuration_id", configurationId),
    supabase.from("system_hardware_bom").delete().eq("company_id", context.companyId).eq("configuration_id", configurationId),
    supabase.from("system_material_summary").delete().eq("company_id", context.companyId).eq("configuration_id", configurationId),
    supabase.from("profile_optimization_runs").delete().eq("company_id", context.companyId).eq("configuration_id", configurationId)
  ]);

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
  const context = await getSystemsConfiguratorContext("update");
  const supabase = await createClient();
  const { data: configuration, error: configurationError } = await supabase
    .from("system_configurations")
    .select("*")
    .eq("id", configurationId)
    .eq("company_id", context.companyId)
    .single();
  if (configurationError || !configuration) throw configurationError ?? new Error("Configuration not found");

  const [series, systemProfiles, hardwareItems, glassItem, finishOption, template, settings] = await Promise.all([
    supabase.from("system_series").select("*").eq("id", configuration.series_id).eq("company_id", context.companyId).single(),
    supabase.from("system_profiles").select("*, aluminium_profiles(id, profile_code, profile_name, section_weight_kg_per_m)").eq("company_id", context.companyId).eq("series_id", configuration.series_id).eq("is_active", true).order("sort_order", { ascending: true }),
    supabase.from("hardware_items").select("*").eq("company_id", context.companyId).eq("is_active", true),
    configuration.glass_id ? supabase.from("glass_items").select("*").eq("id", configuration.glass_id).eq("company_id", context.companyId).single() : Promise.resolve({ data: null, error: null }),
    configuration.finish_id ? supabase.from("finish_options").select("*").eq("id", configuration.finish_id).eq("company_id", context.companyId).single() : Promise.resolve({ data: null, error: null }),
    configuration.template_id ? supabase.from("system_templates").select("*").eq("id", configuration.template_id).eq("company_id", context.companyId).single() : Promise.resolve({ data: null, error: null }),
    supabase.from("company_settings").select("default_gst_percent, default_margin_percent, default_conversion_charge_per_kg, default_transport_charge").eq("company_id", context.companyId).maybeSingle()
  ]);

  if (series.error || !series.data) throw series.error ?? new Error("Series not found");
  if (systemProfiles.error) throw systemProfiles.error;
  if (hardwareItems.error) throw hardwareItems.error;
  if (glassItem.error) throw glassItem.error;
  if (finishOption.error) throw finishOption.error;
  if (template.error) throw template.error;
  if (settings.error) throw settings.error;

  const panelLayout = (configuration.panel_layout_json && typeof configuration.panel_layout_json === "object" ? configuration.panel_layout_json : { panels: [] }) as PanelLayout;
  const options = (configuration.options_json && typeof configuration.options_json === "object" ? configuration.options_json : {}) as Record<string, number | string | boolean | null>;
  const stockLengthMm = toNumber(series.data.stock_length_mm, 6000);
  const result = calculateSystemConfiguration({
    widthMm: toNumber(configuration.width_mm),
    heightMm: toNumber(configuration.height_mm),
    quantity: toNumber(configuration.quantity, 1),
    systemType: configuration.system_type as SystemType,
    seriesId: configuration.series_id,
    template: templateFromRows(template.data, configuration.system_type as SystemType, systemProfiles.data ?? []),
    panelLayout,
    selectedProfiles: (systemProfiles.data ?? []).map((item: any) => ({
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

  await Promise.all([
    supabase.from("system_profile_cuts").delete().eq("company_id", context.companyId).eq("configuration_id", configurationId),
    supabase.from("system_glass_cuts").delete().eq("company_id", context.companyId).eq("configuration_id", configurationId),
    supabase.from("system_beading_cuts").delete().eq("company_id", context.companyId).eq("configuration_id", configurationId),
    supabase.from("system_hardware_bom").delete().eq("company_id", context.companyId).eq("configuration_id", configurationId),
    supabase.from("system_material_summary").delete().eq("company_id", context.companyId).eq("configuration_id", configurationId)
  ]);

  if (result.profileCuts.length) {
    const { error } = await supabase.from("system_profile_cuts").insert(result.profileCuts.map((cut, index) => ({ company_id: context.companyId, configuration_id: configurationId, profile_id: cut.profileId ?? null, component_role: cut.componentRole, profile_code: cut.profileCode, profile_name: cut.profileName, cut_length_mm: cut.cutLengthMm, quantity: cut.quantity, total_length_m: cut.totalLengthM, section_weight_kg_per_m: cut.sectionWeightKgPerM, total_weight_kg: cut.totalWeightKg, angle_left: cut.angleLeft, angle_right: cut.angleRight, deduction_mm: cut.deductionMm, addition_mm: cut.additionMm, stock_length_mm: cut.stockLengthMm, wastage_percent: cut.wastagePercent, remarks: cut.remarks ?? null, sort_order: index })));
    if (error) throw error;
  }

  if (result.glassCuts.length) {
    const { error } = await supabase.from("system_glass_cuts").insert(result.glassCuts.map((cut) => ({ company_id: context.companyId, configuration_id: configurationId, glass_id: cut.glassId ?? null, panel_index: cut.panelIndex, glass_label: cut.glassLabel, width_mm: cut.widthMm, height_mm: cut.heightMm, quantity: cut.quantity, area_sqft: cut.areaSqft, area_sqm: cut.areaSqm, glass_type: cut.glassType ?? null, thickness_mm: cut.thicknessMm ?? 0, rate: cut.rate, amount: cut.amount, deduction_width_mm: cut.deductionWidthMm, deduction_height_mm: cut.deductionHeightMm, remarks: cut.remarks ?? null })));
    if (error) throw error;
  }

  if (result.beadingCuts.length) {
    const { error } = await supabase.from("system_beading_cuts").insert(result.beadingCuts.map((cut) => ({ company_id: context.companyId, configuration_id: configurationId, profile_id: cut.profileId ?? null, panel_index: cut.panelIndex, bead_position: cut.beadPosition, cut_length_mm: cut.cutLengthMm, quantity: cut.quantity, total_length_m: cut.totalLengthM, remarks: cut.remarks ?? `${cut.profileCode ?? "Bead"} ${cut.profileName ?? ""}`.trim() })));
    if (error) throw error;
  }

  if (result.hardwareBom.length) {
    const { error } = await supabase.from("system_hardware_bom").insert(result.hardwareBom.map((item) => ({ company_id: context.companyId, configuration_id: configurationId, hardware_item_id: item.hardwareItemId ?? null, item_code: item.itemCode, item_name: item.itemName, hardware_category: item.hardwareCategory, quantity: item.quantity, unit: item.unit, rate: item.rate, amount: item.amount, remarks: item.remarks ?? null })));
    if (error) throw error;
  }

  if (result.materialSummary.length) {
    const { error } = await supabase.from("system_material_summary").insert(result.materialSummary.map((item) => ({ company_id: context.companyId, configuration_id: configurationId, material_type: item.materialType, item_id: item.itemId ?? null, item_code: item.itemCode ?? null, item_name: item.itemName, quantity: item.quantity, unit: item.unit, total_weight_kg: item.totalWeightKg, total_length_m: item.totalLengthM, total_area_sqft: item.totalAreaSqft, total_area_sqm: item.totalAreaSqm, rate: item.rate, amount: item.amount })));
    if (error) throw error;
  }

  const costing = result.costingSummary;
  const hasCriticalCalculationWarnings = hasCriticalWarnings(result.warnings);
  const { error: updateError } = await supabase
    .from("system_configurations")
    .update({ status: hasCriticalCalculationWarnings ? "draft" : "calculated", subtotal: costing?.subtotalBeforeGst ?? 0, gst_amount: costing?.gstAmount ?? 0, grand_total: costing?.grandTotal ?? 0, internal_cost: costing?.internalCost ?? 0, selling_price: costing?.grandTotal ?? 0, margin_percent: toNumber(options.margin_percent, configuration.margin_percent || settings.data?.default_margin_percent || 15), gst_percent: toNumber(options.gst_percent, configuration.gst_percent || settings.data?.default_gst_percent || 18) })
    .eq("id", configurationId)
    .eq("company_id", context.companyId);
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
    supabase.from("system_configurations").select("id, options_json, system_series(stock_length_mm)").eq("id", configurationId).eq("company_id", context.companyId).single(),
    supabase.from("system_profile_cuts").select("id, profile_code, profile_name, component_role, cut_length_mm, quantity, stock_length_mm").eq("company_id", context.companyId).eq("configuration_id", configurationId),
    supabase.from("profile_optimization_runs").select("run_number").eq("company_id", context.companyId).eq("configuration_id", configurationId).order("run_number", { ascending: false }).limit(1)
  ]);

  if (configurationResult.error || !configurationResult.data) throw configurationResult.error ?? new Error("Configuration not found");
  if (cutsResult.error) throw cutsResult.error;
  if (previousRunsResult.error) throw previousRunsResult.error;
  if (!(cutsResult.data ?? []).length) throw new Error("Calculate the configuration before running profile optimization.");

  const options = configurationResult.data.options_json && typeof configurationResult.data.options_json === "object" ? configurationResult.data.options_json as Record<string, unknown> : {};
  const configurationSeries = configurationResult.data.system_series as any;
  const stockLengthMm = toNumber((cutsResult.data ?? [])[0]?.stock_length_mm, toNumber(configurationSeries?.stock_length_mm, 6000));
  const result = optimizeProfileCuts((cutsResult.data ?? []).map((cut: any) => ({
    id: cut.id,
    profileCode: cut.profile_code,
    profileName: cut.profile_name,
    componentRole: cut.component_role,
    cutLengthMm: toNumber(cut.cut_length_mm),
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

export async function handoffSystemConfigurationToProduction(configurationId: string) {
  const context = await getSessionContext();
  if (!can(context.role, "create", "production")) redirect("/dashboard");
  const supabase = await createClient();
  const [configurationResult, cutsResult, existingOrdersResult, existingJobsResult] = await Promise.all([
    supabase.from("system_configurations").select("id, company_id, configuration_number, project_name, design_reference, customer_id, quote_id, order_id, status, grand_total").eq("id", configurationId).eq("company_id", context.companyId).single(),
    supabase.from("system_profile_cuts").select("profile_id, profile_code, profile_name, total_weight_kg, total_length_m").eq("company_id", context.companyId).eq("configuration_id", configurationId),
    supabase.from("orders").select("order_number").eq("company_id", context.companyId),
    supabase.from("production_jobs").select("id").eq("company_id", context.companyId)
  ]);

  if (configurationResult.error || !configurationResult.data) throw configurationResult.error ?? new Error("Configuration not found");
  if (cutsResult.error) throw cutsResult.error;
  if (existingOrdersResult.error) throw existingOrdersResult.error;
  if (existingJobsResult.error) throw existingJobsResult.error;

  const configuration = configurationResult.data;
  const jobGroups = groupProfileCutsForProduction(cutsResult.data ?? []);
  let existingOrderId = configuration.order_id as string | null;
  if (!existingOrderId && configuration.quote_id) {
    const existingOrderResult = await supabase.from("orders").select("id").eq("company_id", context.companyId).eq("quote_id", configuration.quote_id).maybeSingle();
    if (existingOrderResult.error) throw existingOrderResult.error;
    existingOrderId = existingOrderResult.data?.id ?? null;
  }

  const remarks = buildProductionJobRemarks(configuration.configuration_number, configuration.design_reference);
  const existingJobsForConfiguration = existingOrderId
    ? await supabase.from("production_jobs").select("id").eq("company_id", context.companyId).eq("order_id", existingOrderId).ilike("remarks", `%${configuration.configuration_number ?? "System configuration"}%`)
    : { data: [], error: null };
  if (existingJobsForConfiguration.error) throw existingJobsForConfiguration.error;

  const readiness = getProductionHandoffReadiness({ status: configuration.status, customer_id: configuration.customer_id, order_id: existingOrderId }, jobGroups, existingJobsForConfiguration.data?.length ?? 0);
  if (!readiness.ready) throw new Error(readiness.reason ?? "Configuration is not ready for production handoff.");

  const today = new Date().toISOString().slice(0, 10);
  let orderId = existingOrderId;
  if (!orderId) {
    const orderNumber = nextBusinessNumber("O", (existingOrdersResult.data ?? []).map((order: any) => order.order_number).filter(Boolean));
    const orderResult = await supabase.from("orders").insert({ company_id: context.companyId, order_number: orderNumber, quote_id: configuration.quote_id ?? null, customer_id: configuration.customer_id, order_date: today, priority: "normal", current_stage: "extrusion_planned", order_value: Number(configuration.grand_total ?? 0), notes: `Generated from ${remarks}`, created_by: context.userId }).select("id").single();
    if (orderResult.error || !orderResult.data) throw orderResult.error ?? new Error("Could not create production order");
    orderId = orderResult.data.id;
  }

  const existingJobNumbersResult = await supabase.from("production_jobs").select("job_number").eq("company_id", context.companyId);
  if (existingJobNumbersResult.error) throw existingJobNumbersResult.error;
  const existingJobNumbers = (existingJobNumbersResult.data ?? []).map((job: any) => job.job_number).filter(Boolean);
  const jobRows = jobGroups.map((group, index) => ({
    company_id: context.companyId,
    order_id: orderId,
    job_number: `J-PENDING-${index + 1}`,
    profile_id: group.profileId,
    planned_quantity_kg: group.plannedQuantityKg,
    planned_meters: group.plannedMeters,
    planned_date: today,
    status: "planned",
    remarks: `${remarks} / ${group.profileCode} ${group.profileName}`
  }));

  // Generate sequential job numbers without relying on database-specific sequences.
  let sequenceNumbers = existingJobNumbers;
  for (const row of jobRows) {
    row.job_number = nextBusinessNumber("J", sequenceNumbers);
    sequenceNumbers = [...sequenceNumbers, row.job_number];
  }

  const jobsResult = await supabase.from("production_jobs").insert(jobRows).select("id");
  if (jobsResult.error) throw jobsResult.error;

  const updates = [
    supabase.from("system_configurations").update({ order_id: orderId, status: "in_production" }).eq("id", configurationId).eq("company_id", context.companyId),
    supabase.from("orders").update({ current_stage: "extrusion_planned" }).eq("id", orderId).eq("company_id", context.companyId)
  ];
  if (configuration.quote_id) updates.push(supabase.from("quotes").update({ status: "converted_to_order" }).eq("id", configuration.quote_id).eq("company_id", context.companyId));
  const updateResults = await Promise.all(updates);
  for (const result of updateResults) if (result.error) throw result.error;

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
  const supabase = await createClient();
  const [configurationResult, profileCutsResult, materialSummaryResult, settingsResult, quoteNumbersResult] = await Promise.all([
    supabase.from("system_configurations").select("*, customers(customer_name, company_name), system_series(series_code, series_name), glass_items(glass_code, glass_name), finish_options(finish_code, finish_name)").eq("id", configurationId).eq("company_id", context.companyId).single(),
    supabase.from("system_profile_cuts").select("*").eq("company_id", context.companyId).eq("configuration_id", configurationId).order("sort_order", { ascending: true }),
    supabase.from("system_material_summary").select("*").eq("company_id", context.companyId).eq("configuration_id", configurationId),
    supabase.from("company_settings").select("default_quote_validity_days, default_terms_and_conditions, default_quote_terms, default_payment_terms, default_delivery_terms, minimum_margin_percent").eq("company_id", context.companyId).maybeSingle(),
    supabase.from("quotes").select("quote_number").eq("company_id", context.companyId)
  ]);

  if (configurationResult.error || !configurationResult.data) throw configurationResult.error ?? new Error("Configuration not found");
  if (profileCutsResult.error) throw profileCutsResult.error;
  if (materialSummaryResult.error) throw materialSummaryResult.error;
  if (settingsResult.error) throw settingsResult.error;
  if (quoteNumbersResult.error) throw quoteNumbersResult.error;

  const configuration = configurationResult.data;
  if (configuration.quote_id) redirect(`/quotes/${configuration.quote_id}`);
  assertSystemQuoteReady(configuration, profileCutsResult.data ?? [], true);
  const firstCut = (profileCutsResult.data ?? []).find((cut: any) => cut.profile_id && Number(cut.total_length_m ?? 0) > 0 && Number(cut.total_weight_kg ?? 0) > 0);
  if (!firstCut) throw new Error("At least one calculated profile cut with a profile is required to create a quote item.");

  const aluminiumMaterialRows = (materialSummaryResult.data ?? []).filter((item: any) => item.material_type === "aluminium_profile");
  const totalMeters = aluminiumMaterialRows.length ? aluminiumMaterialRows.reduce((sum: number, item: any) => sum + Number(item.total_length_m ?? 0), 0) : (profileCutsResult.data ?? []).reduce((sum: number, cut: any) => sum + Number(cut.total_length_m ?? 0), 0);
  const totalWeightKg = aluminiumMaterialRows.length ? aluminiumMaterialRows.reduce((sum: number, item: any) => sum + Number(item.total_weight_kg ?? 0), 0) : (profileCutsResult.data ?? []).reduce((sum: number, cut: any) => sum + Number(cut.total_weight_kg ?? 0), 0);
  const materialCost = (materialSummaryResult.data ?? []).reduce((sum: number, item: any) => sum + Number(item.amount ?? 0), 0);
  const subtotal = Number(configuration.subtotal ?? configuration.selling_price ?? 0);
  const internalCost = Number(configuration.internal_cost ?? materialCost);
  const profitAmount = subtotal - internalCost;
  const estimatedProfitPercent = subtotal > 0 ? Math.round((profitAmount / subtotal) * 10000) / 100 : 0;
  const quoteNumber = nextQuoteNumber((quoteNumbersResult.data ?? []).map((quote: any) => quote.quote_number).filter(Boolean));
  const today = new Date();
  const validityDays = Number(settingsResult.data?.default_quote_validity_days ?? 15);
  const validUntil = new Date(today);
  validUntil.setDate(today.getDate() + validityDays);
  const description = buildSystemQuoteDescription({
    configurationNumber: configuration.configuration_number,
    projectName: configuration.project_name,
    designReference: configuration.design_reference,
    systemType: configuration.system_type,
    widthMm: Number(configuration.width_mm),
    heightMm: Number(configuration.height_mm),
    quantity: Number(configuration.quantity),
    finishName: configuration.finish_options?.finish_name,
    glassName: configuration.glass_items?.glass_name,
    grandTotal: Number(configuration.grand_total),
    gstAmount: Number(configuration.gst_amount),
    customerName: configuration.customers?.customer_name
  });

  const quotePayload = {
    company_id: context.companyId,
    quote_number: quoteNumber,
    customer_id: configuration.customer_id,
    quote_date: today.toISOString().slice(0, 10),
    valid_until: validUntil.toISOString().slice(0, 10),
    status: "draft",
    subtotal,
    total_margin_amount: profitAmount,
    total_before_gst: subtotal,
    gst_percent: Number(configuration.gst_percent ?? 18),
    gst_amount: Number(configuration.gst_amount ?? 0),
    grand_total: Number(configuration.grand_total ?? 0),
    low_margin_approval_required: estimatedProfitPercent < Number(settingsResult.data?.minimum_margin_percent ?? 0),
    estimated_profit_amount: profitAmount,
    estimated_profit_percent: estimatedProfitPercent,
    terms_and_conditions: settingsResult.data?.default_terms_and_conditions ?? settingsResult.data?.default_quote_terms ?? null,
    delivery_timeline: settingsResult.data?.default_delivery_terms ?? null,
    payment_terms: settingsResult.data?.default_payment_terms ?? null,
    notes: `Generated from system configuration ${configuration.configuration_number ?? configurationId}`,
    created_by: context.userId
  };

  const quoteResult = await supabase.from("quotes").insert(quotePayload).select("id").single();
  if (quoteResult.error || !quoteResult.data) throw quoteResult.error ?? new Error("Could not create quote");
  const quoteId = quoteResult.data.id;
  const quantityPieces = Math.max(1, Number(configuration.quantity ?? 1));
  const lengthPerPieceM = Math.max(0.001, totalMeters / quantityPieces);
  const sectionWeightKgPerM = Math.max(0.001, totalWeightKg / Math.max(totalMeters, 0.001));
  const marginPercent = Number(configuration.margin_percent ?? 0);

  const itemResult = await supabase.from("quote_items").insert({
    company_id: context.companyId,
    quote_id: quoteId,
    profile_id: firstCut.profile_id,
    die_id: null,
    item_description: description,
    quantity_pieces: quantityPieces,
    length_per_piece_m: lengthPerPieceM,
    total_meters: totalMeters,
    section_weight_kg_per_m: sectionWeightKgPerM,
    total_weight_kg: totalWeightKg,
    billet_rate_per_kg: totalWeightKg > 0 ? materialCost / totalWeightKg : 0,
    raw_material_cost: materialCost,
    conversion_charge_per_kg: 0,
    conversion_cost: 0,
    finishing_type: configuration.finish_options?.finish_code ? "other" : "mill_finish",
    finishing_charge_type: "fixed",
    finishing_charge: 0,
    finishing_cost: 0,
    die_charge: 0,
    scrap_allowance_percent: 0,
    expected_recovery_percent: 100,
    effective_weight_kg: totalWeightKg,
    minimum_billing_weight_kg: 0,
    billing_weight_kg: totalWeightKg,
    die_amortization_type: "waived",
    die_amortization_quantity_kg: 0,
    die_amortization_amount: 0,
    packing_charge: 0,
    transport_charge: 0,
    other_charges: Math.max(0, internalCost - materialCost),
    margin_percent: marginPercent,
    margin_amount: profitAmount,
    sales_price_override: subtotal,
    minimum_margin_percent: Number(settingsResult.data?.minimum_margin_percent ?? 0),
    approval_required: estimatedProfitPercent < Number(settingsResult.data?.minimum_margin_percent ?? 0),
    estimated_profit_amount: profitAmount,
    estimated_profit_percent: estimatedProfitPercent,
    line_subtotal: internalCost,
    line_total_before_gst: subtotal,
    price_per_kg: totalWeightKg > 0 ? subtotal / totalWeightKg : 0,
    price_per_meter: totalMeters > 0 ? subtotal / totalMeters : 0
  });
  if (itemResult.error) throw itemResult.error;

  const updateResult = await supabase.from("system_configurations").update({ quote_id: quoteId, status: "quoted" }).eq("id", configurationId).eq("company_id", context.companyId);
  if (updateResult.error) throw updateResult.error;

  revalidatePath(`/systems-configurator/projects/${configurationId}`);
  revalidatePath(`/systems-configurator/projects/${configurationId}/quote`);
  revalidatePath("/quotes");
  redirect(`/quotes/${quoteId}`);
}

export async function reserveSystemBomProfileStock(configurationId: string) {
  const context = await getSystemsConfiguratorContext("update");
  if (!can(context.role, "update", "inventory") && !can(context.role, "update", "production")) redirect(`/systems-configurator/projects/${configurationId}/bom`);
  const supabase = await createClient();
  const [configurationResult, cutsResult, materialSummaryResult] = await Promise.all([
    supabase.from("system_configurations").select("id, order_id, configuration_number").eq("id", configurationId).eq("company_id", context.companyId).single(),
    supabase.from("system_profile_cuts").select("profile_id, profile_code, profile_name, total_weight_kg, total_length_m").eq("company_id", context.companyId).eq("configuration_id", configurationId),
    supabase.from("system_material_summary").select("item_id, item_code, item_name, total_weight_kg, total_length_m, material_type").eq("company_id", context.companyId).eq("configuration_id", configurationId).eq("material_type", "aluminium_profile")
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
    .select("id, profile_id, total_weight_kg, length_m, bundle_number, created_at, status")
    .eq("company_id", context.companyId)
    .in("status", ["available", "reserved"])
    .in("profile_id", profileIds)
    .order("created_at", { ascending: true }),
    supabase
      .from("profile_stock_reservations")
      .select("id, profile_stock_batch_id, profile_id, order_id, configuration_id, reserved_weight_kg, status")
      .eq("company_id", context.companyId)
      .eq("status", "active")
      .in("profile_id", profileIds)
  ]);
  if (stockResult.error) throw stockResult.error;
  if (reservationsResult.error) throw reservationsResult.error;

  const existingForConfiguration = (reservationsResult.data ?? []).filter((reservation: any) => reservation.configuration_id === configurationId && reservation.order_id === configuration.order_id);
  if (existingForConfiguration.length) throw new Error("Profile stock is already reserved for this configuration and order.");

  const reservationRows: Record<string, any>[] = [];
  for (const requirement of requirements) {
    let remainingWeight = requirement.requiredWeightKg;
    const batches = (stockResult.data ?? []).filter((batch: any) => batch.profile_id === requirement.profileId);
    for (const batch of batches) {
      if (remainingWeight <= 0) break;
      const availableWeight = getBatchAvailableWeightKg(batch, reservationsResult.data ?? []);
      if (availableWeight <= 0) continue;
      const reserveWeight = Math.min(remainingWeight, availableWeight);
      const batchWeight = Number(batch.total_weight_kg ?? 0);
      const batchLength = Number(batch.length_m ?? 0);
      reservationRows.push({
        company_id: context.companyId,
        profile_stock_batch_id: batch.id,
        profile_id: requirement.profileId,
        order_id: configuration.order_id,
        configuration_id: configurationId,
        reserved_weight_kg: reserveWeight,
        reserved_length_m: batchWeight > 0 ? (batchLength * reserveWeight) / batchWeight : 0,
        status: "active",
        notes: `Reserved from system configuration ${configuration.configuration_number ?? configurationId}`,
        created_by: context.userId
      });
      remainingWeight = Math.round((remainingWeight - reserveWeight + Number.EPSILON) * 1000) / 1000;
    }
    if (remainingWeight > 0) {
      throw new Error(`${requirement.profileCode} has insufficient available stock. Required ${requirement.requiredWeightKg.toFixed(3)} kg, shortage ${remainingWeight.toFixed(3)} kg.`);
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

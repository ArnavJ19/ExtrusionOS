import { z } from "zod";
import { validateFormulaExpression } from "../systems-configurator/formula-engine";
import { validateSystemDraftJsonFields } from "../systems-configurator/draft-validation";
import { assertValidTemplateFormulaJson } from "../systems-configurator/template-formula-validation";
import { optionalText } from "./common";

export const systemTypeSchema = z.enum([
  "two_track_sliding_window",
  "three_track_sliding_window",
  "sliding_door",
  "casement_window",
  "fixed_window",
  "top_hung_window",
  "hinged_door",
  "swing_door",
  "partition",
  "ventilator",
  "combination",
  "custom"
]);

export const componentRoleSchema = z.enum([
  "outer_frame_top",
  "outer_frame_bottom",
  "outer_frame_left",
  "outer_frame_right",
  "frame_jamb",
  "frame_head",
  "sill",
  "threshold",
  "shutter_vertical",
  "shutter_horizontal_top",
  "shutter_horizontal_bottom",
  "sash_vertical",
  "sash_horizontal",
  "interlock",
  "meeting_stile",
  "lock_stile",
  "mullion",
  "transom",
  "coupler",
  "add_on",
  "adapter",
  "reinforcement",
  "support_profile",
  "glazing_bead_vertical",
  "glazing_bead_horizontal",
  "mesh_frame_vertical",
  "mesh_frame_horizontal",
  "corner_profile",
  "track_profile",
  "cover_profile",
  "custom"
]);

export const hardwareCategorySchema = z.enum([
  "lock",
  "handle",
  "roller",
  "hinge",
  "stay_arm",
  "tower_bolt",
  "fastener",
  "screw",
  "gasket",
  "wool_pile",
  "weather_strip",
  "silicone",
  "drainage_cap",
  "corner_cleat",
  "connector",
  "accessory",
  "other"
]);

export const glassTypeSchema = z.enum(["clear", "toughened", "laminated", "frosted", "tinted", "reflective", "low_e", "dgu", "textured", "custom"]);
export const finishTypeSchema = z.enum(["mill_finish", "powder_coating", "anodizing", "wood_finish", "pvdf", "custom"]);
export const finishRateTypeSchema = z.enum(["per_kg", "per_sqft", "per_sqm", "per_meter", "fixed"]);

const formulaString = z.string().trim().min(1).max(200).refine((value) => !validateFormulaExpression(value).some((warning) => warning.severity === "error"), "Formula contains unsupported or unsafe syntax");

export const systemSeriesSchema = z.object({
  series_code: z.string().trim().min(1, "Series code is required").max(40),
  series_name: z.string().trim().min(1, "Series name is required").max(120),
  system_type: systemTypeSchema,
  description: optionalText,
  default_alloy: optionalText,
  default_temper: optionalText,
  default_finish: optionalText,
  stock_length_mm: z.coerce.number().positive().max(12000).default(6000),
  wastage_percent_default: z.coerce.number().nonnegative().max(100).default(5),
  is_active: z.coerce.boolean().default(true)
});

export const systemProfileSchema = z.object({
  series_id: z.string().uuid("Select a system series"),
  profile_id: z.string().uuid("Select an aluminium profile"),
  component_role: componentRoleSchema,
  display_name: z.string().trim().min(1, "Display name is required").max(120),
  description: optionalText,
  is_required: z.coerce.boolean().default(true),
  default_quantity_formula: formulaString.default("1 * Q"),
  default_length_formula: formulaString.default("W"),
  deduction_mm: z.coerce.number().min(-10000).max(10000).default(0),
  addition_mm: z.coerce.number().min(-10000).max(10000).default(0),
  applies_to_system_types: z.string().optional().transform((value) => value ? value.split(",").map((item) => item.trim()).filter(Boolean) : []),
  sort_order: z.coerce.number().int().min(0).max(10000).default(0),
  is_active: z.coerce.boolean().default(true)
});

export const hardwareItemSchema = z.object({
  item_code: z.string().trim().min(1, "Item code is required").max(60),
  item_name: z.string().trim().min(1, "Item name is required").max(160),
  hardware_category: hardwareCategorySchema,
  description: optionalText,
  unit: z.string().trim().min(1).max(24).default("pcs"),
  default_rate: z.coerce.number().nonnegative().max(10000000).default(0),
  brand: optionalText,
  finish: optionalText,
  image_url: optionalText,
  is_active: z.coerce.boolean().default(true)
});

export const glassItemSchema = z.object({
  glass_code: z.string().trim().min(1, "Glass code is required").max(60),
  glass_name: z.string().trim().min(1, "Glass name is required").max(160),
  glass_type: glassTypeSchema,
  thickness_mm: z.coerce.number().nonnegative().max(100).default(0),
  composition: optionalText,
  rate_per_sqft: z.coerce.number().nonnegative().max(1000000).default(0),
  rate_per_sqm: z.coerce.number().nonnegative().max(1000000).default(0),
  is_active: z.coerce.boolean().default(true)
});

export const finishOptionSchema = z.object({
  finish_code: z.string().trim().min(1, "Finish code is required").max(60),
  finish_name: z.string().trim().min(1, "Finish name is required").max(160),
  finish_type: finishTypeSchema,
  color_code: optionalText,
  rate_type: finishRateTypeSchema,
  rate: z.coerce.number().nonnegative().max(10000000).default(0),
  vendor_id: z.string().uuid().optional().nullable().or(z.literal("")),
  is_active: z.coerce.boolean().default(true)
});

export const systemTemplateSchema = z.object({
  template_code: z.string().trim().min(1, "Template code is required").max(60),
  template_name: z.string().trim().min(1, "Template name is required").max(160),
  system_type: systemTypeSchema,
  series_id: z.string().uuid().optional().nullable().or(z.literal("")),
  formula_version: z.coerce.number().int().positive().max(1000).default(1),
  is_default: z.coerce.boolean().default(false),
  is_active: z.coerce.boolean().default(true)
});

export const measurementTypeSchema = z.enum(["brick_to_brick", "frame_outer_size", "finished_size", "manufacturing_size"]);
export const viewDirectionSchema = z.enum(["inside_view", "outside_view"]);

export const systemConfigurationDraftSchema = z.object({
  project_name: z.string().trim().min(1, "Project name is required").max(160),
  customer_id: z.string().uuid().optional().nullable().or(z.literal("")),
  design_reference: z.string().trim().min(1, "Design reference is required").max(40),
  location_label: optionalText,
  width_mm: z.coerce.number().positive("Width must be greater than zero").max(20000),
  height_mm: z.coerce.number().positive("Height must be greater than zero").max(20000),
  quantity: z.coerce.number().int().positive("Quantity must be greater than zero").max(10000),
  measurement_type: measurementTypeSchema,
  view_direction: viewDirectionSchema,
  system_type: systemTypeSchema,
  series_id: z.string().uuid("Select a system series"),
  template_id: z.string().uuid().optional().nullable().or(z.literal("")),
  finish_id: z.string().uuid().optional().nullable().or(z.literal("")),
  glass_id: z.string().uuid().optional().nullable().or(z.literal("")),
  panel_count: z.coerce.number().int().positive().max(12),
  track_count: z.coerce.number().int().positive().max(6),
  panel_layout_json: z.string().trim().min(2, "Panel layout is required"),
  options_json: z.string().trim().min(2, "Options are required"),
  notes: optionalText
}).superRefine((value, ctx) => {
  for (const issue of validateSystemDraftJsonFields(value.panel_layout_json, value.options_json)) {
    ctx.addIssue({ code: "custom", path: [issue.path], message: issue.message });
  }
});

export const templateJsonSchema = z.object({
  formula_json: z.string().trim().min(2, "Formula JSON is required"),
  validation_rules_json: z.string().trim().min(2, "Validation JSON is required"),
  preview_config_json: z.string().trim().min(2, "Preview JSON is required")
});

export function parseJsonObject(value: string, label: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object`);
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : `${label} is invalid JSON`);
  }
}

export function assertSafeFormulaJson(value: Record<string, unknown>) {
  assertValidTemplateFormulaJson(value);
  const errors: string[] = [];

  function visit(node: unknown, path: string[]) {
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, [...path, String(index)]));
      return;
    }

    if (node && typeof node === "object") {
      Object.entries(node as Record<string, unknown>).forEach(([key, child]) => {
        const nextPath = [...path, key];
        if (/formula/i.test(key) && typeof child === "string") {
          const warnings = validateFormulaExpression(child).filter((warning) => warning.severity === "error");
          if (warnings.length) errors.push(`${nextPath.join(".")}: ${warnings[0].message}`);
        }
        visit(child, nextPath);
      });
    }
  }

  visit(value, []);
  if (errors.length) throw new Error(`Unsafe formula JSON: ${errors.join("; ")}`);
}

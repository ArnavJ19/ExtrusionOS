/**
 * PCDA Auto-Routing
 * 
 * Derives the production route from a profile's finish attributes.
 * This is a pure function that takes profile data and returns an ordered list of stages.
 * The route is deterministic: equal inputs produce equal outputs.
 */

export type RouteStep = {
  stage_name: string;
  is_required: boolean;
  department?: string;
};

export type ProfileRoutingInput = {
  powder_coating_allowed?: boolean;
  anodizing_allowed?: boolean;
  wood_finish_allowed?: boolean;
  pvdf_allowed?: boolean;
  special_finish_allowed?: boolean;
  stretching_requirement?: string | null;
  aging_requirement?: string | null;
  quench_method?: string | null;
};

/**
 * Derive production route from profile attributes.
 * Returns an ordered list of production stages.
 */
export function deriveProductionRoute(input: ProfileRoutingInput): RouteStep[] {
  const route: RouteStep[] = [];

  // Core extrusion steps (always present)
  route.push({ stage_name: "Extrusion", is_required: true, department: "Press" });

  // Quenching (always after extrusion)
  if (input.quench_method) {
    route.push({ stage_name: "Quenching", is_required: true, department: "Press" });
  } else {
    route.push({ stage_name: "Quenching", is_required: true, department: "Press" });
  }

  // Stretching
  if (input.stretching_requirement) {
    route.push({ stage_name: "Stretching", is_required: true, department: "Stretcher" });
  }

  // Cutting
  route.push({ stage_name: "Cutting", is_required: true, department: "Cutting" });

  // Aging
  if (input.aging_requirement) {
    route.push({ stage_name: "Aging", is_required: true, department: "Oven" });
  }

  // Surface treatments (conditional based on profile capabilities)
  if (input.powder_coating_allowed) {
    route.push({ stage_name: "Powder Coating", is_required: false, department: "Surface Treatment" });
  }
  if (input.anodizing_allowed) {
    route.push({ stage_name: "Anodizing", is_required: false, department: "Surface Treatment" });
  }
  if (input.wood_finish_allowed) {
    route.push({ stage_name: "Wood Finish", is_required: false, department: "Surface Treatment" });
  }
  if (input.pvdf_allowed) {
    route.push({ stage_name: "PVDF", is_required: false, department: "Surface Treatment" });
  }
  if (input.special_finish_allowed) {
    route.push({ stage_name: "Special Finish", is_required: false, department: "Surface Treatment" });
  }

  // Quality and dispatch (always present)
  route.push({ stage_name: "Quality Inspection", is_required: true, department: "QC" });
  route.push({ stage_name: "Packing", is_required: true, department: "Packing" });
  route.push({ stage_name: "Dispatch", is_required: true, department: "Dispatch" });

  return route;
}

/**
 * Determine which surface treatment stage applies for a given finishing type.
 */
export function getFinishStage(finishingType: string): string | null {
  switch (finishingType) {
    case "powder_coating": return "Powder Coating";
    case "anodizing":
    case "anodized_silver":
    case "anodized_bronze":
    case "anodized_black": return "Anodizing";
    case "wood_finish":
    case "wood_grain": return "Wood Finish";
    case "pvdf": return "PVDF";
    case "mill_finish": return null; // No surface treatment needed
    default: return "Special Finish";
  }
}

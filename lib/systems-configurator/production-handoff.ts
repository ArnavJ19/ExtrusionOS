export type ProductionCutInput = {
  profile_id?: string | null;
  profile_code?: string | null;
  profile_name?: string | null;
  total_weight_kg?: number | string | null;
  total_length_m?: number | string | null;
};

export type ProductionJobGroup = {
  profileId: string;
  profileCode: string;
  profileName: string;
  plannedQuantityKg: number;
  plannedMeters: number;
};

export type ProductionHandoffReadiness = {
  ready: boolean;
  reason: string | null;
};

function round(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function groupProfileCutsForProduction(cuts: ProductionCutInput[]): ProductionJobGroup[] {
  const map = new Map<string, ProductionJobGroup>();
  for (const cut of cuts) {
    if (!cut.profile_id) continue;
    const weight = Number(cut.total_weight_kg ?? 0);
    const meters = Number(cut.total_length_m ?? 0);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    const existing = map.get(cut.profile_id);
    if (existing) {
      existing.plannedQuantityKg = round(existing.plannedQuantityKg + weight);
      existing.plannedMeters = round(existing.plannedMeters + (Number.isFinite(meters) ? meters : 0), 2);
    } else {
      map.set(cut.profile_id, { profileId: cut.profile_id, profileCode: cut.profile_code ?? "Profile", profileName: cut.profile_name ?? "Profile", plannedQuantityKg: round(weight), plannedMeters: round(Number.isFinite(meters) ? meters : 0, 2) });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.profileCode.localeCompare(b.profileCode));
}

export function getProductionHandoffReadiness(configuration: { status?: string | null; customer_id?: string | null; order_id?: string | null }, jobGroups: ProductionJobGroup[], existingJobCount = 0): ProductionHandoffReadiness {
  if (configuration.order_id && existingJobCount > 0) return { ready: false, reason: "Production handoff already exists for this configuration." };
  if (!configuration.customer_id) return { ready: false, reason: "Link a customer before creating production jobs." };
  if (!["calculated", "quoted", "approved", "converted_to_order"].includes(configuration.status ?? "")) return { ready: false, reason: "Calculate and approve the configuration before production handoff." };
  if (!jobGroups.length) return { ready: false, reason: "At least one profile cut with positive weight is required for production jobs." };
  return { ready: true, reason: null };
}

export function buildProductionJobRemarks(configurationNumber: string | null | undefined, designReference: string | null | undefined) {
  return `System configuration ${configurationNumber ?? "Draft"}${designReference ? ` / ${designReference}` : ""}`;
}

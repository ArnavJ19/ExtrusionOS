import type { BeadingCut, GlassCut, HardwareBomItem, MaterialSummary, ProfileCut, SystemConfigurationInput } from "./types.ts";
import { round } from "./types.ts";

function addMaterialSummary(map: Map<string, MaterialSummary>, item: MaterialSummary) {
  const key = [item.materialType, item.itemId ?? "", item.itemCode ?? item.itemName, item.unit, item.rate].join("|");
  const existing = map.get(key);
  if (existing) {
    existing.quantity = round(existing.quantity + item.quantity);
    existing.totalWeightKg = round(existing.totalWeightKg + item.totalWeightKg);
    existing.totalLengthM = round(existing.totalLengthM + item.totalLengthM);
    existing.totalAreaSqft = round(existing.totalAreaSqft + item.totalAreaSqft);
    existing.totalAreaSqm = round(existing.totalAreaSqm + item.totalAreaSqm);
    existing.amount = round(existing.amount + item.amount, 2);
  } else {
    map.set(key, { ...item, quantity: round(item.quantity), amount: round(item.amount, 2) });
  }
}

export function buildMaterialSummary(input: SystemConfigurationInput, profileCuts: ProfileCut[], beadingCuts: BeadingCut[], glassCuts: GlassCut[], hardwareBom: HardwareBomItem[]) {
  const map = new Map<string, MaterialSummary>();

  for (const cut of profileCuts) {
    addMaterialSummary(map, { materialType: "aluminium_profile", itemId: cut.profileId, itemCode: cut.profileCode, itemName: cut.profileName, quantity: cut.quantity, unit: "m", totalWeightKg: cut.totalWeightKg, totalLengthM: cut.totalLengthM, totalAreaSqft: 0, totalAreaSqm: 0, rate: input.costing.aluminiumRatePerKg, amount: cut.totalWeightKg * input.costing.aluminiumRatePerKg });
  }

  for (const cut of beadingCuts) {
    addMaterialSummary(map, { materialType: "aluminium_profile", itemId: cut.profileId, itemCode: cut.profileCode, itemName: cut.profileName ?? "Glazing bead", quantity: cut.quantity, unit: "m", totalWeightKg: cut.totalWeightKg, totalLengthM: cut.totalLengthM, totalAreaSqft: 0, totalAreaSqm: 0, rate: input.costing.aluminiumRatePerKg, amount: cut.totalWeightKg * input.costing.aluminiumRatePerKg });
  }

  for (const glass of glassCuts) {
    addMaterialSummary(map, { materialType: "glass", itemId: glass.glassId, itemCode: input.selectedGlass?.glassCode, itemName: input.selectedGlass?.glassName ?? "Glass", quantity: glass.quantity, unit: "sqft", totalWeightKg: 0, totalLengthM: 0, totalAreaSqft: glass.areaSqft, totalAreaSqm: glass.areaSqm, rate: glass.rate, amount: glass.amount });
  }

  for (const hardware of hardwareBom) {
    addMaterialSummary(map, { materialType: hardware.hardwareCategory === "gasket" ? "gasket" : "hardware", itemId: hardware.hardwareItemId, itemCode: hardware.itemCode, itemName: hardware.itemName, quantity: hardware.quantity, unit: hardware.unit, totalWeightKg: 0, totalLengthM: ["m", "meter", "metre"].includes(hardware.unit.toLowerCase()) ? hardware.quantity : 0, totalAreaSqft: 0, totalAreaSqm: 0, rate: hardware.rate, amount: hardware.amount });
  }

  return Array.from(map.values());
}

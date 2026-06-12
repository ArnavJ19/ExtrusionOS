const ALUMINIUM_DENSITY_KG_PER_M3 = 2700;

export function calculateBilletWeightKg(lengthMm: number, diameterMm: number, densityKgPerM3 = ALUMINIUM_DENSITY_KG_PER_M3) {
  if (lengthMm <= 0 || diameterMm <= 0) return 0;

  const radiusM = diameterMm / 2000;
  const lengthM = lengthMm / 1000;
  const volumeM3 = Math.PI * radiusM * radiusM * lengthM;

  return Number((volumeM3 * densityKgPerM3).toFixed(3));
}

export function calculateTotalBilletWeightKg(lengthMm: number, diameterMm: number, billetCount: number, densityKgPerM3 = ALUMINIUM_DENSITY_KG_PER_M3) {
  if (billetCount <= 0) return 0;
  return Number((calculateBilletWeightKg(lengthMm, diameterMm, densityKgPerM3) * billetCount).toFixed(3));
}

export function inchesToMm(inches: number) {
  if (inches <= 0) return 0;
  return Number((inches * 25.4).toFixed(2));
}

export function calculateRequiredBilletCount(requiredKg: number, billetWeightKg: number, efficiencyPercent = 75) {
  if (requiredKg <= 0 || billetWeightKg <= 0 || efficiencyPercent <= 0) return 0;
  return Math.ceil((requiredKg / (efficiencyPercent / 100)) / billetWeightKg);
}

export function calculateFoundryFurnaceMix(totalBilletWeightKg: number, furnaceEfficiencyPercent = 80, scrapPercentage = 0, externalAluminiumPercentage = 100) {
  if (totalBilletWeightKg <= 0 || furnaceEfficiencyPercent <= 0) {
    return { requiredFurnaceChargeKg: 0, scrapAluminiumKg: 0, externalAluminiumKg: 0 };
  }

  const requiredFurnaceChargeKg = Number((totalBilletWeightKg / (furnaceEfficiencyPercent / 100)).toFixed(3));
  return {
    requiredFurnaceChargeKg,
    scrapAluminiumKg: Number((requiredFurnaceChargeKg * (scrapPercentage / 100)).toFixed(3)),
    externalAluminiumKg: Number((requiredFurnaceChargeKg * (externalAluminiumPercentage / 100)).toFixed(3))
  };
}

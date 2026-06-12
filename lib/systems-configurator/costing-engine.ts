import type { CostingSummary, MaterialSummary, SystemFinishSelection } from "./types.ts";

export type CostingEngineInput = {
  materialSummary: MaterialSummary[];
  totalProfileWeightKg: number;
  totalProfileLengthM: number;
  totalGlassAreaSqft: number;
  totalGlassAreaSqm: number;
  quantity: number;
  openingWidthMm: number;
  openingHeightMm: number;
  aluminiumRatePerKg: number;
  selectedFinish?: SystemFinishSelection;
  fabrication: {
    rateType: "fixed" | "per_sqft" | "per_sqm" | "per_kg" | "per_window";
    rate: number;
  };
  installation: {
    enabled: boolean;
    rateType: "fixed" | "per_sqft" | "per_sqm" | "per_unit";
    rate: number;
  };
  transport: {
    type: "fixed" | "percentage" | "manual";
    amount: number;
  };
  aluminiumWastagePercent: number;
  glassWastagePercent: number;
  marginPercent: number;
  dealerMarginPercent?: number;
  discountAmount: number;
  gstPercent: number;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function amountByRateType(rateType: CostingEngineInput["fabrication"]["rateType"], rate: number, input: CostingEngineInput) {
  const openingAreaSqm = (input.openingWidthMm * input.openingHeightMm * input.quantity) / 1_000_000;
  const openingAreaSqft = openingAreaSqm * 10.7639;

  if (rateType === "fixed") return rate;
  if (rateType === "per_sqft") return openingAreaSqft * rate;
  if (rateType === "per_sqm") return openingAreaSqm * rate;
  if (rateType === "per_kg") return input.totalProfileWeightKg * rate;
  return input.quantity * rate;
}

function installationAmount(input: CostingEngineInput) {
  if (!input.installation.enabled) return 0;
  const openingAreaSqm = (input.openingWidthMm * input.openingHeightMm * input.quantity) / 1_000_000;
  const openingAreaSqft = openingAreaSqm * 10.7639;

  if (input.installation.rateType === "fixed") return input.installation.rate;
  if (input.installation.rateType === "per_sqft") return openingAreaSqft * input.installation.rate;
  if (input.installation.rateType === "per_sqm") return openingAreaSqm * input.installation.rate;
  return input.quantity * input.installation.rate;
}

function finishAmount(input: CostingEngineInput) {
  const finish = input.selectedFinish;
  if (!finish) return 0;
  if (finish.rateType === "per_kg") return input.totalProfileWeightKg * finish.rate;
  if (finish.rateType === "per_meter") return input.totalProfileLengthM * finish.rate;
  if (finish.rateType === "per_sqft") return input.totalGlassAreaSqft * finish.rate;
  if (finish.rateType === "per_sqm") return input.totalGlassAreaSqm * finish.rate;
  return finish.rate;
}

export function calculateSystemCosting(input: CostingEngineInput): CostingSummary {
  const aluminiumBaseCost = input.totalProfileWeightKg * input.aluminiumRatePerKg;
  const aluminiumWastageAmount = aluminiumBaseCost * (input.aluminiumWastagePercent / 100);
  const glassCost = input.materialSummary.filter((item) => item.materialType === "glass").reduce((sum, item) => sum + item.amount, 0);
  const glassWastageAmount = glassCost * (input.glassWastagePercent / 100);
  const hardwareCost = input.materialSummary.filter((item) => item.materialType === "hardware").reduce((sum, item) => sum + item.amount, 0);
  const gasketCost = input.materialSummary.filter((item) => item.materialType === "gasket").reduce((sum, item) => sum + item.amount, 0);
  const fabricationCost = amountByRateType(input.fabrication.rateType, input.fabrication.rate, input);
  const installationCost = installationAmount(input);
  const finishCost = finishAmount(input);
  const subtotalBeforeTransport = aluminiumBaseCost + aluminiumWastageAmount + glassCost + glassWastageAmount + hardwareCost + gasketCost + finishCost + fabricationCost + installationCost;
  const transportCost = input.transport.type === "percentage" ? subtotalBeforeTransport * (input.transport.amount / 100) : input.transport.amount;
  const internalCost = subtotalBeforeTransport + transportCost;
  const marginBasePercent = input.marginPercent + (input.dealerMarginPercent ?? 0);
  const marginAmount = internalCost * (marginBasePercent / 100);
  const subtotalBeforeGst = Math.max(internalCost + marginAmount - input.discountAmount, 0);
  const gstAmount = subtotalBeforeGst * (input.gstPercent / 100);
  const grandTotal = subtotalBeforeGst + gstAmount;
  const openingAreaSqm = (input.openingWidthMm * input.openingHeightMm * input.quantity) / 1_000_000;
  const openingAreaSqft = openingAreaSqm * 10.7639;

  return {
    aluminiumCost: roundMoney(aluminiumBaseCost),
    finishCost: roundMoney(finishCost),
    glassCost: roundMoney(glassCost + glassWastageAmount),
    hardwareCost: roundMoney(hardwareCost),
    gasketCost: roundMoney(gasketCost),
    fabricationCost: roundMoney(fabricationCost),
    installationCost: roundMoney(installationCost),
    transportCost: roundMoney(transportCost),
    wastageAmount: roundMoney(aluminiumWastageAmount + glassWastageAmount),
    internalCost: roundMoney(internalCost),
    marginAmount: roundMoney(marginAmount),
    discountAmount: roundMoney(input.discountAmount),
    subtotalBeforeGst: roundMoney(subtotalBeforeGst),
    gstAmount: roundMoney(gstAmount),
    grandTotal: roundMoney(grandTotal),
    pricePerSqft: roundMoney(openingAreaSqft > 0 ? grandTotal / openingAreaSqft : 0),
    pricePerSqm: roundMoney(openingAreaSqm > 0 ? grandTotal / openingAreaSqm : 0),
    pricePerUnit: roundMoney(input.quantity > 0 ? grandTotal / input.quantity : 0),
    profitPercent: roundMoney(internalCost > 0 ? (marginAmount / internalCost) * 100 : 0)
  };
}

const closedProductionOrderStages = new Set(["closed", "cancelled", "delivered", "payment_pending"]);

export function isProductionOrderStageOpenForPlanning(stage: unknown) {
  return !closedProductionOrderStages.has(String(stage ?? ""));
}

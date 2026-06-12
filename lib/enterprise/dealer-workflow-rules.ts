export type ReceiptClassification = "received_confirmed" | "discrepancy_reported";

export function classifyReceiptLine(expectedQuantity: number, reportedReceivedQuantity: number): ReceiptClassification {
  return expectedQuantity === reportedReceivedQuantity ? "received_confirmed" : "discrepancy_reported";
}

export function calculateDifference(expectedQuantity: number, reportedReceivedQuantity: number) {
  return reportedReceivedQuantity - expectedQuantity;
}

export function canAccessDealerRecord(actorDealerId: string | null | undefined, recordDealerId: string, hasOwnerPermission: boolean) {
  return hasOwnerPermission || (!!actorDealerId && actorDealerId === recordDealerId);
}

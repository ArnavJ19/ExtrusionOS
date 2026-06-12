type DealerStock = { profileId: string; kg: number };
type QuoteInput = { id: string; dealerId: string; profileId: string; requiredKg: number };

export function simulateDealerQuoteToReceiptWorkflow(input: { quote: QuoteInput; stock: DealerStock; producedKg: number; dispatchedKg: number; receivedKg: number }) {
  if (input.quote.dealerId.length === 0) throw new Error("Dealer quote must have dealer ownership");
  if (input.stock.profileId !== input.quote.profileId) throw new Error("Dealer stock profile must match quoted profile");

  const quoteStatus = "converted_to_order";
  const autoFulfilledKg = Math.min(input.stock.kg, input.quote.requiredKg);
  const stockAfterOrder = input.stock.kg - autoFulfilledKg;
  const factoryRequiredKg = input.quote.requiredKg - autoFulfilledKg;
  const productionStatus = input.producedKg >= factoryRequiredKg ? "production_completed" : "in_production";
  const shipmentStatus = input.dispatchedKg > 0 ? "pending_dealer_count" : "packed";
  const receiptStatus = input.receivedKg === input.dispatchedKg ? "received_confirmed" : "discrepancy_reported";
  const finalDealerStockKg = receiptStatus === "received_confirmed" ? stockAfterOrder + input.receivedKg : stockAfterOrder;

  return {
    quoteStatus,
    orderDealerId: input.quote.dealerId,
    orderStatus: factoryRequiredKg > 0 ? "in_production" : "accepted_by_factory",
    autoFulfilledKg,
    stockAfterOrder,
    factoryRequiredKg,
    productionStatus,
    shipmentStatus,
    receiptStatus,
    finalDealerStockKg
  };
}

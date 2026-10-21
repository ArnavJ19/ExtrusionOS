export const quoteConfirmationStages = ["approved_for_sending", "sent", "customer_approved"];

export function quotePreparationIssues(items: Array<{ costing_complete?: boolean | null }>) {
  if (!items.length) return ["Add at least one quotation item before confirmation."];
  return items.flatMap((item, index) => item.costing_complete === false
    ? [`Item ${index + 1}: complete recovery, margin and the applicable finishing-area information before confirmation.`]
    : item.costing_complete == null ? [`Item ${index + 1}: costing completeness must be verified before confirmation.`] : []);
}

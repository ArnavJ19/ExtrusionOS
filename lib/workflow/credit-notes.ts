export type CreditNoteIssueAttempt = {
  dispatchId: string;
  reversedCreditNoteId: string | null;
  idempotencyKey: string;
};

export function canIssueDispatchCreditNote(input: {
  canManage: boolean;
  deliveryStatus: string;
  invoiceStatus: string | null;
  creditNoteStatus: string | null;
}) {
  return input.canManage
    && ["returned", "damaged"].includes(input.deliveryStatus)
    && input.invoiceStatus !== null
    && ["generated", "sent", "partially_paid", "paid", "overdue", "credited"].includes(input.invoiceStatus)
    && (input.creditNoteStatus === null || input.creditNoteStatus === "reversed");
}

export function prepareCreditNoteIssueAttempt(
  previous: CreditNoteIssueAttempt | null,
  dispatchId: string,
  reversedCreditNoteId: string | null,
  createKey: () => string
): CreditNoteIssueAttempt {
  if (previous?.dispatchId === dispatchId && previous.reversedCreditNoteId === reversedCreditNoteId) return previous;
  return { dispatchId, reversedCreditNoteId, idempotencyKey: createKey() };
}

// Receivable semantics shared by invoice detail, report exports and PDFs. They mirror
// private.recalculate_invoice_collection_state and get_financial_collection_events:
//   * only PAID receipts count; CANCELLED (reversed) rows never do;
//   * REFUND rows are money paid back to the customer and count negatively;
//   * credit_note-method ADJUSTMENT rows settle the invoice but are not cash collections;
//   * issued return credit notes reduce the receivable separately from receipts.

export type ReceivablePayment = {
  id: string;
  payment_date: string | null;
  amount: number | string | null;
  payment_method: string | null;
  payment_type: string | null;
  payment_status: string | null;
  reference_number?: string | null;
};

export type ReceivableCreditNote = {
  id: string;
  credit_note_number: string | null;
  credit_date: string | null;
  grand_total: number | string | null;
  status: string | null;
  dispatch_id?: string | null;
};

const paise = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
};

export function isPostedPayment(payment: Pick<ReceivablePayment, "payment_status">) {
  return payment.payment_status === "PAID";
}

export function isRefund(payment: Pick<ReceivablePayment, "payment_type">) {
  return payment.payment_type === "REFUND";
}

export function isCreditAdjustment(payment: Pick<ReceivablePayment, "payment_method" | "payment_type">) {
  return payment.payment_method === "credit_note" || payment.payment_type === "ADJUSTMENT";
}

/** Signed effect on the invoice's net receipts (amount_paid). */
export function signedSettlementAmount(payment: ReceivablePayment) {
  if (!isPostedPayment(payment)) return 0;
  const amount = paise(payment.amount) / 100;
  return isRefund(payment) ? -amount : amount;
}

/** Signed cash collection, as reported by collection analytics (adjustments excluded). */
export function signedCollectionAmount(payment: ReceivablePayment) {
  if (!isPostedPayment(payment) || payment.payment_method === "credit_note") return 0;
  return signedSettlementAmount(payment);
}

export type SettlementEntry = {
  kind: "payment" | "credit_note";
  id: string;
  date: string | null;
  label: string;
  reference: string | null;
  status: string;
  effective: boolean;
  balanceEffect: number;
  href: string | null;
  pdfHref: string | null;
};

export function reconcileInvoiceSettlement(
  invoice: { grand_total: unknown; balance_due?: unknown; amount_paid?: unknown; credited_amount?: unknown },
  payments: ReceivablePayment[],
  creditNotes: ReceivableCreditNote[]
) {
  let cash = 0, adjustments = 0, refunds = 0, credited = 0;
  const entries: SettlementEntry[] = [];
  for (const payment of payments) {
    const amount = paise(payment.amount);
    const effective = isPostedPayment(payment);
    if (effective) {
      if (isRefund(payment)) refunds += amount;
      else if (isCreditAdjustment(payment)) adjustments += amount;
      else cash += amount;
    }
    entries.push({
      kind: "payment", id: payment.id, date: payment.payment_date,
      label: isRefund(payment) ? "Customer refund paid" : isCreditAdjustment(payment) ? "Credit adjustment" : "Customer receipt",
      reference: payment.reference_number ?? null, status: payment.payment_status ?? "unknown", effective,
      balanceEffect: effective ? (isRefund(payment) ? amount : -amount) / 100 : 0,
      href: `/payments/${payment.id}`, pdfHref: null
    });
  }
  for (const note of creditNotes) {
    const amount = paise(note.grand_total);
    const effective = note.status === "issued";
    if (effective) credited += amount;
    entries.push({
      kind: "credit_note", id: note.id, date: note.credit_date, label: `Return credit note ${note.credit_note_number ?? ""}`.trim(),
      reference: note.credit_note_number, status: note.status ?? "unknown", effective, balanceEffect: effective ? -amount / 100 : 0,
      href: note.dispatch_id ? `/dispatches/${note.dispatch_id}` : null, pdfHref: `/api/pdf/credit-note/${note.id}`
    });
  }
  const total = paise(invoice.grand_total);
  const netReceipts = cash + adjustments - refunds;
  const balance = Math.max(total - netReceipts - credited, 0);
  const creditDue = Math.max(netReceipts + credited - total, 0);
  entries.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  return {
    total: total / 100,
    cashReceipts: cash / 100,
    adjustments: adjustments / 100,
    refunds: refunds / 100,
    creditNotes: credited / 100,
    netReceipts: netReceipts / 100,
    balance: balance / 100,
    customerCreditDue: creditDue / 100,
    matchesStoredBalance: invoice.balance_due == null || paise(invoice.balance_due) === balance,
    entries
  };
}

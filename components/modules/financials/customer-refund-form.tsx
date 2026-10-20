"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { recordCustomerRefundAction } from "@/lib/actions/payments";
import { nextIdempotentAttempt } from "@/lib/financials/expenses";
import { formatCurrency } from "@/lib/utils/format";

const methods = [["bank_transfer", "Bank transfer"], ["upi", "UPI"], ["cheque", "Cheque"], ["cash", "Cash"], ["other", "Other"]] as const;

// Records money paid back to a customer against customer credit due (AR-02). The refund is
// a signed collection event: it reduces cash received and clears the credit due.
export function CustomerRefundForm({ invoiceId, creditDue, creditNoteId = null, today }: {
  invoiceId: string;
  creditDue: number;
  creditNoteId?: string | null;
  today: string;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(creditDue));
  const [refundDate, setRefundDate] = useState(today);
  const [method, setMethod] = useState<(typeof methods)[number][0]>("bank_transfer");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const attempt = useRef<{ requestKey: string; idempotencyKey: string } | null>(null);
  if (creditDue <= 0) return null;
  const referenceRequired = method !== "cash" && method !== "other";

  function submit() {
    const payload = { invoice_id: invoiceId, amount: Number(amount), refund_date: refundDate, payment_method: method,
      reference_number: reference, notes: reason, credit_note_id: creditNoteId };
    attempt.current = nextIdempotentAttempt(attempt.current, JSON.stringify(payload), () => crypto.randomUUID());
    const idempotencyKey = attempt.current.idempotencyKey;
    startTransition(async () => {
      const result = await recordCustomerRefundAction({ ...payload, idempotency_key: idempotencyKey });
      if (!result.success) { toast.error(result.error); return; }
      toast.success(`Refund recorded. Remaining customer credit due is ${formatCurrency(result.data.customer_credit_due)}.`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-center gap-2"><Banknote className="h-5 w-5 text-amber-700" /><p className="font-black text-amber-950">Record customer refund ({formatCurrency(creditDue)} due)</p></div>
      <p className="text-sm font-medium text-amber-900">Record money actually paid back to the customer. It reduces cash received on the invoice and clears the refund due.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block space-y-1.5"><span className="form-label">Refund amount *</span><input className="form-input" type="number" min="0.01" step="0.01" max={creditDue} value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label className="block space-y-1.5"><span className="form-label">Refund date *</span><input className="form-input" type="date" max={today} value={refundDate} onChange={(event) => setRefundDate(event.target.value)} /></label>
        <label className="block space-y-1.5"><span className="form-label">Paid by *</span><select className="form-input" value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>{methods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="block space-y-1.5"><span className="form-label">Reference{referenceRequired ? " *" : ""}</span><input className="form-input" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="UTR or cheque number" /></label>
        <label className="block space-y-1.5 md:col-span-2"><span className="form-label">Refund reason *</span><input className="form-input" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Refund of returned dispatch value" /></label>
      </div>
      <Button disabled={pending || Number(amount) <= 0 || Number(amount) > creditDue || reason.trim().length < 5 || (referenceRequired && !reference.trim())} onClick={submit}>{pending ? "Recording..." : "Record refund paid"}</Button>
    </div>
  );
}

"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileMinus2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { issueDispatchCreditNoteAction, reverseCreditNoteAction } from "@/lib/actions/credit-notes";
import { formatCurrency } from "@/lib/utils/format";

type Props = {
  dispatchId: string;
  deliveryStatus: string;
  invoice: { id: string; invoice_number: string | null; grand_total: number; amount_paid: number; credited_amount?: number; customer_credit_due?: number; status: string } | null;
  creditNote: { id: string; credit_note_number: string; grand_total: number; status: string; reason: string; reversal_reason?: string | null } | null;
  canManage: boolean;
};

export function DispatchCreditNoteClient({ dispatchId, deliveryStatus, invoice, creditNote, canManage }: Props) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [reversalReason, setReversalReason] = useState("");
  const idempotencyKey = useRef(crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  if (!invoice && !creditNote) return null;

  const returnStatus = ["returned", "damaged"].includes(deliveryStatus);
  function issue() {
    startTransition(async () => {
      const result = await issueDispatchCreditNoteAction({ dispatch_id: dispatchId, reason, idempotency_key: idempotencyKey.current });
      if (!result.success) { toast.error(result.error); return; }
      toast.success("Credit note issued and receivable adjusted");
      router.refresh();
    });
  }
  function reverse() {
    if (!creditNote) return;
    startTransition(async () => {
      const result = await reverseCreditNoteAction({ credit_note_id: creditNote.id, dispatch_id: dispatchId, reason: reversalReason });
      if (!result.success) { toast.error(result.error); return; }
      toast.success("Credit note reversed and invoice receivable restored");
      router.refresh();
    });
  }

  return <Card className="border-slate-200 shadow-sm"><CardHeader><div className="flex items-center gap-3"><FileMinus2 className="h-6 w-6 text-orange" /><div><h2 className="section-title">Return Accounting</h2><p className="mt-1 text-sm font-medium text-slate-500">The original invoice remains intact. Credit notes separately reduce the receivable and expose any refund owed.</p></div></div></CardHeader><CardContent className="space-y-4">
    {invoice ? <div className="grid gap-3 rounded-2xl bg-slate-950 p-4 text-white sm:grid-cols-4"><Metric label="Invoice" value={invoice.invoice_number ?? invoice.id.slice(0, 8)} /><Metric label="Invoice total" value={formatCurrency(invoice.grand_total)} /><Metric label="Received" value={formatCurrency(invoice.amount_paid)} /><Metric label="Customer refund due" value={formatCurrency(invoice.customer_credit_due ?? 0)} /></div> : null}
    {creditNote ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="font-black text-emerald-950">{creditNote.credit_note_number} | {formatCurrency(creditNote.grand_total)} | {creditNote.status}</p><p className="mt-1 text-sm font-medium text-emerald-800">{creditNote.reason}</p>{creditNote.reversal_reason ? <p className="mt-2 text-sm font-bold text-amber-800">Reversal: {creditNote.reversal_reason}</p> : null}</div> : null}
    {canManage && returnStatus && invoice && !creditNote ? <div className="space-y-3"><label className="block space-y-1.5"><span className="form-label">Credit note reason *</span><textarea className="form-input min-h-20" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Full dispatch returned due to transit damage..." /></label><Button disabled={pending || reason.trim().length < 8} onClick={issue}><FileMinus2 className="mr-2 h-4 w-4" /> Issue full dispatch credit note</Button></div> : null}
    {canManage && creditNote?.status === "issued" ? <div className="space-y-3 border-t border-slate-200 pt-4"><label className="block space-y-1.5"><span className="form-label">Credit note reversal reason *</span><input className="form-input" value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} /></label><Button variant="secondary" disabled={pending || reversalReason.trim().length < 8} onClick={reverse}><RotateCcw className="mr-2 h-4 w-4" /> Reverse credit note</Button></div> : null}
  </CardContent></Card>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[11px] font-black uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-base font-black">{value}</p></div>;
}

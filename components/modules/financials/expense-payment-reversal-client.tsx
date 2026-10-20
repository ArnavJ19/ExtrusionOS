"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { reverseExpensePaymentAction } from "@/lib/actions/expenses";
import { nextIdempotentAttempt } from "@/lib/financials/expenses";
import { formatDate } from "@/lib/utils/format";

export function ExpensePaymentReversalClient({ payment, canReverse }: {
  payment: { id: string; expense_ledger_id: string; status: string; reversal_reason: string | null; reversed_at: string | null };
  canReverse: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const attempt = useRef<{ requestKey: string; idempotencyKey: string } | null>(null);

  function reverse() {
    attempt.current = nextIdempotentAttempt(attempt.current, reason.trim(), () => crypto.randomUUID());
    const idempotencyKey = attempt.current.idempotencyKey;
    startTransition(async () => {
      const result = await reverseExpensePaymentAction({ id: payment.id, reason, idempotency_key: idempotencyKey });
      if (!result.success) { toast.error(result.error); return; }
      toast.success("Supplier payment reversed. Post a corrected payment if needed.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="section-title">Payment Control</h2><p className="mt-1 text-sm font-medium text-slate-500">Posted supplier payments are never edited. Reverse a mistaken entry with a reason, then record the correct payment.</p></div>
          <div className="flex flex-wrap gap-2">
            <a className="inline-flex items-center gap-2 rounded-2xl border border-neutral-200 px-4 py-2.5 text-sm font-semibold" href={`/api/pdf/expense-payment/${payment.id}`} target="_blank" rel="noreferrer"><FileText className="h-4 w-4" /> Payment voucher PDF</a>
            <Link className="inline-flex items-center rounded-2xl border border-neutral-200 px-4 py-2.5 text-sm font-semibold" href={`/expenses/${payment.expense_ledger_id}`}>Open expense</Link>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {payment.status === "reversed" ? (
          <p className="text-sm font-semibold text-amber-800">Reversed {formatDate(payment.reversed_at)}: {payment.reversal_reason}</p>
        ) : canReverse ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block min-w-64 flex-1 space-y-1.5"><span className="form-label">Reversal reason *</span><input className="form-input" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Cheque bounced / posted against wrong bill..." /></label>
            <Button variant="secondary" disabled={pending || reason.trim().length < 5} onClick={reverse}><RotateCcw className="mr-2 h-4 w-4" /> Reverse payment</Button>
          </div>
        ) : <p className="text-sm font-medium text-slate-500">Only finance users can reverse supplier payments.</p>}
      </CardContent>
    </Card>
  );
}

"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileText, ReceiptIndianRupee, RotateCcw, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  recordSupplierCreditAction, reverseExpensePaymentAction, reverseSupplierCreditAction, transitionExpenseApprovalAction
} from "@/lib/actions/expenses";
import {
  availableExpenseActions, canPayExpense, expenseSettlement, nextIdempotentAttempt, referenceRequiredMethods,
  supplierPaymentMethods, type ExpenseApprovalAction
} from "@/lib/financials/expenses";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { labelize } from "@/types/app";

export type ExpensePanelExpense = {
  id: string;
  expense_number: string;
  approval_status: string;
  payment_status: string;
  total_amount: number;
  amount_paid: number;
  refunded_amount: number;
  credited_amount: number;
  balance_amount: number;
  supplier_credit_due: number;
  source_table: string | null;
  deleted_at: string | null;
  approval_note: string | null;
};
export type ExpensePanelPayment = { id: string; payment_date: string; amount_paid: number; payment_method: string | null; reference_number: string | null; status: string; reversal_reason: string | null };
export type ExpensePanelCredit = { id: string; credit_type: string; credit_date: string; amount: number; payment_method: string | null; reference_number: string | null; reason: string; status: string; reversal_reason: string | null };

const actionLabels: Record<ExpenseApprovalAction, string> = {
  submit: "Submit for approval",
  approve: "Approve",
  reject: "Reject",
  reopen: "Reopen for correction",
  cancel: "Cancel expense"
};

export function ExpenseControlPanel({ expense, payments, credits, role, today }: {
  expense: ExpensePanelExpense;
  payments: ExpensePanelPayment[];
  credits: ExpensePanelCredit[];
  role: string;
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [creditType, setCreditType] = useState<"credit_note" | "refund">("credit_note");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditDate, setCreditDate] = useState(today);
  const [creditMethod, setCreditMethod] = useState("bank_transfer");
  const [creditReference, setCreditReference] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [reversalReason, setReversalReason] = useState<Record<string, string>>({});
  const creditAttempt = useRef<{ requestKey: string; idempotencyKey: string } | null>(null);
  const reversalAttempts = useRef<Record<string, { requestKey: string; idempotencyKey: string }>>({});
  const settlement = expenseSettlement(expense);
  const actions = availableExpenseActions({ ...expense, role });
  const finance = ["owner", "admin", "accounts"].includes(role);

  function run(task: () => Promise<{ success: boolean; error?: string }>, done: string) {
    startTransition(async () => {
      const result = await task();
      if (!result.success) { toast.error(result.error ?? "Request failed"); return; }
      toast.success(done);
      router.refresh();
    });
  }

  function transition(action: ExpenseApprovalAction) {
    run(() => transitionExpenseApprovalAction({ expense_id: expense.id, action, note: note || null }), `${actionLabels[action]} recorded`);
  }

  function postCredit() {
    const payload = { expense_id: expense.id, credit_type: creditType, amount: Number(creditAmount), credit_date: creditDate,
      payment_method: creditType === "refund" ? creditMethod as typeof supplierPaymentMethods[number] : null,
      reference_number: creditReference, reason: creditReason };
    creditAttempt.current = nextIdempotentAttempt(creditAttempt.current, JSON.stringify(payload), () => crypto.randomUUID());
    const idempotencyKey = creditAttempt.current.idempotencyKey;
    run(() => recordSupplierCreditAction({ ...payload, idempotency_key: idempotencyKey }),
      creditType === "credit_note" ? "Supplier credit note posted" : "Supplier refund posted");
  }

  function reverse(kind: "payment" | "credit", entryId: string) {
    const reason = (reversalReason[entryId] ?? "").trim();
    const attempt = nextIdempotentAttempt(reversalAttempts.current[entryId] ?? null, reason, () => crypto.randomUUID());
    reversalAttempts.current[entryId] = attempt;
    run(() => (kind === "payment" ? reverseExpensePaymentAction : reverseSupplierCreditAction)({ id: entryId, reason, idempotency_key: attempt.idempotencyKey }),
      kind === "payment" ? "Supplier payment reversed" : "Supplier credit reversed");
  }

  const needsNote = actions.some((action) => ["reject", "reopen", "cancel"].includes(action));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3"><ReceiptIndianRupee className="h-6 w-6 text-orange" /><div><h2 className="section-title">Payable Settlement</h2><p className="mt-1 text-sm font-medium text-slate-500">Balances are derived from posted supplier payments, refunds and credit notes. Entries are reversed, never edited.</p></div></div>
            <div className="flex flex-wrap gap-2">
              <a className="inline-flex items-center gap-2 rounded-2xl border border-neutral-200 px-4 py-2.5 text-sm font-semibold" href={`/api/pdf/expense/${expense.id}`} target="_blank" rel="noreferrer"><FileText className="h-4 w-4" /> Expense voucher PDF</a>
              {finance && canPayExpense(expense) ? <Link className="inline-flex items-center rounded-2xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white" href={`/expenses/payments/new?expense_id=${expense.id}`}>Record supplier payment</Link> : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 rounded-2xl bg-slate-950 p-4 text-white sm:grid-cols-3 xl:grid-cols-6">
            <Metric label="Expense total" value={formatCurrency(settlement.total)} />
            <Metric label="Paid to supplier" value={formatCurrency(settlement.paid)} />
            <Metric label="Refunded by supplier" value={formatCurrency(settlement.refunded)} />
            <Metric label="Supplier credit notes" value={formatCurrency(settlement.credited)} />
            <Metric label="Balance payable" value={formatCurrency(settlement.balance)} />
            <Metric label="Supplier credit due" value={formatCurrency(settlement.supplierCreditDue)} />
          </div>
          {expense.approval_status !== "approved" ? <p className="text-sm font-semibold text-amber-800">Supplier payments and credits can be posted only after this expense is approved.</p> : null}
        </CardContent>
      </Card>

      {finance ? (
        <Card>
          <CardHeader><div className="flex items-center gap-3"><CheckCircle2 className="h-6 w-6 text-orange" /><div><h2 className="section-title">Approval</h2><p className="mt-1 text-sm font-medium text-slate-500">Expenses above Rs 25,000 need owner or admin approval. Approved expenses are locked until an owner or admin reopens them with a reason.</p></div></div></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-slate-600">Current state</span><Badge value={expense.approval_status} />{expense.approval_note ? <span className="text-sm font-medium text-slate-600">Note: {expense.approval_note}</span> : null}</div>
            {actions.length ? (
              <>
                {needsNote ? <label className="block space-y-1.5"><span className="form-label">Reason (required to reject, reopen or cancel)</span><input className="form-input" value={note} onChange={(event) => setNote(event.target.value)} /></label> : null}
                <div className="flex flex-wrap gap-2">
                  {actions.map((action) => (
                    <Button key={action} variant={action === "approve" || action === "submit" ? "primary" : "secondary"} disabled={pending || (["reject", "reopen", "cancel"].includes(action) && note.trim().length < 5)} onClick={() => transition(action)}>{actionLabels[action]}</Button>
                  ))}
                </div>
              </>
            ) : <p className="text-sm font-medium text-slate-500">No approval action is available for your role in this state.</p>}
          </CardContent>
        </Card>
      ) : null}

      {finance && expense.approval_status === "approved" && !expense.deleted_at ? (
        <Card>
          <CardHeader><div className="flex items-center gap-3"><Undo2 className="h-6 w-6 text-orange" /><div><h2 className="section-title">Supplier Credit Note or Refund</h2><p className="mt-1 text-sm font-medium text-slate-500">A credit note reduces what is owed. A refund records money the supplier returned against a credit due.</p></div></div></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <label className="block space-y-1.5"><span className="form-label">Entry type *</span><select className="form-input" value={creditType} onChange={(event) => setCreditType(event.target.value as "credit_note" | "refund")}><option value="credit_note">Supplier credit note</option><option value="refund">Refund received</option></select></label>
            <label className="block space-y-1.5"><span className="form-label">Amount *</span><input className="form-input" type="number" min="0.01" step="0.01" max={creditType === "refund" ? settlement.supplierCreditDue : settlement.total - settlement.credited} value={creditAmount} onChange={(event) => setCreditAmount(event.target.value)} /></label>
            <label className="block space-y-1.5"><span className="form-label">Date *</span><input className="form-input" type="date" max={today} value={creditDate} onChange={(event) => setCreditDate(event.target.value)} /></label>
            {creditType === "refund" ? <label className="block space-y-1.5"><span className="form-label">Received by *</span><select className="form-input" value={creditMethod} onChange={(event) => setCreditMethod(event.target.value)}>{supplierPaymentMethods.map((method) => <option key={method} value={method}>{labelize(method)}</option>)}</select></label> : null}
            <label className="block space-y-1.5"><span className="form-label">{creditType === "credit_note" ? "Supplier credit note number *" : `Reference${referenceRequiredMethods.includes(creditMethod) ? " *" : ""}`}</span><input className="form-input" value={creditReference} onChange={(event) => setCreditReference(event.target.value)} /></label>
            <label className="block space-y-1.5 md:col-span-2"><span className="form-label">Reason *</span><textarea className="form-input min-h-20" value={creditReason} onChange={(event) => setCreditReason(event.target.value)} placeholder="Short supply of 120 kg against bill SM/101..." /></label>
            <div className="md:col-span-2"><Button disabled={pending || Number(creditAmount) <= 0 || creditReason.trim().length < 5} onClick={postCredit}>{creditType === "credit_note" ? "Post credit note" : "Post refund"}</Button></div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><h2 className="section-title">Settlement History</h2></CardHeader>
        <CardContent className="space-y-3">
          {!payments.length && !credits.length ? <div className="empty-mini">No supplier payments, refunds or credit notes posted yet.</div> : null}
          {[...payments.map((payment) => ({ kind: "payment" as const, id: payment.id, date: payment.payment_date, label: "Supplier payment", amount: payment.amount_paid, method: payment.payment_method, reference: payment.reference_number, status: payment.status, detail: null as string | null, reversal: payment.reversal_reason })),
            ...credits.map((credit) => ({ kind: "credit" as const, id: credit.id, date: credit.credit_date, label: credit.credit_type === "refund" ? "Supplier refund" : "Supplier credit note", amount: credit.amount, method: credit.payment_method, reference: credit.reference_number, status: credit.status, detail: credit.reason, reversal: credit.reversal_reason }))]
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((entry) => (
              <div key={`${entry.kind}-${entry.id}`} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold text-slate-950">{entry.label} | {formatCurrency(entry.amount)} | {formatDate(entry.date)}</p>
                  <div className="flex items-center gap-2"><Badge value={entry.status} />{entry.kind === "payment" ? <a className="text-sm font-semibold text-slate-700 underline" href={`/api/pdf/expense-payment/${entry.id}`} target="_blank" rel="noreferrer">Voucher</a> : null}</div>
                </div>
                <p className="mt-1 text-sm font-medium text-slate-600">{[entry.method ? labelize(entry.method) : null, entry.reference ? `Ref ${entry.reference}` : null, entry.detail].filter(Boolean).join(" | ") || "-"}</p>
                {entry.reversal ? <p className="mt-1 text-sm font-semibold text-amber-800">Reversed: {entry.reversal}</p> : null}
                {finance && entry.status === "posted" ? (
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <label className="block min-w-64 flex-1 space-y-1.5"><span className="form-label">Reversal reason</span><input className="form-input" value={reversalReason[entry.id] ?? ""} onChange={(event) => setReversalReason((current) => ({ ...current, [entry.id]: event.target.value }))} /></label>
                    <Button variant="secondary" disabled={pending || (reversalReason[entry.id] ?? "").trim().length < 5} onClick={() => reverse(entry.kind, entry.id)}><RotateCcw className="mr-2 h-4 w-4" /> Reverse</Button>
                  </div>
                ) : null}
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[11px] font-black uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-base font-black">{value}</p></div>;
}

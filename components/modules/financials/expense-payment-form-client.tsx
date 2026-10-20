"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Banknote } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { recordExpensePaymentAction, searchPayableExpensesAction, type PayableExpenseOption } from "@/lib/actions/expenses";
import { expensePaymentRequestKey, nextIdempotentAttempt, referenceRequiredMethods, supplierPaymentMethods } from "@/lib/financials/expenses";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { labelize } from "@/types/app";

export function ExpensePaymentFormClient({ initialExpenseId = "", today }: { initialExpenseId?: string; today: string }) {
  const router = useRouter();
  const [options, setOptions] = useState<PayableExpenseOption[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [expenseId, setExpenseId] = useState(initialExpenseId);
  const [selected, setSelected] = useState<PayableExpenseOption | null>(null);
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [method, setMethod] = useState<(typeof supplierPaymentMethods)[number]>("bank_transfer");
  const [bankAccount, setBankAccount] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const attempt = useRef<{ requestKey: string; idempotencyKey: string } | null>(null);
  const searchVersion = useRef(0);

  async function search(term: string, selectedId: string | null = null) {
    const version = ++searchVersion.current;
    setSearching(true);
    const result = await searchPayableExpensesAction({ search: term, selectedId });
    if (version !== searchVersion.current) return;
    setSearching(false);
    if (!result.success) { toast.error(result.error); return; }
    setHasMore(result.data.hasMore);
    setOptions((current) => {
      const merged = new Map(current.filter((row) => row.id === expenseId).map((row) => [row.id, row]));
      for (const row of result.data.rows) merged.set(row.id, row);
      return Array.from(merged.values());
    });
    if (selectedId) {
      const match = result.data.rows.find((row) => row.id === selectedId) ?? null;
      setSelected(match);
      if (match) setAmount(String(match.balance_amount));
      else toast.error("That expense is not approved or has no open balance.");
    }
  }

  useEffect(() => {
    void search("", initialExpenseId || null).then(() => { if (initialExpenseId) void search(""); });
  }, [initialExpenseId]);

  function choose(value: string) {
    const match = options.find((row) => row.id === value) ?? null;
    setExpenseId(value);
    setSelected(match);
    setAmount(match ? String(match.balance_amount) : "");
  }

  function submit() {
    const input = { expense_id: expenseId, amount_paid: Number(amount), payment_date: paymentDate, payment_method: method,
      bank_account: bankAccount, reference_number: reference, notes };
    // An unchanged retry reuses its key; an edited payload gets a new one (prevents a stale replay).
    attempt.current = nextIdempotentAttempt(attempt.current, expensePaymentRequestKey(input), () => crypto.randomUUID());
    const idempotencyKey = attempt.current.idempotencyKey;
    startTransition(async () => {
      const result = await recordExpensePaymentAction({ ...input, idempotency_key: idempotencyKey });
      if (!result.success) { toast.error(result.error); return; }
      toast.success(`Supplier payment posted. Balance payable is ${formatCurrency(result.data.balance_amount)}.`);
      router.push(`/expenses/${result.data.expense_id}`);
      router.refresh();
    });
  }

  const label = (row: PayableExpenseOption) => `${row.expense_number} - ${row.vendor_name_snapshot || row.description || "Expense"}${row.invoice_number ? ` - bill ${row.invoice_number}` : ""} - balance ${formatCurrency(row.balance_amount)}`;
  const referenceRequired = referenceRequiredMethods.includes(method);
  const overBalance = selected ? Number(amount) > Number(selected.balance_amount) : false;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/expenses/payments" className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-neutral-500 hover:text-neutral-950"><ArrowLeft className="h-4 w-4" /> Back to expense payments</Link>
        <div className="flex items-center gap-3"><div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700"><Banknote className="h-6 w-6" /></div><div><h1 className="text-3xl font-bold tracking-tight text-neutral-950">Record Supplier Payment</h1><p className="mt-1 text-sm font-medium text-neutral-500">Only approved expenses with an open balance can be paid. The server locks the expense and rejects any amount above its balance.</p></div></div>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader><h2 className="section-title">Payment Details</h2></CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <label className="block space-y-1.5 md:col-span-2">
              <span className="form-label">Approved expense *</span>
              <SearchableSelect value={expenseId} options={options.map((row) => ({ value: row.id, label: label(row) }))} placeholder="Search expense number, vendor or bill" onChange={choose} onSearchChange={(query) => void search(query)} searching={searching} />
              {hasMore ? <p className="form-hint">Showing the first 25 matches. Type to narrow the search.</p> : null}
            </label>
            <label className="block space-y-1.5"><span className="form-label">Payment date *</span><input className="form-input" type="date" max={today} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label>
            <label className="block space-y-1.5"><span className="form-label">Amount paid *</span><input className="form-input" type="number" min="0.01" step="0.01" max={selected?.balance_amount} value={amount} onChange={(event) => setAmount(event.target.value)} />{overBalance ? <p className="text-xs font-semibold text-rose-700">Amount exceeds the open balance.</p> : null}</label>
            <label className="block space-y-1.5"><span className="form-label">Payment method *</span><select className="form-input" value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>{supplierPaymentMethods.map((value) => <option key={value} value={value}>{labelize(value)}</option>)}</select></label>
            <label className="block space-y-1.5"><span className="form-label">Reference number{referenceRequired ? " *" : ""}</span><input className="form-input" value={reference} placeholder="UTR, UPI reference or cheque number" onChange={(event) => setReference(event.target.value)} /></label>
            <label className="block space-y-1.5"><span className="form-label">Bank account</span><input className="form-input" value={bankAccount} onChange={(event) => setBankAccount(event.target.value)} /></label>
            <label className="block space-y-1.5 md:col-span-2"><span className="form-label">Notes</span><textarea className="form-input min-h-24" value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
            <div className="flex flex-wrap gap-3 md:col-span-2">
              <Button disabled={pending || !selected || Number(amount) <= 0 || overBalance || (referenceRequired && !reference.trim())} onClick={submit}>{pending ? "Posting..." : "Post Supplier Payment"}</Button>
              <Link href="/expenses/payments" className="inline-flex items-center rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700">Cancel</Link>
            </div>
          </CardContent>
        </Card>
        <Card className="h-fit xl:sticky xl:top-24">
          <CardHeader><h2 className="section-title">Payable Check</h2></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Summary label="Expense" value={selected?.expense_number ?? "Select an expense"} />
            <Summary label="Vendor" value={selected?.vendor_name_snapshot ?? "-"} />
            <Summary label="Bill" value={selected?.invoice_number ?? "-"} />
            <Summary label="Due date" value={selected ? formatDate(selected.due_date) : "-"} />
            <Summary label="Expense total" value={selected ? formatCurrency(selected.total_amount) : "-"} />
            <div className="rounded-2xl bg-neutral-950 p-4 text-white"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-300">Open balance</p><p className="mt-2 text-2xl font-bold">{selected ? formatCurrency(selected.balance_amount) : "-"}</p></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4 border-b border-neutral-100 pb-3"><span className="font-medium text-neutral-500">{label}</span><span className="text-right font-bold text-neutral-950">{value}</span></div>;
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ReceiptIndianRupee } from "lucide-react";
import { toast } from "sonner";
import { recordPaymentAction } from "@/lib/actions/payments";
import { createClient } from "@/lib/supabase/browser";
import { formatCurrency, formatDate, todayIso } from "@/lib/utils/format";
import type { SessionContext } from "@/types/app";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading";
import { SearchableSelect } from "@/components/ui/searchable-select";

type OpenInvoice = {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  due_date: string | null;
  grand_total: number;
  amount_paid: number;
  balance_due: number;
  status: string;
  order_id: string | null;
  customers?: { customer_name?: string | null; company_name?: string | null } | null;
  orders?: { order_number?: string | null } | null;
};

function relation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function invoiceCustomer(invoice: OpenInvoice) {
  const customer = relation(invoice.customers);
  return customer?.company_name || customer?.customer_name || "Unknown customer";
}

export function PaymentFormClient({
  context,
  initialInvoiceId = ""
}: {
  context: SessionContext;
  initialInvoiceId?: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const idempotencyKey = useRef<string | null>(null);
  const [invoices, setInvoices] = useState<OpenInvoice[]>([]);
  const [invoiceId, setInvoiceId] = useState(initialInvoiceId);
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data, error: queryError } = await supabase
        .from("invoices")
        .select("id, invoice_number, invoice_date, due_date, grand_total, amount_paid, balance_due, status, order_id, customers(customer_name, company_name), orders(order_number)")
        .eq("company_id", context.companyId)
        .in("status", ["generated", "sent", "partially_paid", "overdue"])
        .gt("balance_due", 0)
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(500);
      if (cancelled) return;
      if (queryError) throw queryError;
      const rows = (data ?? []) as unknown as OpenInvoice[];
      setInvoices(rows);
      const initial = rows.find((invoice) => invoice.id === initialInvoiceId);
      if (initial) setAmount(String(initial.balance_due));
    }

    load()
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load open invoices");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [context.companyId, initialInvoiceId, supabase]);

  const selectedInvoice = invoices.find((invoice) => invoice.id === invoiceId) ?? null;
  const options = invoices.map((invoice) => ({
    value: invoice.id,
    label: `${invoice.invoice_number || "Draft invoice"} - ${invoiceCustomer(invoice)} - balance ${formatCurrency(invoice.balance_due)}`
  }));

  function selectInvoice(value: string) {
    const invoice = invoices.find((item) => item.id === value);
    setInvoiceId(value);
    setAmount(invoice ? String(invoice.balance_due) : "");
    idempotencyKey.current = null;
  }

  function submit() {
    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
    startTransition(async () => {
      const result = await recordPaymentAction({
        invoice_id: invoiceId,
        payment_date: paymentDate,
        amount: Number(amount),
        payment_method: paymentMethod as "bank_transfer" | "upi" | "cheque" | "cash" | "credit_note" | "other",
        reference_number: referenceNumber,
        notes,
        idempotency_key: idempotencyKey.current!
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Receipt posted. Invoice balance is ${formatCurrency(result.data.balance_due)}.`);
      router.push(`/payments/${result.data.payment_id}`);
      router.refresh();
    });
  }

  if (loading) return <LoadingState title="Loading open invoices" description="Checking current balances and customer lineage." />;
  if (error) return <ErrorState description={error} onRetry={() => window.location.reload()} />;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/payments" className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-neutral-500 hover:text-neutral-950">
          <ArrowLeft className="h-4 w-4" /> Back to payments
        </Link>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700"><ReceiptIndianRupee className="h-6 w-6" /></div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-neutral-950">Record Customer Receipt</h1>
            <p className="mt-1 text-sm font-medium text-neutral-500">Select the receivable first. The server will validate the locked balance and close or part-pay the invoice.</p>
          </div>
        </div>
      </div>

      {invoices.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <h2 className="text-lg font-bold text-neutral-950">No issued invoice has an open balance</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm font-medium leading-6 text-neutral-500">Create or generate an invoice from an order or dispatch before recording a receipt.</p>
            <Link href="/invoices/new" className="mt-5 inline-flex rounded-2xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white">Create Invoice</Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card>
            <CardHeader><h2 className="section-title">Receipt Details</h2></CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <label className="block space-y-1.5 md:col-span-2">
                <span className="form-label">Invoice *</span>
                <SearchableSelect value={invoiceId} options={options} placeholder="Search invoice or customer" onChange={selectInvoice} />
              </label>
              <label className="block space-y-1.5">
                <span className="form-label">Payment date *</span>
                <input className="form-input" type="date" max={todayIso()} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
              </label>
              <label className="block space-y-1.5">
                <span className="form-label">Amount received *</span>
                <input className="form-input" type="number" min="0.01" step="0.01" max={selectedInvoice?.balance_due} value={amount} onChange={(event) => setAmount(event.target.value)} />
              </label>
              <label className="block space-y-1.5">
                <span className="form-label">Payment method *</span>
                <select className="form-input" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="upi">UPI</option>
                  <option value="cheque">Cheque</option>
                  <option value="cash">Cash</option>
                  <option value="credit_note">Credit note</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="block space-y-1.5">
                <span className="form-label">Reference number{["bank_transfer", "upi", "cheque"].includes(paymentMethod) ? " *" : ""}</span>
                <input className="form-input" value={referenceNumber} placeholder="UTR, UPI reference, or cheque number" onChange={(event) => setReferenceNumber(event.target.value)} />
              </label>
              <label className="block space-y-1.5 md:col-span-2">
                <span className="form-label">Notes</span>
                <textarea className="form-input min-h-28" value={notes} placeholder="Bank, branch, payer, or reconciliation note" onChange={(event) => setNotes(event.target.value)} />
              </label>
              <div className="flex flex-wrap gap-3 md:col-span-2">
                <Button type="button" disabled={isPending || !selectedInvoice || Number(amount) <= 0} onClick={submit}>{isPending ? "Posting receipt..." : "Post Receipt"}</Button>
                <Link href="/payments" className="inline-flex items-center rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700">Cancel</Link>
              </div>
            </CardContent>
          </Card>

          <Card className="h-fit xl:sticky xl:top-24">
            <CardHeader><h2 className="section-title">Receivable Check</h2></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <Summary label="Customer" value={selectedInvoice ? invoiceCustomer(selectedInvoice) : "Select an invoice"} />
              <Summary label="Invoice" value={selectedInvoice?.invoice_number ?? "-"} />
              <Summary label="Order" value={relation(selectedInvoice?.orders)?.order_number ?? "-"} />
              <Summary label="Invoice date" value={selectedInvoice ? formatDate(selectedInvoice.invoice_date) : "-"} />
              <Summary label="Due date" value={selectedInvoice ? formatDate(selectedInvoice.due_date) : "-"} />
              <Summary label="Invoice total" value={selectedInvoice ? formatCurrency(selectedInvoice.grand_total) : "-"} />
              <Summary label="Already settled" value={selectedInvoice ? formatCurrency(selectedInvoice.amount_paid) : "-"} />
              <div className="rounded-2xl bg-neutral-950 p-4 text-white"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-300">Outstanding balance</p><p className="mt-2 text-2xl font-bold">{selectedInvoice ? formatCurrency(selectedInvoice.balance_due) : "-"}</p></div>
              <p className="text-xs font-semibold leading-5 text-neutral-500">Credit notes settle the invoice but are excluded from cash-collection analytics.</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4 border-b border-neutral-100 pb-3"><span className="font-medium text-neutral-500">{label}</span><span className="text-right font-bold text-neutral-950">{value}</span></div>;
}

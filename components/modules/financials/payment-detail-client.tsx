"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Ban, FileText, PencilLine, ReceiptIndianRupee } from "lucide-react";
import { toast } from "sonner";
import { reversePaymentAction } from "@/lib/actions/payments";
import { createClient } from "@/lib/supabase/browser";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import type { SessionContext } from "@/types/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading";

type PaymentRecord = {
  id: string;
  invoice_id: string | null;
  order_id: string | null;
  payment_date: string;
  amount: number;
  payment_method: string;
  payment_type: string | null;
  payment_status: string;
  reference_number: string | null;
  notes: string | null;
  created_at: string;
  reversed_at: string | null;
  reversal_reason: string | null;
  invoices?: {
    invoice_number?: string | null;
    grand_total?: number;
    amount_paid?: number;
    balance_due?: number;
    status?: string;
    customer_id?: string;
    customers?: { customer_name?: string | null; company_name?: string | null } | null;
  } | null;
  orders?: { order_number?: string | null } | null;
};

function relation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function PaymentDetailClient({
  context,
  recordId,
  reversalMode = false,
  canReverse
}: {
  context: SessionContext;
  recordId: string;
  reversalMode?: boolean;
  canReverse: boolean;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const reversalKey = useRef<string | null>(null);
  const [payment, setPayment] = useState<PaymentRecord | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data, error: queryError } = await supabase
        .from("payments")
        .select("id, invoice_id, order_id, payment_date, amount, payment_method, payment_type, payment_status, reference_number, notes, created_at, reversed_at, reversal_reason, invoices(invoice_number, grand_total, amount_paid, balance_due, status, customer_id, customers(customer_name, company_name)), orders(order_number)")
        .eq("company_id", context.companyId)
        .eq("id", recordId)
        .maybeSingle();
      if (cancelled) return;
      if (queryError) throw queryError;
      if (!data) {
        setError("Payment not found.");
        return;
      }
      setPayment(data as unknown as PaymentRecord);
    }

    load()
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load receipt");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [context.companyId, recordId, supabase]);

  function reverse() {
    if (!reversalKey.current) reversalKey.current = crypto.randomUUID();
    startTransition(async () => {
      const result = await reversePaymentAction({
        payment_id: recordId,
        reason,
        idempotency_key: reversalKey.current!
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Receipt reversed. Invoice balance is now ${formatCurrency(result.data.balance_due)}.`);
      router.push(`/payments/${recordId}`);
      router.refresh();
    });
  }

  if (loading) return <LoadingState title="Loading receipt" description="Fetching invoice and customer traceability." />;
  if (error || !payment) return <ErrorState description={error ?? "Payment not found."} onRetry={() => window.location.reload()} />;

  const invoice = relation(payment.invoices);
  const order = relation(payment.orders);
  const customer = relation(invoice?.customers);
  const customerName = customer?.company_name || customer?.customer_name || "Unknown customer";
  const isPosted = payment.payment_status === "PAID";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/payments" className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-neutral-500 hover:text-neutral-950"><ArrowLeft className="h-4 w-4" /> Back to payments</Link>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700"><ReceiptIndianRupee className="h-6 w-6" /></div>
            <h1 className="text-3xl font-bold tracking-tight text-neutral-950">Receipt {payment.id.slice(0, 8).toUpperCase()}</h1>
            <Badge value={payment.payment_status} />
          </div>
          <p className="mt-2 text-sm font-medium text-neutral-500">A posted receipt is immutable. Corrections are recorded as reversals so the original event and audit trail remain visible.</p>
        </div>
        {canReverse && isPosted && !reversalMode ? (
          <Link href={`/payments/${recordId}/edit`} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700"><PencilLine className="h-4 w-4" /> Reverse Receipt</Link>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Receipt amount" value={formatCurrency(payment.amount)} />
        <Metric label="Payment date" value={formatDate(payment.payment_date)} />
        <Metric label="Invoice balance" value={formatCurrency(invoice?.balance_due)} />
        <Metric label="Invoice status" value={String(invoice?.status ?? "-").replace(/_/g, " ")} />
      </div>

      {reversalMode ? (
        <Card className="border-rose-200 bg-rose-50/60">
          <CardHeader><div className="flex items-center gap-3"><Ban className="h-5 w-5 text-rose-700" /><h2 className="section-title">Reverse Posted Receipt</h2></div></CardHeader>
          <CardContent className="space-y-4">
            {isPosted ? (
              <>
                <p className="max-w-3xl text-sm font-medium leading-6 text-neutral-600">This keeps the receipt record, marks it cancelled, restores the invoice balance, and writes an audit event. It does not delete financial history.</p>
                <label className="block max-w-2xl space-y-1.5"><span className="form-label">Reversal reason *</span><textarea className="form-input min-h-28" value={reason} placeholder="Explain the duplicate, bounced cheque, wrong invoice, or entry correction" onChange={(event) => setReason(event.target.value)} /></label>
                <div className="flex flex-wrap gap-3"><Button variant="danger" type="button" disabled={isPending || reason.trim().length < 5} onClick={reverse}>{isPending ? "Reversing..." : "Confirm Reversal"}</Button><Link href={`/payments/${recordId}`} className="inline-flex rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700">Cancel</Link></div>
              </>
            ) : <p className="text-sm font-semibold text-neutral-600">This receipt is already {payment.payment_status.toLowerCase()} and cannot be reversed again.</p>}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><h2 className="section-title">Receipt Details</h2></CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <Detail label="Method" value={payment.payment_method.replace(/_/g, " ")} />
            <Detail label="Type" value={String(payment.payment_type ?? "-").replace(/_/g, " ")} />
            <Detail label="Reference" value={payment.reference_number || "-"} />
            <Detail label="Recorded" value={formatDate(payment.created_at)} />
            <Detail label="Notes" value={payment.notes || "-"} />
            {payment.reversed_at ? <Detail label="Reversed" value={formatDate(payment.reversed_at)} /> : null}
            {payment.reversal_reason ? <Detail label="Reversal reason" value={payment.reversal_reason} /> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><h2 className="section-title">Connected Receivable</h2></CardHeader>
          <CardContent className="space-y-4">
            <Detail label="Customer" value={customerName} />
            <Detail label="Invoice" value={invoice?.invoice_number || "-"} />
            <Detail label="Order" value={order?.order_number || "-"} />
            <Detail label="Invoice total" value={formatCurrency(invoice?.grand_total)} />
            <Detail label="Settled after effective receipts" value={formatCurrency(invoice?.amount_paid)} />
            <div className="flex flex-wrap gap-3 pt-2">
              {payment.invoice_id ? <Link href={`/invoices/${payment.invoice_id}`} className="inline-flex items-center gap-2 rounded-2xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white"><FileText className="h-4 w-4" /> Open Invoice</Link> : null}
              {payment.order_id ? <Link href={`/orders/${payment.order_id}`} className="inline-flex rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700">Open Order</Link> : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric-card"><p className="relative z-[1] text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">{label}</p><p className="relative z-[1] mt-3 text-xl font-bold capitalize text-neutral-950">{value}</p></div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">{label}</p><p className="mt-1 whitespace-pre-wrap text-sm font-semibold capitalize text-neutral-950">{value}</p></div>;
}

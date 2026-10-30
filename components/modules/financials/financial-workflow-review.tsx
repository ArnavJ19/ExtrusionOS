"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, FileSpreadsheet, ReceiptText, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  applyFinancialCorrectionAction,
  importFinancialReceiptCsvAction,
  postFinancialReceiptAction,
  previewFinancialCorrectionAction,
  reviewInvoiceDispatchAction,
  searchInvoiceEligibilityDispatchesAction,
  searchInvoiceEligibilityOrdersAction,
  searchOpenReceivableInvoicesAction
} from "@/lib/actions/financial-workflow-review";
import {
  parseReceiptCsvDocument,
  previewReceiptCsv,
  type ReceiptCsvMapping,
  type ReceiptCsvPreview
} from "@/lib/workflow/financial-workflow-review";
import { formatCurrency, formatWeight, todayIso } from "@/lib/utils/format";

type Mode = "receipts" | "eligibility";
type Props = { mode: Mode };

type OrderOption = {
  id: string;
  order_number: string | null;
  customer_name: string | null;
  company_name: string | null;
  current_stage: string;
  order_value: number | null;
};
type DispatchOption = {
  id: string;
  order_id: string;
  dispatch_number: string | null;
  dispatch_date: string | null;
  delivery_status: string;
  total_weight_kg: number;
};
type Receivable = {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  due_date: string | null;
  grand_total: number;
  amount_paid: number;
  credited_amount: number;
  balance_due: number;
  status: string;
  customer_name: string | null;
  order_number: string | null;
  overdue_days: number;
};
type InvoiceReview = {
  order_id: string;
  order_number: string | null;
  customer_id: string;
  customer_name: string | null;
  dispatch_id: string;
  dispatch_number: string | null;
  dispatch_date: string | null;
  delivery_status: string;
  source_fingerprint: string;
  default_gst_percent: number;
  subtotal: number;
  tax_total: number;
  grand_total: number;
  rows: Array<{
    source_line_id: string;
    bundle_number: string | null;
    profile_id: string | null;
    description: string | null;
    hsn_code: string | null;
    quantity_kg: number;
    rate_per_kg: number;
    line_total: number;
    gst_percent: number;
    tax_amount: number;
  }>;
};
type CorrectionPreview = {
  record_type: "invoice" | "payment";
  record_id: string;
  fingerprint: string;
  state: string;
  summary: string;
  route: "edit_draft" | "reverse_receipt" | "credit_adjustment" | "unavailable";
  edit_url: string | null;
  adjustment_limit: number | null;
};

const initialMapping: ReceiptCsvMapping = {
  invoice_number: "",
  payment_date: "",
  amount: "",
  payment_method: "",
  reference_number: null,
  notes: null,
  date_format: "dmy"
};

function fieldHeader(headers: string[], choices: string[]) {
  const normalized = headers.map((header) => [header, header.trim().toLocaleLowerCase().replace(/[\s-]+/g, "_")] as const);
  return normalized.find(([, value]) => choices.includes(value))?.[0] ?? "";
}

function csvDefaultMapping(headers: string[]): ReceiptCsvMapping {
  return {
    invoice_number: fieldHeader(headers, ["invoice_number", "invoice_no", "invoice", "document_number"]),
    payment_date: fieldHeader(headers, ["payment_date", "receipt_date", "date", "value_date"]),
    amount: fieldHeader(headers, ["amount", "received_amount", "receipt_amount", "credit_amount"]),
    payment_method: fieldHeader(headers, ["payment_method", "method", "mode", "instrument"]),
    reference_number: fieldHeader(headers, ["reference_number", "reference", "utr", "transaction_id", "cheque_number"]) || null,
    notes: fieldHeader(headers, ["notes", "narration", "description", "remarks"]) || null,
    date_format: "dmy"
  };
}

export function FinancialWorkflowReviewClient({ mode }: Props) {
  return mode === "eligibility"
    ? <InvoiceEligibilityReview />
    : <ReceiptsReview />;
}

function InvoiceEligibilityReview() {
  const [orderSearch, setOrderSearch] = useState("");
  const [dispatchSearch, setDispatchSearch] = useState("");
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [dispatches, setDispatches] = useState<DispatchOption[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [selectedDispatchId, setSelectedDispatchId] = useState("");
  const [review, setReview] = useState<InvoiceReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ordersMore, setOrdersMore] = useState(false);
  const [dispatchesMore, setDispatchesMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    setSearching(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const result = await searchInvoiceEligibilityOrdersAction({ search: orderSearch });
        if (cancelled) return;
        if (!result.success) throw new Error(result.error);
        setOrders(result.rows as OrderOption[]);
        setOrdersMore(result.hasMore);
      } catch (failure) {
        if (!cancelled) { setOrders([]); setOrdersMore(false); setError(failure instanceof Error ? failure.message : "Eligible orders are unavailable."); }
      } finally { if (!cancelled) setSearching(false); }
    }, orderSearch ? 220 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [orderSearch]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedOrderId) { setDispatches([]); setSelectedDispatchId(""); setDispatchesMore(false); return; }
    setSearching(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const result = await searchInvoiceEligibilityDispatchesAction({ order_id: selectedOrderId, search: dispatchSearch });
        if (cancelled) return;
        if (!result.success) throw new Error(result.error);
        setDispatches(result.rows as DispatchOption[]);
        setDispatchesMore(result.hasMore);
      } catch (failure) {
        if (!cancelled) { setDispatches([]); setDispatchesMore(false); setError(failure instanceof Error ? failure.message : "Eligible dispatches are unavailable."); }
      } finally { if (!cancelled) setSearching(false); }
    }, dispatchSearch ? 220 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [selectedOrderId, dispatchSearch]);

  function reviewSelected() {
    if (!selectedOrderId || !selectedDispatchId) return;
    startTransition(async () => {
      setError(null);
      const result = await reviewInvoiceDispatchAction({ order_id: selectedOrderId, dispatch_id: selectedDispatchId });
      if (!result.success) { setReview(null); setError(result.error); return; }
      setReview(result.data as InvoiceReview);
    });
  }

  const selectedOrder = orders.find((order) => order.id === selectedOrderId);
  const selectedDispatch = dispatches.find((dispatch) => dispatch.id === selectedDispatchId);
  const createUrl = review
    ? `/invoices/new?${new URLSearchParams({ order_id: review.order_id, dispatch_id: review.dispatch_id, source_fingerprint: review.source_fingerprint })}`
    : "#";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange">Receivables control</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-neutral-950">Invoice eligibility</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">Review the exact packed dispatch lines, agreed rates, and tax basis before preparing an invoice. Each active dispatch can be billed once; separate partial dispatches stay separate.</p>
        </div>
        <Link href="/invoices/new" className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700">Open invoice editor <ArrowRight className="h-4 w-4" /></Link>
      </div>

      <Card>
        <CardHeader><h2 className="section-title">Choose a source</h2></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="form-label">Search orders</span>
            <input className="form-input" value={orderSearch} onChange={(event) => { setOrderSearch(event.target.value); setSelectedOrderId(""); setSelectedDispatchId(""); setReview(null); }} placeholder="Order number or customer" />
            {ordersMore ? <span className="text-xs text-neutral-500">Showing 25 orders. Refine the search to find older records.</span> : null}
          </label>
          <label className="block space-y-1.5">
            <span className="form-label">Eligible order</span>
            <select aria-label="Eligible order" className="form-input" value={selectedOrderId} onChange={(event) => { setSelectedOrderId(event.target.value); setSelectedDispatchId(""); setDispatchSearch(""); setReview(null); }}>
              <option value="">Select order</option>
              {orders.map((order) => <option key={order.id} value={order.id}>{order.order_number || order.id.slice(0, 8)} · {order.company_name || order.customer_name || "Customer"}</option>)}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="form-label">Search dispatch</span>
            <input className="form-input" value={dispatchSearch} onChange={(event) => { setDispatchSearch(event.target.value); setSelectedDispatchId(""); setReview(null); }} disabled={!selectedOrderId} placeholder="Dispatch number" />
            {dispatchesMore ? <span className="text-xs text-neutral-500">Showing 25 dispatches. Refine the search for older shipments.</span> : null}
          </label>
          <label className="block space-y-1.5">
            <span className="form-label">Eligible dispatch</span>
            <select aria-label="Eligible dispatch" className="form-input" value={selectedDispatchId} onChange={(event) => { setSelectedDispatchId(event.target.value); setReview(null); }} disabled={!selectedOrderId}>
              <option value="">Select dispatch</option>
              {dispatches.map((dispatch) => <option key={dispatch.id} value={dispatch.id}>{dispatch.dispatch_number || dispatch.id.slice(0, 8)} · {dispatch.delivery_status.replaceAll("_", " ")} · {formatWeight(dispatch.total_weight_kg)}</option>)}
            </select>
          </label>
          {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 md:col-span-2">{error}</p> : null}
          {selectedOrder && selectedDispatch ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-neutral-50 p-4 md:col-span-2">
            <p className="text-sm text-neutral-700">{selectedOrder.order_number} · {selectedDispatch.dispatch_number || "Dispatch"} · {selectedDispatch.delivery_status.replaceAll("_", " ")}</p>
            <Button type="button" onClick={reviewSelected} disabled={isPending || searching}>{isPending ? "Verifying manifest..." : "Review exact billable lines"}</Button>
          </div> : null}
        </CardContent>
      </Card>

      {review ? <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div><h2 className="section-title">Manifest reviewed</h2><p className="mt-1 text-sm text-neutral-500">{review.customer_name || "Customer"} · {review.order_number || "Order"} · {review.dispatch_number || "Dispatch"}</p></div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800"><ShieldCheck className="mr-1 inline h-4 w-4" />Source verified</div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Packed lines" value={String(review.rows.length)} />
            <Metric label="Shipped weight" value={formatWeight(review.rows.reduce((sum, row) => sum + row.quantity_kg, 0))} />
            <Metric label="Subtotal" value={formatCurrency(review.subtotal)} />
            <Metric label="Tax and total" value={`${formatCurrency(review.tax_total)} · ${formatCurrency(review.grand_total)}`} />
          </div>
          <div className="max-h-[32rem] overflow-auto rounded-xl border border-neutral-200">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="sticky top-0 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                <tr><th className="px-3 py-3">Bundle / section</th><th className="px-3 py-3">Packing source</th><th className="px-3 py-3 text-right">Weight</th><th className="px-3 py-3 text-right">Rate / kg</th><th className="px-3 py-3 text-right">Tax basis</th><th className="px-3 py-3 text-right">Line value</th><th className="px-3 py-3 text-right">Tax</th></tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {review.rows.map((row) => <tr key={row.source_line_id}>
                  <td className="px-3 py-3 font-semibold text-neutral-900">{row.bundle_number || "Unnumbered bundle"}<span className="block text-xs font-normal text-neutral-500">{row.description || row.profile_id?.slice(0, 8) || "Aluminium profile"}</span></td>
                  <td className="px-3 py-3 font-mono text-xs text-neutral-500">{row.source_line_id.slice(0, 12)}…{row.hsn_code ? ` · HSN ${row.hsn_code}` : ""}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatWeight(row.quantity_kg)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(row.rate_per_kg)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{row.gst_percent.toFixed(2)}%</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(row.line_total)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(row.tax_amount)}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="font-bold">Source fingerprint checked again when you save</p><p className="mt-1 break-all font-mono text-xs">{review.source_fingerprint}</p></div>
            <Link href={createUrl} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-orange px-4 py-2.5 font-bold text-white">Prepare invoice <ArrowRight className="h-4 w-4" /></Link>
          </div>
        </CardContent>
      </Card> : null}
    </div>
  );
}

function ReceiptsReview() {
  const router = useRouter();
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoices, setInvoices] = useState<Receivable[]>([]);
  const [invoicesMore, setInvoicesMore] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [selectedInvoices, setSelectedInvoices] = useState<string[]>([]);
  const [allocationAmounts, setAllocationAmounts] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [receiptKey, setReceiptKey] = useState("");
  const [receiptResult, setReceiptResult] = useState<string | null>(null);
  const [importFile, setImportFile] = useState("");
  const [importName, setImportName] = useState("");
  const [mapping, setMapping] = useState<ReceiptCsvMapping>(initialMapping);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ posted: number; failed: number; rowErrors: string[] } | null>(null);
  const [correctionType, setCorrectionType] = useState<"invoice" | "payment">("payment");
  const [correctionId, setCorrectionId] = useState("");
  const [correctionPreview, setCorrectionPreview] = useState<CorrectionPreview | null>(null);
  const [correctionAmount, setCorrectionAmount] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionKey, setCorrectionKey] = useState("");
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    setInvoiceError(null);
    const timer = setTimeout(async () => {
      try {
        const result = await searchOpenReceivableInvoicesAction({ search: invoiceSearch });
        if (cancelled) return;
        if (!result.success) throw new Error(result.error);
        setInvoices(result.data.rows as Receivable[]);
        setInvoicesMore(result.data.hasMore);
      } catch (error) {
        if (!cancelled) { setInvoices([]); setInvoicesMore(false); setInvoiceError(error instanceof Error ? error.message : "Receivables are unavailable."); }
      }
    }, invoiceSearch ? 220 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [invoiceSearch]);

  let csvPreview: ReceiptCsvPreview | null = null;
  if (importFile) {
    try { csvPreview = previewReceiptCsv(importFile, mapping); }
    catch { csvPreview = null; }
  }
  const receiptAmount = Number(amount);
  const allocationTotal = selectedInvoices.reduce((sum, id) => sum + Number(allocationAmounts[id] || 0), 0);
  const hasValidAllocation = Number.isFinite(receiptAmount) && receiptAmount > 0
    && Math.round(allocationTotal * 100) === Math.round(receiptAmount * 100)
    && selectedInvoices.every((id) => Number.isFinite(Number(allocationAmounts[id])) && Number(allocationAmounts[id]) > 0);

  function updateReceiptField(update: () => void) {
    update();
    setReceiptKey("");
  }

  function submitReceipt() {
    const idempotencyKey = receiptKey || crypto.randomUUID();
    setReceiptKey(idempotencyKey);
    startTransition(async () => {
      const result = await postFinancialReceiptAction({
        amount: receiptAmount,
        payment_date: paymentDate,
        payment_method: method as "bank_transfer" | "upi" | "cheque" | "cash" | "credit_note" | "other",
        reference_number: reference || null,
        notes: notes || null,
        idempotency_key: idempotencyKey,
        allocations: selectedInvoices.map((invoiceId) => ({ invoice_id: invoiceId, amount: Number(allocationAmounts[invoiceId]) }))
      });
      if (!result.success) { toast.error(result.error); return; }
      setReceiptResult(`${result.data.receipt_id} · ${result.data.allocations.length} allocation${result.data.allocations.length === 1 ? "" : "s"} · ${result.data.idempotent_replay ? "retry confirmed" : "posted"}`);
      setSelectedInvoices([]);
      setAllocationAmounts({});
      setAmount("");
      setReference("");
      setNotes("");
      setReceiptKey("");
      toast.success(method === "credit_note" ? "Credit adjustment recorded" : "Receipt recorded against invoices");
      router.refresh();
    });
  }

  async function loadCorrection() {
    setCorrectionError(null);
    setCorrectionPreview(null);
    const result = await previewFinancialCorrectionAction({ record_type: correctionType, record_id: correctionId });
    if (!result.success) { setCorrectionError(result.error); return; }
    setCorrectionPreview(result.data as CorrectionPreview);
    setCorrectionAmount("");
    setCorrectionKey("");
  }

  function applyCorrection() {
    if (!correctionPreview) return;
    const key = correctionKey || crypto.randomUUID();
    setCorrectionKey(key);
    startTransition(async () => {
      const result = await applyFinancialCorrectionAction({
        record_type: correctionPreview.record_type,
        record_id: correctionPreview.record_id,
        fingerprint: correctionPreview.fingerprint,
        amount: correctionPreview.route === "credit_adjustment" ? Number(correctionAmount) : undefined,
        reason: correctionReason,
        idempotency_key: key
      });
      if (!result.success) { setCorrectionError(result.error); toast.error(result.error); return; }
      toast.success("Correction recorded with its original entry retained");
      setCorrectionPreview(null);
      setCorrectionId("");
      setCorrectionReason("");
      setCorrectionAmount("");
      setCorrectionKey("");
      router.refresh();
    });
  }

  type MappingColumn = Exclude<keyof ReceiptCsvMapping, "date_format">;
  const mappingFields: Array<[MappingColumn, string, boolean]> = [
    ["invoice_number", "Invoice number", true],
    ["payment_date", "Receipt date", true],
    ["amount", "Received amount (INR)", true],
    ["payment_method", "Method", true],
    ["reference_number", "Reference", false],
    ["notes", "Notes", false]
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange">Receivables control</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-neutral-950">Receipts and allocations</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">Record received money once, review how it is allocated across invoices, and keep credit adjustments separate from cash collection.</p>
        </div>
        <Link href="/invoices/eligibility" className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700">Invoice eligibility <ArrowRight className="h-4 w-4" /></Link>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start gap-3"><ReceiptText className="mt-1 h-5 w-5 text-orange" /><div><h2 className="section-title">Record an actual receipt</h2><p className="mt-1 text-sm text-neutral-500">The total must be allocated fully across open invoices before posting.</p></div></CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <label className="block space-y-1.5"><span className="form-label">Actual received amount (INR) *</span><input className="form-input" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => updateReceiptField(() => setAmount(event.target.value))} /></label>
            <label className="block space-y-1.5"><span className="form-label">Receipt date *</span><input className="form-input" type="date" max={todayIso()} value={paymentDate} onChange={(event) => updateReceiptField(() => setPaymentDate(event.target.value))} /></label>
            <label className="block space-y-1.5"><span className="form-label">Receipt method *</span><select className="form-input" value={method} onChange={(event) => updateReceiptField(() => setMethod(event.target.value))}>
              <option value="bank_transfer">Bank transfer</option><option value="upi">UPI</option><option value="cheque">Cheque</option><option value="cash">Cash</option><option value="other">Other</option><option value="credit_note">Credit adjustment</option>
            </select></label>
            <label className="block space-y-1.5"><span className="form-label">Bank / UPI / cheque reference {(["bank_transfer", "upi", "cheque"].includes(method)) ? "*" : ""}</span><input className="form-input" value={reference} onChange={(event) => updateReceiptField(() => setReference(event.target.value))} maxLength={120} disabled={!(["bank_transfer", "upi", "cheque"].includes(method))} /></label>
            <label className="block space-y-1.5 sm:col-span-2 xl:col-span-4"><span className="form-label">Notes {method === "credit_note" ? "and adjustment reason *" : ""}</span><textarea className="form-input min-h-20" value={notes} onChange={(event) => updateReceiptField(() => setNotes(event.target.value))} maxLength={2000} /></label>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="block w-full max-w-md space-y-1.5"><span className="form-label">Find open invoice</span><input className="form-input" value={invoiceSearch} onChange={(event) => setInvoiceSearch(event.target.value)} placeholder="Invoice number" /></label>
            {invoicesMore ? <span className="text-xs text-neutral-500">Showing 100 open invoices. Search by invoice number to find others.</span> : null}
          </div>
          {invoiceError ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{invoiceError}</p> : null}
          <div className="max-h-96 overflow-auto rounded-xl border border-neutral-200">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="sticky top-0 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500"><tr><th className="px-3 py-3">Allocate</th><th className="px-3 py-3">Invoice / customer</th><th className="px-3 py-3">Due</th><th className="px-3 py-3 text-right">Open balance</th><th className="px-3 py-3 text-right">Allocation (INR)</th></tr></thead>
              <tbody className="divide-y divide-neutral-100">
                {invoices.map((invoice) => {
                  const checked = selectedInvoices.includes(invoice.id);
                  return <tr key={invoice.id} className={checked ? "bg-orange/5" : ""}>
                    <td className="px-3 py-3"><input aria-label={`Allocate to ${invoice.invoice_number || "invoice"}`} type="checkbox" checked={checked} onChange={(event) => {
                      setReceiptKey("");
                      setSelectedInvoices((current) => event.target.checked ? [...current, invoice.id] : current.filter((id) => id !== invoice.id));
                      if (event.target.checked) setAllocationAmounts((current) => ({ ...current, [invoice.id]: current[invoice.id] ?? "0" }));
                    }} /></td>
                    <td className="px-3 py-3"><Link href={`/invoices/${invoice.id}`} className="font-semibold text-neutral-900 hover:text-orange">{invoice.invoice_number || invoice.id.slice(0, 8)}</Link><span className="block text-xs text-neutral-500">{invoice.customer_name || "Customer"}{invoice.order_number ? ` · ${invoice.order_number}` : ""}</span></td>
                    <td className="px-3 py-3 text-xs text-neutral-600">{invoice.due_date || "No due date"}{invoice.overdue_days ? <span className="block font-bold text-red-700">{invoice.overdue_days} days overdue</span> : null}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">{formatCurrency(invoice.balance_due)}</td>
                    <td className="px-3 py-3 text-right"><input aria-label={`Allocation amount for ${invoice.invoice_number || "invoice"}`} className="form-input ml-auto w-36 text-right" type="number" min="0" max={invoice.balance_due} step="0.01" disabled={!checked} value={allocationAmounts[invoice.id] ?? "0"} onChange={(event) => { setReceiptKey(""); setAllocationAmounts((current) => ({ ...current, [invoice.id]: event.target.value })); }} /></td>
                  </tr>;
                })}
                {!invoices.length && !invoiceError ? <tr><td colSpan={5} className="px-3 py-8 text-center text-neutral-500">No open invoices match this search.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-neutral-50 p-4">
            <p className={`text-sm font-semibold ${hasValidAllocation ? "text-emerald-800" : "text-neutral-600"}`}>Allocated {formatCurrency(allocationTotal)} of {formatCurrency(receiptAmount || 0)}{hasValidAllocation ? " · balanced" : " · allocation must balance exactly"}</p>
            <Button type="button" onClick={submitReceipt} disabled={isPending || !hasValidAllocation || (["bank_transfer", "upi", "cheque"].includes(method) && !reference.trim()) || (method === "credit_note" && notes.trim().length < 5)}>{isPending ? "Posting receipt..." : method === "credit_note" ? "Post credit adjustment" : "Post receipt"}</Button>
          </div>
          {receiptResult ? <p role="status" className="break-all rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">Recorded: {receiptResult}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start gap-3"><FileSpreadsheet className="mt-1 h-5 w-5 text-orange" /><div><h2 className="section-title">Import receipt CSV</h2><p className="mt-1 text-sm text-neutral-500">Map columns and date format explicitly. Each row is checked against this company&apos;s invoice balance and reference history.</p></div></CardHeader>
        <CardContent className="space-y-4">
          <label className="block space-y-1.5"><span className="form-label">Accounting receipt CSV</span><input className="form-input" type="file" accept=".csv,text/csv" onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            setCsvError(null); setImportResult(null); setImportFile(""); setMapping(initialMapping);
            if (!file) return;
            if (file.size > 512_000) { setCsvError("CSV must be smaller than 500 KB."); return; }
            try {
              const text = await file.text();
              const parsed = parseReceiptCsvDocument(text);
              setImportName(file.name.slice(0, 160)); setImportFile(text); setMapping(csvDefaultMapping(parsed.headers));
            } catch (error) { setCsvError(error instanceof Error ? error.message : "CSV could not be read."); }
          }} /></label>
          {importFile ? <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {mappingFields.map(([field, label, required]) => <label key={field} className="block space-y-1.5"><span className="form-label">{label}{required ? " *" : ""}</span><select className="form-input" value={mapping[field] ?? ""} onChange={(event) => setMapping((current) => ({ ...current, [field]: event.target.value || (required ? "" : null) }) as ReceiptCsvMapping)}>
                <option value="">{required ? "Select column" : "Not mapped"}</option>
                {(() => { try { return parseReceiptCsvDocument(importFile).headers.map((header) => <option key={header} value={header}>{header}</option>); } catch { return null; } })()}
              </select></label>)}
              <label className="block space-y-1.5"><span className="form-label">Date format *</span><select className="form-input" value={mapping.date_format} onChange={(event) => setMapping((current) => ({ ...current, date_format: event.target.value as ReceiptCsvMapping["date_format"] }))}><option value="dmy">DD/MM/YYYY</option><option value="mdy">MM/DD/YYYY</option><option value="iso">YYYY-MM-DD</option></select></label>
            </div>
            {csvPreview ? <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm"><p className="font-bold text-neutral-900">{csvPreview.rows.length} rows · {csvPreview.rows.filter((row) => !row.error).length} valid · {csvPreview.rows.filter((row) => row.error).length} need review</p><div className="mt-3 max-h-44 space-y-1 overflow-auto text-xs">{csvPreview.rows.slice(0, 8).map((row) => <p key={row.row_number} className={row.error ? "text-red-700" : "text-neutral-600"}>Row {row.row_number} · {row.invoice_number || "Missing invoice"} · {row.amount ? formatCurrency(row.amount) : "Invalid amount"}{row.error ? ` · ${row.error}` : ""}</p>)}</div></div> : <p className="text-sm text-red-700">Map the required fields to preview this file.</p>}
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-2xl text-xs leading-5 text-neutral-500">Imports are bounded to 500 rows. Failed rows stay in the import reconciliation record. Device readings are not treated as verified weight without an approved protocol and verification source.</p><Button type="button" disabled={isPending || !csvPreview || csvPreview.rows.length < 1} onClick={() => {
              if (!csvPreview) return;
              startTransition(async () => {
                const result = await importFinancialReceiptCsvAction({ csv_text: importFile, source_name: importName, mapping });
                if (!result.success) { setCsvError(result.error); return; }
                setImportResult({ posted: result.data.posted_count, failed: result.data.failed_count,
                  rowErrors: result.data.rows.filter((row) => row.status === "failed").map((row) => `Row ${row.row_number}: ${row.error || "Import failed"}`) });
                toast.success(`Import reconciled: ${result.data.posted_count} posted, ${result.data.failed_count} failed`);
                router.refresh();
              });
            }}>{isPending ? "Importing and reconciling..." : "Import mapped receipts"}</Button></div>
          </> : null}
          {csvError ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{csvError}</p> : null}
          {importResult ? <div role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950"><p className="font-bold">Import reconciled · {importResult.posted} posted · {importResult.failed} failed</p>{importResult.rowErrors.length ? <div className="mt-2 space-y-1 text-xs text-red-800">{importResult.rowErrors.map((error) => <p key={error}>{error}</p>)}</div> : <p className="mt-1 text-xs">Every accepted row is linked to its canonical payment and receipt allocation.</p>}</div> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start gap-3"><RotateCcw className="mt-1 h-5 w-5 text-orange" /><div><h2 className="section-title">Review a correction route</h2><p className="mt-1 text-sm text-neutral-500">Draft invoices route to editing. Posted receipts use an audited reversal. An open issued invoice can receive a credit adjustment that is recorded separately from cash.</p></div></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)_auto]">
            <label className="block space-y-1.5"><span className="form-label">Record type</span><select className="form-input" value={correctionType} onChange={(event) => { setCorrectionType(event.target.value as "invoice" | "payment"); setCorrectionPreview(null); setCorrectionKey(""); }}><option value="payment">Payment / receipt</option><option value="invoice">Invoice</option></select></label>
            <label className="block space-y-1.5"><span className="form-label">Record ID</span><input className="form-input font-mono" value={correctionId} onChange={(event) => { setCorrectionId(event.target.value); setCorrectionPreview(null); setCorrectionKey(""); }} placeholder="Paste invoice or payment UUID" /></label>
            <Button type="button" className="self-end" disabled={isPending || !correctionId} onClick={loadCorrection}>Preview correction</Button>
          </div>
          {correctionError ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{correctionError}</p> : null}
          {correctionPreview ? <div className="space-y-4 rounded-xl border border-neutral-200 p-4">
            <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" /><div><p className="font-bold text-neutral-900">{correctionPreview.state.replaceAll("_", " ")}</p><p className="mt-1 text-sm text-neutral-600">{correctionPreview.summary}</p><p className="mt-2 break-all font-mono text-[11px] text-neutral-500">Preview fingerprint {correctionPreview.fingerprint}</p></div></div>
            {correctionPreview.route === "edit_draft" && correctionPreview.edit_url ? <Link className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 px-4 py-2.5 text-sm font-bold" href={correctionPreview.edit_url}>Edit draft invoice <ArrowRight className="h-4 w-4" /></Link> : null}
            {correctionPreview.route === "reverse_receipt" || correctionPreview.route === "credit_adjustment" ? <>
              {correctionPreview.route === "credit_adjustment" ? <><label className="block max-w-xs space-y-1.5"><span className="form-label">Credit adjustment (INR), up to {formatCurrency(correctionPreview.adjustment_limit || 0)}</span><input className="form-input" type="number" min="0.01" max={correctionPreview.adjustment_limit ?? undefined} step="0.01" value={correctionAmount} onChange={(event) => { setCorrectionAmount(event.target.value); setCorrectionKey(""); }} /></label><p className="text-xs text-amber-800">This reduces the open receivable using the existing credit adjustment ledger. It does not create a GST credit note document.</p></> : null}
              <label className="block max-w-2xl space-y-1.5"><span className="form-label">Correction reason *</span><textarea className="form-input min-h-20" value={correctionReason} onChange={(event) => { setCorrectionReason(event.target.value); setCorrectionKey(""); }} minLength={5} maxLength={1000} /></label>
              <Button type="button" disabled={isPending || correctionReason.trim().length < 5 || (correctionPreview.route === "credit_adjustment" && (!Number(correctionAmount) || Number(correctionAmount) > (correctionPreview.adjustment_limit ?? 0)))} onClick={applyCorrection}>{isPending ? "Applying correction..." : correctionPreview.route === "reverse_receipt" ? "Reverse posted receipt" : "Record credit adjustment"}</Button>
            </> : null}
            {correctionPreview.route === "unavailable" ? <p className="flex items-center gap-2 text-sm text-amber-800"><AlertTriangle className="h-4 w-4" />This record has no supported correction action in its current state. Review linked returns or documents before making another entry.</p> : null}
          </div> : null}
        </CardContent>
      </Card>

      <p className="text-xs leading-5 text-neutral-500">Receivables use invoice due dates and balances from the existing financial ledger. Cash collection excludes credit adjustments; reversing a grouped receipt updates its reconciliation status without deleting the source event.</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</p><p className="mt-2 text-lg font-bold tabular-nums text-neutral-950">{value}</p></div>;
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileText, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { saveInvoiceAction, searchInvoiceSourcesAction } from "@/lib/actions/invoices";
import type { InvoiceOrderOption, InvoiceDispatchOption, InvoiceSourceOptions } from "@/lib/financials/invoice-sources";
import { gstStates } from "@/lib/calculations/gst";
import { createClient } from "@/lib/supabase/browser";
import { formatCurrency, formatWeight, todayIso } from "@/lib/utils/format";
import type { SessionContext } from "@/types/app";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading";
import { SearchableSelect } from "@/components/ui/searchable-select";

type InvoiceRecord = {
  place_of_supply_state_code: string | null;
  id: string;
  order_id: string | null;
  dispatch_id: string | null;
  invoice_number: string | null;
  invoice_date: string;
  due_date: string | null;
  status: string;
  notes: string | null;
  amount_paid: number;
};

type FormState = {
  place_of_supply_state_code: string;
  order_id: string;
  dispatch_id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  status: "draft" | "generated" | "sent";
  notes: string;
};

const initialForm: FormState = {
  place_of_supply_state_code: "",
  order_id: "",
  dispatch_id: "",
  invoice_number: "",
  invoice_date: todayIso(),
  due_date: "",
  status: "draft",
  notes: ""
};

function customerLabel(order: InvoiceOrderOption) {
  return order.company_name || order.customer_name || "Unknown customer";
}

function useInvoiceSources(kind: "order" | "dispatch", enabled: boolean, search: string, selectedId: string, orderId: string, invoiceId?: string) {
  const [options, setOptions] = useState<InvoiceSourceOptions | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!enabled) { setOptions(null); setSearching(false); setError(null); return; }
    setSearching(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const result = await searchInvoiceSourcesAction({kind, search: selectedId ? "" : search, selectedId: selectedId || null, orderId: orderId || null, invoiceId: invoiceId ?? null});
        if (cancelled) return;
        if (!result.success) throw new Error(result.error);
        if (selectedId && result.options.rows.length !== 1) throw new Error("This invoice source is no longer available. Review the shipment before invoicing.");
        setOptions(result.options);
      } catch (failure) {
        if (!cancelled) { setOptions(null); setError(failure instanceof Error ? failure.message : "Invoice sources are unavailable."); }
      } finally { if (!cancelled) setSearching(false); }
    }, search && !selectedId ? 250 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [enabled, kind, search, selectedId, orderId, invoiceId]);
  return {options, searching, error, clear() {setOptions(null); setSearching(true); setError(null);}};
}

export function InvoiceFormClient({
  context,
  recordId
}: {
  context: SessionContext;
  recordId?: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [orderSearch, setOrderSearch] = useState("");
  const [dispatchSearch, setDispatchSearch] = useState("");
  const [form, setForm] = useState<FormState>(initialForm);
  const [record, setRecord] = useState<InvoiceRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      const recordResult = await (recordId
          ? supabase
              .from("invoices")
              .select("id, order_id, dispatch_id, invoice_number, invoice_date, due_date, status, notes, amount_paid, place_of_supply_state_code")
              .eq("company_id", context.companyId)
              .eq("id", recordId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }));

      if (recordResult.error) throw recordResult.error;
      if (recordId && !recordResult.data) throw new Error("Invoice not found.");
      if (cancelled) return;

      const loadedRecord = (recordResult.data ?? null) as InvoiceRecord | null;
      setRecord(loadedRecord);
      if (loadedRecord) {
        setForm({
          place_of_supply_state_code: loadedRecord.place_of_supply_state_code ?? "",
          order_id: loadedRecord.order_id ?? "",
          dispatch_id: loadedRecord.dispatch_id ?? "",
          invoice_number: loadedRecord.invoice_number ?? "",
          invoice_date: loadedRecord.invoice_date,
          due_date: loadedRecord.due_date ?? "",
          status: (["draft", "generated", "sent"].includes(loadedRecord.status)
            ? loadedRecord.status
            : "generated") as FormState["status"],
          notes: loadedRecord.notes ?? ""
        });
      }
    }

    load()
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load invoice sources");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [context.companyId, recordId, supabase]);

  const locked = Boolean(record && (!["draft", "generated"].includes(record.status) || Number(record.amount_paid) > 0));
  const orderSource = useInvoiceSources("order", !loading && !locked && !error, orderSearch, form.order_id, "", recordId);
  const dispatchSource = useInvoiceSources("dispatch", !loading && !locked && !error && Boolean(form.order_id), dispatchSearch, form.dispatch_id, form.order_id, recordId);
  const orders: InvoiceOrderOption[] = orderSource.options?.kind === "order" ? orderSource.options.rows : [];
  const dispatches: InvoiceDispatchOption[] = dispatchSource.options?.kind === "dispatch" ? dispatchSource.options.rows : [];
  const selectedOrder = orders.find(order => order.id === form.order_id) ?? null;
  const selectedDispatch = dispatches.find(dispatch => dispatch.id === form.dispatch_id && dispatch.order_id === form.order_id) ?? null;
  const sourceError = orderSource.error || dispatchSource.error;

  const orderOptions = orders.map((order) => ({
    value: order.id,
    label: `${order.order_number} - ${customerLabel(order)} - ${formatCurrency(order.order_value)}`
  }));
  const dispatchOptions = dispatches.map((dispatch) => ({
    value: dispatch.id,
    label: `${dispatch.dispatch_number || "Dispatch"} - ${dispatch.delivery_status.replace(/_/g, " ")} - ${formatWeight(dispatch.total_weight_kg)}`
  }));

  function submit() {
    startTransition(async () => {
      const result = await saveInvoiceAction({
        editing_id: recordId ?? null,
        ...form
      });
      if (!result.success || !result.invoiceId) {
        toast.error(result.success ? "Could not save invoice" : result.error);
        return;
      }
      toast.success(recordId ? "Invoice updated from its source lines" : "Invoice created from its source lines");
      router.push(`/invoices/${result.invoiceId}`);
      router.refresh();
    });
  }

  if (loading) return <LoadingState title="Loading invoice sources" description="Checking orders, dispatches, and existing invoices." />;
  if (error) return <ErrorState description={error} onRetry={() => window.location.reload()} />;

  if (locked) {
    return (
      <div className="space-y-6">
        <Link href={`/invoices/${recordId}`} className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-500 hover:text-neutral-950">
          <ArrowLeft className="h-4 w-4" /> Back to invoice
        </Link>
        <Card className="border-amber-200 bg-amber-50/70">
          <CardContent className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <LockKeyhole className="h-8 w-8 text-amber-700" />
            <div>
              <h1 className="text-xl font-bold text-neutral-950">This invoice is financially locked</h1>
              <p className="mt-1 text-sm font-medium leading-6 text-neutral-600">Sent, partially paid, and paid invoices cannot have their source or totals rewritten. Record or reverse receipts from the payment workflow.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href={recordId ? `/invoices/${recordId}` : "/invoices"} className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-neutral-500 hover:text-neutral-950">
          <ArrowLeft className="h-4 w-4" /> Back to invoices
        </Link>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-orange/10 p-3 text-orange"><FileText className="h-6 w-6" /></div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-neutral-950">{recordId ? "Edit Source Invoice" : "Create Source Invoice"}</h1>
            <p className="mt-1 text-sm font-medium text-neutral-500">Customer, line values, GST, total, paid amount, and balance are derived by the server.</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader><h2 className="section-title">Source and Dates</h2></CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <label className="block space-y-1.5 md:col-span-2">
              <span className="form-label">Source order *</span>
              <SearchableSelect
                value={form.order_id}
                options={orderOptions}
                placeholder="Search order or customer"
                emptyText={orderSource.error ? "Invoice sources unavailable" : "No eligible orders"}
                ariaLabel="Source order"
                searching={orderSource.searching}
                disabled={Boolean(recordId)}
                onSearchChange={(query) => {orderSource.clear(); dispatchSource.clear(); setOrderSearch(query); setDispatchSearch(""); setForm(current => ({...current, order_id: "", dispatch_id: ""}));}}
                onChange={(value) => {if (value === form.order_id) return; setOrderSearch(""); setDispatchSearch(""); dispatchSource.clear(); setForm(current => ({...current, order_id: value, dispatch_id: ""}));}}
              />
              {orderSource.options?.has_more ? <span className="block text-xs text-neutral-500">Showing 25 orders. Refine your search to find older records.</span> : null}
            </label>
            <label className="block space-y-1.5 md:col-span-2">
              <span className="form-label">Packed dispatch *</span>
              <SearchableSelect
                value={form.dispatch_id}
                options={dispatchOptions}
                placeholder={form.order_id ? "Select an uninvoiced packed dispatch" : "Select an order first"}
                disabled={!form.order_id || Boolean(recordId)}
                ariaLabel="Packed dispatch"
                searching={dispatchSource.searching}
                emptyText={dispatchSource.error ? "Invoice sources unavailable" : "No uninvoiced dispatches for this order"}
                onSearchChange={(query) => {dispatchSource.clear(); setDispatchSearch(query); setForm(current => ({...current, dispatch_id: ""}));}}
                onChange={(value) => {setDispatchSearch(""); setForm(current => ({...current, dispatch_id: value}));}}
              />
              {dispatchSource.options?.has_more ? <span className="block text-xs text-neutral-500">Showing 25 dispatches. Refine your search to find older records.</span> : null}
              {recordId ? <span className="block text-xs text-neutral-500">An existing invoice retains its original order and dispatch.</span> : null}
            </label>
            {sourceError ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 md:col-span-2">{sourceError}</p> : null}
            <label className="block space-y-1.5">
              <span className="form-label">Invoice date *</span>
              <input className="form-input" type="date" value={form.invoice_date} onChange={(event) => setForm((current) => ({ ...current, invoice_date: event.target.value }))} />
            </label>
            <label className="block space-y-1.5">
              <span className="form-label">Due date</span>
              <input className="form-input" type="date" min={form.invoice_date} value={form.due_date} onChange={(event) => setForm((current) => ({ ...current, due_date: event.target.value }))} />
            </label>
            <label className="block space-y-1.5">
              <span className="form-label">Invoice number</span>
              <input className="form-input" value={form.invoice_number} placeholder="Generated automatically on save" readOnly />
            </label>
            <label className="block space-y-1.5">
              <span className="form-label">Place of supply: GST state code *</span>
              <select className="form-input" value={form.place_of_supply_state_code} onChange={(event) => setForm((current) => ({ ...current, place_of_supply_state_code: event.target.value }))}><option value="">Select supply state</option>{Object.entries(gstStates).map(([code, name]) => <option key={code} value={code}>{name} ({code})</option>)}</select>
              <span className="text-xs text-slate-500">Confirm the supply destination; billing and delivery states can differ. Domestic supplies only.</span>
            </label>
            <label className="block space-y-1.5">
              <span className="form-label">Workflow status *</span>
              <select className="form-input" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as FormState["status"] }))}>
                <option value="draft">Draft</option>
                <option value="generated">Generated</option>
                {recordId ? <option value="sent">Sent</option> : null}
              </select>
            </label>
            <label className="block space-y-1.5 md:col-span-2">
              <span className="form-label">Notes</span>
              <textarea className="form-input min-h-28" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
            </label>
            <div className="flex flex-wrap gap-3 md:col-span-2">
              <Button type="button" disabled={isPending || orderSource.searching || dispatchSource.searching || Boolean(sourceError) || !selectedOrder || !selectedDispatch} onClick={submit}>{isPending ? "Deriving invoice..." : recordId ? "Update Invoice" : "Create Invoice"}</Button>
              <Link href={recordId ? `/invoices/${recordId}` : "/invoices"} className="inline-flex items-center rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700">Cancel</Link>
            </div>
          </CardContent>
        </Card>

        <Card className="h-fit xl:sticky xl:top-24">
          <CardHeader><h2 className="section-title">Source Preview</h2></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <Summary label="Customer" value={selectedOrder ? customerLabel(selectedOrder) : "Select an order"} />
            <Summary label="Order" value={selectedOrder?.order_number ?? "-"} />
            <Summary label="Order stage" value={selectedOrder?.current_stage.replace(/_/g, " ") ?? "-"} />
            <Summary label="Order commercial value" value={selectedOrder ? formatCurrency(selectedOrder.order_value) : "-"} />
            <Summary label="Dispatch" value={selectedDispatch?.dispatch_number ?? "Select a packed dispatch"} />
            <Summary label="Dispatch weight" value={selectedDispatch ? formatWeight(selectedDispatch.total_weight_kg) : "-"} />
            {selectedOrder?.current_stage === "cancelled" ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold leading-5 text-amber-900">This order&apos;s unfulfilled remainder is cancelled. This invoice covers only the verified shipment posted before cancellation; its dispatched stock remains unchanged.</div> : null}
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-xs font-semibold leading-5 text-blue-900">The saved invoice total is recalculated from the selected dispatch packing lines. Full-order proformas are intentionally kept out of receivables until a separate proforma workflow is available.</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4 border-b border-neutral-100 pb-3"><span className="font-medium text-neutral-500">{label}</span><span className="text-right font-bold capitalize text-neutral-950">{value}</span></div>;
}

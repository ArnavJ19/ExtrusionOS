"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading";
import { PageHeader } from "@/components/layout/page-header";
import { orderSchema } from "@/lib/validations/schemas";
import { createClient } from "@/lib/supabase/browser";
import { formatCurrency, formatDate, todayIso } from "@/lib/utils/format";
import { getErrorMessage } from "@/lib/utils/errors";
import { rowMatchesSearch } from "@/lib/utils/search";
import { saveOrderAction } from "@/lib/actions/quotes-orders";
import { labelize, orderPriorities, orderStages, type SessionContext } from "@/types/app";

export function OrdersClient({ context }: { context: SessionContext }) {
  const supabase = useMemo(() => createClient(), []);
  const [customers, setCustomers] = useState<Record<string, any>[]>([]);
  const [quotes, setQuotes] = useState<Record<string, any>[]>([]);
  const [orders, setOrders] = useState<Record<string, any>[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ customer_id: "", quote_id: "", order_date: todayIso(), expected_dispatch_date: "", priority: "normal", current_stage: "order_confirmed", order_value: 0, notes: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function loadAll() {
    setLoading(true);
    const [customerResult, quoteResult, orderResult] = await Promise.all([
      supabase.from("customers").select("id, customer_name, company_name").eq("company_id", context.companyId).order("customer_name"),
      supabase.from("quotes").select("id, quote_number, customer_id, grand_total, status").eq("company_id", context.companyId).eq("status", "customer_approved").order("quote_date", { ascending: false }),
      supabase.from("orders").select("*, customers(customer_name, company_name), quotes(quote_number)").eq("company_id", context.companyId).order("created_at", { ascending: false })
    ]);
    setLoading(false);
    if (customerResult.error) toast.error(getErrorMessage(customerResult.error));
    if (quoteResult.error) toast.error(getErrorMessage(quoteResult.error));
    if (orderResult.error) toast.error(getErrorMessage(orderResult.error));
    setCustomers(customerResult.data ?? []);
    setQuotes(quoteResult.data ?? []);
    setOrders(orderResult.data ?? []);
  }

  useEffect(() => { void loadAll(); }, []);

  function selectQuote(quoteId: string) {
    const quote = quotes.find((candidate) => candidate.id === quoteId);
    setForm((current) => ({ ...current, quote_id: quoteId, customer_id: quote?.customer_id ?? current.customer_id, order_value: quote?.grand_total ?? current.order_value }));
  }

  async function saveOrder() {
    const parsed = orderSchema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Please check order details");
    if (!customers.some((customer) => customer.id === parsed.data.customer_id)) return toast.error("Selected customer is not available for this company.");
    if (parsed.data.quote_id && !quotes.some((quote) => quote.id === parsed.data.quote_id && quote.customer_id === parsed.data.customer_id)) return toast.error("Selected quote does not match this company/customer.");
    setSaving(true);
    const result = await saveOrderAction({ ...parsed.data, editing_id: editingId });
    setSaving(false);
    if (!result.success) return toast.error(result.error);
    toast.success("Order saved");
    setEditingId(null);
    setForm({ customer_id: "", quote_id: "", order_date: todayIso(), expected_dispatch_date: "", priority: "normal", current_stage: "order_confirmed", order_value: 0, notes: "" });
    await loadAll();
  }


  const filtered = orders.filter((order) => rowMatchesSearch(order, search));
  const today = todayIso();

  return (
    <div>
      <PageHeader title="Orders" description="Track approved quotes and manual orders through extrusion, finishing, packing, dispatch, and delivery stages." />
      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <Card><CardContent><h2 className="section-title mb-1">{editingId ? "Edit order" : "Create order"}</h2><p className="mb-5 text-sm font-medium text-slate-500">Convert approved work into a simple production plan your team can follow.</p><div className="grid gap-4">
          <label className="block space-y-1.5"><span className="form-label">Approved quote optional</span><select className="form-input" value={form.quote_id} onChange={(event) => selectQuote(event.target.value)}><option value="">Manual order</option>{quotes.map((quote) => <option key={quote.id} value={quote.id}>{quote.quote_number} · {formatCurrency(quote.grand_total)}</option>)}</select></label>
          <label className="block space-y-1.5"><span className="form-label">Customer *</span><select className="form-input" value={form.customer_id} onChange={(event) => setForm({ ...form, customer_id: event.target.value })}><option value="">Select customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.company_name || customer.customer_name}</option>)}</select></label>
          <label className="block space-y-1.5"><span className="form-label">Order date</span><input className="form-input" type="date" value={form.order_date} onChange={(event) => setForm({ ...form, order_date: event.target.value })} /></label>
          <label className="block space-y-1.5"><span className="form-label">Expected dispatch</span><input className="form-input" type="date" value={form.expected_dispatch_date} onChange={(event) => setForm({ ...form, expected_dispatch_date: event.target.value })} /></label>
          <label className="block space-y-1.5"><span className="form-label">Priority</span><select className="form-input" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>{orderPriorities.map((value) => <option key={value} value={value}>{labelize(value)}</option>)}</select></label>
          <div className="space-y-1.5"><span className="form-label">Stage</span><div className="flex min-h-12 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4"><Badge value={editingId ? form.current_stage : "order_confirmed"} /><span className="text-xs font-semibold text-slate-600">Production and dispatch events advance this stage.</span></div></div>
          <label className="block space-y-1.5"><span className="form-label">Order value</span><input className="form-input" type="number" inputMode="decimal" min="0" value={form.order_value} onChange={(event) => setForm({ ...form, order_value: Number(event.target.value) })} /></label>
          <label className="block space-y-1.5"><span className="form-label">Notes</span><textarea className="form-input min-h-24" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
          <div className="flex gap-2"><Button disabled={saving || loading} onClick={saveOrder}>{saving ? "Saving..." : "Save order"}</Button>{editingId ? <Button variant="secondary" onClick={() => setEditingId(null)}>Cancel</Button> : null}</div>
        </div></CardContent></Card>
        <Card><CardContent><div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><input className="form-input max-w-md" placeholder="Search order, customer, stage, priority..." value={search} onChange={(event) => setSearch(event.target.value)} /><p className="rounded-full bg-aluminium px-3 py-1.5 text-xs font-black uppercase tracking-[0.1em] text-slate-600">{filtered.length} orders</p></div>{loading ? <LoadingState title="Loading orders" description="Fetching order book, approved quotes, and customers." /> : filtered.length ? <div className="overflow-x-auto"><table className="industrial-table min-w-[900px]"><thead><tr><th>Order</th><th>Customer</th><th>Order date</th><th>Expected</th><th>Stage</th><th>Priority</th><th>Value</th><th>Actions</th></tr></thead><tbody>{filtered.map((order) => { const delayed = order.expected_dispatch_date && order.expected_dispatch_date < today && !["dispatched", "delivered", "closed", "cancelled"].includes(order.current_stage); return <tr key={order.id}><td className="font-black text-slate-950">{order.order_number}</td><td>{order.customers?.company_name || order.customers?.customer_name}</td><td>{formatDate(order.order_date)}</td><td>{formatDate(order.expected_dispatch_date)} {delayed ? <Badge value="delayed" /> : null}</td><td><Badge value={order.current_stage} /></td><td><Badge value={order.priority} /></td><td className="font-black text-slate-950">{formatCurrency(order.order_value)}</td><td><Button variant="ghost" onClick={() => { setEditingId(order.id); setForm({ customer_id: order.customer_id, quote_id: order.quote_id ?? "", order_date: order.order_date, expected_dispatch_date: order.expected_dispatch_date ?? "", priority: order.priority, current_stage: order.current_stage, order_value: order.order_value, notes: order.notes ?? "" }); }}>Edit</Button></td></tr>; })}</tbody></table></div> : <EmptyState title="No orders yet" description="Create an order manually or convert an approved quotation." />}</CardContent></Card>
      </div>
      <Card className="mt-6">
        <CardContent>
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Factory movement</p><h2 className="section-title">Production Kanban</h2></div><p className="text-sm font-medium text-slate-500">Move orders stage-by-stage without complex training.</p></div>
          {loading ? <LoadingState title="Loading production board" description="Preparing current order stages." /> : <div className="flex gap-4 overflow-x-auto pb-2">
            {orderStages.map((stage) => (
              <div key={stage} className="min-w-72 max-w-72 rounded-3xl border border-slate-200 bg-aluminium/60 p-3 shadow-inner">
                <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-black text-slate-950">{labelize(stage)}</h3><span className="rounded-full bg-white px-2.5 py-1 text-xs font-black text-slate-500 ring-1 ring-slate-200">{orders.filter((order) => order.current_stage === stage).length}</span></div>
                <div className="space-y-2">
                  {orders.filter((order) => order.current_stage === stage).length === 0 ? <div className="empty-mini">No orders in this stage</div> : null}
                  {orders.filter((order) => order.current_stage === stage).map((order) => (
                    <div key={order.id} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                      <p className="font-black text-slate-950">{order.order_number}</p>
                      <p className="text-xs font-medium text-slate-500">{order.customers?.company_name || order.customers?.customer_name}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-600">Dispatch: {formatDate(order.expected_dispatch_date)}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <Badge value={order.priority} />
                        <b className="text-sm text-slate-950">{formatCurrency(order.order_value)}</b>
                      </div>
                      <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">Stage updates when the linked factory workflow completes.</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>}
        </CardContent>
      </Card>
    </div>
  );
}

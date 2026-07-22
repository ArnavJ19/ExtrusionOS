"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading";
import { PageHeader } from "@/components/layout/page-header";
import { saveDispatchAction, updateDeliveryStatusAction } from "@/lib/actions/dispatches";
import { dispatchSchema } from "@/lib/validations/schemas";
import { createClient } from "@/lib/supabase/browser";
import { formatDate, formatWeight, todayIso } from "@/lib/utils/format";
import { getErrorMessage } from "@/lib/utils/errors";
import { rowMatchesSearch } from "@/lib/utils/search";
import { deliveryStatuses, labelize, type SessionContext } from "@/types/app";

export function DispatchesClient({ context }: { context: SessionContext }) {
  const supabase = useMemo(() => createClient(), []);
  const [orders, setOrders] = useState<Record<string, any>[]>([]);
  const [dispatches, setDispatches] = useState<Record<string, any>[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ order_id: "", dispatch_date: todayIso(), number_of_bundles: 1, total_weight_kg: 0, bundle_tare_weights_kg: "0", transporter_name: "", vehicle_number: "", driver_name: "", driver_phone: "", eway_bill_number: "", lr_number: "", delivery_status: "dispatched", proof_of_delivery_url: "", packing_list_url: "", remarks: "" });

  async function loadAll() {
    setLoading(true);
    const [orderResult, dispatchResult] = await Promise.all([
      supabase.from("orders").select("id, order_number, customer_id, current_stage, customers(customer_name, company_name)").eq("company_id", context.companyId).order("order_date", { ascending: false }),
      supabase.from("dispatches").select("*, orders(order_number, customers(customer_name, company_name))").eq("company_id", context.companyId).order("dispatch_date", { ascending: false })
    ]);
    setLoading(false);
    if (orderResult.error) toast.error(getErrorMessage(orderResult.error));
    if (dispatchResult.error) toast.error(getErrorMessage(dispatchResult.error));
    setOrders(orderResult.data ?? []);
    setDispatches(dispatchResult.data ?? []);
  }

  useEffect(() => { void loadAll(); }, []);

  async function saveDispatch() {
    const parsed = dispatchSchema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Please check dispatch details");
    if (!orders.some((order) => order.id === parsed.data.order_id)) return toast.error("Selected order is not available for this company.");
    setSaving(true);
    const result = await saveDispatchAction(parsed.data);
    setSaving(false);
    if (!result.success) return toast.error(result.error);
    toast.success("Dispatch recorded");
    setForm({ order_id: "", dispatch_date: todayIso(), number_of_bundles: 1, total_weight_kg: 0, bundle_tare_weights_kg: "0", transporter_name: "", vehicle_number: "", driver_name: "", driver_phone: "", eway_bill_number: "", lr_number: "", delivery_status: "dispatched", proof_of_delivery_url: "", packing_list_url: "", remarks: "" });
    await loadAll();
  }

  async function updateDelivery(dispatch: Record<string, any>, status: string) {
    const result = await updateDeliveryStatusAction(dispatch.id, status);
    if (!result.success) return toast.error(result.error);
    toast.success("Delivery status updated");
    await loadAll();
  }

  const filtered = dispatches.filter((dispatch) => rowMatchesSearch(dispatch, search));

  return (
    <div>
      <PageHeader title="Dispatches" description="Track bundles, transporter, vehicle, driver, e-way bill, LR number, and delivery status." />
      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <Card><CardContent><h2 className="section-title mb-1">Create dispatch</h2><p className="mb-5 text-sm font-medium text-slate-500">Record shipment details clearly for factory, accounts, and customer follow-up.</p><div className="grid gap-4">
          <label className="block space-y-1.5"><span className="form-label">Order *</span><select className="form-input" value={form.order_id} onChange={(event) => setForm({ ...form, order_id: event.target.value })}><option value="">Select order</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.order_number} · {order.customers?.company_name || order.customers?.customer_name}</option>)}</select></label>
          <label className="block space-y-1.5"><span className="form-label">Dispatch date</span><input className="form-input" type="date" value={form.dispatch_date} onChange={(event) => setForm({ ...form, dispatch_date: event.target.value })} /></label>
          <label className="block space-y-1.5"><span className="form-label">Bundles</span><input className="form-input" type="number" inputMode="numeric" min="0" value={form.number_of_bundles} onChange={(event) => setForm({ ...form, number_of_bundles: Number(event.target.value) })} /></label>
          <label className="block space-y-1.5"><span className="form-label">Net aluminium weight kg</span><input className="form-input" type="number" inputMode="decimal" min="0" step="0.001" value={form.total_weight_kg} onChange={(event) => setForm({ ...form, total_weight_kg: Number(event.target.value) })} /></label>
          <label className="block space-y-1.5"><span className="form-label">Bundle tare kg, one per line</span><textarea className="form-input min-h-24" value={form.bundle_tare_weights_kg} onChange={(event) => setForm({ ...form, bundle_tare_weights_kg: event.target.value })} /></label>
          <label className="block space-y-1.5"><span className="form-label">Transporter</span><input className="form-input" value={form.transporter_name} onChange={(event) => setForm({ ...form, transporter_name: event.target.value })} /></label>
          <label className="block space-y-1.5"><span className="form-label">Vehicle number</span><input className="form-input" value={form.vehicle_number} onChange={(event) => setForm({ ...form, vehicle_number: event.target.value.toUpperCase() })} /></label>
          <label className="block space-y-1.5"><span className="form-label">Driver name</span><input className="form-input" value={form.driver_name} onChange={(event) => setForm({ ...form, driver_name: event.target.value })} /></label>
          <label className="block space-y-1.5"><span className="form-label">Driver phone</span><input className="form-input" value={form.driver_phone} onChange={(event) => setForm({ ...form, driver_phone: event.target.value })} /></label>
          <label className="block space-y-1.5"><span className="form-label">E-way bill</span><input className="form-input" value={form.eway_bill_number} onChange={(event) => setForm({ ...form, eway_bill_number: event.target.value })} /></label>
          <label className="block space-y-1.5"><span className="form-label">LR number</span><input className="form-input" value={form.lr_number} onChange={(event) => setForm({ ...form, lr_number: event.target.value })} /></label>
          <label className="block space-y-1.5"><span className="form-label">Status</span><select className="form-input" value={form.delivery_status} onChange={(event) => setForm({ ...form, delivery_status: event.target.value })}>{deliveryStatuses.map((value) => <option key={value} value={value}>{labelize(value)}</option>)}</select></label>
          <label className="block space-y-1.5"><span className="form-label">Proof of delivery URL</span><input className="form-input" value={form.proof_of_delivery_url} onChange={(event) => setForm({ ...form, proof_of_delivery_url: event.target.value })} /></label>
          <label className="block space-y-1.5"><span className="form-label">Packing list URL</span><input className="form-input" value={form.packing_list_url} onChange={(event) => setForm({ ...form, packing_list_url: event.target.value })} /></label>
          <label className="block space-y-1.5"><span className="form-label">Remarks</span><textarea className="form-input min-h-20" value={form.remarks} onChange={(event) => setForm({ ...form, remarks: event.target.value })} /></label>
          <Button disabled={saving || loading} onClick={saveDispatch}>{saving ? "Saving..." : "Record dispatch"}</Button>
        </div></CardContent></Card>
        <Card><CardContent><div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><input className="form-input max-w-md" placeholder="Search dispatch, order, customer, transporter, vehicle, e-way bill..." value={search} onChange={(event) => setSearch(event.target.value)} /><p className="rounded-full bg-aluminium px-3 py-1.5 text-xs font-black uppercase tracking-[0.1em] text-slate-600">{filtered.length} dispatches</p></div>{loading ? <LoadingState title="Loading dispatches" description="Fetching dispatch history and available orders." /> : filtered.length ? <div className="overflow-x-auto"><table className="industrial-table min-w-[900px]"><thead><tr><th>Dispatch</th><th>Order</th><th>Customer</th><th>Date</th><th>Bundles</th><th>Weight</th><th>Transporter</th><th>Vehicle</th><th>Status</th></tr></thead><tbody>{filtered.map((dispatch) => <tr key={dispatch.id}><td className="font-black text-slate-950">{dispatch.dispatch_number}</td><td>{dispatch.orders?.order_number}</td><td>{dispatch.orders?.customers?.company_name || dispatch.orders?.customers?.customer_name}</td><td>{formatDate(dispatch.dispatch_date)}</td><td>{dispatch.number_of_bundles}</td><td>{formatWeight(dispatch.total_weight_kg)}</td><td>{dispatch.transporter_name}</td><td>{dispatch.vehicle_number}</td><td><select className="form-input" value={dispatch.delivery_status} onChange={(event) => updateDelivery(dispatch, event.target.value)}>{deliveryStatuses.map((value) => <option key={value} value={value}>{labelize(value)}</option>)}</select></td></tr>)}</tbody></table></div> : <EmptyState title="No dispatches yet" description="Record dispatches with transporter, vehicle, e-way bill, LR, bundles, and delivery status." />}</CardContent></Card>
      </div>
    </div>
  );
}

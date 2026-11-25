import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { CommandForm, DeliveryReceiptForm } from "@/components/modules/orchestration/delivery-closure-forms";
import { getSessionContext } from "@/lib/auth";
import { hasRouteAccess } from "@/lib/auth/route-permissions";
import { deliveryTrackingAction } from "@/lib/actions/orchestration";
import { formatWeight } from "@/lib/utils/format";
import {
  ACCEPTANCE_LABELS, ACKNOWLEDGEMENT_LABELS, COMPLAINT_STATUS_LABELS, SHIPMENT_STATE_LABELS, TRACKING_KIND_LABELS, TRACKING_KINDS, deliveryDetailSchema
} from "@/lib/workflow/delivery-closure";

const at = (value: string | null | undefined) => (value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—");
const text = (v: string) => v.replace(/_/g, " ");

// Phase 7: one shipment — its state, tracking updates, delivery receipt, the customer's disposition of every bundle and
// any complaint. Dispatch records status updates; sales records customer reports, receipts and acceptance.
export default async function DeliveryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, context] = await Promise.all([params, getSessionContext()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (context.dealerId || !hasRouteAccess("/dispatches/deliveries", context.role)) redirect("/dashboard");
  const result = await deliveryTrackingAction({ command: "get", dispatch_id: id });
  const parsed = result.success ? deliveryDetailSchema.safeParse(result.data) : null;
  if (!result.success || !parsed?.success) {
    return <div className="space-y-4"><PageHeader title="Shipment" backHref="/dispatches/deliveries" backLabel="Back to delivery monitoring" />
      <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : "The shipment could not be read."}</p></div>;
  }
  const d = parsed.data;
  const s = d.shipment;
  const current = d.receipts.find(r => r.status === "current") ?? null;
  const moving = ["dispatched", "in_transit", "delayed"].includes(d.dispatch.delivery_status);
  const kinds = TRACKING_KINDS.filter(k => d.can_change_status || (k !== "in_transit" && k !== "delayed"));
  return (
    <div className="space-y-5">
      <PageHeader title={`${d.dispatch.dispatch_number ?? "Dispatch"} · ${SHIPMENT_STATE_LABELS[s.state]}`} backHref="/dispatches/deliveries" backLabel="Back to delivery monitoring"
        description={`Order ${d.order.order_number ?? "—"} · ${d.order.customer ?? "—"} · ${d.manifest.bundles} bundle(s), ${formatWeight(d.manifest.kg)} net · ${d.dispatch.vehicle_number ?? "no vehicle"}${d.dispatch.lr_number ? ` · LR ${d.dispatch.lr_number}` : ""}${d.dispatch.transporter_name ? ` · ${d.dispatch.transporter_name}` : ""}`}
        actions={<div className="flex flex-wrap gap-2"><LiveRefresh name="delivery" tables={["dispatches", "dispatch_tracking_updates", "delivery_receipts"]} />
          <Link href={`/dispatches/${id}`} className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Dispatch record</Link>
          <Link href={`/orders/${d.order.id}/lifecycle`} className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Order lifecycle</Link></div>} />
      {d.replacement_for ? <p className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm font-semibold text-sky-950">Free-of-charge replacement for complaint {d.replacement_for}: no invoice is raised for this dispatch.</p> : null}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-3"><p className="text-xs font-bold uppercase text-slate-500">Left the factory</p><p className="font-bold">{at(s.dispatched_at)}</p></div>
        <div className={`rounded-2xl border p-3 ${s.overdue ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}><p className="text-xs font-bold uppercase text-slate-500">Expected delivery</p><p className="font-bold">{at(s.expected_at)}</p>{s.overdue ? <p className="text-xs font-bold text-red-900">Confirmation overdue</p> : null}</div>
        <div className="rounded-2xl border border-slate-200 bg-white p-3"><p className="text-xs font-bold uppercase text-slate-500">Proof of delivery</p><p className="font-bold">{s.pod_on_file ? `On file · delivered ${at(s.delivered_at)}` : "Not uploaded"}</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-3"><p className="text-xs font-bold uppercase text-slate-500">Customer acceptance</p><p className="font-bold">{ACCEPTANCE_LABELS[s.acceptance.outcome]}</p>
          <p className="text-xs text-slate-600">{s.acceptance.lines - s.acceptance.pending_lines} of {s.acceptance.lines} bundle(s) with a disposition{s.acceptance.unresolved ? ` · ${s.acceptance.unresolved} unresolved` : ""}</p></div>
      </section>
      {s.discrepancy?.open ? <p role="status" className={`rounded-2xl border p-3 text-sm font-semibold ${s.discrepancy.resolved ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
        Delivery discrepancy: {formatWeight(s.discrepancy.discrepancy_kg)} not received in good condition{s.discrepancy.missing_bundles > 0 ? `, ${s.discrepancy.missing_bundles} bundle(s) missing` : ""}. {s.discrepancy.resolved ? "Accounted for by resolved bundle dispositions." : `${formatWeight(s.discrepancy.covered_kg)} recorded on bundles so far; record each affected bundle with its resolution.`}</p> : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          {d.can_track && moving ? <CommandForm area="delivery" command="tracking.record" fixed={{ dispatch_id: id }} withId title="Record a shipment update" submitLabel="Record update" done="Update recorded."
            help={d.can_change_status ? "In transit and delay updates move the dispatch status. A reported delivery waits for the proof of delivery." : "Record what the customer, driver or transporter reported. Dispatch records in-transit and delay updates."}
            fields={[{ name: "kind", label: "What was reported", type: "select", required: true, options: kinds.map(k => ({ value: k, label: TRACKING_KIND_LABELS[k] })) },
              { name: "source", label: "Reported by", type: "select", required: true, options: [{ value: "transporter", label: "Transporter" }, { value: "driver", label: "Driver" }, { value: "customer", label: "Customer" }, { value: "staff", label: "Our staff" }] },
              { name: "location", label: "Location", type: "text", maxLength: 120 }, { name: "revised_eta", label: "Revised delivery time (with a delay or ETA revision)", type: "datetime" },
              { name: "note", label: "Note", type: "textarea", required: true, minLength: 5, maxLength: 500 }]} /> : null}
          {d.can_record_receipt && d.dispatch.delivery_status === "delivered" ? <DeliveryReceiptForm dispatchId={id} bundles={d.manifest.bundles} netKg={d.manifest.kg} correcting={Boolean(current)} /> : null}
          {d.can_record_receipt && d.dispatch.delivery_status !== "delivered" && d.dispatch.delivery_status !== "returned" ? <p className="rounded-2xl border border-slate-200 bg-white p-3 text-sm">Once the material arrives, mark the dispatch delivered with its proof of delivery on the <Link className="font-semibold underline" href={`/dispatches/${id}`}>dispatch record</Link>; then record the delivery receipt here.</p> : null}
          <Link className="inline-flex min-h-11 items-center text-sm font-bold underline" href={`/tasks/assurance/deliveries/${id}`}>Record shortage, damage or refusal per bundle</Link>
          <Link className="ml-4 inline-flex min-h-11 items-center text-sm font-bold underline" href={`/quality/complaints/new?order_id=${d.order.id}`}>Log a customer complaint</Link>
        </div>
        <div className="space-y-3">
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-bold">Delivery receipt</h2>
            {current ? <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-slate-500">Delivered</dt><dd>{at(current.delivered_at)}</dd>
              <dt className="text-slate-500">Received by</dt><dd>{current.receiver_name} · {current.receiving_company}{current.receiver_phone ? ` · ${current.receiver_phone}` : ""}</dd>
              <dt className="text-slate-500">Bundles</dt><dd>{current.received_bundles} of {current.dispatched_bundles}</dd>
              <dt className="text-slate-500">Kilograms</dt><dd>{formatWeight(current.received_kg)} of {formatWeight(current.dispatched_kg)}</dd>
              <dt className="text-slate-500">Short / damaged</dt><dd>{formatWeight(current.shortage_kg)} / {formatWeight(current.damaged_kg)}</dd>
              <dt className="text-slate-500">Acknowledged by</dt><dd>{ACKNOWLEDGEMENT_LABELS[current.acknowledgement]}{current.accepted_all ? " · accepted in full" : ""}</dd>
              <dt className="text-slate-500">Recorded</dt><dd>{current.recorded_by_name ?? "—"} · {at(current.recorded_at)}</dd>
              {current.note ? <><dt className="text-slate-500">Note</dt><dd className="[overflow-wrap:anywhere]">{current.note}</dd></> : null}
            </dl> : <p className="mt-1 text-sm">Not recorded yet.</p>}
            {d.receipts.length > 1 ? <p className="mt-2 text-xs text-slate-600">{d.receipts.length - 1} earlier receipt(s) superseded: {d.receipts.filter(r => r.status === "superseded").map(r => r.correction_reason ?? "").filter(Boolean).join("; ") || "see history"}.</p> : null}
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-bold">Bundles and customer disposition</h2>
            <ul className="mt-2 divide-y text-sm">{d.lines.map(l => <li key={l.id} className="py-2"><span className="font-mono font-semibold">{l.bundle_number}</span> · {l.pieces} pcs · {formatWeight(l.net_kg)}
              <span className="block text-xs text-slate-600">{l.dispositions.length ? l.dispositions.map(x => `${text(x.disposition)} ${formatWeight(x.quantity_kg)}${x.resolution ? ` → ${text(x.resolution)}` : x.disposition !== "accepted" ? " (unresolved)" : ""}`).join("; ") : "No disposition yet"}</span></li>)}</ul>
          </section>
          {d.complaints.length ? <section className="rounded-2xl border border-slate-200 bg-white p-4"><h2 className="text-lg font-bold">Complaints</h2>
            <ul className="mt-2 space-y-1 text-sm">{d.complaints.map(c => <li key={c.id}><Link className="font-semibold underline" href={`/quality/complaints/${c.id}`}>{c.complaint_number}</Link> · {text(c.category)} · {c.severity} · {COMPLAINT_STATUS_LABELS[c.status]}</li>)}</ul></section> : null}
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-bold">Shipment updates</h2>
            {d.tracking.length ? <ol className="mt-2 space-y-2 border-l border-slate-200 pl-4 text-sm">{d.tracking.map(u => <li key={u.id}><p className="font-semibold">{TRACKING_KIND_LABELS[u.kind]}{u.location ? ` · ${u.location}` : ""}{u.revised_eta ? ` · expected ${at(u.revised_eta)}` : ""}</p>
              <p className="[overflow-wrap:anywhere]">{u.note}</p><p className="text-xs text-slate-500">{at(u.recorded_at)} · reported by {u.source} · recorded by {u.recorded_by_name ?? "—"}{u.status_changed_to ? ` · status → ${text(u.status_changed_to)}` : ""}</p></li>)}</ol>
              : <p className="mt-1 text-sm">No update recorded.</p>}
          </section>
        </div>
      </section>
    </div>
  );
}

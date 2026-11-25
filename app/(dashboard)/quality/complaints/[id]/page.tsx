import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { CommandForm } from "@/components/modules/orchestration/delivery-closure-forms";
import { getSessionContext } from "@/lib/auth";
import { hasRouteAccess } from "@/lib/auth/route-permissions";
import { complaintAction } from "@/lib/actions/orchestration";
import { formatWeight } from "@/lib/utils/format";
import { TASK_KIND_LABELS, departmentLabel } from "@/lib/workflow/orchestration";
import {
  COMMUNICATION_CHANNELS, COMPLAINT_CATEGORY_LABELS, COMPLAINT_STATUS_LABELS, CONTAINMENT_ACTIONS, CONTAINMENT_LABELS, DEPARTMENTS, RESOLUTIONS, RESOLUTION_LABELS,
  complaintDetailSchema, complaintNextStep, labelOf
} from "@/lib/workflow/delivery-closure";

const at = (value: string | null | undefined) => (value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—");
const text = (v: string | null | undefined) => (v ? v.replace(/_/g, " ") : "—");
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => <><dt className="text-slate-500">{label}</dt><dd className="[overflow-wrap:anywhere]">{children}</dd></>;

// Phase 7: one complaint and its workflow — containment, root cause and corrective action, resolution with replacement
// or credit note, customer communication and closure by a second person. Only the steps the person may take are shown;
// the database refuses the rest.
export default async function ComplaintDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, context] = await Promise.all([params, getSessionContext()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (context.dealerId || !hasRouteAccess("/quality/complaints", context.role)) redirect("/dashboard");
  const result = await complaintAction({ command: "get", complaint_id: id });
  const parsed = result.success ? complaintDetailSchema.safeParse(result.data) : null;
  if (!result.success || !parsed?.success) {
    return <div className="space-y-4"><PageHeader title="Customer complaint" backHref="/quality/complaints" backLabel="Back to complaints" />
      <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : "The complaint could not be read."}</p></div>;
  }
  const d = parsed.data;
  const c = d.complaint;
  const next = complaintNextStep(c.status, c.category);
  const fixed = { complaint_id: id };
  return (
    <div className="space-y-5">
      <PageHeader title={`${c.complaint_number} · ${COMPLAINT_STATUS_LABELS[c.status]}`} backHref="/quality/complaints" backLabel="Back to complaints"
        description={`${d.customer.name ?? "Customer"} · ${COMPLAINT_CATEGORY_LABELS[c.category]} · ${c.severity} severity · logged ${at(c.logged_at)} by ${c.logged_by_name ?? "—"}`}
        actions={<div className="flex flex-wrap gap-2"><LiveRefresh name="complaint" tables={["customer_complaint_events"]} />
          {d.order ? <Link href={`/orders/${d.order.id}/lifecycle`} className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Order {d.order.order_number}</Link> : null}
          {d.dispatch ? <Link href={`/dispatches/deliveries/${d.dispatch.id}`} className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Shipment {d.dispatch.dispatch_number}</Link> : null}</div>} />
      {next ? <p className={`rounded-2xl border p-3 text-sm font-semibold ${c.overdue ? "border-red-200 bg-red-50 text-red-950" : "border-slate-200 bg-white"}`}>
        Next: {next.label} — {departmentLabel(next.department)} · due {at(c.due_at)}{c.overdue ? " (overdue)" : ""}{d.close_blocker ? `. Before closing: ${d.close_blocker}.` : ""}</p> : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-bold">Reported</h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <Row label="Defect">{c.description}</Row>
              <Row label="Reported on">{c.reported_on ?? "—"}{c.customer_reference ? ` · ref ${c.customer_reference}` : ""}</Row>
              <Row label="Suspected">{c.suspected_kg ? formatWeight(c.suspected_kg) : "—"}</Row>
              <Row label="Evidence">{c.evidence ?? "—"}</Row>
              <Row label="NCR">{c.ncr_number ? `${c.ncr_number} (${c.ncr_status})` : "—"}</Row>
            </dl>
            {d.items.length ? <ul className="mt-3 divide-y rounded-xl border text-sm">{d.items.map(x => <li key={x.packing_list_item_id} className="px-3 py-2"><span className="font-mono font-semibold">{x.bundle_number}</span> · {formatWeight(x.affected_kg)} affected</li>)}</ul> : <p className="mt-2 text-sm text-slate-600">No bundle named.</p>}
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-bold">Investigation and action</h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <Row label="Containment">{labelOf(CONTAINMENT_LABELS, c.containment_action)}{c.containment_number ? ` · ${c.containment_number}` : ""}{c.containment_note ? ` — ${c.containment_note}` : ""}</Row>
              <Row label="Root cause">{c.root_cause ?? "—"}</Row>
              <Row label="Corrective action">{c.corrective_action ?? "—"}</Row>
              <Row label="Preventive action">{c.preventive_action ?? "—"}</Row>
              <Row label="Responsible">{c.responsible_department ? departmentLabel(c.responsible_department) : "—"}{c.cause_recorded_by_name ? ` · recorded by ${c.cause_recorded_by_name}` : ""}</Row>
            </dl>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-bold">Resolution</h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <Row label="Resolution">{labelOf(RESOLUTION_LABELS, c.resolution)}{c.resolved_by_name ? ` · ${c.resolved_by_name}, ${at(c.resolved_at)}` : ""}</Row>
              <Row label="Agreed with the customer">{c.resolution_note ?? "—"}</Row>
              {c.replacement_kg ? <Row label="Replacement">{formatWeight(c.replaced_kg)} of {formatWeight(c.replacement_kg)} dispatched · {text(c.replacement_billing)}</Row> : null}
              <Row label="Credit note">{c.credit_note_number ? `${c.credit_note_number} (${c.credit_note_status})` : "—"}</Row>
              {c.closed_at ? <Row label={c.status === "closed" ? "Closed" : text(c.status)}>{c.closed_by_name ?? "—"}, {at(c.closed_at)} — {c.closure_note}</Row> : null}
            </dl>
            {d.replacements.length ? <ul className="mt-3 divide-y rounded-xl border text-sm">{d.replacements.map(r => <li key={r.id} className={`px-3 py-2 ${r.withdrawn_at ? "text-slate-500 line-through" : ""}`}>
              <Link className="font-semibold underline" href={`/dispatches/deliveries/${r.dispatch_id}`}>{r.dispatch_number ?? "Dispatch"}</Link> · {formatWeight(r.kg)} · {text(r.delivery_status)} · linked by {r.linked_by_name ?? "—"}
              {r.withdrawn_at ? <span className="block text-xs no-underline">Withdrawn: {r.withdraw_note}</span> : null}</li>)}</ul> : null}
          </section>
        </div>

        <div className="space-y-3">
          {d.can.investigate && (c.status === "open" || c.status === "investigating") ? <CommandForm area="complaint" command="investigate" fixed={fixed} title={c.status === "open" ? "Record the containment decision" : "Update the containment decision"}
            submitLabel="Record containment" done="Containment recorded." help="For a QC containment, open it on the containment screen first, then choose it here."
            fields={[{ name: "containment_action", label: "Containment", type: "select", required: true, options: CONTAINMENT_ACTIONS.map(a => ({ value: a, label: CONTAINMENT_LABELS[a] })) },
              { name: "containment_id", label: "QC containment (only with the QC containment decision)", type: "select",
                options: (d.containment_candidates ?? []).map(x => ({ value: x.id, label: `${x.containment_number} · ${text(x.status)} · ${x.defect}` })) },
              { name: "containment_note", label: "What was held or checked", type: "textarea", required: true, minLength: 5 }]} /> : null}
          {d.can.root_cause && c.status === "investigating" ? <CommandForm area="complaint" command="root_cause" fixed={fixed} title="Record the root cause and corrective action" submitLabel="Record root cause" done="Root cause recorded; sales agrees the resolution next."
            fields={[{ name: "root_cause", label: "Root cause", type: "textarea", required: true, minLength: 10 }, { name: "corrective_action", label: "Corrective action", type: "textarea", required: true, minLength: 10 },
              { name: "preventive_action", label: "Preventive action", type: "textarea", minLength: 10 },
              { name: "responsible_department", label: "Responsible department", type: "select", required: true, options: DEPARTMENTS.map(x => ({ value: x, label: departmentLabel(x) })) }]} /> : null}
          {d.can.resolve ? <CommandForm area="complaint" command="resolve" fixed={fixed} title="Record the agreed resolution" submitLabel="Record resolution" done="Resolution recorded."
            help="A replacement is made on the same order: free of charge (its own dispatch, never invoiced) or chargeable (invoiced only after a credit note for the rejected material)."
            fields={[{ name: "resolution", label: "Resolution", type: "select", required: true, options: RESOLUTIONS.map(r => ({ value: r, label: RESOLUTION_LABELS[r] })) },
              { name: "replacement_kg", label: "Replacement quantity, kg (replacement only)", type: "number", min: 0.001, step: "0.001" },
              { name: "replacement_billing", label: "Replacement billing (replacement only)", type: "select", options: [{ value: "free_of_charge", label: "Free of charge" }, { value: "chargeable", label: "Chargeable" }] },
              { name: "resolution_note", label: "What was agreed and told to the customer", type: "textarea", required: true, minLength: 10 }]} /> : null}
          {d.can.link_replacement ? <CommandForm area="complaint" command="link_replacement" fixed={fixed} withId collapsed title="Link a replacement dispatch" submitLabel="Link dispatch" done="Replacement dispatch linked."
            help="The dispatch must belong to the same order. A free replacement links its whole dispatch."
            fields={[{ name: "dispatch_id", label: "Replacement dispatch", type: "select", required: true,
                options: (d.replacement_candidates ?? []).map(x => ({ value: x.id, label: `${x.dispatch_number ?? "Dispatch"} · ${text(x.delivery_status)} · ${formatWeight(x.kg)}${x.invoiced ? " · invoiced" : ""}` })) },
              { name: "kg", label: "Replacement kg on it (default: the whole dispatch)", type: "number", min: 0.001, step: "0.001" }]} /> : null}
          {d.can.link_credit_note ? <CommandForm area="complaint" command="link_credit_note" fixed={fixed} collapsed title="Link the credit note" submitLabel="Link credit note" done="Credit note linked."
            fields={[{ name: "credit_note_id", label: "Issued credit note", type: "select", required: true,
              options: (d.credit_note_candidates ?? []).map(x => ({ value: x.id, label: `${x.credit_note_number} · ${x.credit_date} · invoice ${x.invoice_number ?? "—"}` })) }]} /> : null}
          {d.can.communicate ? <CommandForm area="complaint" command="communicate" fixed={fixed} collapsed title="Record customer communication" submitLabel="Record" done="Communication recorded."
            fields={[{ name: "channel", label: "Channel", type: "select", required: true, options: COMMUNICATION_CHANNELS.map(x => ({ value: x, label: text(x) })) },
              { name: "summary", label: "What was communicated", type: "textarea", required: true, minLength: 10 }]} /> : null}
          {d.can.close ? <CommandForm area="complaint" command="close" fixed={fixed} title="Verify and close" submitLabel="Close complaint" done="Complaint closed."
            help={d.close_blocker ? `Not yet: ${d.close_blocker}.` : "Verify that the corrective action works and the customer accepted the resolution."}
            fields={[{ name: "note", label: "Verification", type: "textarea", required: true, minLength: 10 }]} /> : c.status === "resolved" ? <p className="rounded-2xl border border-slate-200 bg-white p-3 text-sm">Another person (factory manager, QA, admin or owner) verifies and closes the complaint.</p> : null}
          {d.can.reject ? <CommandForm area="complaint" command="reject" fixed={fixed} collapsed danger title="Reject as not valid" submitLabel="Reject complaint" done="Complaint rejected."
            fields={[{ name: "note", label: "Why it is not valid, and what the customer was told", type: "textarea", required: true, minLength: 10 }]} /> : null}
          {d.can.withdraw ? <CommandForm area="complaint" command="withdraw" fixed={fixed} collapsed danger title="Customer withdrew it" submitLabel="Record withdrawal" done="Withdrawal recorded."
            fields={[{ name: "note", label: "How the customer withdrew it", type: "textarea", required: true, minLength: 10 }]} /> : null}

          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-bold">Work</h2>
            {d.tasks.length ? <ul className="mt-2 space-y-1 text-sm">{d.tasks.map(t => <li key={t.id}>{TASK_KIND_LABELS[t.kind] ?? t.kind} · {departmentLabel(t.department)} · {t.status}{t.resolution ? ` — ${t.resolution}` : ""}</li>)}</ul> : <p className="mt-1 text-sm">No task yet.</p>}
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-bold">History</h2>
            <ol className="mt-2 space-y-2 border-l border-slate-200 pl-4 text-sm">{d.events.map((e, n) => <li key={`${e.occurred_at}-${n}`}><p className="font-semibold">{text(e.action)}{e.to_status && e.to_status !== e.from_status ? ` → ${text(e.to_status)}` : ""}</p>
              {e.note ? <p className="[overflow-wrap:anywhere]">{e.note}</p> : null}<p className="text-xs text-slate-500">{at(e.occurred_at)} · {e.actor_name ?? "—"}</p></li>)}</ol>
          </section>
        </div>
      </section>
    </div>
  );
}

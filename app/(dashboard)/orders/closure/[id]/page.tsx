import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { CommandForm } from "@/components/modules/orchestration/delivery-closure-forms";
import { getSessionContext } from "@/lib/auth";
import { hasRouteAccess } from "@/lib/auth/route-permissions";
import { orderClosureAction } from "@/lib/actions/orchestration";
import { closureDetailSchema, type ReadinessItem } from "@/lib/workflow/delivery-closure";
import { overallLabel } from "@/lib/workflow/orchestration";

const at = (value: string | null | undefined) => (value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—");
const text = (v: string | null | undefined) => (v ? v.replace(/_/g, " ") : "—");
const DOMAIN_LABELS: Record<string, string> = { acceptance: "Customer acceptance", quality: "Quality and complaints", records: "Records (administrative closure)", billing: "Billing and receivables",
  dispatch: "Dispatch and delivery", sales: "Sales", production: "Production", finishing: "Finishing", inventory: "Inventory" };

function Checklist({ title, items }: { title: string; items: ReadinessItem[] }) {
  const groups = [...new Set(items.map(i => i.domain))];
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-bold">{title}</h2>
      {items.length === 0 ? <p className="mt-1 text-sm text-emerald-800">Nothing open.</p> : groups.map(g => (
        <div key={g} className="mt-3"><h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">{DOMAIN_LABELS[g] ?? text(g)}</h3>
          <ul className="mt-1 space-y-2">{items.filter(i => i.domain === g).map(i => (
            <li key={i.key} className={`rounded-xl border p-2 text-sm ${i.blocking ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"}`}>
              <p className="font-semibold [overflow-wrap:anywhere]">{i.blocking ? "Open: " : i.resolved ? "Resolved: " : i.carried ? "Carried: " : "Noted: "}{i.href ? <Link className="underline" href={i.href}>{i.label}</Link> : i.label}</p>
              {i.detail ? <p className="text-xs text-slate-700 [overflow-wrap:anywhere]">{i.detail}</p> : null}
              {i.carried && i.carry_reason ? <p className="text-xs text-slate-700">Carried: {i.carry_reason}</p> : null}
              {i.owner ? <p className="text-xs text-slate-500">Owner: {text(i.owner)}</p> : null}
            </li>))}</ul></div>))}
    </section>
  );
}

// Phase 7: one order's closure record — operational, financial and administrative closure, the open obligations of each
// and the closure history. Operational and direct final closure are recorded in the closure review; an operationally
// closed order is finally closed here once every obligation is met.
export default async function OrderClosurePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, context] = await Promise.all([params, getSessionContext()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (context.dealerId || !hasRouteAccess("/orders/closure", context.role)) redirect("/dashboard");
  const result = await orderClosureAction({ command: "get", order_id: id });
  const parsed = result.success ? closureDetailSchema.safeParse(result.data) : null;
  if (!result.success || !parsed?.success) {
    return <div className="space-y-4"><PageHeader title="Order closure" backHref="/orders/closure" backLabel="Back to order closure" />
      <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : "The closure record could not be read."}</p></div>;
  }
  const d = parsed.data;
  const st = d.state;
  const finalItems = d.final?.items ?? [];
  return (
    <div className="space-y-5">
      <PageHeader title={`${d.order.order_number} · ${st.overall ? overallLabel(st.overall) : text(st.operational)}`} backHref="/orders/closure" backLabel="Back to order closure"
        description={`${d.order.customer ?? "Customer"} · ordered ${d.order.order_date} · stage ${text(d.order.stage)}`}
        actions={<div className="flex flex-wrap gap-2"><Link href={`/orders/${id}/lifecycle`} className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Order lifecycle</Link>
          {d.can_close_operational || d.can_close_final_directly ? <Link href={`/tasks/lifecycle/closure/${id}`} className="rounded-xl bg-charcoal px-4 py-3 text-sm font-bold text-white">Closure review</Link> : null}</div>} />
      <section className="grid gap-3 sm:grid-cols-3">
        {[["Operational", text(st.operational), st.closure_kind ? `${st.closure_kind} closure ${at(st.closed_at)}` : st.readiness_kind === "operational" ? `${st.blocking} item(s) open` : ""],
          ["Financial", text(st.financial), st.financial === "open" ? "Receivable, dispute or write-off open" : ""],
          ["Records", text(st.administrative ?? "checked at final closure"), st.authorization ? "Includes items closed or carried by authorisation" : ""]].map(([k, v, sub]) =>
          <div key={k} className="rounded-2xl border border-slate-200 bg-white p-3"><p className="text-xs font-bold uppercase text-slate-500">{k}</p><p className="text-lg font-bold">{v}</p>{sub ? <p className="text-xs text-slate-600">{sub}</p> : null}</div>)}
      </section>
      {d.can_finalize ? (finalItems.some(i => i.blocking)
        ? <p className="rounded-2xl border border-slate-200 bg-white p-3 text-sm">Final closure is possible once every open item below is resolved.</p>
        : <CommandForm area="closure" command="finalize" fixed={{ order_id: id }} title="Record the final closure" submitLabel="Close the order finally" done="The order is fully closed."
            help="Every invoice is settled or written off under authority, no dispute, complaint, NCR or missing delivery receipt is left. Management is told."
            fields={[{ name: "note", label: "Final closure note", type: "textarea", required: true, minLength: 10, maxLength: 500 }]} />) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {d.operational ? <Checklist title={`Operational closure · ${d.operational.blocking} open`} items={d.operational.items} /> : null}
        {d.final ? <Checklist title={`Final closure · ${d.final.blocking} open`} items={d.final.items} /> : null}
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-bold">Closure history</h2>
        {d.history.length ? <ol className="mt-2 space-y-2 border-l border-slate-200 pl-4 text-sm">{d.history.map((h, n) => <li key={`${h.closed_at}-${n}`}>
          <p className="font-semibold">{text(h.kind)} closure · {text(h.status)}</p><p className="[overflow-wrap:anywhere]">{h.close_note}</p>
          <p className="text-xs text-slate-500">{at(h.closed_at)} · {h.closed_by_name ?? "—"}{h.superseded_at ? ` · superseded by the final closure ${at(h.superseded_at)}` : ""}{h.reopened_at ? ` · reopened ${at(h.reopened_at)}: ${h.reopen_note}` : ""}</p></li>)}</ol>
          : <p className="mt-1 text-sm">Not closed yet.</p>}
      </section>
    </div>
  );
}

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ReleaseForm, RevokeReleaseButton, TermsForm } from "@/components/modules/orchestration/dispatch-forms";
import { getSessionContext } from "@/lib/auth";
import { dispatchFinanceAction } from "@/lib/actions/orchestration";
import { formatWeight } from "@/lib/utils/format";
import { canReadOrchestration } from "@/lib/workflow/orchestration";
import { CLEARANCE_STATE_LABELS, TERMS_SCOPE_LABELS, clearanceDetailSchema, formatInr } from "@/lib/workflow/dispatch-orchestration";

const at = (value: string | null) => (value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—");

export default async function DispatchClearanceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, context] = await Promise.all([params, getSessionContext()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (context.dealerId || !canReadOrchestration(context.role)) redirect("/dispatches");
  const result = await dispatchFinanceAction({ command: "status", dispatch_id: id });
  const parsed = result.success ? clearanceDetailSchema.safeParse(result.data) : null;
  if (!parsed?.success) {
    return <div className="space-y-4"><PageHeader title="Dispatch finance clearance" backHref="/dispatches/clearance" backLabel="Back to finance clearance" />
      <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : "This dispatch could not be read."}</p></div>;
  }
  const c = parsed.data, m = c.amounts;
  const tone = c.state === "blocked" ? "border-red-200 bg-red-50 text-red-950" : "border-emerald-200 bg-emerald-50 text-emerald-950";
  return (
    <div className="space-y-5">
      <PageHeader title={`${c.dispatch_number ?? "Dispatch"} · ${CLEARANCE_STATE_LABELS[c.state] ?? c.state}`} backHref="/dispatches/clearance" backLabel="Back to finance clearance"
        description={`Order ${c.order_number ?? "—"} · ${c.customer_name ?? "—"} · ${c.bundles} bundle(s), ${formatWeight(c.net_weight_kg)} · terms: ${c.terms.label} (${TERMS_SCOPE_LABELS[c.terms.scope] ?? c.terms.scope})`}
        actions={<Link href={`/dispatches/${c.dispatch_id}`} className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Dispatch record</Link>} />
      <section className={`rounded-2xl border p-4 text-sm ${tone}`}>
        <p className="font-bold">{c.state === "blocked" ? "The gate will refuse this dispatch until the payment is confirmed or released." : c.state === "released" ? `Released until ${at(c.release?.expires_at ?? null)}; the release is used when the dispatch leaves.` : CLEARANCE_STATE_LABELS[c.state]}</p>
        {c.terms.reason ? <p className="mt-1">Terms basis: {c.terms.reason}</p> : null}
        {!c.priced ? <p className="mt-1 font-semibold">Some bundles have no rate, so the dispatch value cannot be checked automatically; a release is needed.</p> : null}
        {c.release?.value_grown ? <p className="mt-1 font-semibold">The dispatch grew after the last release; record a new release.</p> : null}
        {c.release?.expired ? <p className="mt-1 font-semibold">The last release expired before the dispatch left.</p> : null}
      </section>
      {c.finance_visible && m ? <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {([["This dispatch (incl. GST)", m.dispatch_value], ["Dispatched earlier", m.earlier_dispatched_value], ["Required", m.required], ["Paid on order invoices", m.paid_on_order], ["Advance available to this order", m.advance_available ?? null], ["Short", m.shortfall]] as const)
          .map(([label, value]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-3"><p className="text-xs font-bold uppercase text-slate-500">{label}</p><p className="text-lg font-bold">{formatInr(value)}</p></div>)}
      </section> : !c.finance_visible ? <p className="text-sm text-slate-600">Amounts are visible to accounts.</p> : null}
      {c.finance_visible && m?.customer_advance ? <p className="text-xs text-slate-600">Customer advances {formatInr(m.customer_advance)} first cover {formatInr(m.other_obligations ?? 0)} the customer owes on other orders (open invoices and goods sent but not invoiced); the rest counts here. Two pending dispatches may both show covered; whichever leaves first uses the advance, and the other is re-checked at the gate.</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {c.can_release && c.state === "blocked" ? <ReleaseForm dispatchId={c.dispatch_id} canException={c.can_exception} /> : null}
        {c.can_release && c.order_id && c.order_number ? <TermsForm customers={[]} order={{ id: c.order_id, number: c.order_number }} /> : null}
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-bold">Releases</h2>
        {c.releases.length === 0 ? <p className="text-sm text-slate-600">None recorded.</p> : <ul className="mt-2 space-y-2">{c.releases.map(r => <li key={r.id} className="text-sm">
          <p className="font-semibold">{r.basis === "payment_confirmed" ? `Payment confirmed · ${r.reference}` : "Owner exception"} · {r.released_by_name ?? "—"} {at(r.released_at)}{r.released_value !== undefined && r.released_value !== null ? ` · covers ${formatInr(r.released_value)}` : ""}</p>
          <p className="text-xs text-slate-600">{r.note} · {r.consumed_at ? `used at the gate ${at(r.consumed_at)}` : r.revoked_at ? `withdrawn ${at(r.revoked_at)}: ${r.revoke_reason}` : `valid until ${at(r.expires_at)}`}</p>
          {r.can_revoke ? <RevokeReleaseButton releaseId={r.id} /> : null}
        </li>)}</ul>}
      </section>
    </div>
  );
}

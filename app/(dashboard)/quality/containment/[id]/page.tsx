import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ContainmentActions, PriorApprovalReviews } from "@/components/modules/orchestration/nonconforming-forms";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { getSessionContext } from "@/lib/auth";
import { containmentAction } from "@/lib/actions/orchestration";
import { formatWeight } from "@/lib/utils/format";
import { canReadOrchestration } from "@/lib/workflow/orchestration";
import { CONTAINMENT_STATUS, LOT_STATUS, containmentDetailSchema } from "@/lib/workflow/nonconforming";

const at = (value: string) => new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export default async function ContainmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, context] = await Promise.all([params, getSessionContext()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (context.dealerId || !canReadOrchestration(context.role)) redirect("/quality");
  const result = await containmentAction({ command: "get", id });
  const parsed = result.success ? containmentDetailSchema.safeParse(result.data) : null;
  if (!parsed?.success) {
    return <div className="space-y-4"><PageHeader title="QC containment" backHref="/quality/containment" backLabel="Back to containment" />
      <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : "This containment could not be read."}</p></div>;
  }
  const c = parsed.data;
  const ledger: [string, number][] = [["Contained", c.scope_kg], ["Accepted (released)", c.released_accepted_kg], ["Rejected (released)", c.released_rejected_kg], ["Still held", c.held_kg],
    ["Results recorded, not yet released", c.recorded.unreleased_accepted_kg + c.recorded.unreleased_rejected_kg]];
  return (
    <div className="space-y-5">
      <PageHeader title={`${c.containment_number} · ${CONTAINMENT_STATUS[c.status] ?? c.status}`} backHref="/quality/containment" backLabel="Back to containment"
        description={`Job ${c.job_number ?? "—"} · order ${c.order_number ?? "—"} · profile ${c.profile_code ?? "—"} · die ${c.die_number ?? "—"} · ${c.stage === "final" ? "final QC" : "first-stage QC"} · NCR ${c.ncr_number ?? "—"} · opened ${at(c.opened_at)}`}
        actions={<div className="flex flex-wrap items-center gap-2"><LiveRefresh name="containment" tables={["quality_containments", "olo_events"]} />{c.order_id ? <Link href={`/orders/${c.order_id}/lifecycle`} className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Order lifecycle</Link> : null}</div>} />
      <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-950">
        <p className="font-bold">Defect: {c.defect}</p>
        <p>{c.inspection_mode === "full_inspection" ? "100% inspection: every piece or identifiable sublot needs a recorded result before it is released." : `Expanded sampling under ${c.sampling_reference}: ${c.required_samples} passing samples and an engineering disposition are needed; a failed sample cannot be offset.`}</p>
        {c.suspended_approved_kg > 0 ? <p className="mt-1 font-semibold">{formatWeight(c.suspended_approved_kg)} of this job was approved before the containment and stays blocked until each earlier approval is reviewed and any revocation is closed.</p> : null}
      </section>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">{ledger.map(([label, kg]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-3"><dt className="text-xs font-semibold text-slate-600">{label}</dt><dd className="text-lg font-bold">{formatWeight(kg)}</dd></div>)}</dl>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-lg font-bold">Results ({c.results.length})</h2>
          {c.results.length ? <ul className="space-y-1 text-sm">{c.results.map(r => <li key={r.id} className={`rounded-xl border px-3 py-2 ${r.result === "accepted" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
            <b>{r.reference}</b> · {r.result}{r.quantity_kg ? ` · ${formatWeight(r.quantity_kg)}` : ""}{r.pieces ? ` · ${r.pieces} pcs` : ""} · {r.method}{r.note ? ` · ${r.note}` : ""}
            <span className="block text-xs text-slate-600">{at(r.recorded_at)} · {r.recorded_by_name ?? "QA"}{r.released ? " · released" : " · not yet released"}</span></li>)}</ul>
            : <p className="text-sm text-slate-600">No results recorded yet.</p>}
          <h2 className="pt-2 text-lg font-bold">Lots</h2>
          <ul className="space-y-1 text-sm">{c.lots.map(l => <li key={l.id} className={l.parent_lot_id ? "ml-4" : ""}><b>{l.lot_code}</b> · {l.kind} · {formatWeight(l.quantity_kg)} · {LOT_STATUS[l.status] ?? l.status}</li>)}</ul>
          <h2 className="pt-2 text-lg font-bold">Traceability</h2>
          <p className="text-sm">Press {c.trace.machine_name ?? "—"} · die {c.die_number ?? "—"}</p>
          {c.trace.billets.length ? <ul className="text-sm">{c.trace.billets.map((b, n) => <li key={n}>{b.billet_code ?? "billet"} · {b.source ?? "—"} · {b.alloy ?? "—"} · {b.cast_batch ?? b.external_batch ?? "batch not recorded"}</li>)}</ul> : <p className="text-sm text-slate-600">No billets are linked to this job.</p>}
        </section>
        <section className="space-y-3"><h2 className="text-lg font-bold">Record and release</h2><ContainmentActions c={c} /><PriorApprovalReviews c={c} /></section>
      </div>
    </div>
  );
}

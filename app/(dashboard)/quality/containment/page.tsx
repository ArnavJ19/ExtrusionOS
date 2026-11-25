import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { OpenContainmentForm } from "@/components/modules/orchestration/nonconforming-forms";
import { getSessionContext } from "@/lib/auth";
import { containmentAction } from "@/lib/actions/orchestration";
import { formatWeight } from "@/lib/utils/format";
import { canReadOrchestration } from "@/lib/workflow/orchestration";
import { CONTAINMENT_STATUS, QC_CONTAINMENT_OPENERS, containmentCandidatesSchema, containmentListSchema } from "@/lib/workflow/nonconforming";

const FILTERS = [["active", "Active"], ["resolved", "Resolved"], ["cancelled", "Cancelled"], ["all", "All"]] as const;

export default async function ContainmentPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const [q, context] = await Promise.all([searchParams, getSessionContext()]);
  if (context.dealerId || !canReadOrchestration(context.role)) redirect("/quality");
  const status = (FILTERS.some(([k]) => k === q.status) ? q.status : "active") as (typeof FILTERS)[number][0];
  const page = Math.min(Math.max(Number.parseInt(q.page ?? "1", 10) || 1, 1), 100000);
  const canOpen = QC_CONTAINMENT_OPENERS.includes(context.role);
  const [listResult, candidateResult] = await Promise.all([
    containmentAction({ command: "list", status, page }),
    canOpen ? containmentAction({ command: "candidates" }) : Promise.resolve(null)
  ]);
  const list = listResult.success ? containmentListSchema.safeParse(listResult.data).data : null;
  const candidates = candidateResult?.success ? containmentCandidatesSchema.safeParse(candidateResult.data).data?.rows ?? [] : [];
  const href = (p: number) => `?${new URLSearchParams({ status, page: String(p) })}`;
  return (
    <div className="space-y-5">
      <PageHeader title="QC containment" description="Lots held after a failed sample. Held material cannot go to ageing, packaging or dispatch; QA records each piece, sublot or sample result and releases accepted and rejected child lots."
        actions={<div className="flex flex-wrap items-center gap-2"><LiveRefresh name="containments" tables={["quality_containments"]} /><Link href="/foundry/remelt" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Remelt approvals</Link></div>} />
      {canOpen ? <OpenContainmentForm candidates={candidates} /> : null}
      <nav className="flex flex-wrap gap-2">{FILTERS.map(([k, label]) => <Link key={k} href={`?status=${k}`} className={`rounded-xl border px-3 py-2 text-sm font-bold ${status === k ? "border-orange bg-orange/10" : "bg-white"}`}>{label}</Link>)}</nav>
      {!list ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!listResult.success ? listResult.error : "Containments could not be read."}</p>
        : list.rows.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">No containments here.</p> : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50"><tr>{["Containment", "Status", "Job / order", "Defect", "Mode", "Contained", "Accepted", "Rejected", "Still held"].map(h => <th key={h} className="px-3 py-2 font-bold">{h}</th>)}</tr></thead>
            <tbody>{list.rows.map(r => <tr key={r.id} className="border-t align-top">
              <td className="px-3 py-2 font-semibold"><Link className="underline" href={`/quality/containment/${r.id}`}>{r.containment_number}</Link><div className="text-xs text-slate-500">{r.stage === "final" ? "Final QC" : "First-stage QC"}</div></td>
              <td className="px-3 py-2">{CONTAINMENT_STATUS[r.status] ?? r.status}</td>
              <td className="px-3 py-2">{r.job_number ?? "—"}<div className="text-xs">{r.order_id ? <Link className="underline" href={`/orders/${r.order_id}/lifecycle`}>{r.order_number}</Link> : "—"}</div></td>
              <td className="max-w-xs px-3 py-2 [overflow-wrap:anywhere]">{r.defect}</td>
              <td className="px-3 py-2">{r.inspection_mode === "full_inspection" ? "100% inspection" : "Expanded sampling"}</td>
              <td className="px-3 py-2">{formatWeight(r.scope_kg)}</td><td className="px-3 py-2">{formatWeight(r.released_accepted_kg)}</td>
              <td className="px-3 py-2">{formatWeight(r.released_rejected_kg)}</td><td className="px-3 py-2 font-bold">{formatWeight(r.held_kg)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
      {list && list.total > list.page_size ? <nav className="flex justify-between text-sm font-semibold">{page > 1 ? <Link href={href(page - 1)}>Previous</Link> : <span />}<span>Page {page}</span>{page * list.page_size < list.total ? <Link href={href(page + 1)}>Next</Link> : <span />}</nav> : null}
    </div>
  );
}

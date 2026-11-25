import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ProposeRemeltForm, RemeltRowActions } from "@/components/modules/orchestration/nonconforming-forms";
import { getSessionContext } from "@/lib/auth";
import { remeltAction } from "@/lib/actions/orchestration";
import { formatWeight } from "@/lib/utils/format";
import { canReadOrchestration } from "@/lib/workflow/orchestration";
import { REMELT_STATUS, remeltListSchema, remeltSourcesSchema } from "@/lib/workflow/nonconforming";

const FILTERS = [["active", "Open"], ["received", "Weighed in"], ["rejected", "Rejected"], ["all", "All"]] as const;
const PROPOSERS = ["owner", "admin", "quality", "factory_manager", "production_manager", "inventory_manager", "dispatch_manager"];
const at = (value: string) => new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function RemeltApprovalsPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const [q, context] = await Promise.all([searchParams, getSessionContext()]);
  if (context.dealerId || !canReadOrchestration(context.role)) redirect("/foundry");
  const status = (FILTERS.some(([k]) => k === q.status) ? q.status : "active") as (typeof FILTERS)[number][0];
  const page = Math.min(Math.max(Number.parseInt(q.page ?? "1", 10) || 1, 1), 100000);
  const canPropose = PROPOSERS.includes(context.role);
  const [listResult, sourceResult] = await Promise.all([remeltAction({ command: "list", status, page }), canPropose ? remeltAction({ command: "sources" }) : Promise.resolve(null)]);
  const list = listResult.success ? remeltListSchema.safeParse(listResult.data).data : null;
  const sources = sourceResult?.success ? remeltSourcesSchema.safeParse(sourceResult.data).data?.rows ?? [] : [];
  const href = (p: number) => `?${new URLSearchParams({ status, page: String(p) })}`;
  return (
    <div className="space-y-5">
      <PageHeader title="Remelt approvals" description="Rejected material goes to the foundry only with a factory manager or owner approval, never the proposer's own. Approved material stays reserved until the foundry weighs it in; any weight difference must be explained."
        actions={<Link href="/quality/containment" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">QC containment</Link>} />
      {canPropose ? <ProposeRemeltForm sources={sources} /> : null}
      <nav className="flex flex-wrap gap-2">{FILTERS.map(([k, label]) => <Link key={k} href={`?status=${k}`} className={`rounded-xl border px-3 py-2 text-sm font-bold ${status === k ? "border-orange bg-orange/10" : "bg-white"}`}>{label}</Link>)}</nav>
      {!list ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!listResult.success ? listResult.error : "Remelt requests could not be read."}</p>
        : list.rows.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">No remelt requests here.</p> : (
        <ul className="space-y-3">{list.rows.map(r => <li key={r.id} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0"><p className="text-xs font-bold uppercase text-slate-500">{r.approval_number} · {r.source_type.replace(/_/g, " ")} · order {r.order_number ?? "—"} · job {r.job_number ?? "—"}</p>
              <h2 className="font-bold">{formatWeight(r.quantity_kg)} · alloy {r.alloy ?? "not recorded"} · {r.reason}</h2>
              <p className="text-xs text-slate-600">Proposed by {r.proposed_by_name ?? "—"} {at(r.proposed_at)}{r.evidence ? ` · evidence: ${r.evidence}` : ""}{r.decided_by_name ? ` · decided by ${r.decided_by_name}: ${r.decision_note}` : ""}</p>
              {r.received_kg !== null ? <p className="text-xs font-semibold">Weighed in {formatWeight(r.received_kg)}{r.variance_kg ? ` · variance ${r.variance_kg} kg: ${r.variance_note}` : " · no variance"}</p> : null}</div>
            <span className="rounded-full border px-2 py-0.5 text-xs font-bold">{REMELT_STATUS[r.status] ?? r.status}</span>
          </div>
          <RemeltRowActions row={r} />
        </li>)}</ul>
      )}
      {list && list.total > list.page_size ? <nav className="flex justify-between text-sm font-semibold">{page > 1 ? <Link href={href(page - 1)}>Previous</Link> : <span />}<span>Page {page}</span>{page * list.page_size < list.total ? <Link href={href(page + 1)}>Next</Link> : <span />}</nav> : null}
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ExceptionPolicyForm } from "@/components/modules/approvals/exception-requests";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { EXCEPTION_TYPES, STATUS_LABELS, canSetExceptionPolicy, exceptionSummary, policyListSchema, requestListSchema, type ExceptionType } from "@/lib/workflow/exception-requests";

// UPGRADE_EOS feature 45: which restrictions may be lifted by exception, and recent decisions.
export default async function ExceptionPoliciesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !canSetExceptionPolicy(context.role)) redirect("/tasks/approvals");
  const page = Math.min(Math.max(Number.parseInt((await searchParams).page ?? "1", 10) || 1, 1), 100000);
  const supabase = await createClient();
  const [policyResult, decidedResult] = await Promise.all([
    supabase.rpc("exception_command", { p_command: "policy.list", p_payload: {} }),
    supabase.rpc("exception_command", { p_command: "request.list", p_payload: { view: "decided", page } })
  ]);
  const unavailable = Boolean(policyResult.error && ["PGRST202", "42883", "42P01"].includes(policyResult.error.code ?? ""));
  const policies = policyResult.error ? null : policyListSchema.safeParse(policyResult.data);
  const decided = decidedResult.error ? null : requestListSchema.safeParse(decidedResult.data);
  const totalPages = decided?.success ? Math.max(1, Math.ceil(decided.data.total_count / 10)) : 1;

  return (
    <div className="space-y-5">
      <PageHeader title="Exception Policies" description="Restrictions employees may ask to lift, who approves, and for how long. An approval covers only the record and content it was requested for; hard limits are never lifted by exception."
        actions={<Link href="/tasks/approvals#exceptions" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold">Approval inbox</Link>} />
      {!policies?.success ? (
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{unavailable ? "Exception requests are not available on this database yet. The database upgrade must be applied first." : "Policies could not be loaded. Refresh to retry."}</p>
      ) : (
        <div className="grid gap-4">
          {(Object.keys(EXCEPTION_TYPES) as ExceptionType[]).map((type) => <ExceptionPolicyForm key={type} type={type} initial={policies.data.find((p) => p.exception_type === type)} />)}
        </div>
      )}
      <section className="space-y-2">
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">Decided exceptions</h2>
        {!decided?.success ? <p className="text-sm text-slate-500">Decisions could not be loaded.</p> : !decided.data.rows.length ? <p className="text-sm text-slate-500">No exceptions decided yet.</p> : (
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
            {decided.data.rows.map((row) => (
              <li key={row.id} className="flex flex-wrap justify-between gap-2 p-4 text-sm">
                <span><Link href={row.return_path} className="font-bold underline-offset-2 hover:underline">{exceptionSummary(row, formatCurrency)}</Link> · {STATUS_LABELS[row.status]}{row.decision_note ? ` · ${row.decision_note}` : ""}</span>
                <span className="text-xs text-slate-500">{row.requested_by_name} → {row.decided_by_name ?? "-"} · {formatDate(row.decided_at ?? row.requested_at)}</span>
              </li>
            ))}
          </ul>
        )}
        {decided?.success && totalPages > 1 ? (
          <nav className="flex items-center justify-between text-sm font-bold" aria-label="Pages">
            {page > 1 ? <Link href={`/tasks/approvals/exceptions?page=${page - 1}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Previous</Link> : <span />}
            <span className="text-slate-500">Page {page} of {totalPages}</span>
            {page < totalPages ? <Link href={`/tasks/approvals/exceptions?page=${page + 1}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Next</Link> : <span />}
          </nav>
        ) : null}
      </section>
    </div>
  );
}

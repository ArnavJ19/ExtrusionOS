import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ApprovalInboxList } from "@/components/modules/tasks/approval-inbox";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/format";
import { DECISIONS, approvalHistorySchema, approvalInboxSchema, canUseApprovalInbox } from "@/lib/workflow/approval-inbox";
import { ExceptionDecisionRow } from "@/components/modules/approvals/exception-requests";
import { canSetExceptionPolicy, requestListSchema as exceptionListSchema } from "@/lib/workflow/exception-requests";

const types = { "": "All requests", quote: "Quotations", expense: "Expenses" } as const;

// UPGRADE_EOS feature 44: pending approvals the employee may decide, oldest first, with recent decisions.
export default async function ApprovalInboxPage({ searchParams }: { searchParams: Promise<{ type?: string; page?: string; history?: string; exceptions?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !canUseApprovalInbox(context.role)) redirect("/tasks");
  const params = await searchParams;
  const type = params.type === "quote" || params.type === "expense" ? params.type : "";
  const page = Math.min(Math.max(Number.parseInt(params.page ?? "1", 10) || 1, 1), 100000);
  const historyPage = Math.min(Math.max(Number.parseInt(params.history ?? "1", 10) || 1, 1), 100000);
  const exceptionPage = Math.min(Math.max(Number.parseInt(params.exceptions ?? "1", 10) || 1, 1), 100000);
  const supabase = await createClient();
  const [listResult, historyResult, exceptionResult] = await Promise.all([
    supabase.rpc("approval_inbox_command", { p_command: "inbox.list", p_payload: { page, ...(type ? { type } : {}) } }),
    supabase.rpc("approval_inbox_command", { p_command: "inbox.history", p_payload: { page: historyPage } }),
    // UPGRADE_EOS feature 45: exception requests raised at a restriction, for the policy's approvers.
    supabase.rpc("exception_command", { p_command: "request.list", p_payload: { view: "to_decide", page: exceptionPage } })
  ]);
  const exceptionParsed = exceptionResult.error ? null : exceptionListSchema.safeParse(exceptionResult.data);
  const exceptions = exceptionParsed?.success ? exceptionParsed.data : null;
  const exceptionPages = exceptions ? Math.max(1, Math.ceil(exceptions.total_count / 10)) : 1;
  const unavailable = Boolean(listResult.error && ["PGRST202", "42883", "42P01"].includes(listResult.error.code ?? ""));
  const parsed = listResult.error ? null : approvalInboxSchema.safeParse(listResult.data);
  const inbox = parsed?.success ? parsed.data : null;
  const historyParsed = historyResult.error ? null : approvalHistorySchema.safeParse(historyResult.data);
  const history = historyParsed?.success ? historyParsed.data : null;
  const totalPages = inbox ? Math.max(1, Math.ceil(inbox.total_count / 10)) : 1;
  const historyPages = history ? Math.max(1, Math.ceil(history.total_count / 10)) : 1;
  const href = (next: { type?: string; page?: number; history?: number }) => {
    const query = new URLSearchParams({ page: String(next.page ?? 1), history: String(next.history ?? historyPage) });
    const nextType = next.type ?? type;
    if (nextType) query.set("type", nextType);
    return `/tasks/approvals?${query.toString()}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Approval Inbox" description="Quotations awaiting review and expenses awaiting approval that you may decide. Each decision is applied through the record's own workflow and covers only the version shown."
        actions={<Link href="/tasks" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">All tasks</Link>} />
      <nav className="flex flex-wrap gap-2" aria-label="Request type">
        {Object.entries(types).map(([value, text]) => (
          <Link key={value} href={href({ type: value })} className={`rounded-xl border px-3 py-1.5 text-sm font-bold ${type === value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"}`}>{text}</Link>
        ))}
      </nav>
      {!inbox ? (
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
          {unavailable ? "The approval inbox is not available on this database yet. The database upgrade must be applied first." : "The approval inbox could not be loaded. Refresh to retry."}
        </p>
      ) : !inbox.rows.length ? (
        <EmptyState title="Nothing waiting for your decision" description="New requests appear here when a quotation goes to internal review or an expense needs approval." />
      ) : <ApprovalInboxList items={inbox.rows} />}
      {inbox && totalPages > 1 ? (
        <nav className="flex items-center justify-between text-sm font-bold" aria-label="Pages">
          {page > 1 ? <Link href={href({ page: page - 1 })} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Previous</Link> : <span />}
          <span className="text-slate-500">Page {page} of {totalPages} · {inbox.total_count} waiting</span>
          {page < totalPages ? <Link href={href({ page: page + 1 })} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Next</Link> : <span />}
        </nav>
      ) : null}

      <section id="exceptions" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-slate-900">Exception requests{exceptions ? ` (${exceptions.total_count})` : ""}</h2>
          {canSetExceptionPolicy(context.role) ? <Link href="/tasks/approvals/exceptions" className="text-xs font-bold underline">Exception policies</Link> : null}
        </div>
        {!exceptions ? <p className="text-sm text-slate-500">Exception requests are not available yet.</p> : !exceptions.rows.length ? <p className="text-sm text-slate-500">No exception is waiting for your decision.</p> : (
          <ul className="divide-y divide-slate-100 rounded-2xl border border-amber-200 bg-white">{exceptions.rows.map((row) => <ExceptionDecisionRow key={row.id} row={row} />)}</ul>
        )}
        {exceptions && exceptionPages > 1 ? (
          <div className="flex justify-between text-xs font-bold">
            {exceptionPage > 1 ? <Link href={`/tasks/approvals?exceptions=${exceptionPage - 1}#exceptions`} className="underline">Previous</Link> : <span />}
            <span className="text-slate-500">Page {exceptionPage} of {exceptionPages}</span>
            {exceptionPage < exceptionPages ? <Link href={`/tasks/approvals?exceptions=${exceptionPage + 1}#exceptions`} className="underline">Next</Link> : <span />}
          </div>
        ) : null}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-bold text-slate-900">Recent decisions{context.role === "owner" || context.role === "admin" ? "" : " by you"}</h2>
        {history?.rows.length ? (
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {history.rows.map((row) => (
              <li key={row.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span><Link href={row.source_type === "quote" ? `/quotes/${row.source_id}` : `/expenses/${row.source_id}`} className="font-bold underline-offset-2 hover:underline">{row.source_reference ?? row.source_type}</Link> · {DECISIONS[row.decision]}{row.note ? ` — ${row.note}` : ""}</span>
                <span className="text-xs text-slate-500">{row.actor_name} · {formatDate(row.decided_at)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-slate-500">{history ? "No decisions recorded yet." : "Decision history could not be loaded."}</p>}
        {history && historyPages > 1 ? (
          <div className="mt-2 flex justify-between text-xs font-bold">
            {historyPage > 1 ? <Link href={href({ page, history: historyPage - 1 })} className="underline">Newer</Link> : <span />}
            {historyPage < historyPages ? <Link href={href({ page, history: historyPage + 1 })} className="underline">Older</Link> : <span />}
          </div>
        ) : null}
      </section>
    </div>
  );
}

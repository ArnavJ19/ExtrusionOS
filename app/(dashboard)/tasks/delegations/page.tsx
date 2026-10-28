import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { NewDelegationForm } from "@/components/modules/tasks/task-delegation";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/format";
import { canAssignTo } from "@/lib/workflow/bulk-queue";
import { canDelegate, delegationListSchema, delegationState } from "@/lib/workflow/task-delegation";

const stateText = { active: "Active", scheduled: "Scheduled", expiring: "Ending", ended: "Ended", cancelled: "Ended early" } as const;

// UPGRADE_EOS feature 35: temporary cover for absent employees.
export default async function DelegationsPage({ searchParams }: { searchParams: Promise<{ page?: string; status?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !can(context.role, "read", "tasks")) redirect("/tasks");
  const params = await searchParams;
  const page = Math.min(Math.max(Number.parseInt(params.page ?? "1", 10) || 1, 1), 100000);
  const status = params.status === "closed" ? "closed" : "current";
  const supabase = await createClient();
  // Activation and expiry are time-based; the sync is idempotent, so running it here keeps the page current.
  await supabase.rpc("task_delegation_command", { p_command: "delegation.sync", p_payload: {} });
  const [listResult, usersResult] = await Promise.all([
    supabase.rpc("task_delegation_command", { p_command: "delegation.list", p_payload: { page, status } }),
    canDelegate(context.role) ? supabase.from("app_users").select("id, full_name, role").eq("company_id", context.companyId).eq("is_active", true).is("dealer_id", null).order("full_name").limit(1000) : Promise.resolve({ data: [], error: null })
  ]);
  const unavailable = Boolean(listResult.error && ["PGRST202", "42883", "42P01"].includes(listResult.error.code ?? ""));
  const parsed = listResult.error ? null : delegationListSchema.safeParse(listResult.data);
  const list = parsed?.success ? parsed.data : null;
  const employees = (usersResult.data ?? []).filter((user) => canAssignTo(context.role, user.role)).map((user) => ({ id: user.id, name: user.full_name || "Employee", role: user.role }));
  const totalPages = list ? Math.max(1, Math.ceil(list.total_count / 10)) : 1;
  const href = (next: { page?: number; status?: string }) => `/tasks/delegations?page=${next.page ?? 1}&status=${next.status ?? status}`;

  return (
    <div className="space-y-5">
      <PageHeader title="Task Delegation" description="Cover an absent employee's work for a set period. Only assignment moves; unfinished work returns to the owner when the period ends."
        actions={<Link href="/tasks" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">All tasks</Link>} />
      {canDelegate(context.role) && !unavailable ? <NewDelegationForm employees={employees} supervisorRole={context.role} /> : null}
      <nav className="flex gap-2 text-sm font-bold">
        {[["current", "Current and scheduled"], ["closed", "Ended"]].map(([value, text]) => (
          <Link key={value} href={href({ status: value })} className={`rounded-xl border px-3 py-1.5 ${status === value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"}`}>{text}</Link>
        ))}
      </nav>
      {!list ? (
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{unavailable ? "Task delegation is not available on this database yet. The database upgrade must be applied first." : "Delegations could not be loaded. Refresh to retry."}</p>
      ) : !list.rows.length ? <EmptyState title="No delegations here" description={status === "current" ? "Nobody's work is being covered right now." : "No delegation has ended yet."} /> : (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
          {list.rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
              <div>
                <Link href={`/tasks/delegations/${row.id}`} className="font-bold underline-offset-2 hover:underline">{row.delegator_name ?? "Employee"} → {row.delegate_name ?? "Replacement"}</Link>
                <p className="text-xs text-slate-500">{formatDate(row.starts_at)} to {formatDate(row.ends_at)} · {row.scope === "all_open" ? "all open work" : "selected tasks"} · {row.reason}</p>
              </div>
              <div className="text-right text-xs font-semibold">
                <p>{stateText[delegationState(row)]}</p>
                <p className="text-slate-500">{row.open_count} of {row.task_count} task{row.task_count === 1 ? "" : "s"} still held</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {list && totalPages > 1 ? (
        <nav className="flex items-center justify-between text-sm font-bold" aria-label="Pages">
          {page > 1 ? <Link href={href({ page: page - 1 })} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Previous</Link> : <span />}
          <span className="text-slate-500">Page {page} of {totalPages}</span>
          {page < totalPages ? <Link href={href({ page: page + 1 })} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Next</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}

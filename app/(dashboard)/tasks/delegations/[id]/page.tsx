import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { CancelDelegation } from "@/components/modules/tasks/task-delegation";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/format";
import { canDelegate, delegationDetailSchema, outcomeText } from "@/lib/workflow/task-delegation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const how = { selected: "chosen", all_open: "open at start", redirected: "assigned during cover" } as const;

export default async function DelegationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (context.dealerId || !can(context.role, "read", "tasks")) redirect("/tasks");
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const result = await supabase.rpc("task_delegation_command", { p_command: "delegation.load", p_payload: { id } });
  if (result.error?.message === "Delegation is unavailable") notFound();
  if (result.error) throw new Error("The delegation could not be loaded. Refresh to retry.");
  const d = delegationDetailSchema.parse(result.data);

  return (
    <div className="space-y-5">
      <PageHeader title={`${d.delegator_name ?? "Employee"} → ${d.delegate_name ?? "Replacement"}`}
        description={`${formatDate(d.starts_at)} to ${formatDate(d.ends_at)} · ${d.scope === "all_open" ? "all open work, including tasks assigned during the period" : "selected tasks"} · set up by ${d.created_by_name}. Reason: ${d.reason}`}
        actions={<Link href="/tasks/delegations" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">All delegations</Link>} />
      {d.closed_at ? (
        <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">{d.close_reason === "cancelled" ? `Ended early on ${formatDate(d.closed_at)}: ${d.close_note ?? ""}` : `Ended on ${formatDate(d.closed_at)}.`}</p>
      ) : canDelegate(context.role) ? <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><CancelDelegation id={d.id} /></section> : null}
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-bold text-slate-900">Tasks covered ({d.items.length})</h2>
        {d.items.length ? (
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {d.items.map((item) => (
              <li key={item.task_id} className="flex flex-wrap justify-between gap-2 py-2">
                <span><Link href={`/tasks/${item.task_id}`} className="font-bold underline-offset-2 hover:underline">{item.title}</Link> · {how[item.how]} · {item.status.replace(/_/g, " ")}</span>
                <span className="text-xs font-semibold text-slate-600">{item.outcome ? outcomeText[item.outcome] : "With the replacement"}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-slate-500">{d.activated_at ? "No eligible tasks were open." : "Tasks move when the delegation starts."}</p>}
      </section>
    </div>
  );
}

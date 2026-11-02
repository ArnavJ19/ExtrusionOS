import Link from "next/link";
import { coordinationAction } from "@/lib/actions/coordination";
import { canReadCoordination, coordinationDetailSchema } from "@/lib/workflow/coordination";
import type { SessionContext } from "@/types/app";

export async function OrderResponsibility({ orderId, context }: { orderId: string; context: SessionContext }) {
  if (context.dealerId || !canReadCoordination(context.role, "orders")) return null;
  const result = await coordinationAction({ command: "detail", view: "orders", id: orderId });
  const parsed = result.success ? coordinationDetailSchema.safeParse(result.data) : null;
  const row = parsed?.success ? parsed.data.row : null;
  return <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4" aria-label="Order responsibility">
    <h2 className="font-bold text-slate-900">Accountable coordinator</h2>
    {!row ? <p className="text-sm text-amber-900">Coordinator information is unavailable. {result.success ? "Retry the current read." : result.error}</p> : <>
      <p className="text-sm font-semibold text-slate-900">{row.owner ?? "Unassigned"}{row.details.coordinator_active === false ? " (employee unavailable; transfer needed)" : ""}</p>
      {row.details.proposed_id ? <p className="text-sm text-amber-900">Proposed replacement: {String(row.details.proposed_name ?? "Employee unavailable")}. The current coordinator remains accountable until acceptance.</p> : null}
      <p className="text-xs text-slate-600">The coordinator follows the order across teams. Department owners, task assignees and action permissions remain separate.</p>
    </>}
    <Link href={`/tasks/coordination/orders/${orderId}`} className="inline-flex min-h-11 items-center text-sm font-bold underline">Review responsibility, priority and team requests</Link>
  </section>;
}

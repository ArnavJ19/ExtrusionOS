import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { getSessionContext } from "@/lib/auth";
import { hasRouteAccess } from "@/lib/auth/route-permissions";
import { complaintAction } from "@/lib/actions/orchestration";
import { COMPLAINT_CATEGORY_LABELS, COMPLAINT_STATUS_LABELS, canLogComplaint, complaintBoardSchema } from "@/lib/workflow/delivery-closure";

const day = (value: string | null) => (value ? new Date(value).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" }) : "—");
const GROUPS = ["open", "investigating", "action", "resolved"] as const;

// Phase 7: what needs attention in customer complaints — up to 10 per open status, most severe and earliest due first.
export default async function ComplaintsOverviewPage() {
  const context = await getSessionContext();
  if (context.dealerId || !hasRouteAccess("/quality/complaints", context.role)) redirect("/dashboard");
  const result = await complaintAction({ command: "board" });
  const board = result.success ? complaintBoardSchema.safeParse(result.data).data ?? null : null;
  return (
    <div className="space-y-5">
      <PageHeader title="Customer complaints" backHref="/quality" backLabel="Back to quality"
        description="Each complaint runs containment, root cause and corrective action, an agreed resolution with replacement or credit note, and closure by a second person. Sales, QA, the production manager and the factory manager are told when one is logged; management too when it is high or critical."
        actions={<div className="flex flex-wrap gap-2"><LiveRefresh name="complaints" tables={["customer_complaint_events"]} />
          <Link href="/quality/complaints/database" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">View database</Link>
          {canLogComplaint(context.role) ? <Link href="/quality/complaints/new" className="rounded-xl bg-charcoal px-4 py-3 text-sm font-bold text-white">Log a complaint</Link> : null}</div>} />
      {!board ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : "The complaints could not be read."}</p> : <>
        {board.overdue ? <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-950">{board.overdue} complaint(s) are past their resolution date. <Link className="underline" href="/quality/complaints/database?view=overdue">Show them</Link></p> : null}
        <section className="grid gap-4 lg:grid-cols-2">
          {GROUPS.map(g => {
            const rows = board.groups[g] ?? [];
            const total = board.counts[g] ?? 0;
            return (
              <div key={g} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-bold">{COMPLAINT_STATUS_LABELS[g]}</h2><span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold">{total}</span></div>
                {rows.length === 0 ? <p className="mt-2 text-sm text-slate-600">None.</p> : <ul className="mt-2 divide-y">{rows.map(c => (
                  <li key={c.id} className="py-2 text-sm">
                    <Link className="font-semibold underline" href={`/quality/complaints/${c.id}`}>{c.complaint_number}</Link> · <span className={c.severity === "critical" || c.severity === "high" ? "font-bold text-red-900" : ""}>{c.severity}</span> · {COMPLAINT_CATEGORY_LABELS[c.category]}
                    <span className="block text-slate-700 [overflow-wrap:anywhere]">{c.customer ?? "—"} · {c.order_number ?? "—"} · {c.description}</span>
                    <span className={`block text-xs ${c.overdue ? "font-bold text-red-900" : "text-slate-500"}`}>Logged {day(c.logged_at)} · due {day(c.due_at)}{c.overdue ? " · overdue" : ""}</span>
                  </li>))}</ul>}
                {total > rows.length ? <Link className="mt-2 inline-flex min-h-11 items-center text-sm font-bold underline" href={`/quality/complaints/database?view=${g === "open" ? "open_complaints" : g}`}>All {total}</Link> : null}
              </div>
            );
          })}
        </section>
        <p className="text-sm text-slate-600">Closed {board.counts.closed ?? 0} · rejected {board.counts.rejected ?? 0} · withdrawn {board.counts.withdrawn ?? 0}. <Link className="font-semibold underline" href="/quality/complaints/database?view=all">All complaints</Link></p>
      </>}
    </div>
  );
}

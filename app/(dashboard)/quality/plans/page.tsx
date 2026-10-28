import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/format";
import { canEditPlans, canReadPlans, planListSchema } from "@/lib/workflow/inspection-plans";

// UPGRADE_EOS feature 54: approved and draft inspection plans, 10 per page.
export default async function InspectionPlansPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !canReadPlans(context.role)) redirect("/quality");
  const params = await searchParams;
  const page = Math.min(Math.max(Number.parseInt(params.page ?? "1", 10) || 1, 1), 100000);
  const supabase = await createClient();
  const result = await supabase.rpc("inspection_plan_command", { p_command: "plan.list", p_payload: { page } });
  const unavailable = Boolean(result.error && ["PGRST202", "42883", "42P01"].includes(result.error.code ?? ""));
  const parsed = result.error ? null : planListSchema.safeParse(result.data);
  const list = parsed?.success ? parsed.data : null;
  const totalPages = list ? Math.max(1, Math.ceil(list.total_count / 10)) : 1;

  return (
    <div className="space-y-5">
      <PageHeader title="Inspection Plans" description="The tests, limits and sampling that quality entry loads for each profile. An inspection with an applicable plan is approved only when every result is recorded and within limits."
        actions={canEditPlans(context.role) ? <Link href="/quality/plans/new" className="rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-bold text-white">New plan</Link> : null} />
      {!list ? (
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{unavailable ? "Inspection plans are not available on this database yet. The database upgrade must be applied first." : "Plans could not be loaded. Refresh to retry."}</p>
      ) : !list.rows.length ? <EmptyState title="No inspection plans yet" description="Create a company default plan or one for a specific profile." /> : (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
          {list.rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
              <Link href={`/quality/plans/${row.id}`} className="font-bold underline-offset-2 hover:underline">{row.profile_code ?? "Company default"} · version {row.version}</Link>
              <span className="text-xs font-semibold text-slate-600">{row.item_count} characteristic{row.item_count === 1 ? "" : "s"} · {row.status === "approved" ? `approved by ${row.approved_by_name ?? "-"} on ${formatDate(row.approved_at)}` : "draft, not yet in use"}</span>
            </li>
          ))}
        </ul>
      )}
      {list && totalPages > 1 ? (
        <nav className="flex items-center justify-between text-sm font-bold" aria-label="Pages">
          {page > 1 ? <Link href={`/quality/plans?page=${page - 1}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Previous</Link> : <span />}
          <span className="text-slate-500">Page {page} of {totalPages}</span>
          {page < totalPages ? <Link href={`/quality/plans?page=${page + 1}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Next</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}

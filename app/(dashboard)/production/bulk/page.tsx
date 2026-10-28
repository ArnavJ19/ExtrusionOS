import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { BulkQueue } from "@/components/modules/operations/bulk-queue";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatWeight } from "@/lib/utils/format";
import { canBulkJobs } from "@/lib/workflow/bulk-queue";

const PAGE_SIZES = [10, 25, 50] as const;

// UPGRADE_EOS feature 13: move several planned jobs to another date or shift at once.
export default async function BulkProductionPage({ searchParams }: { searchParams: Promise<{ page?: string; size?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !canBulkJobs(context.role)) redirect("/production");
  const params = await searchParams;
  const size = PAGE_SIZES.find((value) => String(value) === params.size) ?? 10;
  const page = Math.min(Math.max(Number.parseInt(params.page ?? "1", 10) || 1, 1), 100000);
  const supabase = await createClient();
  const result = await supabase.from("production_jobs")
    .select("id, job_number, planned_date, shift, planned_quantity_kg, order:orders(order_number), profile:aluminium_profiles(profile_code)", { count: "exact" })
    .eq("company_id", context.companyId).eq("status", "planned")
    .order("planned_date", { ascending: true, nullsFirst: true }).order("created_at", { ascending: true }).range((page - 1) * size, page * size - 1);
  if (result.error) throw new Error("Planned jobs could not be loaded. Refresh to retry.");
  const rows = (result.data ?? []).map((job: any) => ({
    id: job.id, label: job.job_number ?? "Production job", href: `/production/${job.id}`,
    detail: [job.order?.order_number, job.profile?.profile_code, formatWeight(job.planned_quantity_kg), job.planned_date ? `planned ${formatDate(job.planned_date)}` : "no planned date", job.shift ? `shift ${job.shift}` : "no shift"].filter(Boolean).join(" · ")
  }));
  const total = result.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const href = (next: { page?: number; size?: number }) => `/production/bulk?${new URLSearchParams({ page: String(next.page ?? 1), size: String(next.size ?? size) }).toString()}`;

  return (
    <div className="space-y-5">
      <PageHeader title="Bulk Reschedule Planned Jobs" description="Change the planned date or shift of several planned jobs. Jobs already on the press schedule, released or running are reported and must be moved on the press schedule."
        actions={<Link href="/production/schedule" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">Press schedule</Link>} />
      <nav className="flex items-center justify-end gap-2 text-xs font-bold">
        <span className="text-slate-500">Rows per page:</span>
        {PAGE_SIZES.map((value) => <Link key={value} href={href({ size: value })} className={`rounded-lg border px-2 py-1 ${size === value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white"}`}>{value}</Link>)}
      </nav>
      {!rows.length ? <EmptyState title="No planned jobs" description="Planned jobs that are not yet released appear here." /> : (
        <BulkQueue target="production_jobs" rows={rows} actions={[{ action: "planned_date", label: "Set planned date", input: "date" }, { action: "shift", label: "Set shift", input: "text" }]} />
      )}
      {totalPages > 1 ? (
        <nav className="flex items-center justify-between text-sm font-bold" aria-label="Pages">
          {page > 1 ? <Link href={href({ page: page - 1 })} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Previous</Link> : <span />}
          <span className="text-slate-500">Page {page} of {totalPages} · {total} planned jobs</span>
          {page < totalPages ? <Link href={href({ page: page + 1 })} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Next</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}

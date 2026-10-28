import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canReadHandover, canSubmitHandover, formatIst, handoverListSchema } from "@/lib/workflow/shift-handover";

const statuses = { "": "All", submitted: "Awaiting acknowledgement", acknowledged: "Acknowledged" } as const;

// UPGRADE_EOS feature 39: submitted shift handovers, 10 per page, newest first.
export default async function ShiftHandoverListPage({ searchParams }: { searchParams: Promise<{ page?: string; status?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !canReadHandover(context.role)) redirect("/dashboard");
  const params = await searchParams;
  const page = Math.min(Math.max(Number.parseInt(params.page ?? "1", 10) || 1, 1), 100000);
  const status = params.status === "submitted" || params.status === "acknowledged" ? params.status : "";
  const supabase = await createClient();
  const result = await supabase.rpc("shift_handover_command", { p_command: "handover.list", p_payload: { page, ...(status ? { status } : {}) } });
  const parsed = result.error ? null : handoverListSchema.safeParse(result.data);
  const unavailable = Boolean(result.error && ["PGRST202", "42883", "42P01"].includes(result.error.code ?? ""));
  const list = parsed?.success ? parsed.data : null;
  const totalPages = list ? Math.max(1, Math.ceil(list.total_count / 10)) : 1;
  const href = (nextPage: number, nextStatus: string = status) => `/production/handover?page=${nextPage}${nextStatus ? `&status=${nextStatus}` : ""}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Shift Handovers"
        description="What each outgoing supervisor passed on: open and held jobs, downtime, exceptions, quality items and pending loads, with acknowledgement by the incoming shift."
        actions={canSubmitHandover(context.role) ? <Link href="/production/handover/new" className="inline-flex items-center rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-bold text-white">Prepare handover</Link> : null}
      />
      <nav className="flex flex-wrap gap-2" aria-label="Filter by status">
        {Object.entries(statuses).map(([value, text]) => (
          <Link key={value} href={href(1, value)} className={`rounded-xl border px-3 py-1.5 text-sm font-bold ${status === value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"}`}>{text}</Link>
        ))}
      </nav>
      {!list ? (
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
          {unavailable ? "Shift handovers are not available on this database yet. The database upgrade must be applied first." : "Handovers could not be loaded. Refresh to retry."}
        </p>
      ) : !list.rows.length ? (
        <EmptyState title="No handovers yet" description={status ? "No handovers match this filter." : "Prepare the first handover at the end of a shift."} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-black uppercase tracking-[0.08em] text-slate-500">
              <tr><th className="px-4 py-3">Shift</th><th className="px-4 py-3">Window (IST)</th><th className="px-4 py-3">Prepared by</th><th className="px-4 py-3">Open jobs</th><th className="px-4 py-3">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-bold"><Link href={`/production/handover/${row.id}`} className="underline-offset-2 hover:underline">{row.shift_label}</Link></td>
                  <td className="px-4 py-3 text-slate-600">{formatIst(row.period_start)} – {formatIst(row.period_end)}</td>
                  <td className="px-4 py-3 text-slate-600">{row.prepared_by_name}</td>
                  <td className="px-4 py-3">{row.open_job_count} of {row.job_count}</td>
                  <td className="px-4 py-3">{row.status === "acknowledged" ? <span className="font-bold text-emerald-700">Received by {row.acknowledged_by_name}</span> : <span className="font-bold text-amber-700">Awaiting acknowledgement</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list && totalPages > 1 ? (
        <nav className="flex items-center justify-between text-sm font-bold" aria-label="Pages">
          {page > 1 ? <Link href={href(page - 1)} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Previous</Link> : <span />}
          <span className="text-slate-500">Page {page} of {totalPages}</span>
          {page < totalPages ? <Link href={href(page + 1)} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Next</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}

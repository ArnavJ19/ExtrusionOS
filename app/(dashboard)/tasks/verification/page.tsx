import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { queueSchema } from "@/lib/workflow/guided-sop";
import { WorkListControls } from "@/components/modules/tasks/work-list-controls";

export default async function VerificationPage({ searchParams }: { searchParams: Promise<{ page?: string; search?: string; risk?: string; sort?: string }> }) {
  const [query, c] = await Promise.all([searchParams, getSessionContext()]);
  if (c.dealerId || c.role.startsWith("dealer_") || c.role === "viewer") redirect("/tasks");
  const page = Math.min(Math.max(Number.parseInt(query.page ?? "1", 10) || 1, 1), 100000);
  const search = (query.search ?? "").slice(0, 80); const risk = ["normal", "elevated"].includes(query.risk ?? "") ? query.risk! : "all"; const sort = ["newest", "title"].includes(query.sort ?? "") ? query.sort! : "oldest";
  const pageHref = (value: number) => `?${new URLSearchParams({ search, risk, sort, page: String(value) })}`;
  const controls = <WorkListControls key={`${search}:${risk}:${sort}`} search={search} sort={sort} sorts={[{ value: "oldest", label: "Oldest submission" }, { value: "newest", label: "Newest submission" }, { value: "title", label: "Task title" }]} filter={risk} filterName="risk" filters={[{ value: "all", label: "All risk levels" }, { value: "normal", label: "Normal risk" }, { value: "elevated", label: "Elevated risk" }]} />;
  const client = await createClient();
  const result = await client.rpc("guided_sop_command", { p_command: "review.queue", p_payload: { page, search, risk, sort } });
  const data = !result.error ? queueSchema.safeParse(result.data).data : null;
  return <div className="space-y-5"><PageHeader title="Procedure verification" description="Work awaiting your independent review, ordered by submission time. Each task retains the process version, measurements and linked evidence." actions={<Link href="/tasks" className="text-sm font-bold underline">Tasks</Link>} />{controls}<section className="rounded-3xl border border-slate-200 bg-white p-5">{data ? data.rows.length ? <ul className="divide-y divide-slate-100">{data.rows.map(r => <li key={r.id}><Link className="flex flex-wrap justify-between gap-2 py-3 text-sm" href={`/tasks/${r.task_id}/execute`}><span className="font-bold">{r.title}</span><span>{r.performer_name} / {r.required_role.replaceAll("_", " ")}</span></Link></li>)}</ul> : <p className="text-sm">No procedures are waiting for your verification.</p> : <p role="alert">The verification queue could not be loaded. Refresh to retry.</p>}{data && data.total_count > 10 ? <nav className="mt-4 flex justify-between text-sm">{page > 1 ? <Link href={pageHref(page - 1)}>Previous</Link> : <span />}<span>Page {page}</span>{page * 10 < data.total_count ? <Link href={pageHref(page + 1)}>Next</Link> : <span />}</nav> : null}</section></div>;
}

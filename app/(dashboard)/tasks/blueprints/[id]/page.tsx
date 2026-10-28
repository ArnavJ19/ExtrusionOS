import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { BlueprintSections } from "@/components/modules/tasks/task-blueprints";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/format";
import { blueprintLoadSchema, canManageBlueprints, describeKind } from "@/lib/workflow/task-blueprints";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

// UPGRADE_EOS feature 61: one blueprint and its retained revisions.
export default async function BlueprintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const [{ id }, query, context] = await Promise.all([params, searchParams, getSessionContext()]);
  if (!UUID.test(id)) notFound();
  if (context.dealerId || !can(context.role, "read", "tasks")) redirect("/tasks");
  const page = Math.min(Math.max(Number.parseInt(query.page ?? "1", 10) || 1, 1), 100000);
  const supabase = await createClient();
  const result = await supabase.rpc("task_blueprint_command", { p_command: "blueprint.load", p_payload: { blueprint_id: id, page } });
  const parsed = result.error ? null : blueprintLoadSchema.safeParse(result.data);
  if (!parsed?.success) {
    return <div className="space-y-5"><PageHeader title="Task blueprint" description="" /><p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{result.error?.message === "Blueprint is unavailable" ? "This blueprint is unavailable." : "The blueprint could not be loaded. Refresh to retry."}</p></div>;
  }
  const { blueprint, revisions, total_count } = parsed.data;
  const totalPages = Math.max(1, Math.ceil(total_count / 10));
  return (
    <div className="space-y-5">
      <PageHeader title={blueprint.title} description={`${describeKind(blueprint.task_kind)} · revision ${blueprint.revision} by ${blueprint.updated_by_name} · ${blueprint.is_active ? "active" : "inactive"}`}
        actions={<div className="flex flex-wrap gap-2">{canManageBlueprints(context.role) ? <Link href={`/tasks/blueprints/new?edit=${blueprint.id}`} className="rounded-xl bg-charcoal px-4 py-2.5 text-sm font-bold text-white">Edit</Link> : null}<Link href="/tasks/blueprints" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">All blueprints</Link></div>} />
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><BlueprintSections blueprint={blueprint} /></section>
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-bold text-slate-900">Revisions</h2>
        <ul className="mt-2 divide-y divide-slate-100 text-sm">{revisions.map((r) => <li key={r.revision} className="flex flex-wrap justify-between gap-2 py-2"><span className="min-w-0 break-words"><span className="font-bold">rev {r.revision}</span> · {r.note}</span><span className="text-xs text-slate-500">{r.saved_by_name} · {formatDate(r.saved_at)}</span></li>)}</ul>
        {totalPages > 1 ? <nav className="mt-3 flex justify-between text-sm font-semibold">{page > 1 ? <Link href={`?page=${page - 1}`} className="underline">Newer</Link> : <span />}<span>Page {page} of {totalPages}</span>{page < totalPages ? <Link href={`?page=${page + 1}`} className="underline">Older</Link> : <span />}</nav> : null}
      </section>
    </div>
  );
}

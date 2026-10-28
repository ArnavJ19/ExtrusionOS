import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ProcedureVersionsWorkspace } from "@/components/modules/tasks/procedure-versions";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { canMapTaskKinds, versionsListSchema } from "@/lib/workflow/procedure-versions";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

// UPGRADE_EOS feature 77: numbered, reviewed versions of an operating procedure with effective dates.
export default async function ProcedureVersionsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const [{ id }, query, context] = await Promise.all([params, searchParams, getSessionContext()]);
  if (!UUID.test(id)) notFound();
  if (context.dealerId || !can(context.role, "read", "tasks")) redirect("/tasks");
  const page = Math.min(Math.max(Number.parseInt(query.page ?? "1", 10) || 1, 1), 100000);
  const supabase = await createClient();
  const result = await supabase.rpc("procedure_version_command", { p_command: "versions.list", p_payload: { procedure_id: id, page } });
  const unavailable = Boolean(result.error && ["PGRST202", "42883", "42P01"].includes(result.error.code ?? ""));
  const parsed = result.error ? null : versionsListSchema.safeParse(result.data);
  const back = <Link href={`/tasks/procedures/${id}`} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">Procedure owner</Link>;
  if (!parsed?.success) {
    return (
      <div className="space-y-5">
        <PageHeader title="Procedure versions" description="Released instructions and their effective dates." actions={back} />
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
          {unavailable ? "Procedure versions are not available on this database yet. The database upgrade must be applied first."
            : result.error?.message === "Procedure is unavailable" ? "This procedure is unavailable." : "Procedure versions could not be loaded. Refresh to retry."}
        </p>
      </div>
    );
  }
  const list = parsed.data;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const totalPages = Math.max(1, Math.ceil(list.total_count / 10));
  return (
    <div className="space-y-5">
      <PageHeader title={`${list.procedure.title} · versions`} description="Each version is written by one person and released by another with an effective date. Released versions never change; tasks keep the version they were given or completed under." actions={back} />
      <ProcedureVersionsWorkspace list={list} viewerId={context.userId} canMap={canMapTaskKinds(context.role)} today={today} />
      {totalPages > 1 ? (
        <nav className="flex items-center justify-between text-sm font-semibold" aria-label="Version pages">
          {page > 1 ? <Link href={`?page=${page - 1}`} className="underline">Newer versions</Link> : <span />}
          <span>Page {page} of {totalPages}</span>
          {page < totalPages ? <Link href={`?page=${page + 1}`} className="underline">Older versions</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}

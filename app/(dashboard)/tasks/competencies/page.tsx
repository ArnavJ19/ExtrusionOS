import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { CompetencyForm, GrantForm, HoldersList, RequirementForm, SupervisionForm } from "@/components/modules/tasks/competencies";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/format";
import { LEVELS, canManageCompetencies, catalogSchema, describeStanding, holdersSchema, myGrantsSchema, requirementsSchema } from "@/lib/workflow/competencies";

// UPGRADE_EOS feature 76: who may perform restricted steps independently, under supervision, or not yet.
export default async function CompetenciesPage({ searchParams }: { searchParams: Promise<{ competency?: string; page?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !can(context.role, "read", "tasks")) redirect("/tasks");
  const params = await searchParams;
  const supabase = await createClient();
  const [catalogResult, requirementsResult, mineResult] = await Promise.all([
    supabase.rpc("competency_command", { p_command: "catalog.list", p_payload: {} }),
    supabase.rpc("competency_command", { p_command: "requirements.list", p_payload: {} }),
    supabase.rpc("competency_command", { p_command: "grants.list", p_payload: { employee_id: context.userId } })
  ]);
  const unavailable = Boolean(catalogResult.error && ["PGRST202", "42883", "42P01"].includes(catalogResult.error.code ?? ""));
  const catalog = catalogResult.error ? null : catalogSchema.safeParse(catalogResult.data);
  if (!catalog?.success) {
    return (
      <div className="space-y-5">
        <PageHeader title="Competencies" description="Who may perform restricted steps." />
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{unavailable ? "Competencies are not available on this database yet. The database upgrade must be applied first." : "Competencies could not be loaded. Refresh to retry."}</p>
      </div>
    );
  }
  const requirements = requirementsResult.error ? [] : requirementsSchema.safeParse(requirementsResult.data).data ?? [];
  const mine = mineResult.error ? [] : myGrantsSchema.safeParse(mineResult.data).data ?? [];
  const selected = catalog.data.find((c) => c.id === params.competency) ?? catalog.data[0];
  const page = Math.min(Math.max(Number.parseInt(params.page ?? "1", 10) || 1, 1), 100000);
  const holdersResult = selected ? await supabase.rpc("competency_command", { p_command: "grants.list", p_payload: { competency_id: selected.id, page } }) : null;
  const holders = holdersResult && !holdersResult.error ? holdersSchema.safeParse(holdersResult.data).data ?? null : null;
  const manager = canManageCompetencies(context.role);
  const [employeesResult, proceduresResult] = await Promise.all([
    supabase.from("app_users").select("id, full_name, role").eq("company_id", context.companyId).eq("is_active", true).is("dealer_id", null).order("full_name").limit(1000),
    manager ? supabase.from("operating_procedures").select("id, title, revision").eq("company_id", context.companyId).eq("is_active", true).order("title").limit(500) : Promise.resolve({ data: [], error: null })
  ]);
  const employees = (employeesResult.data ?? []).map((u) => ({ value: u.id, label: `${u.full_name || "Employee"} · ${u.role.replace(/_/g, " ")}` }));
  const competencyOptions = catalog.data.filter((c) => c.is_active).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }));
  const canSupervise = mine.some((g) => g.standing.effective === "independent");
  const totalPages = holders ? Math.max(1, Math.ceil(holders.total_count / 10)) : 1;

  return (
    <div className="space-y-5">
      <PageHeader title="Competencies" description="Training records that a procedure was read are kept separate from confirmed competency. Restricted steps can require independent competency, or supervision by an independent holder."
        actions={<Link href="/tasks" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">All tasks</Link>} />

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-bold text-slate-900">My competencies</h2>
        {mine.length ? (
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {mine.map((g) => <li key={g.competency_id} className="flex flex-wrap justify-between gap-2 py-2"><span className="font-bold">{g.code} · {g.name}</span><span className="text-xs font-semibold text-slate-600">{LEVELS[g.level]} · {describeStanding(g.standing)}{g.expires_at ? ` · until ${formatDate(g.expires_at)}` : ""}</span></li>)}
          </ul>
        ) : <p className="mt-2 text-sm text-slate-500">No competencies are recorded for you.</p>}
      </section>

      <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-bold text-slate-900">Restricted steps</h2>
        {manager ? requirements.map((r) => <RequirementForm key={r.action} action={r.action} current={r.competency_id} competencies={competencyOptions} />) : (
          <ul className="text-sm">{requirements.map((r) => <li key={r.action}>{r.action === "qc_release" ? "QC release of material" : "Starting a production job"}: {r.competency_name ?? "no competency required"}</li>)}</ul>
        )}
      </section>

      <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-bold text-slate-900">Catalogue and holders</h2>
        <nav className="flex flex-wrap gap-2">{catalog.data.map((c) => <Link key={c.id} href={`/tasks/competencies?competency=${c.id}`} className={`rounded-xl border px-3 py-1.5 text-xs font-bold ${selected?.id === c.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-700"}`}>{c.code} ({c.holders} independent)</Link>)}</nav>
        {selected ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">{selected.name}{selected.procedure_title ? ` · procedure: ${selected.procedure_title} (revision ${selected.procedure_revision})` : ""}{selected.validity_months ? ` · valid ${selected.validity_months} months` : ""}</p>
            {holders ? <HoldersList holders={holders.rows} /> : <p className="text-sm text-slate-500">Holders could not be loaded.</p>}
            {holders && totalPages > 1 ? (
              <div className="flex justify-between text-xs font-bold">
                {page > 1 ? <Link className="underline" href={`/tasks/competencies?competency=${selected.id}&page=${page - 1}`}>Previous</Link> : <span />}
                {page < totalPages ? <Link className="underline" href={`/tasks/competencies?competency=${selected.id}&page=${page + 1}`}>Next</Link> : <span />}
              </div>
            ) : null}
          </div>
        ) : <p className="text-sm text-slate-500">No competencies defined yet.</p>}
        {manager ? (
          <>
            <h3 className="pt-2 text-sm font-black text-slate-900">Record or withdraw a grant</h3>
            {competencyOptions.length ? <GrantForm competencies={competencyOptions} employees={employees} /> : null}
            <h3 className="pt-2 text-sm font-black text-slate-900">Add a competency</h3>
            <CompetencyForm procedures={(proceduresResult.data ?? []).map((p) => ({ value: p.id, label: `${p.title} (rev ${p.revision})` }))} />
          </>
        ) : null}
      </section>

      {canSupervise ? (
        <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-bold text-slate-900">Confirm supervision</h2>
          <p className="text-xs text-slate-500">As an independent holder, confirm that you are supervising one step on one record. It is valid for 8 hours and is used once.</p>
          <SupervisionForm employees={employees.filter((e) => e.value !== context.userId)} />
        </section>
      ) : null}
    </div>
  );
}

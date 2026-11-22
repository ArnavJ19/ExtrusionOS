import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { OrchestrationSettingsForm, PreheatStandardForm, RetireStandardButton, RoutingEditor } from "@/components/modules/orchestration/settings-forms";
import { getSessionContext } from "@/lib/auth";
import { orchestrationAction } from "@/lib/actions/orchestration";
import { isOrchestrationManager, settingsSchema } from "@/lib/workflow/orchestration";

export default async function OrchestrationSettingsPage() {
  const context = await getSessionContext();
  if (context.dealerId || !isOrchestrationManager(context.role)) redirect("/settings");
  const result = await orchestrationAction({ command: "settings.get" });
  const parsed = result.success ? settingsSchema.safeParse(result.data) : null;
  if (!parsed?.success) {
    return <div className="space-y-4"><PageHeader title="Order lifecycle orchestration" />
      <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : "Settings could not be read."}</p></div>;
  }
  const data = parsed.data;
  return (
    <div className="space-y-5">
      <PageHeader title="Order lifecycle orchestration" description="Queue triggers, response times, production start controls, die preheat standards and who receives each department's work." />
      <OrchestrationSettingsForm data={data} />
      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-bold">Approved die preheat standards</h2>
        {data.standards.length ? <ul className="space-y-2 text-sm">{data.standards.map(s => <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2">
          <span><b>{s.name}</b> · {s.die_type?.replace(/_/g, " ") ?? "all die types"} · {s.min_temperature_c}–{s.max_temperature_c} °C · soak ≥ {s.min_soak_minutes} min · hold ≤ {s.max_hold_minutes} min · {s.sop_reference} · approved by {s.approved_by_name ?? "—"}</span>
          {data.can_edit_standards ? <RetireStandardButton id={s.id} /> : null}</li>)}</ul>
          : <p className="text-sm text-slate-600">None approved yet. Preheat cannot be scheduled until a standard covers the die type.</p>}
        <PreheatStandardForm canEdit={data.can_edit_standards} />
      </section>
      <RoutingEditor data={data} />
      {data.engine_errors.length ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="font-bold text-amber-950">Automation errors in the last 7 days</h2>
          <p className="text-sm text-amber-900">These evaluations failed without blocking the business change; the hourly check retries them.</p>
          <ul className="mt-2 space-y-1 text-sm">{data.engine_errors.map((e, n) => <li key={n}>{new Date(e.occurred_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · {e.source} · {e.message}</li>)}</ul>
        </section>
      ) : null}
    </div>
  );
}

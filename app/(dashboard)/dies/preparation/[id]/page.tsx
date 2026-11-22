import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { FloorLanguageToggle } from "@/components/modules/autopilot-batch9/floor-language";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { DiePrepActions } from "@/components/modules/orchestration/die-prep-actions";
import { getSessionContext } from "@/lib/auth";
import { diePreparationAction } from "@/lib/actions/orchestration";
import { floorText, isFloorKey, type FloorKey } from "@/lib/i18n/floor";
import { getFloorLanguage } from "@/lib/i18n/floor-server";
import { DIE_CHECKS, PREP_STATUS_LABELS, canReadOrchestration, isOrchestrationManager, prepDetailSchema } from "@/lib/workflow/orchestration";

const at = (value: string | null) => (value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—");

export default async function DiePreparationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, context, lang] = await Promise.all([params, getSessionContext(), getFloorLanguage()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (context.dealerId || !canReadOrchestration(context.role)) redirect("/dies");
  const t = floorText(lang);
  const result = await diePreparationAction({ command: "prep.get", id });
  const parsed = result.success ? prepDetailSchema.safeParse(result.data) : null;
  if (!parsed?.success) {
    return <div className="space-y-4"><PageHeader title={t("olo.dp.title")} backHref="/dies/preparation" backLabel={t("olo.dp.back")} />
      <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : t("olo.dp.readFailed")}</p></div>;
  }
  const p = parsed.data;
  const checks = (p.check_results ?? {}) as Record<string, unknown>;
  const system = (checks.system ?? {}) as Record<string, boolean>;
  const prepLabel = (s: string) => (isFloorKey(`olo.prep.${s}`) ? t(`olo.prep.${s}` as FloorKey) : PREP_STATUS_LABELS[s] ?? s);
  return (
    <div className="space-y-5" lang={lang}>
      <PageHeader title={`${t("olo.dp.h.die")} ${p.die_number} · ${prepLabel(p.status)}`} backHref="/dies/preparation" backLabel={t("olo.dp.back")}
        description={t("olo.dp.summary", { job: p.job_number, status: p.job_status.replace(/_/g, " "), order: p.order_number, profile: p.profile_code,
          press: `${p.machine_name ?? t("olo.dp.noPress")}${p.queue_rank ? ` #${p.queue_rank}` : ""}`, start: at(p.planned_start_at), location: p.die_location ?? t("olo.dp.noLocation") })}
        actions={<div className="flex flex-wrap items-center gap-2"><LiveRefresh name="die-prep" tables={["die_preparation_events"]} /><FloorLanguageToggle lang={lang} />
          <Link className="rounded-xl border bg-white px-4 py-3 text-sm font-bold" href={`/production/${p.production_job_id}`}>{t("olo.dp.job")}</Link></div>} />
      {p.job_die_id !== p.die_id ? <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900">{t("olo.dp.dieChanged")}</p> : null}
      {p.hold_expired ? <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900">{t("olo.dp.holdAlert", { min: p.standard?.max_hold_minutes })}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-bold">{t("olo.dp.evidence")}</h2>
          {p.check_results ? <ul className="space-y-1 text-sm">
            {Object.keys(DIE_CHECKS).map(k => <li key={k}>{checks[k] === true ? "✔" : "✘"} {t(`olo.check.${k}` as FloorKey)}</li>)}
            <li>{system.approved_for_profile ? "✔" : "✘"} {t("olo.check.approved")}</li>
            <li>{system.die_matches_job ? "✔" : "✘"} {t("olo.check.matches")}</li>
            <li>{system.not_running_elsewhere ? "✔" : "✘"} {t("olo.check.free")}</li>
          </ul> : <p className="text-sm text-slate-600">{t("olo.dp.noCheck")}</p>}
          {p.check_note ? <p className="text-sm"><b>{t("olo.dp.findings")}</b> {p.check_note}</p> : null}
          {p.preparation_note ? <p className="text-sm"><b>{t("olo.dp.preparation")}</b> {p.preparation_note}</p> : null}
          {p.preheat_scheduled_for ? <p className="text-sm"><b>{t("olo.dp.preheatScheduled")}</b> {at(p.preheat_scheduled_for)}{p.oven_reference ? ` ${t("olo.dp.inOven", { oven: p.oven_reference })}` : ""}</p> : null}
          {p.preheat_completed_at ? <p className="text-sm"><b>{t("olo.dp.preheated")}</b> {t("olo.dp.preheatValues", { temp: p.preheat_temperature_c, soak: p.preheat_soak_minutes, at: at(p.preheat_completed_at) })}</p> : null}
          {p.issued_at ? <p className="text-sm"><b>{t("olo.dp.issued")}</b> {at(p.issued_at)}</p> : null}
          {p.returned_at ? <p className="text-sm"><b>{t("olo.dp.returned")}</b> {at(p.returned_at)} — {p.return_condition}</p> : null}
        </section>
        <section className="space-y-3">
          <h2 className="text-lg font-bold">{t("olo.dp.nextStep")}</h2>
          <DiePrepActions prep={p} canCancel={isOrchestrationManager(context.role)} lang={lang} />
        </section>
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-bold">{t("olo.dp.history")}</h2>
        <ol className="mt-2 space-y-2 border-l border-slate-200 pl-4">{p.events.map((e, n) => <li key={n} className="text-sm"><p className="font-semibold">{e.action.replace(/_/g, " ")} → {prepLabel(e.to_status)}</p><p className="text-xs text-slate-500">{at(e.occurred_at)} · {e.actor_name ?? t("olo.dp.system")}{e.note ? ` · ${e.note}` : ""}</p></li>)}</ol>
      </section>
    </div>
  );
}

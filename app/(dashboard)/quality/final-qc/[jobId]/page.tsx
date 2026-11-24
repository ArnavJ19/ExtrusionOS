import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { FloorLanguageToggle } from "@/components/modules/autopilot-batch9/floor-language";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { FinalQcForm } from "@/components/modules/orchestration/final-qc-forms";
import { getSessionContext } from "@/lib/auth";
import { hasRouteAccess } from "@/lib/auth/route-permissions";
import { finalQcAction } from "@/lib/actions/orchestration";
import { floorText, isFloorKey, type FloorKey } from "@/lib/i18n/floor";
import { getFloorLanguage } from "@/lib/i18n/floor-server";
import { formatWeight } from "@/lib/utils/format";
import { canRecordFinalQc, finalQcJobSchema } from "@/lib/workflow/final-qc";

const at = (value: string) => new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

// Phase 5: one job's way through ageing — first-stage approval, ageing loads and reviews, and the final QC records.
export default async function FinalQcJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const [{ jobId }, context, lang] = await Promise.all([params, getSessionContext(), getFloorLanguage()]);
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) notFound();
  if (context.dealerId || !hasRouteAccess("/quality/final-qc", context.role)) redirect("/quality");
  const t = floorText(lang);
  const key = (prefix: string, value: string | null | undefined, fallback: string) => (value && isFloorKey(`${prefix}${value}`) ? t(`${prefix}${value}` as FloorKey) : fallback);
  const result = await finalQcAction({ command: "get", job_id: jobId });
  const parsed = result.success ? finalQcJobSchema.safeParse(result.data) : null;
  const header = (title: string) => <PageHeader title={title} backHref="/quality/final-qc" backLabel={t("fqc.back")}
    actions={<div className="flex flex-wrap items-center gap-2"><LiveRefresh name="final-qc-job" tables={["final_qc_records", "olo_events", "quality_reversals"]} /><FloorLanguageToggle lang={lang} /></div>} />;
  if (!parsed?.success) {
    return <div className="space-y-4" lang={lang}>{header(t("fqc.title"))}<p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : t("fqc.readFailed")}</p></div>;
  }
  const j = parsed.data;
  const route = `${key("fqc.route.", j.route.state, j.route.state)}${j.route.source ? ` (${key("fqc.source.", j.route.source, j.route.source)})` : ""}`;
  const facts: [string, string][] = [
    [t("fqc.f.job"), `${j.order_number ?? "—"} · ${j.profile_code ?? "—"}`],
    [t("fqc.f.alloy"), `${j.alloy ?? "—"} · ${j.temper ?? "—"}`],
    [t("fqc.f.route"), `${route}${j.route.detail ? ` — ${j.route.detail}` : ""}`],
    [t("fqc.h.stage"), key("fqc.stage.", j.stage, j.stage)]
  ];
  const quantities: [FloorKey, number][] = [
    ["fqc.q.produced", j.produced_kg], ["fqc.q.awaitingDecision", j.awaiting_decision_kg], ["fqc.q.approved", j.approved_kg], ["fqc.q.loaded", j.loaded_kg],
    ["fqc.q.inAgeing", j.in_ageing_kg], ["fqc.q.agedAccepted", j.aged_accepted_kg], ["fqc.q.agedRejected", j.aged_rejected_kg], ["fqc.q.awaitingFinal", j.awaiting_final_kg],
    ["fqc.q.finalAccepted", j.final_accepted_kg], ["fqc.q.finalRejected", j.final_rejected_kg]
  ];
  const spec: string[] = [
    j.spec.tensile_strength_mpa !== undefined ? t("fqc.spec.tensile", { v: j.spec.tensile_strength_mpa }) : null,
    j.spec.yield_strength_mpa !== undefined ? t("fqc.spec.yield", { v: j.spec.yield_strength_mpa }) : null,
    j.spec.elongation_percent !== undefined ? t("fqc.spec.elongation", { v: j.spec.elongation_percent }) : null,
    j.spec.hardness_requirement ? t("fqc.spec.hardness", { v: j.spec.hardness_requirement }) : null,
    j.spec.temper_requirement ? t("fqc.spec.temper", { v: j.spec.temper_requirement }) : null
  ].filter((x): x is string => x !== null);
  return (
    <div className="space-y-5" lang={lang}>
      {header(t("fqc.detailTitle", { job: j.job_number ?? "—" }))}
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{facts.map(([label, value]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-3"><dt className="text-xs font-semibold text-slate-600">{label}</dt><dd className="font-bold [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
      {j.order_id ? <Link className="inline-flex min-h-11 items-center text-sm font-bold underline" href={`/orders/${j.order_id}/lifecycle`}>{j.order_number ?? t("fqc.h.job")}</Link> : null}
      {j.packed_unaged_kg > j.tolerance_kg ? <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-950">{t("fqc.unaged", { kg: formatWeight(j.packed_unaged_kg) })}</p> : null}
      {j.containment_number ? <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{t("fqc.f.containment")}: <Link className="font-bold underline" href="/quality/containment">{j.containment_number}</Link></p> : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">{quantities.map(([label, kg]) => <div key={label} className="rounded-xl bg-slate-50 p-3"><dt className="text-xs font-semibold text-slate-600">{t(label)}</dt><dd className="text-lg font-bold">{formatWeight(kg)}</dd></div>)}</dl>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-bold">{t("fqc.spec.title")}</h2>
        <p className="text-xs text-slate-600">{t("fqc.spec.help")}</p>
        {spec.length ? <ul className="mt-2 flex flex-wrap gap-2">{spec.map(s => <li key={s} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold">{s}</li>)}</ul> : <p className="mt-2 text-sm">{t("fqc.spec.none")}</p>}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">{t("fqc.b.title")}</h2>
        {j.batches.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">{t("fqc.b.empty")}</p> : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50"><tr>{(["fqc.b.h.batch", "fqc.b.h.recipe", "fqc.b.h.status", "fqc.b.h.loaded", "fqc.b.h.outcome"] as FloorKey[]).map(h => <th key={h} scope="col" className="px-3 py-2 font-bold">{t(h)}</th>)}</tr></thead>
              <tbody>{j.batches.map(b => <tr key={`${b.batch_id}-${b.loaded_kg}`} className="border-t align-top">
                <td className="px-3 py-2 font-semibold"><Link className="underline" href={`/tasks/specialist/treatment/${b.batch_id}`}>{b.batch_number}</Link>{b.retreatment ? <div className="text-xs text-slate-500">{t("fqc.b.retreatment")}</div> : null}</td>
                <td className="px-3 py-2">{b.recipe}</td>
                <td className="px-3 py-2">{b.status.replace(/_/g, " ")}</td>
                <td className="px-3 py-2">{formatWeight(b.loaded_kg)}</td>
                <td className="px-3 py-2">{b.accepted_kg === null ? t("fqc.b.notReviewed") : `${formatWeight(b.accepted_kg)} · ${formatWeight(b.rejected_kg ?? 0)} · ${formatWeight(b.retreat_kg ?? 0)}`}</td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
      </section>

      {j.can_record && canRecordFinalQc(context.role) ? <FinalQcForm job={j} lang={lang} />
        : j.blocker ? <p role="status" className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold">{j.blocker}</p>
        : !canRecordFinalQc(context.role) ? <p className="text-sm text-slate-600">{t("fqc.qaOnly")}</p> : null}

      <section className="space-y-2">
        <h2 className="text-lg font-bold">{t("fqc.r.title")}</h2>
        {j.records.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">{t("fqc.r.empty")}</p> : (
          <ul className="space-y-2">{j.records.map(r => <li key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
            <p className="font-bold">{r.record_number}</p>
            <p className="[overflow-wrap:anywhere]">{t("fqc.r.line", { accepted: formatWeight(r.accepted_kg), rejected: formatWeight(r.rejected_kg), method: r.method, sampling: r.sampling_reference })}</p>
            {r.certificate_reference ? <p>{t("fqc.r.certificate", { ref: r.certificate_reference })}</p> : null}
            {r.temper_verified ? <p>{t("fqc.r.temper", { t: r.temper_verified })}</p> : null}
            {r.rejection_reason ? <p className="text-red-900 [overflow-wrap:anywhere]">{t("fqc.r.reason", { reason: r.rejection_reason })}</p> : null}
            {r.reversals.map(x => <p key={x.id}><Link className="underline" href={`/quality/reversals/${x.id}`}>{t("fqc.r.reversal", { number: x.reversal_number, kg: formatWeight(x.reversed_kg) })}</Link></p>)}
            <p className="text-xs text-slate-500">{t("fqc.r.by", { by: r.recorded_by_name ?? "—", at: at(r.recorded_at) })}</p>
          </li>)}</ul>
        )}
      </section>
    </div>
  );
}

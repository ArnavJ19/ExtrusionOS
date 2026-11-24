import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { FloorLanguageToggle } from "@/components/modules/autopilot-batch9/floor-language";
import { ContainmentActions, PriorApprovalReviews } from "@/components/modules/orchestration/nonconforming-forms";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { getSessionContext } from "@/lib/auth";
import { containmentAction } from "@/lib/actions/orchestration";
import { floorText, isFloorKey, type FloorKey } from "@/lib/i18n/floor";
import { getFloorLanguage } from "@/lib/i18n/floor-server";
import { formatWeight } from "@/lib/utils/format";
import { canReadOrchestration } from "@/lib/workflow/orchestration";
import { CONTAINMENT_STATUS, LOT_STATUS, containmentDetailSchema } from "@/lib/workflow/nonconforming";

const at = (value: string) => new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export default async function ContainmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, context, lang] = await Promise.all([params, getSessionContext(), getFloorLanguage()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (context.dealerId || !canReadOrchestration(context.role)) redirect("/quality");
  const t = floorText(lang);
  const result = await containmentAction({ command: "get", id });
  const parsed = result.success ? containmentDetailSchema.safeParse(result.data) : null;
  if (!parsed?.success) {
    return <div className="space-y-4" lang={lang}><PageHeader title={t("olo.qc.title")} backHref="/quality/containment" backLabel={t("olo.qc.back")} />
      <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : t("olo.qc.readFailed")}</p></div>;
  }
  const c = parsed.data;
  const statusLabel = isFloorKey(`olo.qc.status.${c.status}`) ? t(`olo.qc.status.${c.status}` as FloorKey) : CONTAINMENT_STATUS[c.status] ?? c.status;
  const ledger: [string, number][] = [[t("olo.qc.l.contained"), c.scope_kg], [t("olo.qc.l.accepted"), c.released_accepted_kg], [t("olo.qc.l.rejected"), c.released_rejected_kg],
    [t("olo.qc.l.held"), c.held_kg], [t("olo.qc.l.unreleased"), c.recorded.unreleased_accepted_kg + c.recorded.unreleased_rejected_kg]];
  return (
    <div className="space-y-5" lang={lang}>
      <PageHeader title={`${c.containment_number} · ${statusLabel}`} backHref="/quality/containment" backLabel={t("olo.qc.back")}
        description={t("olo.qc.summary", { job: c.job_number, order: c.order_number, profile: c.profile_code, die: c.die_number,
          stage: t(c.stage === "final" ? "olo.qc.stage.final" : "olo.qc.stage.first"), ncr: c.ncr_number, at: at(c.opened_at) })}
        actions={<div className="flex flex-wrap items-center gap-2"><LiveRefresh name="containment" tables={["quality_containments", "olo_events", "quality_reversals"]} /><FloorLanguageToggle lang={lang} />
          {c.order_id ? <Link href={`/orders/${c.order_id}/lifecycle`} className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">{t("olo.qc.orderLifecycle")}</Link> : null}</div>} />
      <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-950">
        <p className="font-bold">{t("olo.qc.defect", { defect: c.defect })}</p>
        <p>{c.inspection_mode === "full_inspection" ? t("olo.qc.fullHelp") : t("olo.qc.samplingHelp", { ref: c.sampling_reference, n: c.required_samples })}</p>
        {c.suspended_approved_kg > 0 ? <p className="mt-1 font-semibold">{t("olo.qc.suspended", { kg: formatWeight(c.suspended_approved_kg) })}</p> : null}
      </section>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">{ledger.map(([label, kg]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-3"><dt className="text-xs font-semibold text-slate-600">{label}</dt><dd className="text-lg font-bold">{formatWeight(kg)}</dd></div>)}</dl>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-lg font-bold">{t("olo.qc.results", { n: c.results.length })}</h2>
          {c.results.length ? <ul className="space-y-1 text-sm">{c.results.map(r => <li key={r.id} className={`rounded-xl border px-3 py-2 ${r.result === "accepted" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
            <b>{r.reference}</b> · {t(r.result === "accepted" ? "olo.qc.result.accepted" : "olo.qc.result.rejected")}{r.quantity_kg ? ` · ${formatWeight(r.quantity_kg)}` : ""}{r.pieces ? ` · ${r.pieces} pcs` : ""} · {r.method}{r.note ? ` · ${r.note}` : ""}
            <span className="block text-xs text-slate-600">{at(r.recorded_at)} · {r.recorded_by_name ?? "QA"} · {t(r.released ? "olo.qc.released" : "olo.qc.notReleased")}</span></li>)}</ul>
            : <p className="text-sm text-slate-600">{t("olo.qc.noResults")}</p>}
          <h2 className="pt-2 text-lg font-bold">{t("olo.qc.lots")}</h2>
          <ul className="space-y-1 text-sm">{c.lots.map(l => <li key={l.id} className={l.parent_lot_id ? "ml-4" : ""}><b>{l.lot_code}</b> · {l.kind} · {formatWeight(l.quantity_kg)} · {LOT_STATUS[l.status] ?? l.status}</li>)}</ul>
          <h2 className="pt-2 text-lg font-bold">{t("olo.qc.trace")}</h2>
          <p className="text-sm">{t("olo.qc.press", { press: c.trace.machine_name, die: c.die_number })}</p>
          {c.trace.billets.length ? <ul className="text-sm">{c.trace.billets.map((b, n) => <li key={n}>{b.billet_code ?? "billet"} · {b.source ?? "—"} · {b.alloy ?? "—"} · {b.cast_batch ?? b.external_batch ?? t("olo.qc.batchMissing")}</li>)}</ul> : <p className="text-sm text-slate-600">{t("olo.qc.noBillets")}</p>}
        </section>
        <section className="space-y-3"><h2 className="text-lg font-bold">{t("olo.qc.recordRelease")}</h2><ContainmentActions c={c} lang={lang} /><PriorApprovalReviews c={c} lang={lang} /></section>
      </div>
    </div>
  );
}

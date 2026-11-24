import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { FloorLanguageToggle } from "@/components/modules/autopilot-batch9/floor-language";
import { getSessionContext } from "@/lib/auth";
import { qualityReversalAction } from "@/lib/actions/orchestration";
import { floorText } from "@/lib/i18n/floor";
import { getFloorLanguage } from "@/lib/i18n/floor-server";
import { formatWeight } from "@/lib/utils/format";
import { canReadOrchestration } from "@/lib/workflow/orchestration";
import { reversalSchema } from "@/lib/workflow/quality-reversal";

const at = (value: string | null) => (value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—");

export default async function QualityReversalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, context, lang] = await Promise.all([params, getSessionContext(), getFloorLanguage()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (context.dealerId || !canReadOrchestration(context.role)) redirect("/quality");
  const t = floorText(lang);
  const result = await qualityReversalAction({ command: "get", id });
  const parsed = result.success ? reversalSchema.safeParse(result.data) : null;
  if (!parsed?.success) {
    return <div className="space-y-4" lang={lang}><PageHeader title={t("olo.rev.title")} backHref="/quality/reversals" backLabel={t("olo.rev.back")} />
      <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : t("olo.rev.readFailed")}</p></div>;
  }
  const r = parsed.data;
  const ledger: [string, number][] = [[t("olo.rev.l.original"), r.original_kg], [t("olo.rev.l.reversed"), r.reversed_kg], [t("olo.rev.l.retained"), r.retained_kg],
    [t("olo.rev.l.jobApproved"), r.job_approved_kg], [t("olo.rev.l.movedOn"), r.moved_on_kg]];
  return (
    <div className="space-y-5" lang={lang}>
      <PageHeader title={`${r.reversal_number} · ${t(r.reversed_as === "rejected" ? "olo.rev.as.rejected" : "olo.rev.as.rework")}`} backHref="/quality/reversals" backLabel={t("olo.rev.back")}
        description={t("olo.rev.summary", { batch: r.batch_number, job: r.job_number, order: r.order_number, profile: r.profile_code, by: r.reversed_by_name, at: at(r.reversed_at) })}
        actions={<div className="flex flex-wrap items-center gap-2"><FloorLanguageToggle lang={lang} />{r.order_id ? <Link href={`/orders/${r.order_id}/lifecycle`} className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">{t("olo.rev.orderLifecycle")}</Link> : null}</div>} />
      <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-950">
        <p className="font-bold">{t("olo.rev.reasonLabel")}: {r.reason}</p>
        <p>{t("olo.rev.methodLabel")}: {r.method}{r.reference ? ` · ${t("olo.rev.referenceLabel")}: ${r.reference}` : ""}</p>
        <p className="mt-1">{t(r.reversed_as === "rejected" ? "olo.rev.nextRejected" : "olo.rev.nextRework")}</p>
      </section>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">{ledger.map(([label, kg]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-3"><dt className="text-xs font-semibold text-slate-600">{label}</dt><dd className="text-lg font-bold">{formatWeight(kg)}</dd></div>)}</dl>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
        <h2 className="text-lg font-bold">{t("olo.rev.records")}</h2>
        <ul className="mt-2 space-y-1">
          <li><Link className="font-semibold underline" href={`/quality/${r.inspection_id}`}>{t("olo.rev.rec.original")}</Link> · {formatWeight(r.original_kg)} · {r.inspector_name ?? "—"} · {at(r.inspection_date)}</li>
          <li><Link className="font-semibold underline" href={`/quality/${r.reversed_inspection_id}`}>{t(r.reversed_as === "rejected" ? "olo.rev.rec.rejected" : "olo.rev.rec.rework")}</Link> · {formatWeight(r.reversed_kg)}</li>
          {r.retained_inspection_id ? <li><Link className="font-semibold underline" href={`/quality/${r.retained_inspection_id}`}>{t("olo.rev.rec.retained")}</Link> · {formatWeight(r.retained_kg)}</li> : null}
        </ul>
        {r.containment_id ? <p className="mt-2">{t(r.revocation_closed ? "olo.rev.containmentClosed" : "olo.rev.containmentOpen", { number: r.containment_number })} <Link className="font-semibold underline" href={`/quality/containment/${r.containment_id}`}>{t("olo.rev.openContainment")}</Link></p> : null}
        {r.reversed_as === "rejected" ? <p className="mt-2"><Link className="font-semibold underline" href="/foundry/remelt">{t("olo.rev.remelt")}</Link></p> : null}
      </section>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { FloorLanguageToggle } from "@/components/modules/autopilot-batch9/floor-language";
import { ReversalForm } from "@/components/modules/orchestration/reversal-forms";
import { getSessionContext } from "@/lib/auth";
import { qualityReversalAction } from "@/lib/actions/orchestration";
import { floorText } from "@/lib/i18n/floor";
import { getFloorLanguage } from "@/lib/i18n/floor-server";
import { formatWeight } from "@/lib/utils/format";
import { canReadOrchestration } from "@/lib/workflow/orchestration";
import { canReverseQc, reversalPreviewSchema } from "@/lib/workflow/quality-reversal";

export default async function NewQualityReversalPage({ searchParams }: { searchParams: Promise<{ inspection_id?: string }> }) {
  const [q, context, lang] = await Promise.all([searchParams, getSessionContext(), getFloorLanguage()]);
  if (context.dealerId || !canReadOrchestration(context.role)) redirect("/quality");
  const t = floorText(lang);
  const inspectionId = /^[0-9a-f-]{36}$/i.test(q.inspection_id ?? "") ? q.inspection_id! : null;
  const header = <PageHeader title={t("olo.rev.newTitle")} backHref={inspectionId ? `/quality/${inspectionId}` : "/quality/reversals"} backLabel={t(inspectionId ? "olo.rev.backInspection" : "olo.rev.back")}
    actions={<FloorLanguageToggle lang={lang} />} />;
  if (!inspectionId) {
    return <div className="space-y-4" lang={lang}>{header}<p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">{t("olo.rev.pickFirst")} <Link className="font-bold underline" href="/quality/database">{t("olo.rev.inspections")}</Link></p></div>;
  }
  const result = await qualityReversalAction({ command: "preview", inspection_id: inspectionId });
  const parsed = result.success ? reversalPreviewSchema.safeParse(result.data) : null;
  if (!parsed?.success) {
    return <div className="space-y-4" lang={lang}>{header}<p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : t("olo.rev.readFailed")}</p></div>;
  }
  const p = parsed.data;
  const facts: [string, string][] = [
    [t("olo.rev.f.approval"), `${p.batch_number ?? t("olo.rev.inspection")} · ${formatWeight(p.quantity_kg)} · ${p.inspector_name ?? "—"}`],
    [t("olo.rev.f.job"), `${p.job_number ?? "—"} · ${p.order_number ?? "—"} · ${p.profile_code ?? "—"}`],
    [t("olo.rev.f.stage"), t(p.stage === "production" ? "olo.rev.stage.production" : "olo.rev.stage.finishing")],
    [t("olo.rev.f.jobApproved"), formatWeight(p.job_approved_kg)],
    [t("olo.rev.f.movedOn"), formatWeight(p.moved_on_kg)],
    [t("olo.rev.f.max"), formatWeight(p.max_reversible_kg)]
  ];
  return (
    <div className="space-y-5" lang={lang}>
      {header}
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{facts.map(([label, value]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-3"><dt className="text-xs font-semibold text-slate-600">{label}</dt><dd className="font-bold [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
      {p.containment ? <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{t("olo.rev.underContainment", { number: p.containment.containment_number })} <Link className="font-bold underline" href={`/quality/containment/${p.containment.id}`}>{t("olo.rev.openContainment")}</Link></p> : null}
      {p.reversal_id ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">{t("olo.rev.alreadyReversed")} <Link className="font-bold underline" href={`/quality/reversals/${p.reversal_id}`}>{t("olo.rev.openReversal")}</Link></p>
        : !p.can_reverse ? <p role="status" className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold">{p.blocker}</p>
        : canReverseQc(context.role) ? <ReversalForm preview={p} lang={lang} /> : <p className="text-sm text-slate-600">{t("olo.rev.qaOnly")}</p>}
    </div>
  );
}

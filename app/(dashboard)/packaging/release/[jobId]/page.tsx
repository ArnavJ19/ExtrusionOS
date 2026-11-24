import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { FloorLanguageToggle } from "@/components/modules/autopilot-batch9/floor-language";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { getSessionContext } from "@/lib/auth";
import { hasRouteAccess } from "@/lib/auth/route-permissions";
import { packagingFlowAction } from "@/lib/actions/orchestration";
import { floorText, isFloorKey, type FloorKey } from "@/lib/i18n/floor";
import { getFloorLanguage } from "@/lib/i18n/floor-server";
import { formatDate, formatWeight } from "@/lib/utils/format";
import { releaseDetailSchema } from "@/lib/workflow/packaging-flow";

// Phase 6: one job's packaging release — released by which QC, packed so far, still to pack, the customer's packing
// specification, its bundles and where each one is, packaging jobs and handoffs.
export default async function PackagingReleaseDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
  const [{ jobId }, context, lang] = await Promise.all([params, getSessionContext(), getFloorLanguage()]);
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) notFound();
  if (context.dealerId || !hasRouteAccess("/packaging/release", context.role)) redirect("/packaging");
  const t = floorText(lang);
  const result = await packagingFlowAction({ command: "release.get", job_id: jobId });
  const parsed = result.success ? releaseDetailSchema.safeParse(result.data) : null;
  if (!result.success || !parsed?.success) {
    return <div className="space-y-4" lang={lang}><PageHeader title={t("pkf.rel.title")} backHref="/packaging/release" backLabel={t("pkf.rel.title")} />
      <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : t("pkf.rel.loadFailed")}</p></div>;
  }
  const d = parsed.data;
  const r = d.release;
  const state = (s: string) => (isFloorKey(`pkf.state.${s}`) ? t(`pkf.state.${s}` as FloorKey) : s.replace(/_/g, " "));
  const words = (s: string) => s.replace(/_/g, " ");
  return (
    <div className="space-y-5" lang={lang}>
      <PageHeader title={t("pkf.rel.detailTitle", { job: d.job.job_number ?? "—" })} backHref="/packaging/release" backLabel={t("pkf.rel.title")}
        description={t("pkf.rel.summary", { order: d.job.order_number, customer: d.job.customer, profile: d.job.profile_code, alloy: d.job.alloy, temper: d.job.temper ?? "", due: formatDate(d.job.expected_dispatch_date) })}
        actions={<div className="flex flex-wrap items-center gap-2"><LiveRefresh name="packaging-release-job" tables={["olo_events", "final_qc_records", "fg_transfer_bundles", "dispatches"]} /><FloorLanguageToggle lang={lang} />
          {d.can_record_bundles ? <Link href={`/dispatches/bundles/new?order_id=${d.job.order_id}`} className="rounded-xl bg-charcoal px-4 py-3 text-sm font-bold text-white">{t("pkf.rel.recordBundles")}</Link> : null}</div>} />
      {r ? <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold uppercase text-slate-500">{t("pkf.rel.released")}</p><p className="text-2xl font-black">{formatWeight(r.release_kg)}</p><p className="text-sm">{t(`pkf.basis.${r.basis}` as FloorKey)}</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold uppercase text-slate-500">{t("pkf.rel.packed")}</p><p className="text-2xl font-black">{formatWeight(r.packed_kg)}</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold uppercase text-slate-500">{t("pkf.rel.toPack")}</p><p className="text-2xl font-black">{formatWeight(r.to_pack_kg)}</p></div>
      </section> : null}
      {d.containment ? <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900">{t("pkf.rel.held", { number: d.containment })}</p> : null}
      {r?.basis === "first_qc_route_undocumented" ? <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{t("pkf.rel.undocumented")}</p> : null}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-bold">{t("pkf.rel.spec")}</h2>
        <p className="mt-1 text-sm [overflow-wrap:anywhere]">{d.spec_text}</p>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-bold">{t("pkf.rel.bundles")}</h2>
        {d.bundles.length === 0 ? <p className="mt-1 text-sm">{t("pkf.rel.noBundles")}</p> : (
          <div className="mt-2 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50"><tr>
            <th scope="col" className="px-3 py-2">{t("pkf.b.h.tag")}</th><th scope="col" className="px-3 py-2">{t("pkf.b.h.state")}</th><th scope="col" className="px-3 py-2">{t("pkf.b.h.net")}</th>
            <th scope="col" className="px-3 py-2">{t("pkf.b.h.where")}</th><th scope="col" className="px-3 py-2">{t("pkf.b.h.invoice")}</th></tr></thead>
            <tbody>{d.bundles.map(b => <tr key={b.id} className="border-t">
              <td className="px-3 py-2 font-mono font-semibold"><Link className="underline" href={`/packaging/bundles/${b.id}`}>{b.bundle_number}</Link></td>
              <td className="px-3 py-2">{state(b.state)}</td><td className="px-3 py-2">{formatWeight(b.net_kg)} · {b.pieces} pcs</td>
              <td className="px-3 py-2">{b.dispatch_number ?? b.location ?? "—"}</td><td className="px-3 py-2">{b.invoice_number ?? "—"}</td></tr>)}</tbody></table></div>)}
      </section>
      <section className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-bold">{t("pkf.rel.packagingJobs")}</h2>
          {d.packaging_jobs.length === 0 ? <p className="mt-1 text-sm">{t("pkf.rel.noPackagingJobs")}</p> : <ul className="mt-2 space-y-1 text-sm">{d.packaging_jobs.map(p =>
            <li key={p.id}><Link className="font-semibold underline" href={`/packaging/${p.id}`}>{p.packaging_number}</Link> · {words(p.status)} · {formatWeight(p.weight_kg)} · {p.pieces} pcs</li>)}</ul>}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-bold">{t("pkf.rel.handoffs")}</h2>
          {d.handoffs.length === 0 ? <p className="mt-1 text-sm">{t("pkf.rel.noHandoffs")}</p> : <ul className="mt-2 space-y-1 text-sm">{d.handoffs.map(h =>
            <li key={h.id} className="[overflow-wrap:anywhere]">{h.title} · {words(h.status)}{h.acceptance ? ` · ${words(h.acceptance)}` : ""}</li>)}</ul>}
        </div>
      </section>
    </div>
  );
}

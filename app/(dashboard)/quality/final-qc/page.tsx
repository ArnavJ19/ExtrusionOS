import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { FloorLanguageToggle } from "@/components/modules/autopilot-batch9/floor-language";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { getSessionContext } from "@/lib/auth";
import { hasRouteAccess } from "@/lib/auth/route-permissions";
import { finalQcAction } from "@/lib/actions/orchestration";
import { floorText, isFloorKey, type FloorKey } from "@/lib/i18n/floor";
import { getFloorLanguage } from "@/lib/i18n/floor-server";
import { formatWeight } from "@/lib/utils/format";
import { finalQcQueueSchema, finalQcRecordSchema, qualityFlowSchema } from "@/lib/workflow/final-qc";

const at = (value: string) => new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

// Phase 5: jobs whose route needs artificial ageing, from the first QC to the final QC that releases them for packing.
export default async function FinalQcPage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string }> }) {
  const [q, context, lang] = await Promise.all([searchParams, getSessionContext(), getFloorLanguage()]);
  if (context.dealerId || !hasRouteAccess("/quality/final-qc", context.role)) redirect("/quality");
  const t = floorText(lang);
  const view = q.view === "recorded" ? "recorded" : "awaiting";
  const page = Math.min(Math.max(Number.parseInt(q.page ?? "1", 10) || 1, 1), 100000);
  const result = await finalQcAction({ command: "queue", view, page });
  const list = result.success ? finalQcQueueSchema.safeParse(result.data).data ?? null : null;
  const stage = (s: string) => (isFloorKey(`fqc.stage.${s}`) ? t(`fqc.stage.${s}` as FloorKey) : s.replace(/_/g, " "));
  const tab = (v: "awaiting" | "recorded", key: FloorKey) => (
    <Link href={`?view=${v}`} aria-current={view === v ? "page" : undefined}
      className={`inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold ${view === v ? "bg-charcoal text-white" : "border border-slate-300 bg-white"}`}>{t(key)}</Link>
  );
  const awaitingRows = view === "awaiting" && list ? list.rows.map(r => ({ flow: qualityFlowSchema.safeParse(r), order_number: r.order_number as string | null, profile_code: r.profile_code as string | null })) : [];
  const recordRows = view === "recorded" && list ? list.rows.map(r => finalQcRecordSchema.safeParse(r)) : [];
  const headers: FloorKey[] = view === "awaiting" ? ["fqc.h.job", "fqc.h.profile", "fqc.h.stage", "fqc.h.awaitingAgeing", "fqc.h.inAgeing", "fqc.h.awaitingFinal", "fqc.h.released"]
    : ["fqc.h.record", "fqc.h.job", "fqc.h.accepted", "fqc.h.rejected", "fqc.h.method", "fqc.h.by"];
  return (
    <div className="space-y-5" lang={lang}>
      <PageHeader title={t("fqc.title")} description={t("fqc.desc")} backHref="/quality" backLabel={t("fqc.backQuality")}
        actions={<div className="flex flex-wrap items-center gap-2"><LiveRefresh name="final-qc" tables={["final_qc_records", "olo_events", "quality_reversals"]} /><FloorLanguageToggle lang={lang} />
          <Link href="/tasks/specialist/database?view=treatment" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">{t("fqc.ageingBatches")}</Link></div>} />
      {list ? <p className={`rounded-2xl border p-4 text-sm ${list.enforced ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-slate-200 bg-white text-slate-700"}`}>{t(list.enforced ? "fqc.enforcedOn" : "fqc.enforcedOff")}</p> : null}
      <nav className="flex flex-wrap gap-2" aria-label={t("fqc.title")}>{tab("awaiting", "fqc.tab.awaiting")}{tab("recorded", "fqc.tab.recorded")}</nav>
      {!list ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : t("fqc.loadFailed")}</p>
        : list.rows.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">{t(view === "awaiting" ? "fqc.emptyAwaiting" : "fqc.emptyRecorded")}</p> : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50"><tr>{headers.map(h => <th key={h} scope="col" className="px-3 py-2 font-bold">{t(h)}</th>)}</tr></thead>
            <tbody>
              {awaitingRows.map(({ flow, order_number, profile_code }, n) => flow.success ? (
                <tr key={flow.data.job_id} className="border-t align-top">
                  <td className="px-3 py-2 font-semibold"><Link className="underline" href={`/quality/final-qc/${flow.data.job_id}`}>{flow.data.job_number ?? "—"}</Link>
                    <div className="text-xs">{flow.data.order_id ? <Link className="underline" href={`/orders/${flow.data.order_id}/lifecycle`}>{order_number ?? "—"}</Link> : "—"}</div></td>
                  <td className="px-3 py-2">{profile_code ?? "—"}</td>
                  <td className="px-3 py-2 font-semibold">{stage(flow.data.stage)}</td>
                  <td className="px-3 py-2">{formatWeight(flow.data.awaiting_ageing_kg)}</td>
                  <td className="px-3 py-2">{formatWeight(flow.data.in_ageing_kg)}</td>
                  <td className="px-3 py-2 font-bold">{formatWeight(flow.data.awaiting_final_kg)}</td>
                  <td className="px-3 py-2">{formatWeight(flow.data.final_accepted_kg)}</td>
                </tr>) : <tr key={`bad-${n}`} className="border-t"><td colSpan={headers.length} className="px-3 py-2 text-amber-900">{t("fqc.loadFailed")}</td></tr>)}
              {recordRows.map((parsed, n) => parsed.success ? (
                <tr key={parsed.data.id} className="border-t align-top">
                  <td className="px-3 py-2 font-semibold">{parsed.data.record_number}<div className="text-xs text-slate-500">{at(parsed.data.recorded_at)}</div></td>
                  <td className="px-3 py-2"><Link className="underline" href={`/quality/final-qc/${parsed.data.job_id}`}>{parsed.data.job_number ?? "—"}</Link>
                    <div className="text-xs">{parsed.data.order_id ? <Link className="underline" href={`/orders/${parsed.data.order_id}/lifecycle`}>{parsed.data.order_number ?? "—"}</Link> : "—"}</div></td>
                  <td className="px-3 py-2 font-bold text-emerald-900">{formatWeight(parsed.data.accepted_kg)}</td>
                  <td className="px-3 py-2 font-bold text-red-900">{formatWeight(parsed.data.rejected_kg)}</td>
                  <td className="max-w-xs px-3 py-2 [overflow-wrap:anywhere]">{parsed.data.method}<div className="text-xs text-slate-500">{parsed.data.sampling_reference}</div></td>
                  <td className="px-3 py-2">{parsed.data.recorded_by_name ?? "—"}</td>
                </tr>) : <tr key={`bad-${n}`} className="border-t"><td colSpan={headers.length} className="px-3 py-2 text-amber-900">{t("fqc.loadFailed")}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
      {list && list.total > list.page_size ? <nav className="flex justify-between text-sm font-semibold" aria-label="Pages">
        {page > 1 ? <Link href={`?view=${view}&page=${page - 1}`}>{t("common.previous")}</Link> : <span />}<span>{t("olo.tasks.pageOf", { n: page, total: Math.ceil(list.total / list.page_size) })}</span>
        {page * list.page_size < list.total ? <Link href={`?view=${view}&page=${page + 1}`}>{t("common.next")}</Link> : <span />}</nav> : null}
    </div>
  );
}

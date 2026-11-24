import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { FloorLanguageToggle } from "@/components/modules/autopilot-batch9/floor-language";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { getSessionContext } from "@/lib/auth";
import { qualityReversalAction } from "@/lib/actions/orchestration";
import { floorText, type FloorKey } from "@/lib/i18n/floor";
import { getFloorLanguage } from "@/lib/i18n/floor-server";
import { formatWeight } from "@/lib/utils/format";
import { canReadOrchestration } from "@/lib/workflow/orchestration";
import { reversalListSchema } from "@/lib/workflow/quality-reversal";

const at = (value: string) => new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function QualityReversalsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const [q, context, lang] = await Promise.all([searchParams, getSessionContext(), getFloorLanguage()]);
  if (context.dealerId || !canReadOrchestration(context.role)) redirect("/quality");
  const t = floorText(lang);
  const page = Math.min(Math.max(Number.parseInt(q.page ?? "1", 10) || 1, 1), 100000);
  const result = await qualityReversalAction({ command: "list", page });
  const list = result.success ? reversalListSchema.safeParse(result.data).data ?? null : null;
  const headers: FloorKey[] = ["olo.rev.h.number", "olo.rev.h.approval", "olo.rev.h.job", "olo.rev.h.reversed", "olo.rev.h.retained", "olo.rev.h.reason", "olo.rev.h.by"];
  return (
    <div className="space-y-5" lang={lang}>
      <PageHeader title={t("olo.rev.title")} description={t("olo.rev.desc")} backHref="/quality" backLabel={t("olo.rev.backQuality")}
        actions={<div className="flex flex-wrap items-center gap-2"><LiveRefresh name="qc-reversals" tables={["quality_reversals"]} /><FloorLanguageToggle lang={lang} />
          <Link href="/quality/database" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">{t("olo.rev.inspections")}</Link></div>} />
      <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">{t("olo.rev.how")}</p>
      {!list ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : t("olo.rev.loadFailed")}</p>
        : list.rows.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">{t("olo.rev.empty")}</p> : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50"><tr>{headers.map(h => <th key={h} scope="col" className="px-3 py-2 font-bold">{t(h)}</th>)}</tr></thead>
            <tbody>{list.rows.map(r => <tr key={r.id} className="border-t align-top">
              <td className="px-3 py-2 font-semibold"><Link className="underline" href={`/quality/reversals/${r.id}`}>{r.reversal_number}</Link><div className="text-xs text-slate-500">{at(r.reversed_at)}</div></td>
              <td className="px-3 py-2"><Link className="underline" href={`/quality/${r.inspection_id}`}>{r.batch_number ?? t("olo.rev.inspection")}</Link><div className="text-xs text-slate-500">{formatWeight(r.original_kg)}</div></td>
              <td className="px-3 py-2">{r.job_number ?? "—"}<div className="text-xs">{r.order_id ? <Link className="underline" href={`/orders/${r.order_id}/lifecycle`}>{r.order_number}</Link> : "—"}</div></td>
              <td className="px-3 py-2 font-bold text-red-900">{formatWeight(r.reversed_kg)}<div className="text-xs font-semibold">{t(r.reversed_as === "rejected" ? "olo.rev.as.rejected" : "olo.rev.as.rework")}</div></td>
              <td className="px-3 py-2">{formatWeight(r.retained_kg)}</td>
              <td className="max-w-xs px-3 py-2 [overflow-wrap:anywhere]">{r.reason}</td>
              <td className="px-3 py-2">{r.reversed_by_name ?? "—"}</td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
      {list && list.total > list.page_size ? <nav className="flex justify-between text-sm font-semibold" aria-label="Pages">
        {page > 1 ? <Link href={`?page=${page - 1}`}>{t("common.previous")}</Link> : <span />}<span>{t("olo.tasks.pageOf", { n: page, total: Math.ceil(list.total / list.page_size) })}</span>
        {page * list.page_size < list.total ? <Link href={`?page=${page + 1}`}>{t("common.next")}</Link> : <span />}</nav> : null}
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { FloorLanguageToggle } from "@/components/modules/autopilot-batch9/floor-language";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { ListControls, SortHeader } from "@/components/modules/orchestration/list-controls";
import { getSessionContext } from "@/lib/auth";
import { qualityReversalAction } from "@/lib/actions/orchestration";
import { floorText, type FloorKey } from "@/lib/i18n/floor";
import { getFloorLanguage } from "@/lib/i18n/floor-server";
import { formatWeight } from "@/lib/utils/format";
import { canReadOrchestration } from "@/lib/workflow/orchestration";
import { REVERSAL_SORTS, reversalListSchema } from "@/lib/workflow/quality-reversal";

const at = (value: string) => new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

type Params = { page?: string; q?: string; outcome?: string; sort?: string; dir?: string };

export default async function QualityReversalsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const [q, context, lang] = await Promise.all([searchParams, getSessionContext(), getFloorLanguage()]);
  if (context.dealerId || !canReadOrchestration(context.role)) redirect("/quality");
  const t = floorText(lang);
  const page = Math.min(Math.max(Number.parseInt(q.page ?? "1", 10) || 1, 1), 100000);
  // Search, outcome filter and sort run in the database (migration 20261124200000); the URL keeps them.
  const search = (q.q ?? "").trim().slice(0, 80);
  const outcome = q.outcome === "rejected" || q.outcome === "rework" ? q.outcome : undefined;
  const sort = (REVERSAL_SORTS as readonly string[]).includes(q.sort ?? "") ? (q.sort as (typeof REVERSAL_SORTS)[number]) : "reversed_at";
  const direction = q.dir === "asc" ? "asc" : "desc";
  // Only non-default options are sent, so the default list still reads from a database without that upgrade.
  const result = await qualityReversalAction({ command: "list", page, ...(sort !== "reversed_at" ? { sort } : {}), ...(direction !== "desc" ? { direction } : {}),
    ...(search ? { search } : {}), ...(outcome ? { reversed_as: outcome } : {}) });
  const list = result.success ? reversalListSchema.safeParse(result.data).data ?? null : null;
  const href = (next: { page?: number; sort?: string; dir?: string }) => {
    const p = new URLSearchParams();
    if (search) p.set("q", search);
    if (outcome) p.set("outcome", outcome);
    p.set("sort", next.sort ?? sort); p.set("dir", next.dir ?? direction);
    if (next.page && next.page > 1) p.set("page", String(next.page));
    return `?${p.toString()}`;
  };
  const sortHref = (s: string, d: string) => href({ sort: s, dir: d });
  const plain: FloorKey[] = ["olo.rev.h.approval", "olo.rev.h.job"];
  return (
    <div className="space-y-5" lang={lang}>
      <PageHeader title={t("olo.rev.title")} description={t("olo.rev.desc")} backHref="/quality" backLabel={t("olo.rev.backQuality")}
        actions={<div className="flex flex-wrap items-center gap-2"><LiveRefresh name="qc-reversals" tables={["quality_reversals"]} /><FloorLanguageToggle lang={lang} />
          <Link href="/quality/database" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">{t("olo.rev.inspections")}</Link></div>} />
      <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">{t("olo.rev.how")}</p>
      <ListControls t={t} search={search} searchHint={t("olo.rev.searchHint")} sort={sort} direction={direction} clearHref="/quality/reversals"
        filter={{ name: "outcome", label: t("olo.rev.as"), value: outcome ?? "", options: [{ value: "", label: t("olo.rev.allOutcomes") },
          { value: "rejected", label: t("olo.rev.as.rejected") }, { value: "rework", label: t("olo.rev.as.rework") }] }}
        sorts={REVERSAL_SORTS.map(s => ({ value: s, label: t(`olo.rev.sort.${s}` as FloorKey) }))} />
      {!list ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : t("olo.rev.loadFailed")}</p>
        : list.rows.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">{t("olo.rev.empty")}</p> : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50"><tr>
              <SortHeader t={t} label={t("olo.rev.h.number")} field="reversal_number" sort={sort} direction={direction} href={sortHref} />
              {plain.map(h => <th key={h} scope="col" className="px-3 py-2 font-bold">{t(h)}</th>)}
              <SortHeader t={t} label={t("olo.rev.h.reversed")} field="reversed_kg" sort={sort} direction={direction} href={sortHref} />
              <th scope="col" className="px-3 py-2 font-bold">{t("olo.rev.h.retained")}</th>
              <th scope="col" className="px-3 py-2 font-bold">{t("olo.rev.h.reason")}</th>
              <SortHeader t={t} label={t("olo.rev.h.by")} field="reversed_at" sort={sort} direction={direction} href={sortHref} />
            </tr></thead>
            <tbody>{list.rows.map(r => <tr key={r.id} className="border-t align-top">
              <td className="px-3 py-2 font-semibold"><Link className="underline" href={`/quality/reversals/${r.id}`}>{r.reversal_number}</Link><div className="text-xs text-slate-500">{at(r.reversed_at)}</div></td>
              <td className="px-3 py-2"><Link className="underline" href={`/quality/${r.inspection_id}`}>{r.batch_number ?? t("olo.rev.inspection")}</Link><div className="text-xs text-slate-500">{formatWeight(r.original_kg)}</div></td>
              <td className="px-3 py-2">{r.job_number ?? "—"}<div className="text-xs">{r.order_id ? <Link className="underline" href={`/orders/${r.order_id}/lifecycle`}>{r.order_number}</Link> : "—"}</div></td>
              <td className="px-3 py-2 font-bold text-red-900">{formatWeight(r.reversed_kg)}<div className="text-xs font-semibold">{t(r.reversed_as === "rejected" ? "olo.rev.as.rejected" : "olo.rev.as.rework")}</div></td>
              <td className="px-3 py-2">{formatWeight(r.retained_kg)}</td>
              <td className="max-w-xs px-3 py-2 [overflow-wrap:anywhere]">{r.reason}</td>
              <td className="px-3 py-2">{r.reversed_by_name ?? "—"}<div className="text-xs text-slate-500">{at(r.reversed_at)}</div></td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
      {list && list.total > list.page_size ? <nav className="flex justify-between text-sm font-semibold" aria-label="Pages">
        {page > 1 ? <Link href={href({ page: page - 1 })}>{t("common.previous")}</Link> : <span />}<span>{t("olo.tasks.pageOf", { n: page, total: Math.ceil(list.total / list.page_size) })}</span>
        {page * list.page_size < list.total ? <Link href={href({ page: page + 1 })}>{t("common.next")}</Link> : <span />}</nav> : null}
    </div>
  );
}

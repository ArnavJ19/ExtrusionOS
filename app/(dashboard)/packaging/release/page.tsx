import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { FloorLanguageToggle } from "@/components/modules/autopilot-batch9/floor-language";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { ListControls, SortHeader } from "@/components/modules/orchestration/list-controls";
import { getSessionContext } from "@/lib/auth";
import { hasRouteAccess } from "@/lib/auth/route-permissions";
import { packagingFlowAction } from "@/lib/actions/orchestration";
import { floorText, type FloorKey } from "@/lib/i18n/floor";
import { getFloorLanguage } from "@/lib/i18n/floor-server";
import { formatWeight } from "@/lib/utils/format";
import { RELEASE_SORTS, RELEASE_VIEWS, releaseQueueSchema, releaseSort } from "@/lib/workflow/packaging-flow";

// Phase 6: what each job has released to packaging (route-aware), what is packed and what is still to pack.
export default async function PackagingReleasePage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string; q?: string; sort?: string; dir?: string }> }) {
  const [q, context, lang] = await Promise.all([searchParams, getSessionContext(), getFloorLanguage()]);
  if (context.dealerId || !hasRouteAccess("/packaging/release", context.role)) redirect("/packaging");
  const t = floorText(lang);
  const view = (RELEASE_VIEWS as readonly string[]).includes(q.view ?? "") ? q.view as (typeof RELEASE_VIEWS)[number] : "to_pack";
  const page = Math.min(Math.max(Number.parseInt(q.page ?? "1", 10) || 1, 1), 100000);
  const search = (q.q ?? "").trim().slice(0, 80);
  const sort = releaseSort(q.sort);
  const direction = q.dir === "asc" || q.dir === "desc" ? q.dir : sort === "job_number" ? "asc" : "desc";
  const result = await packagingFlowAction({ command: "release.queue", view, page, sort, direction, ...(search ? { search } : {}) });
  const list = result.success ? releaseQueueSchema.safeParse(result.data).data ?? null : null;
  const href = (next: { view?: string; page?: number; sort?: string; dir?: string }) => {
    const p = new URLSearchParams();
    p.set("view", next.view ?? view);
    if (next.view === undefined) {
      if (search) p.set("q", search);
      p.set("sort", next.sort ?? sort); p.set("dir", next.dir ?? direction);
    }
    if (next.page && next.page > 1) p.set("page", String(next.page));
    return `?${p.toString()}`;
  };
  const headers: [FloorKey, string | null][] = [["pkf.rel.h.job", "job_number"], ["pkf.rel.h.profile", null], ["pkf.rel.h.basis", null], ["pkf.rel.h.released", "release_kg"],
    ["pkf.rel.h.packed", null], ["pkf.rel.h.toPack", "to_pack_kg"]];
  return (
    <div className="space-y-5" lang={lang}>
      <PageHeader title={t("pkf.rel.title")} description={t("pkf.rel.desc")} backHref="/packaging" backLabel={t("pkf.rel.back")}
        actions={<div className="flex flex-wrap items-center gap-2"><LiveRefresh name="packaging-release" tables={["olo_events", "final_qc_records", "quality_reversals"]} /><FloorLanguageToggle lang={lang} />
          <Link href="/packaging/bundles" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">{t("pkf.card.bundles")}</Link></div>} />
      <nav className="flex flex-wrap gap-2" aria-label={t("pkf.rel.title")}>
        {RELEASE_VIEWS.map(v => <Link key={v} href={href({ view: v })} aria-current={view === v ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold ${view === v ? "bg-charcoal text-white" : "border border-slate-300 bg-white"}`}>{t(`pkf.rel.tab.${v}` as FloorKey)}</Link>)}
      </nav>
      <ListControls t={t} search={search} searchHint={t("pkf.rel.searchHint")} hidden={{ view }} sort={sort} direction={direction} clearHref={`?view=${view}`}
        sorts={RELEASE_SORTS.map(s => ({ value: s, label: t(`pkf.rel.sort.${s}` as FloorKey) }))} />
      {!list ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : t("pkf.rel.loadFailed")}</p>
        : list.rows.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">{t("pkf.rel.empty")}</p> : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50"><tr>{headers.map(([h, field]) => field
              ? <SortHeader key={h} t={t} label={t(h)} field={field} sort={sort} direction={direction} href={(s, d) => href({ sort: s, dir: d })} />
              : <th key={h} scope="col" className="px-3 py-2 font-bold">{t(h)}</th>)}</tr></thead>
            <tbody>{list.rows.map(r => (
              <tr key={r.job_id} className="border-t align-top">
                <td className="px-3 py-2 font-semibold"><Link className="underline" href={`/packaging/release/${r.job_id}`}>{r.job_number ?? "—"}</Link>
                  <div className="text-xs"><Link className="underline" href={`/orders/${r.order_id}/lifecycle`}>{r.order_number ?? "—"}</Link> · {r.customer ?? "—"}</div></td>
                <td className="px-3 py-2">{r.profile_code ?? "—"}</td>
                <td className={`px-3 py-2 ${r.basis === "held" ? "font-bold text-red-900" : ""}`}>{t(`pkf.basis.${r.basis}` as FloorKey)}{r.containment ? <div className="text-xs">{r.containment}</div> : null}</td>
                <td className="px-3 py-2">{formatWeight(r.release_kg)}</td>
                <td className="px-3 py-2">{formatWeight(r.packed_kg)}</td>
                <td className="px-3 py-2 font-bold">{formatWeight(r.to_pack_kg)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {list && list.total > list.page_size ? <nav className="flex justify-between text-sm font-semibold" aria-label="Pages">
        {page > 1 ? <Link href={href({ page: page - 1 })}>{t("common.previous")}</Link> : <span />}<span>{t("olo.tasks.pageOf", { n: page, total: Math.ceil(list.total / list.page_size) })}</span>
        {page * list.page_size < list.total ? <Link href={href({ page: page + 1 })}>{t("common.next")}</Link> : <span />}</nav> : null}
    </div>
  );
}

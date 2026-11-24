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
import { FG_SORTS, fgListSchema, fgSort } from "@/lib/workflow/packaging-flow";

const at = (value: string) => new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

// Phase 6: finished-goods transfers in transit and closed (search, sorting, 10 per page, in the database).
export default async function FgTransfersPage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string; q?: string; sort?: string; dir?: string }> }) {
  const [q, context, lang] = await Promise.all([searchParams, getSessionContext(), getFloorLanguage()]);
  if (context.dealerId || !hasRouteAccess("/packaging/fg-transfers", context.role)) redirect("/dashboard");
  const t = floorText(lang);
  const view = q.view === "done" ? "done" : "open";
  const page = Math.min(Math.max(Number.parseInt(q.page ?? "1", 10) || 1, 1), 100000);
  const search = (q.q ?? "").trim().slice(0, 80);
  const sort = fgSort(q.sort);
  const direction = q.dir === "asc" || q.dir === "desc" ? q.dir : sort === "transfer_number" ? "asc" : "desc";
  const result = await packagingFlowAction({ command: "fg.list", view, page, sort, direction, ...(search ? { search } : {}) });
  const list = result.success ? fgListSchema.safeParse(result.data).data ?? null : null;
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
  const headers: [FloorKey, string | null][] = [["pkf.fg.h.transfer", "transfer_number"], ["pkf.fg.h.location", null], ["pkf.fg.h.bundles", "bundle_count"], ["pkf.fg.h.received", null], ["pkf.fg.h.sent", "sent_at"]];
  return (
    <div className="space-y-5" lang={lang}>
      <PageHeader title={t("pkf.fg.title")} description={t("pkf.fg.desc")} backHref="/packaging" backLabel={t("pkf.rel.back")}
        actions={<div className="flex flex-wrap items-center gap-2"><LiveRefresh name="fg-transfers" tables={["fg_transfers", "fg_transfer_bundles"]} /><FloorLanguageToggle lang={lang} />
          {list?.can_send ? <Link href="/packaging/fg-transfers/new" className="rounded-xl bg-charcoal px-4 py-3 text-sm font-bold text-white">{t("pkf.fg.new")}</Link> : null}</div>} />
      <nav className="flex flex-wrap gap-2" aria-label={t("pkf.fg.title")}>
        {(["open", "done"] as const).map(v => <Link key={v} href={href({ view: v })} aria-current={view === v ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold ${view === v ? "bg-charcoal text-white" : "border border-slate-300 bg-white"}`}>{t(`pkf.fg.tab.${v}` as FloorKey)}</Link>)}
      </nav>
      <ListControls t={t} search={search} searchHint={t("pkf.fg.searchHint")} hidden={{ view }} sort={sort} direction={direction} clearHref={`?view=${view}`}
        sorts={FG_SORTS.map(s => ({ value: s, label: t(`pkf.fg.sort.${s}` as FloorKey) }))} />
      {!list ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : t("pkf.fg.loadFailed")}</p>
        : list.rows.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">{t("pkf.fg.empty")}</p> : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50"><tr>{headers.map(([h, f]) => f
              ? <SortHeader key={h} t={t} label={t(h)} field={f} sort={sort} direction={direction} href={(s, d) => href({ sort: s, dir: d })} />
              : <th key={h} scope="col" className="px-3 py-2 font-bold">{t(h)}</th>)}</tr></thead>
            <tbody>{list.rows.map(r => (
              <tr key={r.id} className="border-t align-top">
                <td className="px-3 py-2 font-semibold"><Link className="underline" href={`/packaging/fg-transfers/${r.id}`}>{r.transfer_number}</Link><div className="text-xs">{t(`pkf.status.${r.status}` as FloorKey)}</div></td>
                <td className="px-3 py-2">{r.location}</td>
                <td className="px-3 py-2">{r.bundle_count} · {formatWeight(r.net_kg)}</td>
                <td className={`px-3 py-2 ${r.missing > 0 ? "font-bold text-red-900" : ""}`}>{r.received} / {r.missing}</td>
                <td className="px-3 py-2">{r.sent_by_name ?? "—"}<div className="text-xs">{at(r.sent_at)}</div></td>
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

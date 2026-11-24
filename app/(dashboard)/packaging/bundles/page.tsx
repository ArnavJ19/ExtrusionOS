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
import { BUNDLE_SORTS, BUNDLE_STATES, bundleListSchema, bundleResolveSchema, bundleSort, tagSchema } from "@/lib/workflow/packaging-flow";

const field = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-sm";

// Phase 6: the bundle register (search, state filter, sorting, 10 per page, all in the database) and the tag lookup
// that opens a bundle's trace. A scanner keyboard wedge types into the lookup field and presses Enter.
export default async function BundlesPage({ searchParams }: { searchParams: Promise<{ tag?: string; state?: string; uninvoiced?: string; page?: string; q?: string; sort?: string; dir?: string }> }) {
  const [q, context, lang] = await Promise.all([searchParams, getSessionContext(), getFloorLanguage()]);
  if (context.dealerId || !hasRouteAccess("/packaging/bundles", context.role)) redirect("/dashboard");
  const t = floorText(lang);
  let lookup: string | null = null;
  if (q.tag !== undefined) {
    const tag = tagSchema.safeParse(q.tag);
    if (!tag.success) lookup = tag.error.issues[0]?.message ?? t("pkf.b.notFound", { tag: q.tag });
    else {
      const found = await packagingFlowAction({ command: "bundle.resolve", tag: tag.data });
      const parsed = found.success ? bundleResolveSchema.safeParse(found.data) : null;
      if (parsed?.success && parsed.data.found) redirect(`/packaging/bundles/${parsed.data.id}`);
      lookup = !found.success ? found.error : parsed?.success && parsed.data.dispatch_number
        ? t("pkf.b.legacy", { tag: tag.data, dispatch: parsed.data.dispatch_number }) : t("pkf.b.notFound", { tag: tag.data });
    }
  }
  const state = (BUNDLE_STATES as readonly string[]).includes(q.state ?? "") ? q.state as (typeof BUNDLE_STATES)[number] : "all";
  const notInvoiced = q.uninvoiced === "1";
  const page = Math.min(Math.max(Number.parseInt(q.page ?? "1", 10) || 1, 1), 100000);
  const search = (q.q ?? "").trim().slice(0, 80);
  const sort = bundleSort(q.sort);
  const direction = q.dir === "asc" || q.dir === "desc" ? q.dir : sort === "bundle_number" ? "asc" : "desc";
  const result = await packagingFlowAction({ command: "bundles.list", state, page, sort, direction, ...(notInvoiced ? { not_invoiced: true } : {}), ...(search ? { search } : {}) });
  const list = result.success ? bundleListSchema.safeParse(result.data).data ?? null : null;
  const href = (next: { page?: number; sort?: string; dir?: string }) => {
    const p = new URLSearchParams();
    if (search) p.set("q", search);
    if (state !== "all") p.set("state", state);
    if (notInvoiced) p.set("uninvoiced", "1");
    p.set("sort", next.sort ?? sort); p.set("dir", next.dir ?? direction);
    if (next.page && next.page > 1) p.set("page", String(next.page));
    return `?${p.toString()}`;
  };
  const headers: [FloorKey, string | null][] = [["pkf.b.h.tag", "bundle_number"], ["pkf.b.h.order", null], ["pkf.b.h.state", null], ["pkf.b.h.net", "net_kg"], ["pkf.b.h.where", null], ["pkf.b.h.invoice", null]];
  return (
    <div className="space-y-5" lang={lang}>
      <PageHeader title={t("pkf.b.title")} description={t("pkf.b.desc")} backHref="/packaging" backLabel={t("pkf.rel.back")}
        actions={<div className="flex flex-wrap items-center gap-2"><LiveRefresh name="bundles" tables={["fg_transfer_bundles", "dispatches"]} /><FloorLanguageToggle lang={lang} />
          <Link href="/packaging/fg-transfers" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">{t("pkf.card.fg")}</Link></div>} />
      <form method="get" className="flex flex-col gap-2 rounded-2xl border border-slate-300 bg-white p-4 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm font-semibold">{t("pkf.b.lookup")}
          <input name="tag" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={160} defaultValue={q.tag ?? ""} className={field} /></label>
        <button type="submit" className="min-h-11 rounded-xl bg-charcoal px-4 text-sm font-bold text-white">{t("pkf.b.open")}</button>
      </form>
      {lookup ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900 [overflow-wrap:anywhere]">{lookup}</p> : null}
      {list?.enforce_fg_receipt ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">{t("pkf.b.enforced")}</p> : null}
      <ListControls t={t} search={search} searchHint={t("pkf.b.searchHint")} sort={sort} direction={direction} clearHref="?"
        filter={{ name: "state", label: t("pkf.b.state"), value: state, options: [{ value: "all", label: t("pkf.b.allStates") }, ...BUNDLE_STATES.map(s => ({ value: s, label: t(`pkf.state.${s}` as FloorKey) }))] }}
        checkbox={{ name: "uninvoiced", label: t("pkf.b.notInvoiced"), checked: notInvoiced }}
        sorts={BUNDLE_SORTS.map(s => ({ value: s, label: t(`pkf.b.sort.${s}` as FloorKey) }))} />
      {!list ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : t("pkf.t.loadFailed")}</p>
        : list.rows.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">{t("pkf.b.empty")}</p> : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50"><tr>{headers.map(([h, f]) => f
              ? <SortHeader key={h} t={t} label={t(h)} field={f} sort={sort} direction={direction} href={(s, d) => href({ sort: s, dir: d })} />
              : <th key={h} scope="col" className="px-3 py-2 font-bold">{t(h)}</th>)}</tr></thead>
            <tbody>{list.rows.map(r => (
              <tr key={r.id} className="border-t align-top">
                <td className="px-3 py-2 font-mono font-semibold"><Link className="underline" href={`/packaging/bundles/${r.id}`}>{r.bundle_number}</Link>
                  {r.held ? <div className="font-sans text-xs font-bold text-red-900">{t("pkf.b.held")}</div> : null}</td>
                <td className="px-3 py-2"><Link className="underline" href={`/orders/${r.order_id}/lifecycle`}>{r.order_number ?? "—"}</Link><div className="text-xs">{r.job_number ?? "—"} · {r.profile_code ?? "—"}</div></td>
                <td className="px-3 py-2 font-semibold">{t(`pkf.state.${r.state}` as FloorKey)}</td>
                <td className="px-3 py-2">{formatWeight(r.net_kg)}<div className="text-xs">{r.pieces} pcs</div></td>
                <td className="px-3 py-2">{r.dispatch_id ? <Link className="underline" href={`/dispatches/${r.dispatch_id}`}>{r.dispatch_number ?? "—"}</Link> : r.location ?? r.transfer_number ?? "—"}</td>
                <td className="px-3 py-2">{r.invoice_number ?? "—"}</td>
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

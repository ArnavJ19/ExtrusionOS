import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { FloorLanguageToggle } from "@/components/modules/autopilot-batch9/floor-language";
import { FgSendForm } from "@/components/modules/orchestration/packaging-flow-forms";
import { getSessionContext } from "@/lib/auth";
import { hasRouteAccess } from "@/lib/auth/route-permissions";
import { packagingFlowAction } from "@/lib/actions/orchestration";
import { floorText } from "@/lib/i18n/floor";
import { getFloorLanguage } from "@/lib/i18n/floor-server";
import { canSendFg, fgCandidatesSchema, fgLocationsSchema } from "@/lib/workflow/packaging-flow";

// Phase 6: packaging chooses packed bundles (oldest first, 20 per page, optionally of one order) and a holding location.
export default async function NewFgTransferPage({ searchParams }: { searchParams: Promise<{ order_id?: string; page?: string; q?: string }> }) {
  const [q, context, lang] = await Promise.all([searchParams, getSessionContext(), getFloorLanguage()]);
  if (context.dealerId || !hasRouteAccess("/packaging/fg-transfers", context.role)) redirect("/dashboard");
  const t = floorText(lang);
  if (!canSendFg(context.role)) {
    return <div className="space-y-4" lang={lang}><PageHeader title={t("pkf.fg.newTitle")} backHref="/packaging/fg-transfers" backLabel={t("pkf.fg.back")} />
      <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">{t("pkf.fg.cannotSend")}</p></div>;
  }
  const order = /^[0-9a-f-]{36}$/i.test(q.order_id ?? "") ? q.order_id : undefined;
  const page = Math.min(Math.max(Number.parseInt(q.page ?? "1", 10) || 1, 1), 100000);
  const search = (q.q ?? "").trim().slice(0, 80);
  const [locations, candidates] = await Promise.all([
    packagingFlowAction({ command: "fg.locations" }),
    packagingFlowAction({ command: "fg.candidates", page, ...(order ? { order_id: order } : {}), ...(search ? { search } : {}) })
  ]);
  const loc = locations.success ? fgLocationsSchema.safeParse(locations.data).data ?? null : null;
  const cands = candidates.success ? fgCandidatesSchema.safeParse(candidates.data).data ?? null : null;
  const pageHref = (n: number) => `?${new URLSearchParams({ ...(order ? { order_id: order } : {}), ...(search ? { q: search } : {}), ...(n > 1 ? { page: String(n) } : {}) }).toString()}`;
  return (
    <div className="space-y-5" lang={lang}>
      <PageHeader title={t("pkf.fg.newTitle")} description={t("pkf.fg.desc")} backHref="/packaging/fg-transfers" backLabel={t("pkf.fg.back")} actions={<FloorLanguageToggle lang={lang} />} />
      <form method="get" className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-end">
        {order ? <input type="hidden" name="order_id" value={order} /> : null}
        <label className="flex-1 text-sm font-semibold">{t("list.search")}
          <input type="search" name="q" maxLength={80} defaultValue={search} placeholder={t("pkf.rel.searchHint")} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" /></label>
        <button type="submit" className="min-h-11 rounded-xl bg-charcoal px-4 text-sm font-bold text-white">{t("list.apply")}</button>
      </form>
      {!loc || !cands ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!locations.success ? locations.error : !candidates.success ? candidates.error : t("pkf.fg.loadFailed")}</p>
        : <FgSendForm key={`${page}:${search}:${order ?? ""}`} lang={lang} locations={loc.rows} candidates={cands.rows} />}
      {cands && cands.total > cands.page_size ? <nav className="flex justify-between text-sm font-semibold" aria-label="Pages">
        {page > 1 ? <Link href={pageHref(page - 1)}>{t("common.previous")}</Link> : <span />}<span>{t("olo.tasks.pageOf", { n: page, total: Math.ceil(cands.total / cands.page_size) })}</span>
        {page * cands.page_size < cands.total ? <Link href={pageHref(page + 1)}>{t("common.next")}</Link> : <span />}</nav> : null}
    </div>
  );
}

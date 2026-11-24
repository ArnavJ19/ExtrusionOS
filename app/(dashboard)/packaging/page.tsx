import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { hasRouteAccess } from "@/lib/auth/route-permissions";
import { floorText } from "@/lib/i18n/floor";
import { getFloorLanguage } from "@/lib/i18n/floor-server";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function PackagingPage() {
  const [context, lang] = await Promise.all([getSessionContext(), getFloorLanguage()]);
  if (!can(context.role, "read", "packaging")) redirect("/dashboard");
  const t = floorText(lang);
  // Phase 6: packaging release, the bundle register and trace, and finished-goods transfers.
  const shipment = [
    { href: "/packaging/release", title: t("pkf.card.release"), body: t("pkf.card.releaseDesc") },
    { href: "/packaging/bundles", title: t("pkf.card.bundles"), body: t("pkf.card.bundlesDesc") },
    { href: "/packaging/fg-transfers", title: t("pkf.card.fg"), body: t("pkf.card.fgDesc") }
  ].filter(card => !context.dealerId && hasRouteAccess(card.href, context.role));
  return (
    <ModuleOverviewClient moduleKey="packaging" context={context} canCreate={can(context.role, "create", "packaging")} canUpdate={can(context.role, "update", "packaging")}>
      {shipment.length ? <div className="grid gap-3 md:grid-cols-3" lang={lang}>{shipment.map(card => (
        <Link key={card.href} href={card.href} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-charcoal">
          <h2 className="section-title">{card.title}</h2><p className="mt-1 text-sm font-medium text-slate-500">{card.body}</p></Link>))}</div> : null}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Packaging Stock</p><h2 className="section-title mt-1">Packaging Material Inventory</h2><p className="mt-1 text-sm font-medium text-slate-500">Maintain film, paper, strapping, crates, reorder levels, and vendor traceability.</p></div>
          <Link href="/packaging/materials" className="inline-flex items-center justify-center rounded-xl bg-charcoal px-4 py-2.5 text-sm font-bold text-white transition hover:bg-charcoal/90">Open Material Inventory</Link>
        </div>
      </div>
    </ModuleOverviewClient>
  );
}

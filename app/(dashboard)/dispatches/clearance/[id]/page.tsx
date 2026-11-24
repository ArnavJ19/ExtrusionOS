import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { FloorLanguageToggle } from "@/components/modules/autopilot-batch9/floor-language";
import { ReleaseForm, RevokeReleaseButton, SendOutButton, TermsForm } from "@/components/modules/orchestration/dispatch-forms";
import { getSessionContext } from "@/lib/auth";
import { dispatchFinanceAction } from "@/lib/actions/orchestration";
import { floorText } from "@/lib/i18n/floor";
import { getFloorLanguage } from "@/lib/i18n/floor-server";
import { formatWeight } from "@/lib/utils/format";
import { canReadOrchestration } from "@/lib/workflow/orchestration";
import { clearanceDetailSchema, clearanceStateText, formatInr, termsScopeText, termsText } from "@/lib/workflow/dispatch-orchestration";

// Roles that may record a dispatch leaving the gate (as in the dispatch delivery workflow).
const DISPATCH_SENDERS = ["owner", "admin", "factory_manager", "inventory_manager", "dispatch_manager", "dispatch"];
const at = (value: string | null) => (value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—");

export default async function DispatchClearanceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, context, lang] = await Promise.all([params, getSessionContext(), getFloorLanguage()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (context.dealerId || !canReadOrchestration(context.role)) redirect("/dispatches");
  const t = floorText(lang);
  const result = await dispatchFinanceAction({ command: "status", dispatch_id: id });
  const parsed = result.success ? clearanceDetailSchema.safeParse(result.data) : null;
  if (!parsed?.success) {
    return <div className="space-y-4" lang={lang}><PageHeader title={t("olo.fc.title")} backHref="/dispatches/clearance" backLabel={t("olo.fc.back")} />
      <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : t("olo.fc.readFailed")}</p></div>;
  }
  const c = parsed.data, m = c.amounts;
  const tone = c.state === "blocked" ? "border-red-200 bg-red-50 text-red-950" : "border-emerald-200 bg-emerald-50 text-emerald-950";
  const amounts: [string, number | null][] = m ? [[t("olo.fc.a.dispatch"), m.dispatch_value], [t("olo.fc.a.earlier"), m.earlier_dispatched_value], [t("olo.fc.a.required"), m.required],
    [t("olo.fc.a.paid"), m.paid_on_order], [t("olo.fc.a.advance"), m.advance_available ?? null], [t("olo.fc.a.short"), m.shortfall]] : [];
  return (
    <div className="space-y-5" lang={lang}>
      <PageHeader title={`${c.dispatch_number ?? t("olo.fc.h.dispatch")} · ${clearanceStateText(t, c.state)}`} backHref="/dispatches/clearance" backLabel={t("olo.fc.back")}
        description={t("olo.fc.summary", { order: c.order_number, customer: c.customer_name, bundles: c.bundles, kg: formatWeight(c.net_weight_kg), terms: termsText(t, c.terms), scope: termsScopeText(t, c.terms.scope) })}
        actions={<div className="flex flex-wrap items-center gap-2"><FloorLanguageToggle lang={lang} /><Link href={`/dispatches/${c.dispatch_id}`} className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">{t("olo.fc.dispatchRecord")}</Link></div>} />
      <section className={`rounded-2xl border p-4 text-sm ${tone}`}>
        <p className="font-bold">{c.state === "blocked" ? t("olo.fc.blockedNote") : c.state === "released" ? t("olo.fc.releasedUntil", { at: at(c.release?.expires_at ?? null) }) : clearanceStateText(t, c.state)}</p>
        {c.terms.reason ? <p className="mt-1">{t("olo.fc.termsBasis", { reason: c.terms.reason })}</p> : null}
        {!c.priced ? <p className="mt-1 font-semibold">{t("olo.fc.unpricedNote")}</p> : null}
        {c.release?.value_grown ? <p className="mt-1 font-semibold">{t("olo.fc.valueGrown")}</p> : null}
        {c.release?.expired ? <p className="mt-1 font-semibold">{t("olo.fc.expired")}</p> : null}
        {c.delivery_status === "pending" ? <p className="mt-1">{t("olo.fc.heldPending")}</p> : null}
      </section>
      {c.delivery_status === "pending" && ["not_required", "covered", "released"].includes(c.state) && DISPATCH_SENDERS.includes(context.role)
        ? <SendOutButton dispatchId={c.dispatch_id} lang={lang} /> : null}
      {c.finance_visible && m ? <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {amounts.map(([label, value]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-3"><p className="text-xs font-bold uppercase text-slate-500">{label}</p><p className="text-lg font-bold">{formatInr(value)}</p></div>)}
      </section> : !c.finance_visible ? <p className="text-sm text-slate-600">{t("olo.fc.amountsAccounts")}</p> : null}
      {c.finance_visible && m?.customer_advance ? <p className="text-xs text-slate-600">{t("olo.fc.advanceNote", { advance: formatInr(m.customer_advance), other: formatInr(m.other_obligations ?? 0) })}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {c.can_release && c.state === "blocked" ? <ReleaseForm dispatchId={c.dispatch_id} canException={c.can_exception} hours={c.release_hours} lang={lang} /> : null}
        {c.can_release && c.order_id && c.order_number ? <TermsForm customers={[]} order={{ id: c.order_id, number: c.order_number }} lang={lang} /> : null}
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-bold">{t("olo.fc.releases")}</h2>
        {c.releases.length === 0 ? <p className="text-sm text-slate-600">{t("olo.fc.none")}</p> : <ul className="mt-2 space-y-2">{c.releases.map(r => <li key={r.id} className="text-sm">
          <p className="font-semibold">{r.basis === "payment_confirmed" ? t("olo.fc.paymentConfirmed", { ref: r.reference }) : t("olo.fc.ownerException")} · {r.released_by_name ?? "—"} {at(r.released_at)}{r.released_value !== undefined && r.released_value !== null ? t("olo.fc.covers", { amount: formatInr(r.released_value) }) : ""}</p>
          <p className="text-xs text-slate-600">{r.note} · {r.consumed_at ? t("olo.fc.usedAt", { at: at(r.consumed_at) }) : r.revoked_at ? t("olo.fc.withdrawnAt", { at: at(r.revoked_at), reason: r.revoke_reason }) : t("olo.fc.validUntil", { at: at(r.expires_at) })}</p>
          {r.can_revoke ? <RevokeReleaseButton releaseId={r.id} lang={lang} /> : null}
        </li>)}</ul>}
      </section>
    </div>
  );
}

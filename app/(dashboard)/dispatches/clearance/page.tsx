import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { FloorLanguageToggle } from "@/components/modules/autopilot-batch9/floor-language";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { ClearTermsButton, TermsForm } from "@/components/modules/orchestration/dispatch-forms";
import { getSessionContext } from "@/lib/auth";
import { dispatchFinanceAction } from "@/lib/actions/orchestration";
import { floorText, type FloorKey } from "@/lib/i18n/floor";
import { getFloorLanguage } from "@/lib/i18n/floor-server";
import { formatWeight } from "@/lib/utils/format";
import { canReadOrchestration } from "@/lib/workflow/orchestration";
import { clearanceQueueSchema, clearanceStateText, formatInr, termsListSchema, termsScopeText, termsText } from "@/lib/workflow/dispatch-orchestration";

const VIEWS = ["attention", "pending"] as const;
const at = (value: string | null) => (value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export default async function DispatchClearancePage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string; tpage?: string }> }) {
  const [q, context, lang] = await Promise.all([searchParams, getSessionContext(), getFloorLanguage()]);
  if (context.dealerId || !canReadOrchestration(context.role)) redirect("/dispatches");
  const t = floorText(lang);
  const view = (VIEWS.includes(q.view as (typeof VIEWS)[number]) ? q.view : "attention") as (typeof VIEWS)[number];
  const page = Math.min(Math.max(Number.parseInt(q.page ?? "1", 10) || 1, 1), 100000);
  const tpage = Math.min(Math.max(Number.parseInt(q.tpage ?? "1", 10) || 1, 1), 100000);
  const [queueResult, termsResult] = await Promise.all([dispatchFinanceAction({ command: "queue", view, page }), dispatchFinanceAction({ command: "terms.list", page: tpage })]);
  const queue = queueResult.success ? clearanceQueueSchema.safeParse(queueResult.data).data ?? null : null;
  const terms = termsResult.success ? termsListSchema.safeParse(termsResult.data).data ?? null : null;
  const href = (p: number) => `?${new URLSearchParams({ view, page: String(p), tpage: String(tpage) })}`;
  const thref = (p: number) => `?${new URLSearchParams({ view, page: String(page), tpage: String(p) })}`;
  const headers: FloorKey[] = ["olo.fc.h.dispatch", "olo.fc.h.order", "olo.fc.h.terms", "olo.fc.h.state", ...(queue?.finance_visible ? ["olo.fc.h.value", "olo.fc.h.received", "olo.fc.h.short"] as FloorKey[] : []), "olo.fc.h.packed"];
  return (
    <div className="space-y-5" lang={lang}>
      <PageHeader title={t("olo.fc.title")} description={t("olo.fc.desc")}
        actions={<div className="flex flex-wrap items-center gap-2"><LiveRefresh name="dispatch-clearance" tables={["dispatches", "olo_task_events"]} /><FloorLanguageToggle lang={lang} />
          <Link href="/dispatches" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">{t("olo.fc.dispatches")}</Link></div>} />
      <nav className="flex flex-wrap gap-2">{VIEWS.map(k => <Link key={k} href={`?view=${k}`} className={`rounded-xl border px-3 py-2 text-sm font-bold ${view === k ? "border-orange bg-orange/10" : "bg-white"}`}>{t(`olo.fc.view.${k}`)}</Link>)}</nav>
      {!queue ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!queueResult.success ? queueResult.error : t("olo.fc.loadFailed")}</p> : <>
        {!queue.finance_visible ? <p className="text-sm text-slate-600">{t("olo.fc.amountsHidden")}</p> : null}
        {queue.rows.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">{t("olo.fc.empty")}</p> : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50"><tr>{headers.map(h => <th key={h} className="px-3 py-2 font-bold">{t(h)}</th>)}</tr></thead>
              <tbody>{queue.rows.map(r => <tr key={r.dispatch_id} className="border-t align-top">
                <td className="px-3 py-2 font-semibold"><Link className="underline" href={`/dispatches/clearance/${r.dispatch_id}`}>{r.dispatch_number ?? t("olo.fc.h.dispatch")}</Link><div className="text-xs text-slate-500">{at(r.created_at)}</div></td>
                <td className="px-3 py-2">{r.order_number ?? "—"}<div className="text-xs text-slate-500">{r.customer_name ?? "—"}</div></td>
                <td className="px-3 py-2">{termsText(t, r.terms)}<div className="text-xs text-slate-500">{termsScopeText(t, r.terms.scope)}</div></td>
                <td className="px-3 py-2 font-semibold">{clearanceStateText(t, r.state)}{!r.priced ? <div className="text-xs font-semibold text-amber-800">{t("olo.fc.unpriced")}</div> : null}</td>
                {queue.finance_visible ? <><td className="px-3 py-2">{formatInr(r.amounts?.dispatch_value)}</td><td className="px-3 py-2">{formatInr(r.amounts?.received)}</td><td className="px-3 py-2 font-semibold">{formatInr(r.amounts?.shortfall)}</td></> : null}
                <td className="px-3 py-2">{r.bundles} · {formatWeight(r.net_weight_kg)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
        {queue.total > queue.page_size ? <nav className="flex justify-between text-sm font-semibold">{page > 1 ? <Link href={href(page - 1)}>{t("common.previous")}</Link> : <span />}<span>{t("common.page", { n: page })}</span>{page * queue.page_size < queue.total ? <Link href={href(page + 1)}>{t("common.next")}</Link> : <span />}</nav> : null}
      </>}

      <section className="space-y-3">
        <h2 className="text-lg font-bold">{t("olo.fc.termsTitle")}</h2>
        {!terms ? <p role="alert" className="text-sm font-semibold text-amber-900">{!termsResult.success ? termsResult.error : t("olo.fc.termsFailed")}</p> : <>
          {terms.rows.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">{t("olo.fc.noTerms")}</p> : (
            <ul className="space-y-2">{terms.rows.map(x => <li key={x.id} className="rounded-2xl border border-slate-200 bg-white p-3 text-sm">
              <p className="font-semibold">{x.scope === "company" ? t("olo.fc.scope.company") : x.scope === "customer" ? x.customer_name : t("olo.fc.orderTerms", { number: x.order_number })} — {termsText(t, x)}</p>
              <p className="text-xs text-slate-600">{t("olo.fc.setBy", { reason: x.reason, name: x.set_by_name, at: at(x.set_at) })}</p>
              {terms.can_set_terms ? <ClearTermsButton id={x.id} lang={lang} /> : null}
            </li>)}</ul>
          )}
          {terms.total > terms.page_size ? <nav className="flex justify-between text-sm font-semibold">{tpage > 1 ? <Link href={thref(tpage - 1)}>{t("common.previous")}</Link> : <span />}<span>{t("common.page", { n: tpage })}</span>{tpage * terms.page_size < terms.total ? <Link href={thref(tpage + 1)}>{t("common.next")}</Link> : <span />}</nav> : null}
          {terms.can_set_terms ? <TermsForm customers={terms.customers} lang={lang} /> : null}
        </>}
      </section>
    </div>
  );
}

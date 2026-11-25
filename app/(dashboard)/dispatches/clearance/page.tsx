import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { ClearTermsButton, TermsForm } from "@/components/modules/orchestration/dispatch-forms";
import { getSessionContext } from "@/lib/auth";
import { dispatchFinanceAction } from "@/lib/actions/orchestration";
import { formatWeight } from "@/lib/utils/format";
import { canReadOrchestration } from "@/lib/workflow/orchestration";
import { CLEARANCE_STATE_LABELS, TERMS_SCOPE_LABELS, clearanceQueueSchema, formatInr, termsListSchema } from "@/lib/workflow/dispatch-orchestration";

const VIEWS = [["attention", "Needs clearance"], ["pending", "All pending dispatches"]] as const;
const at = (value: string | null) => (value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export default async function DispatchClearancePage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string; tpage?: string }> }) {
  const [q, context] = await Promise.all([searchParams, getSessionContext()]);
  if (context.dealerId || !canReadOrchestration(context.role)) redirect("/dispatches");
  const view = (VIEWS.some(([k]) => k === q.view) ? q.view : "attention") as (typeof VIEWS)[number][0];
  const page = Math.min(Math.max(Number.parseInt(q.page ?? "1", 10) || 1, 1), 100000);
  const tpage = Math.min(Math.max(Number.parseInt(q.tpage ?? "1", 10) || 1, 1), 100000);
  const [queueResult, termsResult] = await Promise.all([dispatchFinanceAction({ command: "queue", view, page }), dispatchFinanceAction({ command: "terms.list", page: tpage })]);
  const queue = queueResult.success ? clearanceQueueSchema.safeParse(queueResult.data).data ?? null : null;
  const terms = termsResult.success ? termsListSchema.safeParse(termsResult.data).data ?? null : null;
  const href = (p: number) => `?${new URLSearchParams({ view, page: String(p), tpage: String(tpage) })}`;
  const thref = (p: number) => `?${new URLSearchParams({ view, page: String(page), tpage: String(p) })}`;
  return (
    <div className="space-y-5">
      <PageHeader title="Dispatch finance clearance" description="Dispatches whose order or customer is on advance or payment-before-dispatch terms. The gate refuses them until receipts cover the terms or accounts record a release. Credit terms keep the existing credit-limit checks."
        actions={<div className="flex flex-wrap items-center gap-2"><LiveRefresh name="dispatch-clearance" tables={["dispatches", "olo_task_events"]} /><Link href="/dispatches" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Dispatches</Link></div>} />
      <nav className="flex flex-wrap gap-2">{VIEWS.map(([k, label]) => <Link key={k} href={`?view=${k}`} className={`rounded-xl border px-3 py-2 text-sm font-bold ${view === k ? "border-orange bg-orange/10" : "bg-white"}`}>{label}</Link>)}</nav>
      {!queue ? <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!queueResult.success ? queueResult.error : "Pending dispatches could not be read."}</p> : <>
        {!queue.finance_visible ? <p className="text-sm text-slate-600">Amounts are visible to accounts. You can see which dispatches are waiting and why.</p> : null}
        {queue.rows.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">No packed dispatch is waiting for finance clearance.</p> : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50"><tr>{["Dispatch", "Order / customer", "Terms", "State", ...(queue.finance_visible ? ["Value", "Received", "Short"] : []), "Packed"].map(h => <th key={h} className="px-3 py-2 font-bold">{h}</th>)}</tr></thead>
              <tbody>{queue.rows.map(r => <tr key={r.dispatch_id} className="border-t align-top">
                <td className="px-3 py-2 font-semibold"><Link className="underline" href={`/dispatches/clearance/${r.dispatch_id}`}>{r.dispatch_number ?? "Dispatch"}</Link><div className="text-xs text-slate-500">{at(r.created_at)}</div></td>
                <td className="px-3 py-2">{r.order_number ?? "—"}<div className="text-xs text-slate-500">{r.customer_name ?? "—"}</div></td>
                <td className="px-3 py-2">{r.terms.label}<div className="text-xs text-slate-500">{TERMS_SCOPE_LABELS[r.terms.scope] ?? r.terms.scope}</div></td>
                <td className="px-3 py-2 font-semibold">{CLEARANCE_STATE_LABELS[r.state] ?? r.state}{!r.priced ? <div className="text-xs font-semibold text-amber-800">Unpriced bundles</div> : null}</td>
                {queue.finance_visible ? <><td className="px-3 py-2">{formatInr(r.amounts?.dispatch_value)}</td><td className="px-3 py-2">{formatInr(r.amounts?.received)}</td><td className="px-3 py-2 font-semibold">{formatInr(r.amounts?.shortfall)}</td></> : null}
                <td className="px-3 py-2">{r.bundles} · {formatWeight(r.net_weight_kg)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
        {queue.total > queue.page_size ? <nav className="flex justify-between text-sm font-semibold">{page > 1 ? <Link href={href(page - 1)}>Previous</Link> : <span />}<span>Page {page}</span>{page * queue.page_size < queue.total ? <Link href={href(page + 1)}>Next</Link> : <span />}</nav> : null}
      </>}

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Payment terms in force</h2>
        {!terms ? <p role="alert" className="text-sm font-semibold text-amber-900">{!termsResult.success ? termsResult.error : "Terms could not be read."}</p> : <>
          {terms.rows.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">No terms recorded: every order is on credit terms.</p> : (
            <ul className="space-y-2">{terms.rows.map(t => <li key={t.id} className="rounded-2xl border border-slate-200 bg-white p-3 text-sm">
              <p className="font-semibold">{t.scope === "company" ? "Company default" : t.scope === "customer" ? t.customer_name : `Order ${t.order_number}`} — {t.label}</p>
              <p className="text-xs text-slate-600">{t.reason} · set by {t.set_by_name ?? "—"} {at(t.set_at)}</p>
              {terms.can_set_terms ? <ClearTermsButton id={t.id} /> : null}
            </li>)}</ul>
          )}
          {terms.total > terms.page_size ? <nav className="flex justify-between text-sm font-semibold">{tpage > 1 ? <Link href={thref(tpage - 1)}>Previous</Link> : <span />}<span>Page {tpage}</span>{tpage * terms.page_size < terms.total ? <Link href={thref(tpage + 1)}>Next</Link> : <span />}</nav> : null}
          {terms.can_set_terms ? <TermsForm customers={terms.customers} /> : null}
        </>}
      </section>
    </div>
  );
}

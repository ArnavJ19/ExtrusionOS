import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { LiveRefresh } from "@/components/modules/intelligence/live";
import { CustomerUpdateComposer, MarkMessage } from "@/components/modules/orchestration/dispatch-forms";
import { getSessionContext } from "@/lib/auth";
import { dispatchCommAction } from "@/lib/actions/orchestration";
import { formatWeight } from "@/lib/utils/format";
import { canReadOrchestration } from "@/lib/workflow/orchestration";
import { CHANNEL_LABELS, COMM_STATUS_LABELS, dispatchFactsSchema } from "@/lib/workflow/dispatch-orchestration";

const at = (value: string | null) => (value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—");

export default async function DispatchCommunicationPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, context] = await Promise.all([params, getSessionContext()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  if (context.dealerId || !canReadOrchestration(context.role)) redirect("/dispatches");
  const result = await dispatchCommAction({ command: "facts", dispatch_id: id });
  const parsed = result.success ? dispatchFactsSchema.safeParse(result.data) : null;
  if (!parsed?.success) {
    return <div className="space-y-4"><PageHeader title="Customer dispatch update" backHref="/dispatches/communications" backLabel="Back to customer updates" />
      <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{!result.success ? result.error : "This dispatch could not be read."}</p></div>;
  }
  const f = parsed.data;
  const informed = f.history.some(m => m.status !== "failed");
  return (
    <div className="space-y-5">
      <PageHeader title={`Customer update · ${f.dispatch_number ?? "dispatch"}`} backHref="/dispatches/communications" backLabel="Back to customer updates"
        description={`Order ${f.order_number ?? "—"} · ${f.customer_name ?? "—"} · left ${at(f.dispatched_at)} · ${f.bundles} bundle(s), ${formatWeight(f.net_weight_kg)} · ${informed ? "customer informed" : "customer not yet informed"}`}
        actions={<div className="flex flex-wrap items-center gap-2"><LiveRefresh name="dispatch-comm" tables={["dispatch_communications"]} /><Link href={`/dispatches/${f.dispatch_id}`} className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Dispatch record</Link></div>} />
      {f.recipients.length === 0 ? <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">The customer has no WhatsApp number, phone or email recorded. Enter the recipient below, and add it to the customer record.</p> : null}
      <CustomerUpdateComposer facts={f} />
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-bold">Messages recorded</h2>
        {f.history.length === 0 ? <p className="text-sm text-slate-600">None yet.</p> : <ul className="mt-2 space-y-3">{f.history.map(m => <li key={m.id} className="rounded-xl border border-slate-200 p-3 text-sm">
          <p className="font-semibold">{CHANNEL_LABELS[m.channel] ?? m.channel} to {m.recipient} · {COMM_STATUS_LABELS[m.status] ?? m.status} · {at(m.sent_at)} by {m.sent_by_name ?? "—"}</p>
          <p className="text-xs text-slate-600">{m.delivered_at ? `Delivered ${at(m.delivered_at)}` : ""}{m.read_at ? ` · read ${at(m.read_at)}` : ""}{m.failed_at ? `Failed ${at(m.failed_at)}: ${m.failed_reason}` : ""}</p>
          <pre lang={m.language} className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-xs [overflow-wrap:anywhere]">{m.message_body}</pre>
          {m.can_mark ? <MarkMessage id={m.id} status={m.status} /> : null}
        </li>)}</ul>}
      </section>
    </div>
  );
}

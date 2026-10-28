import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatWeight } from "@/lib/utils/format";
import { balanceExplanationSchema, canExplainStock, exclusionText, withdrawalText } from "@/lib/inventory/stock-balance";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const metres = (value: number) => `${value.toFixed(3)} m`;
const signed = (value: number, format: (v: number) => string) => (value > 0 ? `+${format(value)}` : value < 0 ? `−${format(-value)}` : format(0));

// UPGRADE_EOS feature 51: one batch's available balance expanded into the records behind it.
export default async function StockBalanceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!canExplainStock(context.role)) redirect("/inventory");
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const result = await supabase.rpc("profile_stock_balance_command", { p_command: "balance.explain", p_payload: { batch_id: id } });
  if (result.error?.message === "Stock batch is unavailable") notFound();
  if (result.error) throw new Error("The stock balance could not be loaded. Refresh to retry.");
  const parsed = balanceExplanationSchema.safeParse(result.data);
  if (!parsed.success) throw new Error("The stock balance did not reconcile, so it is not shown. Refresh and report it if this repeats.");
  const data = parsed.data;
  const lines = [
    { label: "On hand now", value: data.on_hand, sign: 1, note: "Current batch quantity after recorded dispatches and dealer debits." },
    { label: `Open reservations (${data.open_reserved.count})`, value: data.open_reserved, sign: -1, note: "Reserved minus what dispatch has already taken; the taken part has already left on hand." },
    ...(data.excluded.reason ? [{ label: "Excluded", value: data.excluded, sign: -1, note: exclusionText[data.excluded.reason] ?? data.excluded.reason }] : []),
    ...(data.shortfall.weight_kg > 0 || data.shortfall.pieces > 0 ? [{ label: "Over-reservation shortfall", value: data.shortfall, sign: 1, note: "Open reservations exceed on hand. Review these reservations: availability is shown as zero, not negative." }] : [])
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Bundle ${data.batch.bundle_number ?? "unnumbered"}`}
        description={`${data.batch.profile_code ?? "Profile"} ${data.batch.profile_name ?? ""} · ${data.batch.finish ?? "finish not set"} · ${data.batch.location ?? "no location"} · QC ${data.batch.qc_status.replace(/_/g, " ")}`}
        actions={<Link href="/inventory/stock-balances" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">All balances</Link>}
      />
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-bold text-slate-900">How the available balance is made up</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="text-left text-xs font-black uppercase tracking-[0.08em] text-slate-500"><tr><th className="py-2">Component</th><th className="py-2 text-right">Weight</th><th className="py-2 text-right">Pieces</th><th className="py-2 text-right">Length</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((line) => (
                <tr key={line.label}>
                  <td className="py-2"><p className="font-bold text-slate-900">{line.label}</p><p className="text-xs text-slate-500">{line.note}</p></td>
                  <td className="py-2 text-right font-semibold">{signed(line.sign * line.value.weight_kg, formatWeight)}</td>
                  <td className="py-2 text-right">{signed(line.sign * line.value.pieces, (v) => `${v} pcs`)}</td>
                  <td className="py-2 text-right">{signed(line.sign * line.value.length_m, metres)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-900">
                <td className="py-2 font-black">Available to reserve</td>
                <td className="py-2 text-right font-black">{formatWeight(data.available.weight_kg)}</td>
                <td className="py-2 text-right font-black">{data.available.pieces} pcs</td>
                <td className="py-2 text-right font-black">{metres(data.available.length_m)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-bold text-slate-900">Open reservations</h2>
        {data.reservations.length ? (
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {data.reservations.map((row) => (
              <li key={row.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>{row.order_id ? <Link href={`/orders/${row.order_id}`} className="font-bold underline-offset-2 hover:underline">{row.order_number ?? "Order"}</Link> : <span className="font-bold">{row.order_number ?? "Order"}</span>}{row.customer_name ? ` · ${row.customer_name}` : ""} · reserved {formatDate(row.created_at)}</span>
                <span className="text-slate-700">{formatWeight(row.reserved_weight_kg)} reserved − {formatWeight(row.consumed_weight_kg)} dispatched = <span className="font-black">{formatWeight(row.open_weight_kg)} open</span></span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-slate-500">No active reservations hold this batch.</p>}
        {data.reservations_total > data.reservations.length ? <p className="mt-2 text-xs font-semibold text-amber-800">Showing the first {data.reservations.length} of {data.reservations_total} reservations; the totals above include all of them.</p> : null}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-bold text-slate-900">Recorded withdrawals behind &quot;on hand&quot;</h2>
        <p className="mt-1 text-xs font-medium text-slate-500">Before these records the batch held {formatWeight(data.before_recorded_withdrawals.weight_kg)}, {data.before_recorded_withdrawals.pieces} pcs. Net movement {signed(data.net_withdrawn.weight_kg, formatWeight)}.</p>
        {data.withdrawals.length ? (
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {data.withdrawals.map((row) => (
              <li key={`${row.kind}-${row.id}`} className="flex flex-wrap justify-between gap-2 py-2">
                <span><span className="font-bold">{withdrawalText[row.kind]}</span>{row.reference ? ` · ${row.reference}` : ""}{row.order_number ? ` · ${row.order_number}` : ""} · {formatDate(row.at)}</span>
                <span className={row.weight_kg < 0 ? "font-semibold text-red-700" : "font-semibold text-emerald-700"}>{signed(row.weight_kg, formatWeight)} · {signed(row.pieces, (v) => `${v} pcs`)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-slate-500">No dispatches or dealer debits have been recorded against this batch.</p>}
        {data.withdrawals_total > data.withdrawals.length ? <p className="mt-2 text-xs font-semibold text-amber-800">Showing the latest {data.withdrawals.length} of {data.withdrawals_total} records; the net movement includes all of them.</p> : null}
      </section>
    </div>
  );
}

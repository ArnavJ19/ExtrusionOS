import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatWeight } from "@/lib/utils/format";
import { balanceListSchema, canExplainStock, exclusionText } from "@/lib/inventory/stock-balance";

const filters = { in_stock: "In stock", reservable: "Available to reserve", held: "Held by QC or status", over_reserved: "Over-reserved" } as const;
type Filter = keyof typeof filters;

// UPGRADE_EOS feature 51: finished-stock batches with an explainable available balance, 10 per page.
export default async function StockBalancesPage({ searchParams }: { searchParams: Promise<{ page?: string; q?: string; filter?: string }> }) {
  const context = await getSessionContext();
  if (!canExplainStock(context.role)) redirect("/inventory");
  const params = await searchParams;
  const page = Math.min(Math.max(Number.parseInt(params.page ?? "1", 10) || 1, 1), 100000);
  const search = (params.q ?? "").trim().slice(0, 80);
  const filter: Filter = Object.hasOwn(filters, params.filter ?? "") ? (params.filter as Filter) : "in_stock";
  const supabase = await createClient();
  const result = await supabase.rpc("profile_stock_balance_command", { p_command: "balance.list", p_payload: { page, search, filter } });
  const parsed = result.error ? null : balanceListSchema.safeParse(result.data);
  const unavailable = Boolean(result.error && ["PGRST202", "42883", "42P01"].includes(result.error.code ?? ""));
  const list = parsed?.success ? parsed.data : null;
  const totalPages = list ? Math.max(1, Math.ceil(list.total_count / 10)) : 1;
  const href = (nextPage: number, nextFilter: Filter = filter) => {
    const query = new URLSearchParams({ page: String(nextPage), filter: nextFilter });
    if (search) query.set("q", search);
    return `/inventory/stock-balances?${query.toString()}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Stock Balances"
        description="Available to reserve = on hand − open reservations − stock excluded by QC or status. Open a batch to see every reservation and withdrawal behind its figure."
        actions={<Link href="/inventory/reservations" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">Reservation ledger</Link>}
      />
      <nav className="flex flex-wrap gap-2" aria-label="Filter batches">
        {Object.entries(filters).map(([value, text]) => (
          <Link key={value} href={href(1, value as Filter)} className={`rounded-xl border px-3 py-1.5 text-sm font-bold ${filter === value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"}`}>{text}</Link>
        ))}
      </nav>
      <form className="flex flex-wrap items-end gap-2" action="/inventory/stock-balances">
        <input type="hidden" name="filter" value={filter} />
        <label className="min-w-[220px] flex-1 space-y-1"><span className="form-label">Search bundle, profile or location</span>
          <input name="q" className="form-input" maxLength={80} defaultValue={search} />
        </label>
        <button type="submit" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">Search</button>
      </form>
      {!list ? (
        <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
          {unavailable ? "Stock balance explanations are not available on this database yet. The database upgrade must be applied first." : "Stock balances could not be loaded or did not reconcile. Refresh to retry."}
        </p>
      ) : !list.rows.length ? (
        <EmptyState title="No matching batches" description="Try another filter or search." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-black uppercase tracking-[0.08em] text-slate-500">
              <tr><th className="px-4 py-3">Bundle</th><th className="px-4 py-3">Profile</th><th className="px-4 py-3 text-right">On hand</th><th className="px-4 py-3 text-right">Open reserved</th><th className="px-4 py-3 text-right">Available</th><th className="px-4 py-3">Note</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.rows.map((row) => (
                <tr key={row.batch.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3"><Link href={`/inventory/stock-balances/${row.batch.id}`} className="font-bold underline-offset-2 hover:underline">{row.batch.bundle_number ?? "Unnumbered"}</Link><p className="text-xs text-slate-500">{row.batch.location ?? "No location"}</p></td>
                  <td className="px-4 py-3">{row.batch.profile_code ?? "-"}<p className="text-xs text-slate-500">{row.batch.finish ?? ""}</p></td>
                  <td className="px-4 py-3 text-right">{formatWeight(row.on_hand.weight_kg)}<p className="text-xs text-slate-500">{row.on_hand.pieces} pcs</p></td>
                  <td className="px-4 py-3 text-right">{formatWeight(row.open_reserved.weight_kg)}<p className="text-xs text-slate-500">{row.open_reserved.count} reservation{row.open_reserved.count === 1 ? "" : "s"}</p></td>
                  <td className="px-4 py-3 text-right font-black">{formatWeight(row.available.weight_kg)}<p className="text-xs font-semibold text-slate-500">{row.available.pieces} pcs</p></td>
                  <td className="px-4 py-3 text-xs font-semibold">
                    {row.excluded.reason ? <span className="text-amber-800">{exclusionText[row.excluded.reason] ?? row.excluded.reason}</span> : null}
                    {row.shortfall.weight_kg > 0 ? <span className="text-red-700">Over-reserved by {formatWeight(row.shortfall.weight_kg)}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list && totalPages > 1 ? (
        <nav className="flex items-center justify-between text-sm font-bold" aria-label="Pages">
          {page > 1 ? <Link href={href(page - 1)} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Previous</Link> : <span />}
          <span className="text-slate-500">Page {page} of {totalPages} · {list.total_count} batches</span>
          {page < totalPages ? <Link href={href(page + 1)} className="rounded-xl border border-slate-200 bg-white px-3 py-2">Next</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}

import { getSessionContext } from "@/lib/auth";
import { purchaseLifecycleAction } from "@/lib/actions/purchase-lifecycle";
import { redirect } from "next/navigation";
import Link from "next/link";

type Query = { view?: string; page?: string; search?: string; status?: string; sort?: string; direction?: string };

const orderSorts = ["date", "supplier", "number", "status"] as const;
const billSorts = ["date", "supplier", "invoice", "amount", "status"] as const;
const directions = ["asc", "desc"] as const;

function selection<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

export default async function VendorPurchasingDatabasePage({ searchParams }: { searchParams: Promise<Query> }) {
  const [context, query] = await Promise.all([getSessionContext(), searchParams]);
  if (context.dealerId || !["owner", "admin", "accounts", "inventory_manager"].includes(context.role)) redirect("/vendors");

  const view = query.view === "bills" ? "bills" : "orders";
  const parsedPage = Number.parseInt(query.page ?? "1", 10);
  const page = Number.isFinite(parsedPage) ? Math.min(Math.max(parsedPage, 1), 10000) : 1;
  const search = (query.search ?? "").slice(0, 80);
  const direction = selection(query.direction, directions, "desc");
  const status = view === "orders"
    ? selection(query.status, ["all", "draft", "open"] as const, "all")
    : selection(query.status, ["all", "draft", "posted"] as const, "all");
  const sort = view === "orders"
    ? selection(query.sort, orderSorts, "date")
    : selection(query.sort, billSorts, "date");
  const result = view === "orders"
    ? await purchaseLifecycleAction({ command: "orders.list", payload: { page, search, status: selection(query.status, ["all", "draft", "open"] as const, "all"), sort: sort as typeof orderSorts[number], direction } })
    : await purchaseLifecycleAction({ command: "bills.list", payload: { page, search, status: selection(query.status, ["all", "draft", "posted"] as const, "all"), sort: sort as typeof billSorts[number], direction } });
  const total = result.success && result.data.kind === view ? result.data.total : 0;
  const pages = Math.max(1, Math.ceil(total / 10));
  const url = (nextPage: number) => {
    const params = new URLSearchParams({ view, page: String(nextPage), search, status, sort, direction });
    return `/vendors/purchasing/database?${params.toString()}`;
  };
  if (result.success && page > pages) redirect(url(pages));

  return <main className="space-y-6 pb-12">
    <header className="rounded-3xl bg-slate-950 px-6 py-7 text-white sm:px-8">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-amber-300">Purchasing records</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight">Database</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Search and page through all purchase orders or supplier bills. Each record opens its company-scoped source and latest recorded details.</p>
      <Link href="/vendors/purchasing" className="mt-4 inline-block text-sm font-bold text-white underline">Back to purchasing overview</Link>
    </header>

    <div className="flex flex-wrap gap-2" aria-label="Purchasing database type">
      <a href={url(1).replace(`view=${view}`, "view=orders")} aria-current={view === "orders" ? "page" : undefined} className={`rounded-xl px-4 py-2 text-sm font-bold ${view === "orders" ? "bg-slate-950 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>Purchase orders</a>
      <a href={url(1).replace(`view=${view}`, "view=bills")} aria-current={view === "bills" ? "page" : undefined} className={`rounded-xl px-4 py-2 text-sm font-bold ${view === "bills" ? "bg-slate-950 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>Supplier bills</a>
    </div>

    <form method="get" className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-6">
      <input type="hidden" name="view" value={view} />
      <label className="text-sm font-semibold text-slate-700 lg:col-span-2">Search<input name="search" maxLength={80} defaultValue={search} placeholder={view === "orders" ? "PO number or supplier" : "Invoice number or supplier"} className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
      <label className="text-sm font-semibold text-slate-700">Status<select name="status" defaultValue={status} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5">{(view === "orders" ? ["all", "draft", "open"] : ["all", "draft", "posted"]).map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="text-sm font-semibold text-slate-700">Sort by<select name="sort" defaultValue={sort} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5">{(view === "orders" ? orderSorts : billSorts).map((value) => <option key={value} value={value}>{value === "date" ? "Date" : value === "supplier" ? "Supplier" : value === "number" ? "PO number" : value === "invoice" ? "Invoice number" : value === "amount" ? "Invoice total" : "Status"}</option>)}</select></label>
      <label className="text-sm font-semibold text-slate-700">Direction<select name="direction" defaultValue={direction} className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5"><option value="desc">Descending</option><option value="asc">Ascending</option></select></label>
      <button className="self-end rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white">Apply filters</button>
    </form>

    {!result.success ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{result.error}</div> : null}
    {result.success && result.data.kind === "orders" ? <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4"><h2 className="text-lg font-extrabold text-slate-950">Purchase orders</h2><p className="text-sm text-slate-600">{total} records / 10 per page</p></div>
      {result.data.items.length === 0 ? <p className="p-6 text-sm text-slate-600">No purchase orders match these filters.</p> : <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Purchase order</th><th className="px-4 py-3">Supplier</th><th className="px-4 py-3">Order date</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Open</th></tr></thead><tbody className="divide-y divide-slate-100">{result.data.items.map((order) => <tr key={order.id} className="hover:bg-slate-50"><td className="px-4 py-3 font-bold text-slate-950">{order.po_number}</td><td className="px-4 py-3">{order.vendor_name}</td><td className="px-4 py-3">{order.order_date}</td><td className="px-4 py-3">{order.status}</td><td className="px-4 py-3"><a className="font-bold text-cyan-900 underline" href={`/vendors/purchasing?order_id=${encodeURIComponent(order.id)}`}>Open PO</a></td></tr>)}</tbody></table></div>}
    </section> : null}
    {result.success && result.data.kind === "bills" ? <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4"><h2 className="text-lg font-extrabold text-slate-950">Supplier bills</h2><p className="text-sm text-slate-600">{total} records / 10 per page</p></div>
      {result.data.items.length === 0 ? <p className="p-6 text-sm text-slate-600">No supplier bills match these filters.</p> : <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Invoice</th><th className="px-4 py-3">Supplier</th><th className="px-4 py-3">Invoice date</th><th className="px-4 py-3">Total INR</th><th className="px-4 py-3">Status / match</th><th className="px-4 py-3">Open</th></tr></thead><tbody className="divide-y divide-slate-100">{result.data.items.map((bill) => <tr key={bill.id} className="hover:bg-slate-50"><td className="px-4 py-3 font-bold text-slate-950">{bill.invoice_number}<span className="block text-xs font-normal text-slate-500">{bill.po_number}</span></td><td className="px-4 py-3">{bill.vendor_name}</td><td className="px-4 py-3">{bill.invoice_date}</td><td className="px-4 py-3">{bill.total_amount.toFixed(2)}</td><td className="px-4 py-3">{bill.status} / {bill.match_status}</td><td className="px-4 py-3"><a className="font-bold text-cyan-900 underline" href={`/vendors/purchasing?bill_id=${encodeURIComponent(bill.id)}`}>Open bill source</a></td></tr>)}</tbody></table></div>}
    </section> : null}

    <nav aria-label="Purchasing database pages" className="flex items-center justify-between gap-3">
      <a aria-disabled={page <= 1} href={url(Math.max(1, page - 1))} className={`rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold ${page <= 1 ? "pointer-events-none opacity-40" : "bg-white text-slate-700"}`}>Previous</a>
      <p className="text-sm text-slate-600">Page {Math.min(page, pages)} of {pages}</p>
      <a aria-disabled={page >= pages} href={url(Math.min(pages, page + 1))} className={`rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold ${page >= pages ? "pointer-events-none opacity-40" : "bg-white text-slate-700"}`}>Next</a>
    </nav>
  </main>;
}

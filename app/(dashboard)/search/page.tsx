import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { getSearchResourceKeys, type SearchResourceKey } from "@/lib/auth/role-experience";

type SearchParams = Promise<{ q?: string }>;

const customerSearchFields = ["customer_name", "company_name", "contact_person", "phone", "whatsapp_number", "email", "gst_number", "city", "state", "pincode", "billing_address", "shipping_address"];

function cleanSearch(value: string) {
  return value.replace(/[^a-zA-Z0-9@\-\s]/g, " ").replace(/\s+/g, " ").trim();
}

function ilikeAny(fields: string[], like: string) {
  return fields.map((field) => `${field}.ilike.${like}`).join(",");
}

function mergeById(primary: any[] = [], fallback: any[] = []) {
  const seen = new Set(primary.map((item) => item.id));
  return [...fallback.filter((item) => !seen.has(item.id)), ...primary];
}

async function searchCustomers(supabase: any, companyId: string, query: string, like: string) {
  const [broadResult, gstResult] = await Promise.all([
    supabase.from("customers").select("id, customer_name, company_name, customer_type, city, phone, contact_person, email, whatsapp_number, gst_number").eq("company_id", companyId).or(ilikeAny(customerSearchFields, like)).order("customer_name", { ascending: true }).limit(20),
    supabase.from("customers").select("id, customer_name, company_name, customer_type, city, phone, contact_person, email, whatsapp_number, gst_number").eq("company_id", companyId).ilike("gst_number", `%${query}%`).limit(20)
  ]);

  return {
    data: mergeById(broadResult.data ?? [], gstResult.data ?? []),
    error: broadResult.error ?? gstResult.error
  };
}

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const context = await getSessionContext();
  const allowedResources = getSearchResourceKeys(context.role);
  const supabase = await createClient();
  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const safeQuery = cleanSearch(query);
  const like = `*${safeQuery}*`;

  const searchers: Record<SearchResourceKey, () => PromiseLike<any>> = {
    customers: () => searchCustomers(supabase, context.companyId, safeQuery, like),
    profiles: () => supabase.from("aluminium_profiles").select("id, profile_code, profile_name, application_category, section_weight_kg_per_m").eq("company_id", context.companyId).or(`profile_code.ilike.${like},profile_name.ilike.${like},application_category.ilike.${like}`).limit(8),
    dies: () => supabase.from("dies").select("id, die_number, die_status, rack_location").eq("company_id", context.companyId).or(`die_number.ilike.${like},rack_location.ilike.${like},die_status.ilike.${like}`).limit(8),
    quotes: () => supabase.from("quotes").select("id, quote_number, status, quote_date, grand_total, customers(customer_name, company_name)").eq("company_id", context.companyId).or(`quote_number.ilike.${like},status.ilike.${like}`).limit(8),
    orders: () => supabase.from("orders").select("id, order_number, current_stage, order_date, order_value, customers(customer_name, company_name)").eq("company_id", context.companyId).or(`order_number.ilike.${like},current_stage.ilike.${like}`).limit(8),
    dispatches: () => supabase.from("dispatches").select("id, dispatch_number, delivery_status, dispatch_date, vehicle_number, orders(order_number)").eq("company_id", context.companyId).or(`dispatch_number.ilike.${like},vehicle_number.ilike.${like},delivery_status.ilike.${like}`).limit(8),
  };
  const entries = safeQuery.length >= 2
    ? await Promise.all(allowedResources.map(async (resource) => [resource, await searchers[resource]()] as const))
    : [];
  const results = Object.fromEntries(entries) as Partial<Record<SearchResourceKey, { data?: any[] | null; error?: { message?: string } | null }>>;
  const errors = entries.map(([, result]) => result.error?.message ?? "").filter(Boolean);
  const total = entries.reduce((sum, [, result]) => sum + (result.data?.length ?? 0), 0);
  const has = (resource: SearchResourceKey) => allowedResources.includes(resource);

  return (
    <div className="space-y-6">
      <PageHeader title="Global Search" description={`Search only the ${allowedResources.join(", ") || "records"} available to your role.`} />
      <QueryErrorNotice messages={errors} />
      <Card>
        <CardContent>
          <form className="flex flex-col gap-3 sm:flex-row">
            <input name="q" defaultValue={query} className="form-input" placeholder="Search customer, profile code, die number, quote, order, vehicle..." />
            <button className="rounded-xl bg-orange px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-orange/20" type="submit">Search</button>
          </form>
          {query.length > 0 && safeQuery.length < 2 ? <p className="mt-3 text-sm font-bold text-orange">Enter at least 2 searchable characters.</p> : null}
        </CardContent>
      </Card>

      {safeQuery.length >= 2 && total === 0 ? <EmptyState title="No matching records" description="Try a customer name, company, contact person, phone, GST, email, profile code, die rack, order number, or vehicle number." /> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        {has("customers") ? <SearchSection title="Customers" count={results.customers?.data?.length ?? 0}>{results.customers?.data?.map((item: any) => <ResultCard key={item.id} href={`/customers/${item.id}`} title={item.company_name || item.customer_name} eyebrow={item.contact_person || item.phone || item.email || item.whatsapp_number || item.gst_number || item.city || "Customer"} badge={item.customer_type} />)}</SearchSection> : null}
        {has("profiles") ? <SearchSection title="Profiles" count={results.profiles?.data?.length ?? 0}>{results.profiles?.data?.map((item: any) => <ResultCard key={item.id} href={`/profiles/${item.id}`} title={`${item.profile_code} - ${item.profile_name}`} eyebrow={`${item.section_weight_kg_per_m} kg/m`} badge={item.application_category} />)}</SearchSection> : null}
        {has("dies") ? <SearchSection title="Dies" count={results.dies?.data?.length ?? 0}>{results.dies?.data?.map((item: any) => <ResultCard key={item.id} href={`/dies/${item.id}`} title={item.die_number} eyebrow={item.rack_location || "Die library"} badge={item.die_status} />)}</SearchSection> : null}
        {has("quotes") ? <SearchSection title="Quotes" count={results.quotes?.data?.length ?? 0}>{results.quotes?.data?.map((item: any) => <ResultCard key={item.id} href={`/quotes/${item.id}`} title={item.quote_number} eyebrow={`${item.customers?.company_name || item.customers?.customer_name || "Customer"} · ${formatDate(item.quote_date)} · ${formatCurrency(item.grand_total)}`} badge={item.status} />)}</SearchSection> : null}
        {has("orders") ? <SearchSection title="Orders" count={results.orders?.data?.length ?? 0}>{results.orders?.data?.map((item: any) => <ResultCard key={item.id} href={`/orders/${item.id}`} title={item.order_number} eyebrow={`${item.customers?.company_name || item.customers?.customer_name || "Customer"} · ${formatDate(item.order_date)} · ${formatCurrency(item.order_value)}`} badge={item.current_stage} />)}</SearchSection> : null}
        {has("dispatches") ? <SearchSection title="Dispatches" count={results.dispatches?.data?.length ?? 0}>{results.dispatches?.data?.map((item: any) => <ResultCard key={item.id} href={`/dispatches/${item.id}`} title={item.dispatch_number || "Dispatch"} eyebrow={`${item.orders?.order_number || "Order"} · ${formatDate(item.dispatch_date)} · ${item.vehicle_number || "Vehicle pending"}`} badge={item.delivery_status} />)}</SearchSection> : null}
      </div>
    </div>
  );
}

function SearchSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <Card>
      <CardContent>
        <div className="mb-4 flex items-center justify-between gap-3"><h2 className="section-title">{title}</h2><span className="rounded-full bg-aluminium px-3 py-1.5 text-xs font-black uppercase tracking-[0.1em] text-slate-600">{count} found</span></div>
        <div className="space-y-3">{count ? children : <div className="empty-mini">No matches in {title.toLowerCase()}.</div>}</div>
      </CardContent>
    </Card>
  );
}

function ResultCard({ href, title, eyebrow, badge }: { href: string; title: string; eyebrow: string; badge: string }) {
  return (
    <Link href={href} className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-orange/50 hover:bg-orange/5">
      <span><span className="block font-black text-slate-950">{title}</span><span className="mt-1 block text-sm font-medium text-slate-500">{eyebrow}</span></span>
      <Badge value={badge} />
    </Link>
  );
}

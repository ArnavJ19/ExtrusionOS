import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate, formatWeight } from "@/lib/utils/format";
import Link from "next/link";
import { can } from "@/lib/auth/permissions";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";

function addQuoteWeight(weights: Map<string, number>, item: { quote_id?: string | null; billing_weight_kg?: number | string | null; total_weight_kg?: number | string | null }) {
  if (!item.quote_id) return;
  const weight = Number(item.billing_weight_kg ?? item.total_weight_kg ?? 0);
  weights.set(item.quote_id, (weights.get(item.quote_id) ?? 0) + (Number.isFinite(weight) ? weight : 0));
}

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  const supabase = await createClient();

  if (!can(context.role, "read", "customers")) redirect("/dashboard");

  const { data: customer, error } = await supabase
    .from("customers")
    .select("*")
    .eq("id", id)
    .eq("company_id", context.companyId)
    .maybeSingle();

  if (error || !customer) {
    return (
      <div>
        <PageHeader title="Customer not found" description="The requested customer does not exist or you do not have permission." />
      </div>
    );
  }

  const [quotesResult, ordersResult] = await Promise.all([
    can(context.role, "read", "quotes")
      ? supabase
        .from("quotes")
        .select("id, quote_number, revision_number, quote_date, status, grand_total")
        .eq("customer_id", id)
        .eq("company_id", context.companyId)
        .order("quote_date", { ascending: false })
        .limit(5)
      : Promise.resolve({ data: [], error: null }),
    can(context.role, "read", "orders")
      ? supabase
        .from("orders")
        .select("id, order_number, order_date, current_stage, order_value")
        .eq("customer_id", id)
        .eq("company_id", context.companyId)
        .order("order_date", { ascending: false })
        .limit(5)
      : Promise.resolve({ data: [], error: null })
  ]);

  const quotes = quotesResult.data || [];
  const orders = ordersResult.data || [];
  const quoteWeights = new Map<string, number>();
  let quoteItemsError: string | undefined;

  if (quotes.length > 0) {
    const { data: quoteItems, error: quoteItemsQueryError } = await supabase
      .from("quote_items")
      .select("quote_id, billing_weight_kg, total_weight_kg")
      .eq("company_id", context.companyId)
      .in("quote_id", quotes.map((quote: any) => quote.id));

    if (quoteItemsQueryError) quoteItemsError = quoteItemsQueryError.message;
    else (quoteItems ?? []).forEach((item: any) => addQuoteWeight(quoteWeights, item));
  }

  const relatedErrors = [quotesResult.error?.message, ordersResult.error?.message, quoteItemsError].filter((message): message is string => Boolean(message));

  return (
    <div className="space-y-6">
      <PageHeader 
        title={customer.company_name || customer.customer_name} 
        description={`Customer since ${formatDate(customer.created_at)}`}
      />
      <QueryErrorNotice messages={relatedErrors} />

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-1 h-fit">
          <CardHeader>
            <h3 className="font-bold tracking-tight text-slate-900">Details</h3>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="font-bold uppercase tracking-wider text-slate-500 text-xs">Contact Person</p>
              <p className="font-medium text-slate-900">{customer.contact_person || customer.customer_name || "-"}</p>
            </div>
            <div>
              <p className="font-bold uppercase tracking-wider text-slate-500 text-xs">Phone</p>
              <p className="font-medium text-slate-900">{customer.phone || "-"}</p>
            </div>
            <div>
              <p className="font-bold uppercase tracking-wider text-slate-500 text-xs">GST Number</p>
              <p className="font-medium text-slate-900">{customer.gst_number || "-"}</p>
            </div>
            <div>
              <p className="font-bold uppercase tracking-wider text-slate-500 text-xs">Billing Address</p>
              <p className="font-medium text-slate-900">{customer.billing_address || "-"}</p>
            </div>
          </CardContent>
        </Card>

        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <h3 className="font-bold tracking-tight text-slate-900">Recent Quotes</h3>
              <Link href="/quotes" className="text-xs font-bold text-orange hover:underline">View all</Link>
            </CardHeader>
            <CardContent className="p-0">
              {quotes.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="industrial-table w-full text-sm">
                    <thead>
                      <tr>
                        <th>Quote Number</th>
                        <th>Date</th>
                        <th>Status</th>
                        <th>Weight</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quotes.map((q: any) => (
                        <tr key={q.id} className="hover:bg-slate-50/50">
                          <td className="font-bold text-slate-900">
                            <Link href={`/quotes/${q.id}`} className="hover:text-orange hover:underline">
                              {q.quote_number} <span className="text-xs font-normal text-slate-400 ml-1">Rev {q.revision_number}</span>
                            </Link>
                          </td>
                          <td>{formatDate(q.quote_date)}</td>
                          <td><Badge value={q.status} /></td>
                          <td>{formatWeight(quoteWeights.get(q.id) ?? 0)}</td>
                          <td className="font-bold">{formatCurrency(q.grand_total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-6 text-center text-sm text-slate-500">No quotes generated for this customer yet.</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <h3 className="font-bold tracking-tight text-slate-900">Recent Orders</h3>
              <Link href="/orders" className="text-xs font-bold text-orange hover:underline">View all</Link>
            </CardHeader>
            <CardContent className="p-0">
              {orders.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="industrial-table w-full text-sm">
                    <thead>
                      <tr>
                        <th>Order Number</th>
                        <th>Date</th>
                        <th>Stage</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o: any) => (
                        <tr key={o.id} className="hover:bg-slate-50/50">
                          <td className="font-bold text-slate-900">
                            <Link href={`/orders/${o.id}`} className="hover:text-orange hover:underline">
                              {o.order_number}
                            </Link>
                          </td>
                          <td>{formatDate(o.order_date)}</td>
                          <td><Badge value={o.current_stage} /></td>
                          <td className="font-bold">{formatCurrency(o.order_value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-6 text-center text-sm text-slate-500">No orders placed by this customer yet.</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

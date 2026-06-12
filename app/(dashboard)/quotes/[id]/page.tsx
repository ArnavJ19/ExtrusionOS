import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate, formatWeight } from "@/lib/utils/format";
import Link from "next/link";
import { can } from "@/lib/auth/permissions";
import { Download, Pencil } from "lucide-react";
import { revalidatePath } from "next/cache";
import { PcdaLineReportControls } from "@/components/modules/shared/pcda-line-report-controls";
import { checkPcdaLineReadiness } from "@/lib/reports/pcda/readiness";
import { getReportTemplate } from "@/lib/reports/pcda/templates";

const quickQuoteStatuses = ["draft", "internal_review", "approved_for_sending", "sent", "customer_approved", "customer_rejected", "expired", "converted_to_order"];

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  const supabase = await createClient();

  async function changeQuoteStatus(formData: FormData) {
    "use server";
    const actionContext = await getSessionContext();
    if (!can(actionContext.role, "update", "quotes")) redirect("/dashboard");
    const status = String(formData.get("status") ?? "");
    if (!quickQuoteStatuses.includes(status)) throw new Error("Invalid quote status");
    const serverSupabase = await createClient();
    const { error: updateError } = await serverSupabase
      .from("quotes")
      .update({ status })
      .eq("id", id)
      .eq("company_id", actionContext.companyId);
    if (updateError) throw updateError;
    revalidatePath(`/quotes/${id}`);
    revalidatePath("/quotes");
    revalidatePath("/quotes/database");
  }

  if (!can(context.role, "read", "quotes")) redirect("/dashboard");

  const { data: quote, error } = await supabase
    .from("quotes")
    .select(`
      *,
      customers(customer_name, company_name),
      quote_items(
        *,
        aluminium_profiles(profile_code, profile_name)
      ),
      orders(id, order_number),
      quote_revisions(id, revision_number, revised_at, reason)
    `)
    .eq("id", id)
    .eq("company_id", context.companyId)
    .single();

  if (error || !quote) {
    return (
      <div>
        <PageHeader title="Quote not found" description="The requested quote does not exist or you do not have permission." />
      </div>
    );
  }

  const items = quote.quote_items || [];
  const linkedOrder = quote.orders && quote.orders.length > 0 ? quote.orders[0] : null;
  const revisions = quote.quote_revisions || [];
  const lineIds = items.map((item: any) => item.id);
  let reportRows: { id: string; record_id: string; generated_at: string }[] = [];
  if (lineIds.length) {
    const { data } = await supabase
      .from("technical_reports")
      .select("id, record_id, generated_at")
      .eq("company_id", context.companyId)
      .eq("record_type", "quote")
      .eq("template_key", "quote_line")
      .in("record_id", lineIds)
      .order("generated_at", { ascending: false })
      .limit(100);
    reportRows = data ?? [];
  }
  const canGeneratePcda = getReportTemplate("quote_line")?.roles.includes(context.role) ?? false;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <PageHeader 
          title={`Quote ${quote.quote_number}`} 
          description={`Revision ${quote.revision_number} • ${formatDate(quote.quote_date)} • ${quote.customers?.company_name || quote.customers?.customer_name}`}
        />
        <div className="flex items-center gap-3 pt-2">
          <Badge value={quote.status} />
          {!linkedOrder && (can(context.role, "create", "orders") || can(context.role, "create", "dealer_orders")) ? <Link href={`${context.dealerId ? "/dealer-orders/new" : "/orders/new"}?quoteId=${quote.id}`} className="flex items-center gap-2 rounded-xl bg-charcoal px-3 py-2 text-sm font-bold text-white transition hover:bg-charcoal/90">Create Order</Link> : null}
          {can(context.role, "update", "quotes") ? <Link href={`/quotes/${quote.id}/edit`} className="flex items-center gap-2 rounded-xl bg-orange px-3 py-2 text-sm font-bold text-white shadow-lg shadow-orange/20 transition hover:bg-orange/90"><Pencil className="h-4 w-4" /> Edit</Link> : null}
          <a 
            href={`/api/pdf/quote/${quote.id}`} 
            target="_blank" 
            className="flex items-center gap-2 rounded-xl bg-orange/10 px-3 py-2 text-sm font-bold text-orange transition hover:bg-orange hover:text-white"
          >
            <Download className="h-4 w-4" />
            PDF
          </a>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h3 className="font-bold tracking-tight text-slate-900">Extrusion Items</h3>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="industrial-table w-full text-sm">
                  <thead>
                    <tr>
                      <th>Profile</th>
                      <th>Qty</th>
                      <th>Length</th>
                      <th>Weight</th>
                      <th>Finish</th>
                      <th>Rate</th>
                      <th>Amount</th>
                      <th className="text-right">PCDA Report</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item: any) => (
                      <tr key={item.id} className="hover:bg-slate-50/50">
                        <td className="font-medium text-slate-900">
                          {item.section_code || item.aluminium_profiles?.profile_code || "-"}
                          <br/>
                          <span className="text-xs text-slate-500 font-normal">{item.component_description || item.item_description}</span>
                        </td>
                        <td>{item.order_quantity ?? item.quantity_pieces ?? "-"}</td>
                        <td>{(item.cut_length ?? item.length_per_piece_m) != null ? `${item.cut_length ?? item.length_per_piece_m}m` : "-"}</td>
                        <td>{formatWeight(item.quantity_kg ?? item.billing_weight_kg)}</td>
                        <td>{item.finishing_type?.replace(/_/g, " ") ?? "-"}</td>
                        <td>{formatCurrency(item.net_rate ?? item.price_per_kg)}/kg</td>
                        <td className="font-bold text-slate-900">{formatCurrency(item.final_line_value ?? item.line_total_before_gst)}</td>
                        <td>
                          <PcdaLineReportControls
                            templateKey="quote_line"
                            lineId={item.id}
                            canGenerate={canGeneratePcda}
                            readiness={checkPcdaLineReadiness(item, "quote")}
                            reports={reportRows
                              .filter((report) => report.record_id === item.id)
                              .map((report) => ({ id: report.id, generatedAt: report.generated_at }))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 pt-5 text-sm">
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <p className="font-bold uppercase tracking-wider text-slate-500 text-xs">Terms & Conditions</p>
                  <p className="text-slate-700 mt-1 whitespace-pre-wrap">{quote.terms_and_conditions || "-"}</p>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="font-bold uppercase tracking-wider text-slate-500 text-xs">Delivery Timeline</p>
                    <p className="text-slate-700 mt-1">{quote.delivery_timeline || "-"}</p>
                  </div>
                  <div>
                    <p className="font-bold uppercase tracking-wider text-slate-500 text-xs">Payment Terms</p>
                    <p className="text-slate-700 mt-1">{quote.payment_terms || "-"}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="bg-charcoal bg-none text-white shadow-premium">
            <CardContent className="p-6 space-y-4">
              <div className="flex justify-between items-center pb-4 border-b border-white/10">
                <span className="text-slate-400 font-medium">Subtotal</span>
                <span className="font-bold">{formatCurrency(quote.subtotal)}</span>
              </div>
              <div className="flex justify-between items-center pb-4 border-b border-white/10">
                <span className="text-slate-400 font-medium">GST ({quote.gst_percent}%)</span>
                <span className="font-bold">{formatCurrency(quote.gst_amount)}</span>
              </div>
              <div className="flex justify-between items-center pt-2 text-lg">
                <span className="text-slate-300 font-bold">Grand Total</span>
                <span className="font-black text-orange">{formatCurrency(quote.grand_total)}</span>
              </div>
            </CardContent>
          </Card>

          {can(context.role, "approve", "quotes") && quote.low_margin_approval_required && (
            <div className="rounded-2xl border border-orange-500/30 bg-orange-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-orange-800">Margin Alert</p>
              <p className="mt-1 text-sm font-medium text-orange-900">
                This quote requires approval because it falls below the minimum margin requirements.
              </p>
            </div>
          )}

          {can(context.role, "update", "quotes") ? (
            <Card className="border-orange/30 bg-orange/5">
              <CardHeader>
                <h3 className="font-bold tracking-tight text-slate-900">Change the Status of The Quote</h3>
              </CardHeader>
              <CardContent>
                <form action={changeQuoteStatus} className="space-y-3">
                  <label className="block space-y-1.5">
                    <span className="form-label">Quick status</span>
                    <select name="status" defaultValue={quote.status} className="form-input">
                      {quickQuoteStatuses.map((status) => <option key={status} value={status}>{status.replace(/_/g, " ")}</option>)}
                    </select>
                  </label>
                  <button type="submit" className="w-full rounded-xl bg-charcoal px-4 py-2.5 text-sm font-black text-white transition hover:bg-charcoal/90">Update Quote Status</button>
                  <p className="text-xs font-semibold leading-5 text-slate-500">Use this for quick follow-up updates without opening the full edit screen.</p>
                </form>
              </CardContent>
            </Card>
          ) : null}

          {linkedOrder && (
            <Card>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Linked Order</p>
                  <Link href={`/orders/${linkedOrder.id}`} className="mt-1 font-bold text-slate-900 hover:text-orange">
                    {linkedOrder.order_number}
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <h3 className="font-bold tracking-tight text-slate-900">Status Info</h3>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <p className="font-bold uppercase tracking-wider text-slate-500 text-xs">Valid Until</p>
                <p className="font-medium text-slate-900 mt-1">{formatDate(quote.valid_until)}</p>
              </div>
              {quote.sent_at && (
                <div>
                  <p className="font-bold uppercase tracking-wider text-slate-500 text-xs">Sent At</p>
                  <p className="font-medium text-slate-900 mt-1">{formatDate(quote.sent_at)}</p>
                </div>
              )}
              {quote.approved_by && (
                <div>
                  <p className="font-bold uppercase tracking-wider text-slate-500 text-xs">Approved By</p>
                  <p className="font-medium text-slate-900 mt-1">Admin User</p>
                </div>
              )}
            </CardContent>
          </Card>

          {revisions.length > 0 && (
            <Card>
              <CardHeader>
                <h3 className="font-bold tracking-tight text-slate-900">Revision History</h3>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {revisions.sort((a: any, b: any) => b.revision_number - a.revision_number).map((rev: any) => (
                    <div key={rev.id} className="text-sm border-l-2 border-slate-200 pl-4 py-1">
                      <p className="font-bold text-slate-900">Revision {rev.revision_number}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{formatDate(rev.revised_at)} • {rev.users?.full_name || "System"}</p>
                      {rev.reason && <p className="text-slate-700 mt-1 italic">&quot;{rev.reason}&quot;</p>}
                    </div>
                  ))}
                  <div className="text-sm border-l-2 border-slate-200 pl-4 py-1">
                    <p className="font-bold text-slate-900">Revision {quote.revision_number} (Current)</p>
                    <p className="text-xs text-slate-500 mt-0.5">{formatDate(quote.updated_at || quote.created_at)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

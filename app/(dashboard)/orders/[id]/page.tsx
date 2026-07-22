import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate, formatWeight } from "@/lib/utils/format";
import Link from "next/link";
import { can } from "@/lib/auth/permissions";
import { Pencil } from "lucide-react";
import { PcdaLineReportControls } from "@/components/modules/shared/pcda-line-report-controls";
import { checkPcdaLineReadiness } from "@/lib/reports/pcda/readiness";
import { getReportTemplate } from "@/lib/reports/pcda/templates";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  const supabase = await createClient();

  if (!can(context.role, "read", "orders")) redirect("/dashboard");

  const { data: order, error } = await supabase
    .from("orders")
    .select(`
      *,
      customers(customer_name, company_name),
      quotes(quote_number, revision_number),
      order_items(*, aluminium_profiles(profile_code, profile_name)),
      order_billet_requirements(id, alloy, temper, billet_diameter_inch, required_weight_kg, billets_required, billets_allocated, billets_short, status, aluminium_profiles(profile_code, profile_name)),
      foundry_billets(id, billet_code, source_type, alloy, billet_diameter_inch, status, production_job_id),
      order_stage_history(id, stage, changed_at, remarks, changed_by),
      order_dealer_stock_fulfillments(id, quote_item_id, order_item_id, finishing_type, unit_rate, fulfilled_weight_kg, fulfilled_length_m, notes, created_at, aluminium_profiles(profile_code, profile_name), profile_stock_batches(bundle_number, location, finish, length_m), quote_items(item_description)),
      dispatches(id, dispatch_number, dispatch_date, total_weight_kg, delivery_status)
    `)
    .eq("id", id)
    .eq("company_id", context.companyId)
    .single();

  if (error || !order) {
    return (
      <div>
        <PageHeader title="Order not found" description="The requested order does not exist or you do not have permission." />
      </div>
    );
  }

  const history = order.order_stage_history || [];
  const dealerFulfillments = order.order_dealer_stock_fulfillments || [];
  const dispatches = order.dispatches || [];
  const billetRequirements = order.order_billet_requirements || [];
  const allocatedBillets = order.foundry_billets || [];
  const items = order.order_items || [];
  const canSeeValue = can(context.role, "read", "quotes");
  const lineIds = items.map((item: any) => item.id);
  let reportRows: { id: string; record_id: string; generated_at: string }[] = [];
  if (lineIds.length) {
    const { data } = await supabase
      .from("technical_reports")
      .select("id, record_id, generated_at")
      .eq("company_id", context.companyId)
      .eq("record_type", "order")
      .eq("template_key", "order_line")
      .in("record_id", lineIds)
      .order("generated_at", { ascending: false })
      .limit(100);
    reportRows = data ?? [];
  }
  const canGeneratePcda = getReportTemplate("order_line")?.roles.includes(context.role) ?? false;
  const dealerLedgerWeight = dealerFulfillments.reduce((sum: number, row: any) => sum + Number(row.fulfilled_weight_kg ?? 0), 0);
  const dealerLedgerLength = dealerFulfillments.reduce((sum: number, row: any) => sum + Number(row.fulfilled_length_m ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <PageHeader 
          title={`Order ${order.order_number}`} 
          description={`Placed on ${formatDate(order.order_date)} for ${order.customers?.company_name || order.customers?.customer_name}`}
        />
        <div className="flex items-center gap-2 pt-2">
          <Badge value={order.current_stage} />
          {can(context.role, "update", "orders") ? <Link href={`/orders/${order.id}/edit`} className="inline-flex items-center gap-2 rounded-xl bg-orange px-3 py-2 text-sm font-bold text-white shadow-lg shadow-orange/20 transition hover:bg-orange/90"><Pencil className="h-4 w-4" /> Edit</Link> : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h3 className="font-bold tracking-tight text-slate-900">Order Details</h3>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="font-bold uppercase tracking-wider text-slate-500 text-xs">Customer</p>
                  <p className="font-medium text-slate-900 mt-1">{order.customers?.company_name || order.customers?.customer_name}</p>
                </div>
                <div>
                  <p className="font-bold uppercase tracking-wider text-slate-500 text-xs">Reference Quote</p>
                  <p className="font-medium text-slate-900 mt-1">
                    {order.quotes ? (
                      <Link href={`/quotes/${order.quote_id}`} className="text-orange hover:underline font-bold">
                        {order.quotes.quote_number} Rev {order.quotes.revision_number}
                      </Link>
                    ) : "-"}
                  </p>
                </div>
                <div>
                  <p className="font-bold uppercase tracking-wider text-slate-500 text-xs">Expected Dispatch</p>
                  <p className="font-medium text-slate-900 mt-1">{formatDate(order.expected_dispatch_date)}</p>
                </div>
                {canSeeValue && (
                  <div>
                    <p className="font-bold uppercase tracking-wider text-slate-500 text-xs">Total Value</p>
                    <p className="font-black text-slate-900 mt-1">{formatCurrency(order.order_value)}</p>
                  </div>
                )}
                <div>
                  <p className="font-bold uppercase tracking-wider text-slate-500 text-xs">Requested Weight</p>
                  <p className="font-medium text-slate-900 mt-1">{formatWeight(order.requested_weight_kg)}</p>
                </div>
                <div>
                  <p className="font-bold uppercase tracking-wider text-slate-500 text-xs">Dealer Fulfilled</p>
                  <p className="font-medium text-slate-900 mt-1">{formatWeight(order.dealer_fulfilled_weight_kg)}</p>
                </div>
                <div>
                  <p className="font-bold uppercase tracking-wider text-slate-500 text-xs">Factory Balance</p>
                  <p className="font-black text-slate-900 mt-1">{formatWeight(order.manufacturing_weight_kg)}</p>
                </div>
                <div>
                  <p className="font-bold uppercase tracking-wider text-slate-500 text-xs">Billets Required</p>
                  <p className="font-black text-slate-900 mt-1">{order.billets_required ?? 0}</p>
                </div>
                <div>
                  <p className="font-bold uppercase tracking-wider text-slate-500 text-xs">Billets Allocated</p>
                  <p className="font-black text-slate-900 mt-1">{order.billets_allocated ?? 0}</p>
                </div>
                <div>
                  <p className="font-bold uppercase tracking-wider text-slate-500 text-xs">Billets Short</p>
                  <p className="font-black text-slate-900 mt-1">{order.billets_short ?? 0}</p>
                </div>
                <div>
                  <p className="font-bold uppercase tracking-wider text-slate-500 text-xs">Billet Status</p>
                  <div className="mt-1"><Badge value={order.billet_allocation_status ?? "not_required"} /></div>
                </div>
              </div>
              {Number(order.billets_short ?? 0) > 0 ? (
                <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
                  Billet shortage: this order needs {order.billets_short} more billet{Number(order.billets_short) === 1 ? "" : "s"}. Schedule a foundry job or outsource compatible billets.
                </div>
              ) : null}
              {Number(order.manufacturing_weight_kg ?? 0) > 0 && Number(order.manufacturing_weight_kg ?? 0) < 700 ? (
                <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
                  Urgent: this factory balance is below 700 kg and should not be sent for manufacturing. Fulfill locally or arrange stock from another dealer/manufacturer.
                </div>
              ) : null}
              {order.fulfillment_notes && (
                <div className="mt-6 pt-4 border-t border-slate-100">
                  <p className="font-bold uppercase tracking-wider text-slate-500 text-xs">Fulfillment Notes</p>
                  <p className="text-slate-700 mt-1 text-sm whitespace-pre-wrap">{order.fulfillment_notes}</p>
                </div>
              )}
              {order.notes && (
                <div className="mt-6 pt-4 border-t border-slate-100">
                  <p className="font-bold uppercase tracking-wider text-slate-500 text-xs">Order Notes</p>
                  <p className="text-slate-700 mt-1 text-sm whitespace-pre-wrap">{order.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="font-bold tracking-tight text-slate-900">Order Lines & PCDA Reports</h3>
              <p className="mt-1 text-xs font-semibold text-slate-500">Generate customer-safe technical-commercial sheets only when the required line data is complete.</p>
            </CardHeader>
            <CardContent className="p-0">
              {items.length ? (
                <div className="overflow-x-auto">
                  <table className="industrial-table min-w-[1080px] text-sm">
                    <thead>
                      <tr>
                        <th>Profile</th>
                        <th>Qty</th>
                        <th>Length</th>
                        <th>Weight</th>
                        <th>Finish</th>
                        {canSeeValue ? <th>Rate</th> : null}
                        <th className="text-right">PCDA Report</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item: any) => (
                        <tr key={item.id} className="hover:bg-slate-50/50">
                          <td className="font-medium text-slate-900">
                            {item.section_code || item.aluminium_profiles?.profile_code || "-"}
                            <p className="text-xs font-normal text-slate-500">
                              {item.component_description || item.item_description || item.aluminium_profiles?.profile_name || ""}
                            </p>
                          </td>
                          <td>{item.order_quantity ?? item.quantity_pieces ?? "-"}</td>
                          <td>{(item.cut_length ?? item.length_per_piece_m) != null ? `${item.cut_length ?? item.length_per_piece_m}m` : "-"}</td>
                          <td>{formatWeight(item.quantity_kg ?? item.billing_weight_kg ?? item.total_weight_kg)}</td>
                          <td>{item.finishing_type?.replace(/_/g, " ") ?? "-"}</td>
                          {canSeeValue ? <td>{formatCurrency(item.net_rate ?? item.price_per_kg)}/kg</td> : null}
                          <td>
                            <PcdaLineReportControls
                              templateKey="order_line"
                              lineId={item.id}
                              canGenerate={canGeneratePcda}
                              readiness={checkPcdaLineReadiness(item, "order")}
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
              ) : (
                <div className="p-6 text-center text-sm text-slate-500">No order lines are available for PCDA reporting.</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <h3 className="font-bold tracking-tight text-slate-900">Billet Requirement & Allocation</h3>
                <p className="mt-1 text-xs font-semibold text-slate-500">Calculated at 75% extrusion efficiency and allocated by alloy/diameter priority.</p>
              </div>
              <Badge value={order.billet_allocation_status ?? "not_required"} />
            </CardHeader>
            <CardContent className="space-y-5">
              {billetRequirements.length ? (
                <div className="overflow-x-auto">
                  <table className="industrial-table min-w-[900px] text-sm">
                    <thead><tr><th>Profile</th><th>Alloy</th><th>Diameter</th><th className="text-right">Weight</th><th className="text-right">Required</th><th className="text-right">Allocated</th><th className="text-right">Short</th><th>Status</th></tr></thead>
                    <tbody>{billetRequirements.map((row: any) => <tr key={row.id}><td className="font-black text-slate-950">{row.aluminium_profiles?.profile_code ?? "Profile"}<p className="text-xs font-semibold text-slate-500">{row.aluminium_profiles?.profile_name ?? ""}</p></td><td>{row.alloy}{row.temper ? ` / ${row.temper}` : ""}</td><td>{row.billet_diameter_inch} in</td><td className="text-right font-semibold tabular-nums">{formatWeight(row.required_weight_kg)}</td><td className="text-right font-black tabular-nums">{row.billets_required}</td><td className="text-right font-black tabular-nums text-emerald-700">{row.billets_allocated}</td><td className="text-right font-black tabular-nums text-amber-700">{row.billets_short}</td><td><Badge value={row.status} /></td></tr>)}</tbody>
                  </table>
                </div>
              ) : <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-500">No billet requirement has been calculated for this order.</div>}
              {allocatedBillets.length ? (
                <div className="flex flex-wrap gap-2">
                  {allocatedBillets.map((billet: any) => <Link key={billet.id} href={`/foundry/billets/${billet.id}`} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700 hover:border-orange hover:text-orange">{billet.billet_code} · {billet.alloy} · {billet.billet_diameter_inch} in · {billet.status}</Link>)}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <h3 className="font-bold tracking-tight text-slate-900">Dealer Stock Fulfillment</h3>
                <p className="mt-1 text-xs font-semibold text-slate-500">Exact profile stock batches deducted while converting this quote to an order.</p>
              </div>
              {dealerFulfillments.length ? <Badge value={`${dealerFulfillments.length}_batch_rows`} /> : null}
            </CardHeader>
            <CardContent className="p-0">
              {dealerFulfillments.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="industrial-table min-w-[980px] text-sm">
                    <thead>
                      <tr>
                        <th>Profile</th>
                        <th>Batch / Location</th>
                        <th>Finish</th>
                        <th>Quote Line</th>
                        {canSeeValue ? <th className="text-right">Rate</th> : null}
                        <th className="text-right">Fulfilled kg</th>
                        <th className="text-right">Fulfilled m</th>
                        <th>Date</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dealerFulfillments.map((row: any) => (
                        <tr key={row.id} className="hover:bg-slate-50/50">
                          <td className="font-black text-slate-950">
                            {row.aluminium_profiles?.profile_code ?? "Profile"}
                            <p className="text-xs font-semibold text-slate-500">{row.aluminium_profiles?.profile_name ?? ""}</p>
                          </td>
                          <td className="font-semibold text-slate-700">
                            {row.profile_stock_batches?.bundle_number ?? "-"}
                            <p className="text-xs font-semibold text-slate-500">{row.profile_stock_batches?.location ?? "No location"}</p>
                          </td>
                          <td><Badge value={row.finishing_type ?? row.profile_stock_batches?.finish ?? "stock"} /></td>
                          <td className="max-w-[220px] text-xs font-semibold text-slate-600">{row.quote_items?.item_description || (row.quote_item_id ? `Linked ${String(row.quote_item_id).slice(0, 8)}` : "Legacy line")}</td>
                          {canSeeValue ? <td className="text-right font-semibold tabular-nums">{row.unit_rate ? `${formatCurrency(row.unit_rate)}/kg` : "-"}</td> : null}
                          <td className="text-right font-black tabular-nums text-slate-950">{formatWeight(row.fulfilled_weight_kg)}</td>
                          <td className="text-right font-semibold tabular-nums">{Number(row.fulfilled_length_m ?? 0).toFixed(3)}</td>
                          <td>{formatDate(row.created_at)}</td>
                          <td className="max-w-[260px] text-xs font-semibold leading-5 text-slate-500">{row.notes || "-"}</td>
                        </tr>
                      ))}
                      <tr className="bg-slate-50 font-black text-slate-950">
                        <td colSpan={canSeeValue ? 5 : 4}>Total dealer stock deducted</td>
                        <td className="text-right tabular-nums">{formatWeight(dealerLedgerWeight)}</td>
                        <td className="text-right tabular-nums">{dealerLedgerLength.toFixed(3)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-6 text-center text-sm text-slate-500">No dealer stock was deducted for this order.</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <h3 className="font-bold tracking-tight text-slate-900">Dispatches</h3>
            </CardHeader>
            <CardContent className="p-0">
              {dispatches.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="industrial-table w-full text-sm">
                    <thead>
                      <tr>
                        <th>Dispatch Number</th>
                        <th>Date</th>
                        <th>Weight</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dispatches.map((d: any) => (
                        <tr key={d.id} className="hover:bg-slate-50/50">
                          <td className="font-bold text-slate-900">{d.dispatch_number}</td>
                          <td>{formatDate(d.dispatch_date)}</td>
                          <td className="font-medium">{formatWeight(d.total_weight_kg)}</td>
                          <td><Badge value={d.delivery_status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-6 text-center text-sm text-slate-500">No dispatches created for this order yet.</div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h3 className="font-bold tracking-tight text-slate-900">Stage Timeline</h3>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {history.sort((a: any, b: any) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime()).map((h: any, i: number) => (
                  <div key={h.id} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className={`w-2.5 h-2.5 rounded-full mt-1.5 ${i === 0 ? 'bg-orange' : 'bg-slate-300'}`} />
                      {i !== history.length - 1 && <div className="w-px h-full bg-slate-200 mt-2" />}
                    </div>
                    <div className="pb-4">
                      <p className="text-sm font-bold text-slate-900">{h.stage.replace(/_/g, ' ').replace(/\b\w/g, (l: any) => l.toUpperCase())}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{formatDate(h.changed_at)}</p>
                      {h.remarks && <p className="text-xs text-slate-600 mt-1 italic">&quot;{h.remarks}&quot;</p>}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

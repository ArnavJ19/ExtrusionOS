import Link from "next/link";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ConfiguratorOutputNav } from "@/components/modules/systems-configurator/output-nav";
import { createClient } from "@/lib/supabase/server";
import { getSystemsConfiguratorContext } from "@/lib/systems-configurator/access";
import { generateSystemQuote } from "@/lib/systems-configurator/actions";
import { getSystemQuoteReadiness } from "@/lib/systems-configurator/quote-readiness";
import { buildSystemWhatsAppSummary } from "@/lib/systems-configurator/quote-integration";
import { can } from "@/lib/auth/permissions";
import { labelize } from "@/types/app";

export default async function SystemQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSystemsConfiguratorContext("read");
  const supabase = await createClient();
  const [{ data: configuration }, { data: summary }, { data: profileCuts }] = await Promise.all([
    supabase.from("system_configurations").select("*, system_series(series_code, series_name), glass_items(glass_code, glass_name), finish_options(finish_code, finish_name), customers(customer_name, company_name)").eq("id", id).eq("company_id", context.companyId).single(),
    supabase.from("system_material_summary").select("*").eq("company_id", context.companyId).eq("configuration_id", id).order("material_type", { ascending: true }),
    supabase.from("system_profile_cuts").select("profile_id, total_length_m, total_weight_kg").eq("company_id", context.companyId).eq("configuration_id", id)
  ]);
  const rows = summary ?? [];
  const canSeeInternal = ["owner", "admin", "accounts"].includes(context.role);
  const quoteAction = generateSystemQuote.bind(null, id);
  const quoteReadiness = getSystemQuoteReadiness(configuration, profileCuts ?? [], true);
  const whatsappSummary = buildSystemWhatsAppSummary({
    configurationNumber: configuration?.configuration_number,
    projectName: configuration?.project_name,
    designReference: configuration?.design_reference,
    systemType: configuration?.system_type,
    widthMm: Number(configuration?.width_mm ?? 0),
    heightMm: Number(configuration?.height_mm ?? 0),
    quantity: Number(configuration?.quantity ?? 1),
    finishName: configuration?.finish_options?.finish_name,
    glassName: configuration?.glass_items?.glass_name,
    grandTotal: Number(configuration?.grand_total ?? 0),
    gstAmount: Number(configuration?.gst_amount ?? 0),
    customerName: configuration?.customers?.customer_name
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader title="Costing & Quote" description="Customer-safe quote summary with internal costing visibility restricted by role." />
        <div className="flex flex-wrap gap-2">
          {configuration?.quote_id ? <Link href={`/quotes/${configuration.quote_id}`} className="inline-flex items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700 transition hover:bg-emerald-100">Open Quote</Link> : can(context.role, "create", "quotes") ? <form action={quoteAction}><button type="submit" disabled={!quoteReadiness.ready} className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-orange hover:text-orange disabled:cursor-not-allowed disabled:opacity-50">Convert To Quote</button></form> : null}
          {quoteReadiness.ready ? <Link href={`/api/pdf/systems-configurator/${id}/customer_quote`} target="_blank" className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange/20 transition hover:bg-orange/90"><Download className="h-4 w-4" /> Customer PDF</Link> : <span className="inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-bold text-slate-500"><Download className="h-4 w-4" /> Customer PDF</span>}
          {canSeeInternal ? <Link href={`/api/pdf/systems-configurator/${id}/internal_costing`} target="_blank" className="inline-flex items-center justify-center gap-2 rounded-xl bg-charcoal px-4 py-2.5 text-sm font-bold text-white transition hover:bg-charcoal/90"><Download className="h-4 w-4 text-orange" /> Internal PDF</Link> : null}
        </div>
      </div>

      <ConfiguratorOutputNav projectId={id} active="costing" />
      <Card className={quoteReadiness.ready ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}><CardContent><p className={quoteReadiness.ready ? "text-sm font-bold text-emerald-900" : "text-sm font-bold text-amber-900"}>{quoteReadiness.ready ? "Ready for quote conversion. Customer PDFs show selling totals only; internal cost and margin remain role-restricted." : quoteReadiness.reason}</p></CardContent></Card>
      <div className="grid gap-3 md:grid-cols-4"><Metric label="Subtotal" value={configuration?.subtotal ?? 0} /><Metric label="GST" value={configuration?.gst_amount ?? 0} /><Metric label="Grand Total" value={configuration?.grand_total ?? 0} highlight />{canSeeInternal ? <Metric label="Internal Cost" value={configuration?.internal_cost ?? 0} /> : <LockedMetric />}</div>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-white"><h3 className="font-black text-slate-950">Material & Cost Summary</h3></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-black uppercase tracking-[0.12em] text-slate-500"><tr><th className="px-4 py-3">Category</th><th className="px-4 py-3">Item</th><th className="px-4 py-3 text-right">Qty</th><th className="px-4 py-3">Unit</th><th className="px-4 py-3 text-right">Weight kg</th><th className="px-4 py-3 text-right">Area sq ft</th><th className="px-4 py-3 text-right">Amount</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((item: any) => <tr key={item.id} className="hover:bg-orange/5"><td className="px-4 py-3 font-semibold text-slate-700">{labelize(item.material_type)}</td><td className="px-4 py-3 font-black text-slate-950">{item.item_code ?? "-"}<p className="text-xs font-semibold text-slate-500">{item.item_name}</p></td><td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(item.quantity ?? 0).toFixed(3)}</td><td className="px-4 py-3 font-semibold">{item.unit}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(item.total_weight_kg ?? 0).toFixed(3)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(item.total_area_sqft ?? 0).toFixed(3)}</td><td className="px-4 py-3 text-right font-black tabular-nums">Rs. {Number(item.amount ?? 0).toLocaleString("en-IN")}</td></tr>)}{!rows.length ? <tr><td colSpan={7} className="px-4 py-12 text-center font-semibold text-slate-500">No costing summary yet. <Link href={`/systems-configurator/projects/${id}`} className="font-black text-orange">Calculate this configuration</Link>.</td></tr> : null}</tbody></table></div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 shadow-sm">
          <CardHeader><h3 className="font-black text-slate-950">Customer Summary</h3></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Summary label="Project" value={configuration?.project_name ?? "-"} />
            <Summary label="Design" value={configuration?.design_reference ?? "-"} />
            <Summary label="System" value={labelize(configuration?.system_type ?? "custom")} />
            <Summary label="Size" value={`${Number(configuration?.width_mm ?? 0).toFixed(0)} x ${Number(configuration?.height_mm ?? 0).toFixed(0)} mm`} />
            <Summary label="Series" value={configuration?.system_series?.series_code ?? "Not selected"} />
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">Message Summary</p><p className="mt-2 whitespace-pre-line text-sm font-semibold leading-6 text-slate-700">{whatsappSummary}</p></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return <Card className={highlight ? "border-orange/40" : undefined}><CardContent><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{label}</p><p className={`mt-2 text-2xl font-black ${highlight ? "text-orange" : "text-slate-950"}`}>Rs. {Number(value ?? 0).toLocaleString("en-IN")}</p></CardContent></Card>;
}

function LockedMetric() {
  return <Card><CardContent><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Internal Cost</p><p className="mt-2 text-sm font-bold text-slate-500">Restricted by role</p></CardContent></Card>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2"><span className="font-bold text-slate-500">{label}</span><span className="text-right font-black text-slate-950">{value}</span></div>;
}

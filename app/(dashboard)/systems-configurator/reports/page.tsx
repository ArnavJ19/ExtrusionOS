import Link from "next/link";
import { Download, FileSpreadsheet, PackageCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getSystemsConfiguratorContext } from "@/lib/systems-configurator/access";
import { getSystemOutputStatus } from "@/lib/systems-configurator/output-status";
import { summarizeProductionProgress } from "@/lib/systems-configurator/production-progress";
import { getSystemQuoteReadiness } from "@/lib/systems-configurator/quote-readiness";
import { getConfiguratorWorkflowStatus, productionJobMatchesConfiguration } from "@/lib/systems-configurator/workflow-status";
import { labelize } from "@/types/app";

type CountableRow = { configuration_id: string };

export default async function SystemReportsPage() {
  const context = await getSystemsConfiguratorContext("read");
  const supabase = await createClient();
  const canSeeInternal = can(context.role, "read", "financials") || ["owner", "admin", "accounts"].includes(context.role);
  const { data: configurations } = await supabase
    .from("system_configurations")
    .select("id, configuration_number, project_name, design_reference, customer_id, status, quote_id, order_id, grand_total, system_type, width_mm, height_mm, quantity, created_at, system_series(series_code), customers(customer_name, company_name)")
    .eq("company_id", context.companyId)
    .order("created_at", { ascending: false })
    .limit(50);

  const rows = configurations ?? [];
  const ids = rows.map((configuration: any) => configuration.id);
  const orderIds = rows.map((configuration: any) => configuration.order_id).filter(Boolean);
  const [profileCuts, glassCuts, beadingCuts, hardwareBom, optimizationRuns, productionJobs] = ids.length
    ? await Promise.all([
        supabase.from("system_profile_cuts").select("configuration_id, profile_id, total_length_m, total_weight_kg").eq("company_id", context.companyId).in("configuration_id", ids),
        supabase.from("system_glass_cuts").select("configuration_id").eq("company_id", context.companyId).in("configuration_id", ids),
        supabase.from("system_beading_cuts").select("configuration_id").eq("company_id", context.companyId).in("configuration_id", ids),
        supabase.from("system_hardware_bom").select("configuration_id").eq("company_id", context.companyId).in("configuration_id", ids),
        supabase.from("profile_optimization_runs").select("configuration_id").eq("company_id", context.companyId).in("configuration_id", ids),
        orderIds.length ? supabase.from("production_jobs").select("order_id, status, planned_quantity_kg, actual_quantity_kg, planned_meters, actual_meters, remarks").eq("company_id", context.companyId).in("order_id", orderIds) : Promise.resolve({ data: [] })
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];

  const profileCutRows = profileCuts.data ?? [];
  const profileCount = countByConfiguration(profileCutRows);
  const glassCount = countByConfiguration(glassCuts.data ?? []);
  const beadCount = countByConfiguration(beadingCuts.data ?? []);
  const hardwareCount = countByConfiguration(hardwareBom.data ?? []);
  const optimizationCount = countByConfiguration(optimizationRuns.data ?? []);
  const calculatedCount = rows.filter((item: any) => item.status === "calculated" || item.status === "quoted").length;
  const quotedCount = rows.filter((item: any) => Boolean(item.quote_id) || item.status === "quoted").length;
  const productionReadyCount = rows.filter((item: any) => getSystemOutputStatus({ profileCuts: profileCount.get(item.id) ?? 0, glassCuts: glassCount.get(item.id) ?? 0, beadingCuts: beadCount.get(item.id) ?? 0, hardwareBom: hardwareCount.get(item.id) ?? 0 }).productionReady).length;
  const totalValue = rows.reduce((sum: number, item: any) => sum + Number(item.grand_total ?? 0), 0);
  const productionJobRows = productionJobs.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader title="System Reports" description="Report center for customer quote PDFs, production sheets, cutting lists, glass lists, hardware BOMs, internal costing, and optimization reports." />
        <Link href="/systems-configurator/projects" className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange/20 transition hover:bg-orange/90"><FileSpreadsheet className="h-4 w-4" /> All Projects</Link>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Metric label="Configurations" value={String(rows.length)} />
        <Metric label="Calculated" value={String(calculatedCount)} />
        <Metric label="Production Ready" value={String(productionReadyCount)} />
        <Metric label="Quoted" value={String(quotedCount)} />
        <Metric label="Total Selling Value" value={`Rs. ${totalValue.toLocaleString("en-IN")}`} highlight />
      </div>

      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 bg-white"><h3 className="flex items-center gap-2 font-black text-slate-950"><PackageCheck className="h-5 w-5 text-orange" /> Recent Configuration Reports</h3></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1060px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-black uppercase tracking-[0.12em] text-slate-500"><tr><th className="px-4 py-3">Configuration</th><th className="px-4 py-3">System</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Production Outputs</th><th className="px-4 py-3">Production Progress</th><th className="px-4 py-3 text-right">Value</th><th className="px-4 py-3">Reports</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((configuration: any) => {
                  const cutsForConfiguration = profileCutRows.filter((cut: any) => cut.configuration_id === configuration.id);
                  const outputStatus = getSystemOutputStatus({ profileCuts: profileCount.get(configuration.id) ?? 0, glassCuts: glassCount.get(configuration.id) ?? 0, beadingCuts: beadCount.get(configuration.id) ?? 0, hardwareBom: hardwareCount.get(configuration.id) ?? 0, optimizationRuns: optimizationCount.get(configuration.id) ?? 0 });
                  const quoteReadiness = getSystemQuoteReadiness(configuration, cutsForConfiguration, true);
                  const matchingJobs = productionJobRows.filter((job: any) => productionJobMatchesConfiguration(job, configuration));
                  const progress = summarizeProductionProgress(matchingJobs);
                  const workflow = getConfiguratorWorkflowStatus({ configurationStatus: configuration.status, quoteId: configuration.quote_id, dataReadiness: { status: "ready", issues: [], criticalCount: 0, warningCount: 0 }, outputStatus, quoteReadiness, productionReadiness: { ready: false, reason: null }, productionProgress: progress });
                  return (
                    <tr key={configuration.id} className="transition hover:bg-orange/5">
                      <td className="px-4 py-4"><Link href={`/systems-configurator/projects/${configuration.id}`} className="font-black text-slate-950 transition hover:text-orange">{configuration.configuration_number ?? "Draft"} · {configuration.design_reference ?? "Design"}</Link><p className="mt-1 text-xs font-semibold text-slate-500">{configuration.project_name ?? "Project"} · {configuration.customers?.customer_name ?? "Walk-in"}</p></td>
                      <td className="px-4 py-4 font-semibold text-slate-700">{labelize(configuration.system_type ?? "custom")}<p className="mt-1 text-xs text-slate-500">{configuration.width_mm} x {configuration.height_mm} mm · Qty {configuration.quantity}</p></td>
                      <td className="px-4 py-4"><Badge value={configuration.status ?? "draft"} /><p className="mt-2 text-xs font-black text-slate-600">{workflow.label}</p></td>
                      <td className="px-4 py-4"><p className={outputStatus.productionReady ? "font-black text-emerald-700" : "font-black text-amber-700"}>{outputStatus.productionReady ? "Production ready" : "Pending outputs"}</p><p className="mt-1 text-xs font-semibold text-slate-500">{outputStatus.productionReady ? outputStatus.completedOutputs.join(", ") : outputStatus.missingOutputs.join(", ")}</p></td>
                      <td className="px-4 py-4"><p className={progress.status === "completed" ? "font-black text-emerald-700" : progress.jobCount ? "font-black text-orange" : "font-black text-slate-500"}>{progress.jobCount ? `${progress.progressPercent.toFixed(1)}%` : "Not handed off"}</p><p className="mt-1 text-xs font-semibold text-slate-500">{progress.jobCount ? `${progress.completedJobs}/${progress.jobCount} jobs · ${progress.actualKg.toFixed(3)}/${progress.plannedKg.toFixed(3)} kg` : "No linked production jobs"}</p></td>
                      <td className="px-4 py-4 text-right font-black tabular-nums text-slate-950">Rs. {Number(configuration.grand_total ?? 0).toLocaleString("en-IN")}</td>
                      <td className="px-4 py-4"><div className="flex flex-wrap gap-2"><ReportLink href={`/api/pdf/systems-configurator/${configuration.id}/customer_quote`} label="Customer" disabled={!quoteReadiness.ready} /><ReportLink href={`/api/pdf/systems-configurator/${configuration.id}/production_sheet`} label="Production" /><ReportLink href={`/api/pdf/systems-configurator/${configuration.id}/cutting_list`} label="Cutting" disabled={(profileCount.get(configuration.id) ?? 0) === 0} /><ReportLink href={`/api/pdf/systems-configurator/${configuration.id}/glass_list`} label="Glass" disabled={(glassCount.get(configuration.id) ?? 0) === 0} /><ReportLink href={`/api/pdf/systems-configurator/${configuration.id}/hardware_bom`} label="BOM" disabled={(hardwareCount.get(configuration.id) ?? 0) === 0} /><ReportLink href={`/api/pdf/systems-configurator/${configuration.id}/optimization_report`} label="Optimization" disabled={!outputStatus.optimizationReady} />{canSeeInternal ? <ReportLink href={`/api/pdf/systems-configurator/${configuration.id}/internal_costing`} label="Internal" /> : null}</div></td>
                    </tr>
                  );
                })}
                {!rows.length ? <tr><td colSpan={7} className="px-5 py-12 text-center text-sm font-semibold text-slate-500">No configurations yet. Reports appear after configurations are created.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function countByConfiguration(rows: CountableRow[]) {
  return rows.reduce((map, row) => map.set(row.configuration_id, (map.get(row.configuration_id) ?? 0) + 1), new Map<string, number>());
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return <Card className={highlight ? "border-orange/40 shadow-sm" : "border-slate-200 shadow-sm"}><CardContent><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{label}</p><p className={`mt-2 text-2xl font-black ${highlight ? "text-orange" : "text-slate-950"}`}>{value}</p></CardContent></Card>;
}

function ReportLink({ href, label, disabled }: { href: string; label: string; disabled?: boolean }) {
  if (disabled) return <span className="inline-flex cursor-not-allowed items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-black text-slate-400"><Download className="h-3.5 w-3.5" />{label}</span>;
  return <Link href={href} target="_blank" className="inline-flex items-center gap-1 rounded-lg bg-charcoal px-2.5 py-1.5 text-xs font-black text-white transition hover:bg-charcoal/90"><Download className="h-3.5 w-3.5 text-orange" />{label}</Link>;
}

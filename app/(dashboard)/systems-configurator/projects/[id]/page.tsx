import Link from "next/link";
import { Calculator, Download, Edit, FileSpreadsheet, Layers, PackageCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SystemElevationPreview } from "@/components/modules/systems-configurator/system-elevation-preview";
import { ConfiguratorOutputNav } from "@/components/modules/systems-configurator/output-nav";
import { createClient } from "@/lib/supabase/server";
import { getSystemsConfiguratorContext } from "@/lib/systems-configurator/access";
import { calculateSystemConfigurationProject, generateSystemQuote, handoffSystemConfigurationToProduction, runProfileOptimization } from "@/lib/systems-configurator/actions";
import { getConfigurationDataReadiness } from "@/lib/systems-configurator/data-readiness";
import { getSystemOutputStatus } from "@/lib/systems-configurator/output-status";
import { getProductionHandoffReadiness, groupProfileCutsForProduction } from "@/lib/systems-configurator/production-handoff";
import { summarizeProductionProgress } from "@/lib/systems-configurator/production-progress";
import { getSystemQuoteReadiness } from "@/lib/systems-configurator/quote-readiness";
import { getConfiguratorWorkflowStatus, productionJobMatchesConfiguration } from "@/lib/systems-configurator/workflow-status";
import { can } from "@/lib/auth/permissions";
import { labelize } from "@/types/app";

export default async function SystemProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSystemsConfiguratorContext("read");
  const supabase = await createClient();
  const [configurationResult, profileCutsResult, glassCutsResult, beadingCutsResult, hardwareResult, materialResult, templateResult, systemProfilesResult, hardwareItemsResult, glassItemsResult, finishOptionsResult] = await Promise.all([
    supabase.from("system_configurations").select("*, system_series(series_code, series_name), customers(customer_name, company_name), glass_items(glass_code, glass_name), finish_options(finish_code, finish_name)").eq("id", id).eq("company_id", context.companyId).single(),
    supabase.from("system_profile_cuts").select("id, profile_id, profile_code, profile_name, total_length_m, total_weight_kg").eq("company_id", context.companyId).eq("configuration_id", id),
    supabase.from("system_glass_cuts").select("id, area_sqft, area_sqm").eq("company_id", context.companyId).eq("configuration_id", id),
    supabase.from("system_beading_cuts").select("id").eq("company_id", context.companyId).eq("configuration_id", id),
    supabase.from("system_hardware_bom").select("id, quantity").eq("company_id", context.companyId).eq("configuration_id", id),
    supabase.from("system_material_summary").select("id, material_type, amount").eq("company_id", context.companyId).eq("configuration_id", id),
    supabase.from("system_templates").select("id, formula_json").eq("company_id", context.companyId).eq("is_active", true).limit(200),
    supabase.from("system_profiles").select("id, series_id, profile_id, component_role, display_name, is_active, aluminium_profiles(profile_code, profile_name, section_weight_kg_per_m)").eq("company_id", context.companyId).eq("is_active", true),
    supabase.from("hardware_items").select("id, item_code, item_name, hardware_category, default_rate, unit, is_active").eq("company_id", context.companyId).eq("is_active", true),
    supabase.from("glass_items").select("id, glass_code, glass_name, rate_per_sqft, rate_per_sqm, is_active").eq("company_id", context.companyId).eq("is_active", true),
    supabase.from("finish_options").select("id, finish_code, finish_name, rate, is_active").eq("company_id", context.companyId).eq("is_active", true)
  ]);
  const configuration = configurationResult.data;
  const error = configurationResult.error;

  if (error || !configuration) {
    return <PageHeader title="Configuration Not Found" description="The requested system configuration does not exist or is outside your company workspace." />;
  }

  const layout = configuration.panel_layout_json as any;
  const panels = Array.isArray(layout?.panels) ? layout.panels : [];
  const panelCount = panels.length || Number(configuration.no_of_panels ?? 1);
  const options = configuration.options_json && typeof configuration.options_json === "object" ? configuration.options_json as Record<string, unknown> : {};
  const calculateAction = calculateSystemConfigurationProject.bind(null, id);
  const optimizeAction = runProfileOptimization.bind(null, id);
  const quoteAction = generateSystemQuote.bind(null, id);
  const handoffAction = handoffSystemConfigurationToProduction.bind(null, id);
  const profileCuts = profileCutsResult.data ?? [];
  const glassCuts = glassCutsResult.data ?? [];
  const beadingCuts = beadingCutsResult.data ?? [];
  const hardwareRows = hardwareResult.data ?? [];
  const materialRows = materialResult.data ?? [];
  const totalWeight = profileCuts.reduce((sum: number, cut: any) => sum + Number(cut.total_weight_kg ?? 0), 0);
  const totalLength = profileCuts.reduce((sum: number, cut: any) => sum + Number(cut.total_length_m ?? 0), 0);
  const glassArea = glassCuts.reduce((sum: number, cut: any) => sum + Number(cut.area_sqft ?? 0), 0);
  const hardwareQty = hardwareRows.reduce((sum: number, item: any) => sum + Number(item.quantity ?? 0), 0);
  const materialAmount = materialRows.reduce((sum: number, item: any) => sum + Number(item.amount ?? 0), 0);
  const createdDate = configuration.created_at ? new Date(configuration.created_at).toLocaleDateString("en-IN") : "-";
  const quoteReadiness = getSystemQuoteReadiness(configuration, profileCuts, true);
  const selectedTemplate = (templateResult.data ?? []).find((template: any) => template.id === configuration.template_id);
  const dataReadiness = getConfigurationDataReadiness({ seriesId: configuration.series_id, template: selectedTemplate, systemProfiles: systemProfilesResult.data ?? [], hardwareItems: hardwareItemsResult.data ?? [], glassItems: glassItemsResult.data ?? [], finishOptions: finishOptionsResult.data ?? [], glassId: configuration.glass_id, finishId: configuration.finish_id });
  const outputStatus = getSystemOutputStatus({ profileCuts: profileCuts.length, glassCuts: glassCuts.length, beadingCuts: beadingCuts.length, hardwareBom: hardwareRows.length });
  const existingProductionJobs = configuration.order_id ? await supabase.from("production_jobs").select("id, order_id, job_number, status, planned_quantity_kg, actual_quantity_kg, planned_meters, actual_meters, remarks, profile:aluminium_profiles(profile_code, profile_name)").eq("company_id", context.companyId).eq("order_id", configuration.order_id).ilike("remarks", `%${configuration.configuration_number ?? "System configuration"}%`) : { data: [] };
  const productionJobs = (existingProductionJobs.data ?? []).filter((job: any) => productionJobMatchesConfiguration(job, configuration));
  const productionJobGroups = groupProfileCutsForProduction(profileCuts);
  const productionReadiness = getProductionHandoffReadiness(configuration, productionJobGroups, productionJobs.length);
  const productionProgress = summarizeProductionProgress(productionJobs);
  const workflowStatus = getConfiguratorWorkflowStatus({ configurationStatus: configuration.status, quoteId: configuration.quote_id, dataReadiness, outputStatus, quoteReadiness, productionReadiness, productionProgress });

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-[linear-gradient(135deg,#ffffff,#f8fafc)] p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-charcoal px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-white">{configuration.configuration_number ?? "Draft"}</span><Badge value={configuration.status ?? "draft"} /></div>
            <PageHeader title={`${configuration.design_reference ?? "System"} · ${configuration.project_name ?? "Project"}`} description={`${configuration.customers?.customer_name ?? "Walk-in"} · ${labelize(configuration.system_type ?? "custom")} · Created ${createdDate}`} />
          </div>
          <div className="flex flex-wrap gap-2">
          {can(context.role, "update", "systems_configurator") ? <form action={calculateAction}><button type="submit" className="inline-flex items-center gap-2 rounded-xl bg-orange px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange/20 transition hover:bg-orange/90"><Calculator className="h-4 w-4" /> Calculate</button></form> : null}
          {can(context.role, "update", "systems_configurator") ? <form action={optimizeAction}><button type="submit" className="inline-flex items-center gap-2 rounded-xl bg-charcoal px-4 py-2.5 text-sm font-bold text-white transition hover:bg-charcoal/90"><Calculator className="h-4 w-4 text-orange" /> Optimize</button></form> : null}
          {configuration.quote_id ? <Link href={`/quotes/${configuration.quote_id}`} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700 transition hover:bg-emerald-100">View Quote</Link> : can(context.role, "create", "quotes") ? <form action={quoteAction}><button type="submit" disabled={!quoteReadiness.ready} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-orange hover:text-orange disabled:cursor-not-allowed disabled:opacity-50">Generate Quote</button></form> : null}
          {can(context.role, "create", "production") ? <form action={handoffAction}><button type="submit" disabled={!productionReadiness.ready} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-orange hover:text-orange disabled:cursor-not-allowed disabled:opacity-50">Production Handoff</button></form> : null}
          <Link href={`/systems-configurator/projects/${id}/edit`} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-orange hover:text-orange"><Edit className="h-4 w-4" /> Edit</Link>
          <Link href={`/api/pdf/systems-configurator/${id}/production_sheet`} target="_blank" className="inline-flex items-center gap-2 rounded-xl bg-charcoal px-4 py-2.5 text-sm font-bold text-white transition hover:bg-charcoal/90"><Download className="h-4 w-4 text-orange" /> Production Sheet</Link>
          </div>
        </div>
      </div>

      <ConfiguratorOutputNav projectId={id} active="overview" />

      <Card className={workflowStatus.severity === "success" ? "border-emerald-200 bg-emerald-50 shadow-sm" : workflowStatus.severity === "warning" ? "border-amber-200 bg-amber-50 shadow-sm" : "border-slate-200 bg-white shadow-sm"}>
        <CardContent>
          <p className={workflowStatus.severity === "success" ? "text-sm font-black text-emerald-900" : workflowStatus.severity === "warning" ? "text-sm font-black text-amber-900" : "text-sm font-black text-slate-800"}>Workflow Stage: {workflowStatus.label}</p>
          <p className="mt-1 text-sm font-semibold text-slate-700">Next: {workflowStatus.nextAction}</p>
        </CardContent>
      </Card>

      <Card className={quoteReadiness.ready ? "border-emerald-200 bg-emerald-50 shadow-sm" : "border-amber-200 bg-amber-50 shadow-sm"}>
        <CardContent>
          <p className={quoteReadiness.ready ? "text-sm font-black text-emerald-900" : "text-sm font-black text-amber-900"}>{quoteReadiness.ready ? "Ready for quote conversion." : quoteReadiness.reason}</p>
        </CardContent>
      </Card>

      <Card className={dataReadiness.status === "critical" ? "border-red-200 bg-red-50 shadow-sm" : dataReadiness.status === "warning" ? "border-amber-200 bg-amber-50 shadow-sm" : "border-emerald-200 bg-emerald-50 shadow-sm"}>
        <CardContent>
          <p className={dataReadiness.status === "critical" ? "text-sm font-black text-red-900" : dataReadiness.status === "warning" ? "text-sm font-black text-amber-900" : "text-sm font-black text-emerald-900"}>{dataReadiness.status === "ready" ? "Production data is complete for calculation." : `Production data readiness: ${dataReadiness.criticalCount} critical issue${dataReadiness.criticalCount === 1 ? "" : "s"}, ${dataReadiness.warningCount} warning${dataReadiness.warningCount === 1 ? "" : "s"}.`}</p>
          {dataReadiness.issues.length ? <p className="mt-1 text-sm font-semibold text-slate-700">{dataReadiness.issues.slice(0, 3).map((issue) => issue.message).join(" ")}</p> : null}
        </CardContent>
      </Card>

      <Card className={productionReadiness.ready ? "border-emerald-200 bg-emerald-50 shadow-sm" : "border-slate-200 bg-white shadow-sm"}>
        <CardContent>
          <p className={productionReadiness.ready ? "text-sm font-black text-emerald-900" : "text-sm font-black text-slate-700"}>{productionReadiness.ready ? `Ready for production handoff: ${productionJobGroups.length} planned profile job${productionJobGroups.length === 1 ? "" : "s"}.` : productionReadiness.reason}</p>
          {configuration.order_id ? <p className="mt-1 text-sm font-semibold text-slate-600">Linked order is ready. <Link href="/production" className="font-black text-orange">Open production jobs</Link>.</p> : null}
        </CardContent>
      </Card>

      {productionJobs.length ? <ProductionProgressCard jobs={productionJobs} summary={productionProgress} /> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Metric label="Size" value={`${configuration.width_mm} x ${configuration.height_mm} mm`} />
        <Metric label="Aluminium" value={`${totalWeight.toFixed(3)} kg`} />
        <Metric label="Profile Length" value={`${totalLength.toFixed(3)} m`} />
        <Metric label="Glass Area" value={`${glassArea.toFixed(3)} sqft`} />
        <Metric label="Grand Total" value={`Rs. ${Number(configuration.grand_total ?? 0).toLocaleString("en-IN")}`} highlight />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-white"><h3 className="flex items-center gap-2 font-black text-slate-950"><Layers className="h-5 w-5 text-orange" /> Design Elevation</h3></CardHeader>
          <CardContent>
            <SystemElevationPreview realWidthMm={Number(configuration.width_mm ?? 0)} realHeightMm={Number(configuration.height_mm ?? 0)} systemType={configuration.system_type} panelLayout={layout} panelCount={panelCount} trackCount={Number(options.track_count ?? 1)} designReference={configuration.design_reference} viewDirection={configuration.view_direction} className="min-h-[360px]" />
          </CardContent>
        </Card>

        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <Card className="border-slate-200 shadow-sm"><CardHeader><h3 className="font-black text-slate-950">Key Specs</h3></CardHeader><CardContent className="space-y-3 text-sm"><Summary label="Series" value={configuration.system_series?.series_code ?? "Not selected"} /><Summary label="Customer" value={configuration.customers?.customer_name ?? "Walk-in"} /><Summary label="Quantity" value={String(configuration.quantity)} /><Summary label="Measurement" value={labelize(configuration.measurement_type ?? "frame_outer_size")} /><Summary label="Glass" value={configuration.glass_items?.glass_code ?? "Not selected"} /><Summary label="Finish" value={configuration.finish_options?.finish_code ?? "Not selected"} /><Summary label="Hardware Qty" value={hardwareQty.toFixed(3)} /><Summary label="Material Amount" value={`Rs. ${materialAmount.toLocaleString("en-IN")}`} /></CardContent></Card>
          <Card className="border-slate-200 shadow-sm"><CardHeader><h3 className="flex items-center gap-2 font-black text-slate-950"><PackageCheck className="h-5 w-5 text-orange" /> Production Outputs</h3></CardHeader><CardContent className="grid gap-2"><OutputLink href={`/systems-configurator/projects/${id}/cutting-list`} label="Cutting List" /><OutputLink href={`/systems-configurator/projects/${id}/glass-list`} label="Glass & Beading" /><OutputLink href={`/systems-configurator/projects/${id}/bom`} label="Hardware BOM" /><OutputLink href={`/systems-configurator/projects/${id}/quote`} label="Costing & Quote" /><OutputLink href={`/systems-configurator/projects/${id}/optimization`} label="Optimization" /><PdfLink href={`/api/pdf/systems-configurator/${id}/customer_quote`} label="Customer Quote PDF" disabled={!quoteReadiness.ready} /></CardContent></Card>
        </aside>
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2"><span className="font-bold text-slate-500">{label}</span><span className="text-right font-black text-slate-950">{value}</span></div>;
}

function OutputLink({ href, label }: { href: string; label: string }) {
  return <Link href={href} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition hover:border-orange hover:text-orange"><FileSpreadsheet className="h-4 w-4" /><Calculator className="hidden" />{label}</Link>;
}

function PdfLink({ href, label, disabled }: { href: string; label: string; disabled?: boolean }) {
  if (disabled) return <span className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl bg-slate-200 px-3 py-2 text-sm font-bold text-slate-500"><Download className="h-4 w-4" />{label}</span>;
  return <Link href={href} target="_blank" className="inline-flex items-center gap-2 rounded-xl bg-charcoal px-3 py-2 text-sm font-bold text-white transition hover:bg-charcoal/90"><Download className="h-4 w-4 text-orange" />{label}</Link>;
}

function ProductionProgressCard({ jobs, summary }: { jobs: any[]; summary: ReturnType<typeof summarizeProductionProgress> }) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="border-b border-slate-100 bg-white"><h3 className="flex items-center gap-2 font-black text-slate-950"><PackageCheck className="h-5 w-5 text-orange" /> Production Progress</h3></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-5"><Metric label="Jobs" value={`${summary.completedJobs}/${summary.jobCount}`} /><Metric label="Status" value={labelize(summary.status)} /><Metric label="Planned" value={`${summary.plannedKg.toFixed(3)} kg`} /><Metric label="Actual" value={`${summary.actualKg.toFixed(3)} kg`} /><Metric label="Progress" value={`${summary.progressPercent.toFixed(1)}%`} highlight /></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-black uppercase tracking-[0.12em] text-slate-500"><tr><th className="px-4 py-3">Job</th><th className="px-4 py-3">Profile</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Planned kg</th><th className="px-4 py-3 text-right">Actual kg</th><th className="px-4 py-3 text-right">Progress</th></tr></thead><tbody className="divide-y divide-slate-100">{jobs.map((job) => { const planned = Number(job.planned_quantity_kg ?? 0); const actual = Number(job.actual_quantity_kg ?? 0); const percent = planned > 0 ? Math.min(100, (actual / planned) * 100) : job.status === "completed" ? 100 : 0; return <tr key={job.id} className="hover:bg-orange/5"><td className="px-4 py-3 font-black text-slate-950"><Link href={`/production/${job.id}`} className="hover:text-orange">{job.job_number ?? "Job"}</Link></td><td className="px-4 py-3 font-semibold text-slate-700">{job.profile?.profile_code ?? "Profile"}<p className="text-xs text-slate-500">{job.profile?.profile_name ?? ""}</p></td><td className="px-4 py-3 font-semibold text-slate-700">{labelize(job.status ?? "planned")}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{planned.toFixed(3)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{actual.toFixed(3)}</td><td className="px-4 py-3 text-right font-black tabular-nums text-slate-950">{percent.toFixed(1)}%</td></tr>; })}</tbody></table></div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return <Card className={highlight ? "border-orange/40 shadow-sm" : "border-slate-200 shadow-sm"}><CardContent><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{label}</p><p className={`mt-2 text-xl font-black ${highlight ? "text-orange" : "text-slate-950"}`}>{value}</p></CardContent></Card>;
}

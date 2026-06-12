import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getDieRisks } from "@/lib/calculations/operations";
import { formatCurrency, formatDate, formatWeight } from "@/lib/utils/format";
import { DieDetailTabs } from "@/components/modules/dies/die-detail-tabs";
import { DieNitridingForm } from "@/components/modules/dies/die-nitriding-form";
import { TechnicalDocumentUpload } from "@/components/modules/shared/technical-document-upload";
import { GenerateReportButton } from "@/components/modules/shared/generate-report-button";
import { ReportDownloadList } from "@/components/modules/shared/report-download-list";
import { RevisionHistory } from "@/components/modules/shared/revision-history";
function DetailItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <div className="mt-1 text-sm font-bold text-slate-950">{value || <span className="text-slate-400">Not Captured</span>}</div>
    </div>
  );
}

export default async function DieDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "read", "dies")) redirect("/dashboard");

  const supabase = await createClient();
  const { data: die, error } = await supabase
    .from("dies")
    .select("*, aluminium_profiles!dies_profile_id_fkey(profile_code, profile_name, section_weight_kg_per_m, application_category), customers(customer_name, company_name, phone, gst_number)")
    .eq("id", id)
    .eq("company_id", context.companyId)
    .single();

  if (error || !die) {
    return (
      <div className="space-y-4">
        <Link href="/dies" className="inline-flex items-center gap-2 text-sm font-black text-slate-500 transition hover:text-orange"><ArrowLeft className="h-4 w-4" /> Back to Dies</Link>
        <Card><CardContent><p className="font-black text-slate-950">Die not found</p></CardContent></Card>
      </div>
    );
  }

  // Load related data
  const [trialsResult, correctionsResult, nitridingsResult, documentsResult, productionCount] = await Promise.all([
    supabase.from("die_trials").select("*").eq("company_id", context.companyId).eq("die_id", id).order("trial_date", { ascending: false }).limit(50),
    supabase.from("die_corrections").select("*").eq("company_id", context.companyId).eq("die_id", id).order("correction_date", { ascending: false }).limit(50),
    supabase.from("die_nitriding_history").select("*").eq("company_id", context.companyId).eq("die_id", id).order("nitriding_date", { ascending: false }).limit(50),
    supabase.from("technical_documents").select("*").eq("company_id", context.companyId).eq("linked_entity_type", "die").eq("linked_entity_id", id).order("created_at", { ascending: false }).limit(50),
    supabase.from("production_jobs").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).eq("die_id", id),
  ]);

  const customer = die.customers?.company_name || die.customers?.customer_name || "-";
  const profile = die.aluminium_profiles ? `${die.aluminium_profiles.profile_code} · ${die.aluminium_profiles.profile_name}` : "-";
  const risks = getDieRisks(die);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/dies" className="mb-3 inline-flex items-center gap-2 text-sm font-black text-slate-500 transition hover:text-orange"><ArrowLeft className="h-4 w-4" /> Back to Dies</Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-black tracking-tight text-slate-950">Die {die.die_number}</h1>
            <Badge value={die.die_status} />
            <Badge value={die.ownership_type} />
            {die.die_type && <Badge value={die.die_type} />}
            {die.performance_grade && <Badge value={die.performance_grade} />}
          </div>
          <p className="mt-2 text-sm font-medium text-slate-500">Complete die technical identity, performance, trials, corrections, and nitriding history.</p>
        </div>
        {can(context.role, "update", "dies") && (
          <Link href={`/dies/${die.id}/edit`} className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange/20 transition hover:bg-orange/90"><Pencil className="h-4 w-4" /> Edit Die</Link>
        )}
      </div>

      {/* Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <div className="metric-card"><p className="relative z-[1] text-xs font-black uppercase tracking-[0.14em] text-slate-500">Total Production</p><p className="relative z-[1] mt-3 text-2xl font-black text-slate-950">{formatWeight(die.total_production_kg)}</p></div>
        <div className="metric-card"><p className="relative z-[1] text-xs font-black uppercase tracking-[0.14em] text-slate-500">Total Runs</p><p className="relative z-[1] mt-3 text-2xl font-black text-slate-950">{die.total_runs ?? 0}</p></div>
        <div className="metric-card"><p className="relative z-[1] text-xs font-black uppercase tracking-[0.14em] text-slate-500">Recovery</p><p className="relative z-[1] mt-3 text-2xl font-black text-slate-950">{die.average_recovery_percent ? `${die.average_recovery_percent}%` : "Not Captured"}</p></div>
        <div className="metric-card"><p className="relative z-[1] text-xs font-black uppercase tracking-[0.14em] text-slate-500">Last Used</p><p className="relative z-[1] mt-3 text-2xl font-black text-slate-950">{formatDate(die.last_used_date)}</p></div>
        <div className="metric-card"><p className="relative z-[1] text-xs font-black uppercase tracking-[0.14em] text-slate-500">Production Jobs</p><p className="relative z-[1] mt-3 text-2xl font-black text-slate-950">{productionCount.count ?? 0}</p></div>
      </div>

      {/* Risks */}
      {risks.length > 0 && (
        <Card className="border-orange/30 bg-orange/5">
          <CardHeader><h2 className="section-title">Die Attention</h2></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {risks.map((risk) => (
              <div key={risk.label} className="rounded-2xl border border-orange/20 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3"><p className="font-black text-slate-950">{risk.label}</p><Badge value={risk.severity} /></div>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-600">{risk.detail}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {/* Main Details */}
          <Card>
            <CardHeader><h2 className="section-title">Die Identity</h2></CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              <DetailItem label="Die code" value={die.die_code} />
              <DetailItem label="Profile" value={profile} />
              <DetailItem label="Profile weight" value={die.aluminium_profiles?.section_weight_kg_per_m ? `${die.aluminium_profiles.section_weight_kg_per_m} kg/m` : null} />
              <DetailItem label="Die type" value={die.die_type} />
              <DetailItem label="Cavities" value={die.number_of_cavities} />
              <DetailItem label="Priority" value={die.priority_level} />
              <DetailItem label="Customer" value={customer} />
              <DetailItem label="Application" value={die.application_category} />
              <DetailItem label="End-use industry" value={die.end_use_industry} />
              <DetailItem label="Press compatibility" value={die.press_compatibility} />
            </CardContent>
          </Card>

          {/* Geometry */}
          <Card>
            <CardHeader><h2 className="section-title">Geometry & Design</h2></CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              <DetailItem label="Die diameter" value={die.die_diameter_mm ? `${die.die_diameter_mm} mm` : null} />
              <DetailItem label="Die thickness" value={die.die_thickness_mm ? `${die.die_thickness_mm} mm` : null} />
              <DetailItem label="Stack height" value={die.die_stack_height_mm ? `${die.die_stack_height_mm} mm` : null} />
              <DetailItem label="Backer diameter" value={die.backer_diameter_mm ? `${die.backer_diameter_mm} mm` : null} />
              <DetailItem label="Bolster diameter" value={die.bolster_diameter_mm ? `${die.bolster_diameter_mm} mm` : null} />
              <DetailItem label="Bearing length" value={die.bearing_length_mm ? `${die.bearing_length_mm} mm` : null} />
              <DetailItem label="Entry angle" value={die.entry_angle_degrees ? `${die.entry_angle_degrees}°` : null} />
              <DetailItem label="Relief angle" value={die.relief_angle_degrees ? `${die.relief_angle_degrees}°` : null} />
              <DetailItem label="Tongue ratio" value={die.tongue_ratio} />
              <DetailItem label="Extrusion ratio" value={die.extrusion_ratio} />
              <DetailItem label="CCD" value={die.ccd_mm ? `${die.ccd_mm} mm` : null} />
              <DetailItem label="Output per stroke" value={die.output_per_stroke_kg ? `${die.output_per_stroke_kg} kg` : null} />
            </CardContent>
          </Card>

          {/* Material */}
          <Card>
            <CardHeader><h2 className="section-title">Material & Manufacturing</h2></CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              <DetailItem label="Steel grade" value={die.die_steel_grade} />
              <DetailItem label="Manufacturer" value={die.die_manufacturer} />
              <DetailItem label="Die cost" value={die.die_cost ? formatCurrency(die.die_cost) : null} />
              <DetailItem label="Purchase date" value={formatDate(die.purchase_date)} />
              <DetailItem label="Manufacturing date" value={formatDate(die.manufacturing_date)} />
              <DetailItem label="Receipt date" value={formatDate(die.receipt_date)} />
              <DetailItem label="Heat treatment" value={die.heat_treatment_status} />
              <DetailItem label="Hardness before nitriding" value={die.hardness_before_nitriding} />
              <DetailItem label="Hardness after nitriding" value={die.hardness_after_nitriding} />
              <DetailItem label="HRC" value={die.hrc_value} />
              <DetailItem label="HV" value={die.hv_value} />
              <DetailItem label="Dimensional inspection" value={die.dimensional_inspection_status} />
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader><h2 className="section-title">Drawing</h2></CardHeader>
            <CardContent className="space-y-3">
              <DetailItem label="Revision" value={die.drawing_revision} />
              <DetailItem label="Approval" value={die.drawing_approval_status ? <Badge value={die.drawing_approval_status} /> : null} />
              {die.drawing_url ? <a href={die.drawing_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-black text-orange hover:bg-orange/5">Open Drawing</a> : <p className="text-sm text-slate-400">No drawing uploaded</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><h2 className="section-title">Storage & Maintenance</h2></CardHeader>
            <CardContent className="space-y-3">
              <DetailItem label="Rack / location" value={die.rack_location} />
              <DetailItem label="Storage bin" value={die.storage_bin} />
              <DetailItem label="Performance grade" value={die.performance_grade ? <Badge value={die.performance_grade} /> : null} />
              <DetailItem label="Blocked reason" value={die.die_blocked_reason} />
              <DetailItem label="Retirement reason" value={die.die_retirement_reason} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><h2 className="section-title">Connected Records</h2></CardHeader>
            <CardContent className="space-y-3">
              <Link href="/production/database" className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-orange/60"><span className="font-black text-slate-950">Production jobs</span><span className="rounded-full bg-aluminium px-3 py-1 text-xs font-black text-slate-700">{productionCount.count ?? 0}</span></Link>
              <Link href={`/profiles/${die.profile_id}`} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-orange/60"><span className="font-black text-slate-950">Linked profile</span><span className="rounded-full bg-aluminium px-3 py-1 text-xs font-black text-slate-700">{profile}</span></Link>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Tabs for trials, corrections, nitriding, documents */}
      <DieDetailTabs
        trials={trialsResult.data ?? []}
        corrections={correctionsResult.data ?? []}
        nitridings={nitridingsResult.data ?? []}
        documents={documentsResult.data ?? []}
      />

      {/* Actions: Nitriding, Document Upload, Report Generation */}
      {can(context.role, "update", "dies") && (
        <div className="grid gap-6 lg:grid-cols-2">
          <DieNitridingForm context={context} dieId={id} />
          <TechnicalDocumentUpload context={context} entityType="die" entityId={id} />
        </div>
      )}

      <div className="flex gap-3">
        <GenerateReportButton entityType="die" entityId={id} />
      </div>

      <ReportDownloadList context={context} entityType="die" entityId={id} />

      <RevisionHistory context={context} entityType="die" entityId={id} />

      {/* Correction history text */}
      {die.correction_history && (
        <Card>
          <CardHeader><h2 className="section-title">Legacy Correction Notes</h2></CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap rounded-xl bg-aluminium/50 p-4 text-sm font-medium leading-6 text-slate-700">{die.correction_history}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

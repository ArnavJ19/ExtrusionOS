import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatCurrency, formatWeight } from "@/lib/utils/format";
import { ProfileRoutingClient } from "@/components/modules/profiles/profile-routing-client";
import { ProfileQualityPlanClient } from "@/components/modules/profiles/profile-quality-plan-client";
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

export default async function ProfileDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "read", "profiles")) redirect("/dashboard");

  const supabase = await createClient();

  // First try with the enriched FK joins; fall back to basic select if columns don't exist yet
  let profile: Record<string, any> | null = null;
  const enrichedResult = await supabase
    .from("aluminium_profiles")
    .select("*, primary_die:dies!aluminium_profiles_primary_die_id_fkey(die_number, die_status), backup_die:dies!aluminium_profiles_backup_die_id_fkey(die_number, die_status)")
    .eq("id", id)
    .eq("company_id", context.companyId)
    .single();

  if (enrichedResult.error) {
    // Fallback: the FK columns may not exist yet
    const basicResult = await supabase
      .from("aluminium_profiles")
      .select("*")
      .eq("id", id)
      .eq("company_id", context.companyId)
      .single();
    if (basicResult.error || !basicResult.data) {
      return (
        <div className="space-y-4">
          <Link href="/profiles" className="inline-flex items-center gap-2 text-sm font-black text-slate-500 transition hover:text-orange"><ArrowLeft className="h-4 w-4" /> Back to Profiles</Link>
          <Card><CardContent><p className="font-black text-slate-950">Profile not found</p></CardContent></Card>
        </div>
      );
    }
    profile = basicResult.data;
  } else {
    profile = enrichedResult.data;
  }

  if (!profile) {
    return (
      <div className="space-y-4">
        <Link href="/profiles" className="inline-flex items-center gap-2 text-sm font-black text-slate-500 transition hover:text-orange"><ArrowLeft className="h-4 w-4" /> Back to Profiles</Link>
        <Card><CardContent><p className="font-black text-slate-950">Profile not found</p></CardContent></Card>
      </div>
    );
  }

  // Linked data counts
  const [diesCount, productionCount, ordersCount] = await Promise.all([
    supabase.from("dies").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).eq("profile_id", id),
    supabase.from("production_jobs").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).eq("profile_id", id),
    supabase.from("quote_items").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).eq("profile_id", id),
  ]);

  const primaryDie = profile.primary_die as any;
  const backupDie = profile.backup_die as any;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/profiles" className="mb-3 inline-flex items-center gap-2 text-sm font-black text-slate-500 transition hover:text-orange"><ArrowLeft className="h-4 w-4" /> Back to Profiles</Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-black tracking-tight text-slate-950">{profile.profile_code} · {profile.profile_name}</h1>
            <Badge value={profile.approval_status ?? "draft"} />
            <Badge value={profile.is_active ? "active" : "inactive"} />
          </div>
          <p className="mt-2 text-sm font-medium text-slate-500">Complete technical identity for this section/profile.</p>
        </div>
        {can(context.role, "update", "profiles") && (
          <Link href={`/profiles/${id}/edit`} className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange/20 transition hover:bg-orange/90"><Pencil className="h-4 w-4" /> Edit Profile</Link>
        )}
      </div>

      {/* Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <div className="metric-card"><p className="relative z-[1] text-xs font-black uppercase tracking-[0.14em] text-slate-500">Weight kg/m</p><p className="relative z-[1] mt-3 text-2xl font-black text-slate-950">{profile.section_weight_kg_per_m ? `${profile.section_weight_kg_per_m}` : "Not Captured"}</p></div>
        <div className="metric-card"><p className="relative z-[1] text-xs font-black uppercase tracking-[0.14em] text-slate-500">Recovery Target</p><p className="relative z-[1] mt-3 text-2xl font-black text-slate-950">{profile.recovery_target_percent ? `${profile.recovery_target_percent}%` : "Not Captured"}</p></div>
        <div className="metric-card"><p className="relative z-[1] text-xs font-black uppercase tracking-[0.14em] text-slate-500">Dies Linked</p><p className="relative z-[1] mt-3 text-2xl font-black text-slate-950">{diesCount.count ?? 0}</p></div>
        <div className="metric-card"><p className="relative z-[1] text-xs font-black uppercase tracking-[0.14em] text-slate-500">Production Jobs</p><p className="relative z-[1] mt-3 text-2xl font-black text-slate-950">{productionCount.count ?? 0}</p></div>
        <div className="metric-card"><p className="relative z-[1] text-xs font-black uppercase tracking-[0.14em] text-slate-500">Quote Lines</p><p className="relative z-[1] mt-3 text-2xl font-black text-slate-950">{ordersCount.count ?? 0}</p></div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {/* Engineering Details */}
          <Card>
            <CardHeader><h2 className="section-title">Engineering & Geometry</h2></CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              <DetailItem label="Classification" value={<Badge value={profile.profile_classification ?? "solid"} />} />
              <DetailItem label="Complexity" value={<Badge value={profile.complexity_rating ?? "standard"} />} />
              <DetailItem label="CCD (mm)" value={profile.circumscribing_circle_diameter_mm} />
              <DetailItem label="Nominal wall (mm)" value={profile.nominal_wall_thickness_mm} />
              <DetailItem label="Min wall (mm)" value={profile.min_wall_thickness_mm} />
              <DetailItem label="Max wall (mm)" value={profile.max_wall_thickness_mm} />
              <DetailItem label="Section perimeter (mm)" value={profile.section_perimeter_mm} />
              <DetailItem label="Voids" value={profile.number_of_voids} />
              <DetailItem label="Tolerance class" value={profile.tolerance_class} />
              <DetailItem label="Standard length (m)" value={profile.standard_length_m} />
              <DetailItem label="Min cut length (m)" value={profile.min_cutting_length_m} />
              <DetailItem label="Max cut length (m)" value={profile.max_cutting_length_m} />
            </CardContent>
          </Card>

          {/* Alloy & Mechanical */}
          <Card>
            <CardHeader><h2 className="section-title">Alloy, Temper & Mechanical Properties</h2></CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              <DetailItem label="Alloy" value={profile.alloy} />
              <DetailItem label="Temper" value={profile.temper} />
              <DetailItem label="Recommended alloy" value={profile.recommended_alloy} />
              <DetailItem label="Temper requirement" value={profile.temper_requirement} />
              <DetailItem label="Tensile (MPa)" value={profile.tensile_strength_mpa} />
              <DetailItem label="Yield (MPa)" value={profile.yield_strength_mpa} />
              <DetailItem label="Elongation %" value={profile.elongation_percent} />
            </CardContent>
          </Card>

          {/* Production Parameters */}
          <Card>
            <CardHeader><h2 className="section-title">Production Parameters</h2></CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              <DetailItem label="Recommended press" value={profile.recommended_press} />
              <DetailItem label="Billet diameter" value={profile.billet_diameter_mm ? `${profile.billet_diameter_mm} mm` : profile.billet_diameter_required_inch ? `${profile.billet_diameter_required_inch} in` : null} />
              <DetailItem label="Billet alloy" value={profile.billet_alloy} />
              <DetailItem label="Billet temp range" value={profile.billet_temperature_range} />
              <DetailItem label="Container temp range" value={profile.container_temperature_range} />
              <DetailItem label="Die temp range" value={profile.die_temperature_range} />
              <DetailItem label="Ram speed range" value={profile.ram_speed_range} />
              <DetailItem label="Exit temp range" value={profile.exit_temperature_range} />
              <DetailItem label="Quench method" value={profile.quench_method} />
              <DetailItem label="Stretching" value={profile.stretching_requirement} />
              <DetailItem label="Aging" value={profile.aging_requirement} />
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader><h2 className="section-title">Die Linkage</h2></CardHeader>
            <CardContent className="space-y-3">
              <DetailItem label="Primary die" value={primaryDie ? <Link href={`/dies`} className="text-orange hover:underline">{primaryDie.die_number} ({primaryDie.die_status})</Link> : null} />
              <DetailItem label="Backup die" value={backupDie ? <Link href={`/dies`} className="text-orange hover:underline">{backupDie.die_number} ({backupDie.die_status})</Link> : null} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><h2 className="section-title">Surface Treatment</h2></CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: "Mill finish", allowed: profile.mill_finish_allowed },
                { label: "Powder coating", allowed: profile.powder_coating_allowed },
                { label: "Anodizing", allowed: profile.anodizing_allowed },
                { label: "Wood finish", allowed: profile.wood_finish_allowed },
                { label: "PVDF", allowed: profile.pvdf_allowed },
                { label: "Special", allowed: profile.special_finish_allowed },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                  <span className="text-sm font-bold text-slate-700">{item.label}</span>
                  <Badge value={item.allowed ? "allowed" : "not_allowed"} />
                </div>
              ))}
              <DetailItem label="Coating thickness" value={profile.coating_thickness_microns ? `${profile.coating_thickness_microns} µm` : null} />
              <DetailItem label="Anodizing requirement" value={profile.anodizing_micron_requirement ? `${profile.anodizing_micron_requirement} µm` : null} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><h2 className="section-title">Costing</h2></CardHeader>
            <CardContent className="space-y-3">
              <DetailItem label="Base rate" value={profile.base_rate_per_kg ? formatCurrency(profile.base_rate_per_kg) + "/kg" : null} />
              <DetailItem label="Production cost" value={profile.production_cost_per_kg ? formatCurrency(profile.production_cost_per_kg) + "/kg" : null} />
              <DetailItem label="Packing cost" value={profile.packing_cost_per_kg ? formatCurrency(profile.packing_cost_per_kg) + "/kg" : null} />
              <DetailItem label="Energy cost" value={profile.energy_cost_per_kg ? formatCurrency(profile.energy_cost_per_kg) + "/kg" : null} />
              <DetailItem label="Min order qty" value={profile.minimum_order_quantity_kg ? formatWeight(profile.minimum_order_quantity_kg) : null} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><h2 className="section-title">Drawing & Documents</h2></CardHeader>
            <CardContent className="space-y-3">
              <DetailItem label="Drawing revision" value={profile.drawing_revision} />
              <DetailItem label="Drawing status" value={profile.drawing_approval_status ? <Badge value={profile.drawing_approval_status} /> : null} />
              {profile.drawing_url ? <a href={profile.drawing_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-black text-orange hover:bg-orange/5">Open Drawing</a> : <p className="text-sm font-medium text-slate-400">No drawing uploaded</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><h2 className="section-title">Connected Records</h2></CardHeader>
            <CardContent className="space-y-3">
              <Link href="/dies/database" className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-orange/60"><span className="font-black text-slate-950">Dies</span><span className="rounded-full bg-aluminium px-3 py-1 text-xs font-black text-slate-700">{diesCount.count ?? 0}</span></Link>
              <Link href="/production/database" className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-orange/60"><span className="font-black text-slate-950">Production jobs</span><span className="rounded-full bg-aluminium px-3 py-1 text-xs font-black text-slate-700">{productionCount.count ?? 0}</span></Link>
              <Link href="/quotes/database" className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-orange/60"><span className="font-black text-slate-950">Quote items</span><span className="rounded-full bg-aluminium px-3 py-1 text-xs font-black text-slate-700">{ordersCount.count ?? 0}</span></Link>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Notes section */}
      {(profile.cutting_instructions || profile.handling_instructions || profile.special_production_notes || profile.notes) && (
        <Card>
          <CardHeader><h2 className="section-title">Instructions & Notes</h2></CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            {profile.cutting_instructions && <div><p className="text-xs font-black uppercase text-slate-500">Cutting Instructions</p><p className="mt-1 whitespace-pre-wrap rounded-xl bg-aluminium/50 p-3 text-sm text-slate-700">{profile.cutting_instructions}</p></div>}
            {profile.handling_instructions && <div><p className="text-xs font-black uppercase text-slate-500">Handling Instructions</p><p className="mt-1 whitespace-pre-wrap rounded-xl bg-aluminium/50 p-3 text-sm text-slate-700">{profile.handling_instructions}</p></div>}
            {profile.special_production_notes && <div><p className="text-xs font-black uppercase text-slate-500">Special Production Notes</p><p className="mt-1 whitespace-pre-wrap rounded-xl bg-aluminium/50 p-3 text-sm text-slate-700">{profile.special_production_notes}</p></div>}
            {profile.notes && <div><p className="text-xs font-black uppercase text-slate-500">Notes</p><p className="mt-1 whitespace-pre-wrap rounded-xl bg-aluminium/50 p-3 text-sm text-slate-700">{profile.notes}</p></div>}
          </CardContent>
        </Card>
      )}

      {/* Production Routing */}
      <ProfileRoutingClient context={context} profileId={id} />

      {/* Quality Inspection Plan */}
      <ProfileQualityPlanClient context={context} profileId={id} />

      {/* Document Upload & Report Generation */}
      {can(context.role, "update", "profiles") && (
        <TechnicalDocumentUpload context={context} entityType="profile" entityId={id} />
      )}

      <div className="flex gap-3">
        <GenerateReportButton entityType="profile" entityId={id} />
      </div>

      <ReportDownloadList context={context} entityType="profile" entityId={id} />

      <RevisionHistory context={context} entityType="profile" entityId={id} />
    </div>
  );
}

import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { labelize, systemConfiguratorSystemTypes } from "@/types/app";
import { createFinishOption, createGlassItem, createHardwareItem, createSystemProfile, createSystemSeries } from "@/lib/systems-configurator/actions";
import { getLibraryReadiness, type DataReadinessSummary } from "@/lib/systems-configurator/data-readiness";

const componentRoles = ["outer_frame_top", "outer_frame_bottom", "outer_frame_left", "outer_frame_right", "sill", "threshold", "shutter_vertical", "shutter_horizontal_top", "shutter_horizontal_bottom", "sash_vertical", "sash_horizontal", "interlock", "meeting_stile", "lock_stile", "mullion", "transom", "coupler", "add_on", "adapter", "reinforcement", "support_profile", "glazing_bead_vertical", "glazing_bead_horizontal", "mesh_frame_vertical", "mesh_frame_horizontal", "track_profile", "cover_profile", "custom"];
const hardwareCategories = ["lock", "handle", "roller", "hinge", "stay_arm", "tower_bolt", "fastener", "screw", "gasket", "wool_pile", "weather_strip", "silicone", "drainage_cap", "corner_cleat", "connector", "accessory", "other"];
const glassTypes = ["clear", "toughened", "laminated", "frosted", "tinted", "reflective", "low_e", "dgu", "textured", "custom"];
const finishTypes = ["mill_finish", "powder_coating", "anodizing", "wood_finish", "pvdf", "custom"];
const finishRateTypes = ["per_kg", "per_sqft", "per_sqm", "per_meter", "fixed"];

type LibraryManagerProps = {
  canManage: boolean;
  series: any[];
  profiles: any[];
  systemProfiles: any[];
  hardwareItems: any[];
  glassItems: any[];
  finishOptions: any[];
  vendors: any[];
};

function inputClass() {
  return "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none transition focus:border-orange focus:ring-2 focus:ring-orange/10";
}

function SelectOptions({ values }: { values: string[] }) {
  return values.map((value) => <option key={value} value={value}>{labelize(value)}</option>);
}

function EmptyRow({ label }: { label: string }) {
  return <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-sm font-semibold text-slate-500">No {label} yet.</p>;
}

function FormCard({ title, description, action, children }: { title: string; description: string; action: (formData: FormData) => void | Promise<void>; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <h3 className="font-black tracking-tight text-slate-950">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-3 md:grid-cols-2">
          {children}
          <div className="md:col-span-2"><Button type="submit" className="w-full"><Plus className="h-4 w-4" /> Add {title}</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

function ReadOnlyNotice() {
  return <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">You can view configurator libraries. Owner, admin, and sales manager roles can manage master setup.</div>;
}

export function SystemsLibraryManager({ canManage, series, profiles, systemProfiles, hardwareItems, glassItems, finishOptions, vendors }: LibraryManagerProps) {
  const readiness = getLibraryReadiness({ systemProfiles, hardwareItems, glassItems, finishOptions });
  return (
    <div className="space-y-6">
      {!canManage ? <ReadOnlyNotice /> : null}
      <LibraryReadinessPanel summary={readiness} counts={{ series: series.length, profiles: systemProfiles.length, hardware: hardwareItems.length, glass: glassItems.length, finish: finishOptions.length }} />

      {canManage ? (
        <section className="grid gap-4 xl:grid-cols-2">
          <FormCard title="System Series" description="Define aluminium system families such as 2-track economy or premium casement." action={createSystemSeries}>
            <input name="series_code" className={inputClass()} placeholder="Series code, e.g. SL-2T-ECO" required />
            <input name="series_name" className={inputClass()} placeholder="Series name" required />
            <select name="system_type" className={inputClass()} required><SelectOptions values={systemConfiguratorSystemTypes} /></select>
            <input name="stock_length_mm" type="number" className={inputClass()} defaultValue="6000" placeholder="Stock length mm" />
            <input name="default_alloy" className={inputClass()} placeholder="Default alloy, e.g. 6063" />
            <input name="default_temper" className={inputClass()} placeholder="Default temper, e.g. T6" />
            <input name="default_finish" className={inputClass()} placeholder="Default finish" />
            <input name="wastage_percent_default" type="number" step="0.01" className={inputClass()} defaultValue="5" placeholder="Wastage %" />
            <textarea name="description" className={`${inputClass()} md:col-span-2`} placeholder="Description" />
          </FormCard>

          <FormCard title="Profile Role" description="Map existing aluminium profiles to functional roles inside a system." action={createSystemProfile}>
            <select name="series_id" className={inputClass()} required><option value="">Select series</option>{series.map((item) => <option key={item.id} value={item.id}>{item.series_code} - {item.series_name}</option>)}</select>
            <select name="profile_id" className={inputClass()} required><option value="">Select profile</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.profile_code} - {item.profile_name}</option>)}</select>
            <select name="component_role" className={inputClass()} required><SelectOptions values={componentRoles} /></select>
            <input name="display_name" className={inputClass()} placeholder="Display name, e.g. Bottom sill" required />
            <input name="default_quantity_formula" className={inputClass()} defaultValue="1 * Q" placeholder="Quantity formula" />
            <input name="default_length_formula" className={inputClass()} defaultValue="W" placeholder="Length formula" />
            <input name="deduction_mm" type="number" step="0.01" className={inputClass()} defaultValue="0" placeholder="Deduction mm" />
            <input name="addition_mm" type="number" step="0.01" className={inputClass()} defaultValue="0" placeholder="Addition mm" />
            <input name="applies_to_system_types" className={`${inputClass()} md:col-span-2`} placeholder="Optional system types, comma separated" />
          </FormCard>

          <FormCard title="Hardware Item" description="Build lock, handle, roller, hinge, gasket, screw, and accessory master data." action={createHardwareItem}>
            <input name="item_code" className={inputClass()} placeholder="Item code" required />
            <input name="item_name" className={inputClass()} placeholder="Item name" required />
            <select name="hardware_category" className={inputClass()} required><SelectOptions values={hardwareCategories} /></select>
            <input name="unit" className={inputClass()} defaultValue="pcs" placeholder="Unit" />
            <input name="default_rate" type="number" step="0.01" className={inputClass()} defaultValue="0" placeholder="Default rate" />
            <input name="brand" className={inputClass()} placeholder="Brand" />
            <input name="finish" className={inputClass()} placeholder="Finish" />
            <input name="image_url" className={inputClass()} placeholder="Image URL" />
            <textarea name="description" className={`${inputClass()} md:col-span-2`} placeholder="Description" />
          </FormCard>

          <FormCard title="Glass Item" description="Maintain glass types, thickness, composition, and sqft/sqm rates." action={createGlassItem}>
            <input name="glass_code" className={inputClass()} placeholder="Glass code" required />
            <input name="glass_name" className={inputClass()} placeholder="Glass name" required />
            <select name="glass_type" className={inputClass()} required><SelectOptions values={glassTypes} /></select>
            <input name="thickness_mm" type="number" step="0.01" className={inputClass()} defaultValue="5" placeholder="Thickness mm" />
            <input name="rate_per_sqft" type="number" step="0.01" className={inputClass()} defaultValue="0" placeholder="Rate per sqft" />
            <input name="rate_per_sqm" type="number" step="0.01" className={inputClass()} defaultValue="0" placeholder="Rate per sqm" />
            <input name="composition" className={`${inputClass()} md:col-span-2`} placeholder="Composition, e.g. 6mm toughened" />
          </FormCard>

          <FormCard title="Finish Option" description="Configure powder coating, anodizing, wood finish, PVDF, and custom rates." action={createFinishOption}>
            <input name="finish_code" className={inputClass()} placeholder="Finish code" required />
            <input name="finish_name" className={inputClass()} placeholder="Finish name" required />
            <select name="finish_type" className={inputClass()} required><SelectOptions values={finishTypes} /></select>
            <select name="rate_type" className={inputClass()} required><SelectOptions values={finishRateTypes} /></select>
            <input name="rate" type="number" step="0.01" className={inputClass()} defaultValue="0" placeholder="Rate" />
            <input name="color_code" className={inputClass()} placeholder="Color code" />
            <select name="vendor_id" className={`${inputClass()} md:col-span-2`}><option value="">No vendor</option>{vendors.map((item) => <option key={item.id} value={item.id}>{item.vendor_name}</option>)}</select>
          </FormCard>
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-2">
        <Card><CardHeader><h3 className="font-black text-slate-950">System Series</h3></CardHeader><CardContent className="space-y-3">{series.length ? series.map((item) => <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black text-slate-950">{item.series_code} - {item.series_name}</p><p className="text-sm text-slate-500">{labelize(item.system_type)} · Stock {item.stock_length_mm}mm · Wastage {item.wastage_percent_default}%</p></div><Badge value={item.is_active ? "active" : "inactive"} /></div></div>) : <EmptyRow label="series" />}</CardContent></Card>
        <Card><CardHeader><h3 className="font-black text-slate-950">Profile Role Mapping</h3></CardHeader><CardContent className="space-y-3">{systemProfiles.length ? systemProfiles.map((item) => <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4"><p className="font-black text-slate-950">{labelize(item.component_role)} · {item.display_name}</p><p className="text-sm text-slate-500">{item.system_series?.series_code ?? "Series"} · {item.aluminium_profiles?.profile_code ?? "Profile"} · Qty `{item.default_quantity_formula}` · Length `{item.default_length_formula}`</p></div>) : <EmptyRow label="profile mappings" />}</CardContent></Card>
        <Card><CardHeader><h3 className="font-black text-slate-950">Hardware Items</h3></CardHeader><CardContent className="space-y-3">{hardwareItems.length ? hardwareItems.map((item) => <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4"><p className="font-black text-slate-950">{item.item_code} - {item.item_name}</p><p className="text-sm text-slate-500">{labelize(item.hardware_category)} · {item.unit} · Rs. {item.default_rate}</p></div>) : <EmptyRow label="hardware items" />}</CardContent></Card>
        <Card><CardHeader><h3 className="font-black text-slate-950">Glass Items</h3></CardHeader><CardContent className="space-y-3">{glassItems.length ? glassItems.map((item) => <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4"><p className="font-black text-slate-950">{item.glass_code} - {item.glass_name}</p><p className="text-sm text-slate-500">{labelize(item.glass_type)} · {item.thickness_mm}mm · Rs. {item.rate_per_sqft}/sqft</p></div>) : <EmptyRow label="glass items" />}</CardContent></Card>
        <Card className="xl:col-span-2"><CardHeader><h3 className="font-black text-slate-950">Finish Options</h3></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">{finishOptions.length ? finishOptions.map((item) => <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4"><p className="font-black text-slate-950">{item.finish_code} - {item.finish_name}</p><p className="text-sm text-slate-500">{labelize(item.finish_type)} · {labelize(item.rate_type)} · Rs. {item.rate}</p></div>) : <EmptyRow label="finish options" />}</CardContent></Card>
      </section>
    </div>
  );
}

function LibraryReadinessPanel({ summary, counts }: { summary: DataReadinessSummary; counts: Record<string, number> }) {
  const className = summary.status === "critical" ? "border-red-200 bg-red-50" : summary.status === "warning" ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50";
  return (
    <Card className={className}>
      <CardHeader><h3 className="font-black text-slate-950">Production Data Readiness</h3><p className="text-sm font-bold text-slate-600">{summary.status === "ready" ? "Libraries are ready for production calculations." : `${summary.criticalCount} critical issue${summary.criticalCount === 1 ? "" : "s"}, ${summary.warningCount} warning${summary.warningCount === 1 ? "" : "s"}`}</p></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-5"><MiniMetric label="Series" value={counts.series} /><MiniMetric label="Role Maps" value={counts.profiles} /><MiniMetric label="Hardware" value={counts.hardware} /><MiniMetric label="Glass" value={counts.glass} /><MiniMetric label="Finish" value={counts.finish} /></div>
        {summary.issues.length ? <div className="grid gap-2 md:grid-cols-2">{summary.issues.slice(0, 8).map((issue) => <p key={`${issue.code}-${issue.message}`} className="rounded-xl bg-white/70 px-3 py-2 text-sm font-bold leading-5 text-slate-700"><span className="font-black text-slate-950">{labelize(issue.area)}:</span> {issue.message}</p>)}</div> : null}
      </CardContent>
    </Card>
  );
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl border border-white/70 bg-white/70 px-3 py-2"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p><p className="mt-1 text-xl font-black text-slate-950">{value}</p></div>;
}

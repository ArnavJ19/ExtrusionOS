"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, Calculator, CheckCircle2, FileText, Layers, Ruler, Save, Settings2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { saveSystemConfigurationDraft } from "@/lib/systems-configurator/actions";
import { getConfigurationDataReadiness, type DataReadinessSummary } from "@/lib/systems-configurator/data-readiness";
import { labelize, systemConfiguratorSystemTypes } from "@/types/app";
import { SystemElevationPreview } from "./system-elevation-preview";

type ConfiguratorFormProps = {
  customers: any[];
  series: any[];
  templates: any[];
  systemProfiles: any[];
  hardwareItems: any[];
  glassItems: any[];
  finishOptions: any[];
  initialConfiguration?: any;
  action?: (formData: FormData) => void | Promise<void>;
  submitLabel?: string;
};

const measurementTypes = ["brick_to_brick", "frame_outer_size", "finished_size", "manufacturing_size"];
const viewDirections = ["inside_view", "outside_view"];

const systemDefaults: Record<string, { panelCount: number; trackCount: number; title: string }> = {
  two_track_sliding_window: { panelCount: 2, trackCount: 2, title: "2 Track Sliding Window" },
  three_track_sliding_window: { panelCount: 3, trackCount: 3, title: "3 Track Sliding Window" },
  sliding_door: { panelCount: 2, trackCount: 2, title: "Sliding Door" },
  casement_window: { panelCount: 1, trackCount: 1, title: "Casement Window" },
  fixed_window: { panelCount: 1, trackCount: 1, title: "Fixed Window" },
  top_hung_window: { panelCount: 1, trackCount: 1, title: "Top Hung Window" },
  hinged_door: { panelCount: 1, trackCount: 1, title: "Hinged Door" },
  swing_door: { panelCount: 1, trackCount: 1, title: "Swing Door" },
  partition: { panelCount: 2, trackCount: 1, title: "Partition" },
  ventilator: { panelCount: 1, trackCount: 1, title: "Ventilator" },
  combination: { panelCount: 3, trackCount: 1, title: "Combination" },
  custom: { panelCount: 2, trackCount: 1, title: "Custom System" }
};

function inputClass() {
  return "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-orange focus:ring-2 focus:ring-orange/10";
}

function StepBadge({ number, title, active, complete }: { number: number; title: string; active?: boolean; complete?: boolean }) {
  return <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] ${active ? "border-orange bg-orange/10 text-orange" : complete ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500"}`}>{complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span>{number}.</span>} {title}</div>;
}

function toPositiveNumber(value: string, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function toBoundedInt(value: string, fallback: number, min: number, max: number) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function defaultSeriesId(series: any[], systemType: string) {
  return series.find((item) => item.system_type === systemType)?.id ?? series.find((item) => item.system_type === "custom")?.id ?? "";
}

function compatibleTemplates(templates: any[], systemType: string, seriesId: string) {
  return templates.filter((item) => item.system_type === systemType && (!item.series_id || item.series_id === seriesId));
}

function defaultTemplateId(templates: any[], systemType: string, seriesId: string) {
  const matches = compatibleTemplates(templates, systemType, seriesId);
  return matches.find((item) => item.is_default)?.id ?? matches[0]?.id ?? "";
}

function extractTemplateRoles(template: any) {
  const formula = template?.formula_json && typeof template.formula_json === "object" ? template.formula_json : {};
  const required = Array.isArray(formula.requiredComponents) ? formula.requiredComponents : [];
  const rules = Array.isArray(formula.profileRules) ? formula.profileRules : [];
  return Array.from(new Set([...required, ...rules.map((rule: any) => rule.componentRole ?? rule.component_role)].filter(Boolean))) as string[];
}

export function ConfiguratorForm({ customers, series, templates, systemProfiles, hardwareItems, glassItems, finishOptions, initialConfiguration, action = saveSystemConfigurationDraft, submitLabel = "Save Draft" }: ConfiguratorFormProps) {
  const initialOptions = initialConfiguration?.options_json && typeof initialConfiguration.options_json === "object" ? initialConfiguration.options_json : {};
  const initialLayout = initialConfiguration?.panel_layout_json && typeof initialConfiguration.panel_layout_json === "object" ? initialConfiguration.panel_layout_json : null;
  const initialPanels = Array.isArray(initialLayout?.panels) ? initialLayout.panels : [];
  const initialSystemType = initialConfiguration?.system_type ?? "two_track_sliding_window";
  const initialSeriesId = initialConfiguration?.series_id ?? defaultSeriesId(series, initialSystemType);
  const initialTemplateId = initialConfiguration?.template_id ?? defaultTemplateId(templates, initialSystemType, initialSeriesId);
  const [systemType, setSystemType] = useState(initialSystemType);
  const [selectedSeriesId, setSelectedSeriesId] = useState(initialSeriesId);
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialTemplateId);
  const [widthMm, setWidthMm] = useState(Number(initialConfiguration?.width_mm ?? 1500));
  const [heightMm, setHeightMm] = useState(Number(initialConfiguration?.height_mm ?? 1200));
  const [quantity, setQuantity] = useState(Number(initialConfiguration?.quantity ?? 1));
  const [panelCount, setPanelCount] = useState(Number(initialOptions.panel_count ?? initialConfiguration?.no_of_panels ?? initialPanels.length ?? systemDefaults[initialSystemType]?.panelCount ?? 2));
  const [trackCount, setTrackCount] = useState(Number(initialOptions.track_count ?? systemDefaults[initialSystemType]?.trackCount ?? 1));
  const [meshEnabled, setMeshEnabled] = useState(Boolean(initialOptions.mesh_enabled ?? initialLayout?.mesh?.enabled ?? false));
  const [viewDirection, setViewDirection] = useState(initialConfiguration?.view_direction ?? "inside_view");
  const [selectedGlassId, setSelectedGlassId] = useState(initialConfiguration?.glass_id ?? "");
  const [selectedFinishId, setSelectedFinishId] = useState(initialConfiguration?.finish_id ?? "");
  const [layoutTouched, setLayoutTouched] = useState(false);

  const matchingSeries = series.filter((item) => item.system_type === systemType || item.system_type === "custom");
  const matchingTemplates = compatibleTemplates(templates, systemType, selectedSeriesId);
  const selectedSeries = (matchingSeries.length ? matchingSeries : series).find((item) => item.id === selectedSeriesId);
  const selectedTemplate = matchingTemplates.find((item) => item.id === selectedTemplateId) ?? templates.find((item) => item.id === selectedTemplateId);
  const profileMappings = systemProfiles.filter((item) => item.series_id === selectedSeriesId && item.is_active !== false);
  const requiredTemplateRoles = extractTemplateRoles(selectedTemplate);
  const missingRequiredRoles = requiredTemplateRoles.filter((role) => !profileMappings.some((profile) => profile.component_role === role));
  const mappedRoleCount = new Set(profileMappings.map((profile) => profile.component_role)).size;
  const isSliding = systemType.includes("sliding");
  const isDoor = systemType.includes("door");
  const safeWidthMm = Number.isFinite(widthMm) && widthMm > 0 ? widthMm : 0;
  const safeHeightMm = Number.isFinite(heightMm) && heightMm > 0 ? heightMm : 0;
  const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  const safePanelCount = Number.isFinite(panelCount) && panelCount > 0 ? Math.min(12, Math.max(1, Math.round(panelCount))) : systemDefaults[systemType]?.panelCount ?? 1;
  const safeTrackCount = Number.isFinite(trackCount) && trackCount > 0 ? Math.min(6, Math.max(1, Math.round(trackCount))) : systemDefaults[systemType]?.trackCount ?? 1;
  const dataReadiness = getConfigurationDataReadiness({ seriesId: selectedSeriesId, template: selectedTemplate, systemProfiles, hardwareItems, glassItems, finishOptions, glassId: selectedGlassId, finishId: selectedFinishId });
  const formWarnings = [
    safeWidthMm <= 0 ? "Width must be greater than 0 mm." : null,
    safeHeightMm <= 0 ? "Height must be greater than 0 mm." : null,
    !matchingSeries.length ? "No active series matches this system type." : null,
    selectedSeriesId && selectedTemplateId && missingRequiredRoles.length ? `${missingRequiredRoles.length} required profile role${missingRequiredRoles.length === 1 ? "" : "s"} missing for the selected template.` : null,
    selectedSeriesId && !profileMappings.length ? "Selected series has no active profile-role mappings." : null,
    ...dataReadiness.issues.slice(0, 5).map((issue) => issue.message)
  ].filter(Boolean) as string[];
  const configurationNumber = initialConfiguration?.configuration_number ?? "New Draft";
  const status = initialConfiguration?.status ?? "draft";
  const projectName = initialConfiguration?.project_name || "New aluminium system";
  const designReference = initialConfiguration?.design_reference ?? "W01";

  const layout = useMemo<any>(() => {
    if (!layoutTouched && initialLayout && initialPanels.length) return initialLayout;
    const panels = Array.from({ length: safePanelCount }).map((_, index) => {
      const type = meshEnabled && index === safePanelCount - 1 ? "mesh" : isSliding ? "sliding" : isDoor ? "door_leaf" : systemType === "fixed_window" ? "fixed" : systemType === "top_hung_window" ? "top_hung" : "casement";
      return {
        index: index + 1,
        type,
        function: type === "mesh" ? "mesh" : "glass",
        widthRatio: 1 / safePanelCount,
        heightRatio: 1,
        openingDirection: type === "fixed" ? "fixed" : isSliding ? (index % 2 === 0 ? "sliding_left" : "sliding_right") : type === "top_hung" ? "top" : index % 2 === 0 ? "left" : "right"
      };
    });
    return { panels, mullions: [], transoms: [], mesh: { enabled: meshEnabled, panelIndex: meshEnabled ? safePanelCount : undefined } };
  }, [initialLayout, initialPanels.length, isDoor, isSliding, layoutTouched, meshEnabled, safePanelCount, systemType]);

  const options = useMemo(() => ({
    ...initialOptions,
    track_count: safeTrackCount,
    panel_count: safePanelCount,
    mesh_enabled: meshEnabled,
    frame_deduction: Number(initialOptions.frame_deduction ?? 0),
    sash_deduction: Number(initialOptions.sash_deduction ?? (isSliding ? 85 : 60)),
    glass_deduction_width: Number(initialOptions.glass_deduction_width ?? 90),
    glass_deduction_height: Number(initialOptions.glass_deduction_height ?? 90),
    overlap_mm: Number(initialOptions.overlap_mm ?? (isSliding ? 40 : 0)),
    clearance_mm: Number(initialOptions.clearance_mm ?? 5)
  }), [initialOptions, isSliding, meshEnabled, safePanelCount, safeTrackCount]);

  function applySystemType(value: string) {
    setSystemType(value);
    setLayoutTouched(true);
    const defaults = systemDefaults[value] ?? systemDefaults.custom;
    const nextSeriesId = defaultSeriesId(series, value);
    const nextTemplateId = defaultTemplateId(templates, value, nextSeriesId);
    setSelectedSeriesId(nextSeriesId);
    setSelectedTemplateId(nextTemplateId);
    setPanelCount(defaults.panelCount);
    setTrackCount(defaults.trackCount);
    setMeshEnabled(false);
  }

  function applySeries(value: string) {
    setSelectedSeriesId(value);
    setSelectedTemplateId(defaultTemplateId(templates, systemType, value));
  }

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="panel_layout_json" value={JSON.stringify(layout)} />
      <input type="hidden" name="options_json" value={JSON.stringify(options)} />
      <div className="rounded-3xl border border-slate-200 bg-[linear-gradient(135deg,#ffffff,#f8fafc)] p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-charcoal px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-white">{configurationNumber}</span><span className="rounded-full bg-orange/10 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-orange">{labelize(status)}</span></div>
            <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950">Aluminium Systems Configurator</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">Configure, preview, calculate, and prepare production outputs for aluminium doors/windows.</p>
          </div>
          <div className="grid gap-2 text-sm sm:grid-cols-3 lg:min-w-[520px]">
            <HeaderMetric label="Project" value={projectName} />
            <HeaderMetric label="Design" value={designReference} />
            <HeaderMetric label="System" value={systemDefaults[systemType]?.title ?? labelize(systemType)} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-3xl border border-slate-200 bg-white/80 p-3 shadow-sm">
        <StepBadge number={1} title="Project" complete={Boolean(projectName)} />
        <StepBadge number={2} title="Product" active />
        <StepBadge number={3} title="Size/Layout" complete={safeWidthMm > 0 && safeHeightMm > 0} />
        <StepBadge number={4} title="Profiles" complete={Boolean(selectedSeries) && missingRequiredRoles.length === 0} />
        <StepBadge number={5} title="Glass" complete={Boolean(selectedGlassId)} />
        <StepBadge number={6} title="Finish" complete={Boolean(selectedFinishId)} />
        <StepBadge number={7} title="Costing" complete={dataReadiness.status === "ready"} />
        <StepBadge number={8} title="Review" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(420px,1fr)_330px]">
        <div className="space-y-4">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3"><h3 className="flex items-center gap-2 font-black text-slate-950"><FileText className="h-5 w-5 text-orange" /> Project</h3><p className="text-sm font-semibold text-slate-500">Name the opening and link a customer if needed.</p></CardHeader>
            <CardContent className="space-y-3">
              <LabeledField label="Project name"><input name="project_name" className={inputClass()} placeholder="e.g. Villa sliding windows" defaultValue={initialConfiguration?.project_name ?? ""} required /></LabeledField>
              <LabeledField label="Customer"><select name="customer_id" className={inputClass()} defaultValue={initialConfiguration?.customer_id ?? ""}><option value="">Walk-in / no customer linked</option>{customers.map((item) => <option key={item.id} value={item.id}>{item.customer_name}{item.company_name ? ` - ${item.company_name}` : ""}</option>)}</select></LabeledField>
              <div className="grid grid-cols-2 gap-3">
                <LabeledField label="Design ref"><input name="design_reference" className={inputClass()} defaultValue={initialConfiguration?.design_reference ?? "W01"} placeholder="W01" required /></LabeledField>
                <LabeledField label="Location"><input name="location_label" className={inputClass()} defaultValue={initialConfiguration?.location_label ?? ""} placeholder="Living" /></LabeledField>
              </div>
              <textarea name="notes" className={`${inputClass()} h-auto min-h-20 py-3`} defaultValue={initialConfiguration?.notes ?? ""} placeholder="Notes for estimator or production" />
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3"><h3 className="flex items-center gap-2 font-black text-slate-950"><Ruler className="h-5 w-5 text-orange" /> Dimensions</h3><p className="text-sm font-semibold text-slate-500">Enter the finished system size in millimetres.</p></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <LabeledField label="Width" suffix="mm"><input name="width_mm" type="number" min="1" value={widthMm} onChange={(event) => setWidthMm(toPositiveNumber(event.target.value, 0))} className={inputClass()} required /></LabeledField>
                <LabeledField label="Height" suffix="mm"><input name="height_mm" type="number" min="1" value={heightMm} onChange={(event) => setHeightMm(toPositiveNumber(event.target.value, 0))} className={inputClass()} required /></LabeledField>
                <LabeledField label="Qty"><input name="quantity" type="number" min="1" value={quantity} onChange={(event) => setQuantity(toBoundedInt(event.target.value, 1, 1, 10000))} className={inputClass()} required /></LabeledField>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <LabeledField label="Measurement"><select name="measurement_type" className={inputClass()} defaultValue={initialConfiguration?.measurement_type ?? "frame_outer_size"}>{measurementTypes.map((value) => <option key={value} value={value}>{labelize(value)}</option>)}</select></LabeledField>
                <LabeledField label="View"><select name="view_direction" value={viewDirection} onChange={(event) => setViewDirection(event.target.value)} className={inputClass()}>{viewDirections.map((value) => <option key={value} value={value}>{labelize(value)}</option>)}</select></LabeledField>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3"><h3 className="flex items-center gap-2 font-black text-slate-950"><Layers className="h-5 w-5 text-orange" /> Product Type & Layout</h3><p className="text-sm font-semibold text-slate-500">Choose the system, tracks, shutter count, and visible layout.</p></CardHeader>
            <CardContent className="space-y-3">
              <LabeledField label="System type"><select name="system_type" value={systemType} onChange={(event) => applySystemType(event.target.value)} className={inputClass()}>{systemConfiguratorSystemTypes.map((value) => <option key={value} value={value}>{systemDefaults[value]?.title ?? labelize(value)}</option>)}</select></LabeledField>
              <div className="grid grid-cols-2 gap-3">
                <LabeledField label="Panels"><input name="panel_count" type="number" min="1" max="12" value={panelCount} onChange={(event) => { setLayoutTouched(true); setPanelCount(toBoundedInt(event.target.value, safePanelCount, 1, 12)); }} className={inputClass()} /></LabeledField>
                <LabeledField label="Tracks"><input name="track_count" type="number" min="1" max="6" value={trackCount} onChange={(event) => setTrackCount(toBoundedInt(event.target.value, safeTrackCount, 1, 6))} className={inputClass()} /></LabeledField>
              </div>
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700"><input type="checkbox" checked={meshEnabled} onChange={(event) => { setLayoutTouched(true); setMeshEnabled(event.target.checked); }} className="rounded border-slate-300 text-orange" /> Include mesh panel</label>
              <details className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                <summary className="cursor-pointer text-sm font-black text-slate-700">Advanced settings</summary>
                <div className="mt-3 grid gap-2 text-xs font-semibold text-slate-500">
                  <p>Overlap: {Number(options.overlap_mm ?? 0)} mm</p>
                  <p>Sash deduction: {Number(options.sash_deduction ?? 0)} mm</p>
                  <p>Glass deduction: {Number(options.glass_deduction_width ?? 0)} x {Number(options.glass_deduction_height ?? 0)} mm</p>
                </div>
              </details>
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3"><h3 className="flex items-center gap-2 font-black text-slate-950"><Settings2 className="h-5 w-5 text-orange" /> Profiles, Glass & Finish</h3><p className="text-sm font-semibold text-slate-500">Select the system library items that drive calculation outputs.</p></CardHeader>
            <CardContent className="space-y-3">
              <LabeledField label="Series"><select name="series_id" className={inputClass()} value={selectedSeriesId} onChange={(event) => applySeries(event.target.value)} required><option value="">Select system series</option>{(matchingSeries.length ? matchingSeries : series).map((item) => <option key={item.id} value={item.id}>{item.series_code} - {item.series_name}</option>)}</select></LabeledField>
              <LabeledField label="Template"><select name="template_id" className={inputClass()} value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}><option value="">Use series role formulas</option>{matchingTemplates.map((item) => <option key={item.id} value={item.id}>{item.template_code} - {item.template_name}{item.is_default ? " (Default)" : ""}</option>)}</select></LabeledField>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-600"><p><span className="font-black text-slate-800">Series:</span> {selectedSeries ? `${selectedSeries.series_code} - ${selectedSeries.series_name}` : "Select a series to map profile roles."}</p><p className="mt-1"><span className="font-black text-slate-800">Template:</span> {selectedTemplate ? `${selectedTemplate.template_code} - ${selectedTemplate.template_name}` : "Series role formulas will be used if no template is selected."}</p><p className="mt-1"><span className="font-black text-slate-800">Mapped roles:</span> {mappedRoleCount} active role{mappedRoleCount === 1 ? "" : "s"}</p></div>
              <ProfileMappingPanel mappings={profileMappings} requiredRoles={requiredTemplateRoles} missingRoles={missingRequiredRoles} />
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <LabeledField label="Glass"><select name="glass_id" className={inputClass()} value={selectedGlassId} onChange={(event) => setSelectedGlassId(event.target.value)}><option value="">Select glass later</option>{glassItems.map((item) => <option key={item.id} value={item.id}>{item.glass_code} - {item.glass_name}</option>)}</select></LabeledField>
                <LabeledField label="Finish"><select name="finish_id" className={inputClass()} value={selectedFinishId} onChange={(event) => setSelectedFinishId(event.target.value)}><option value="">Select finish later</option>{finishOptions.map((item) => <option key={item.id} value={item.id}>{item.finish_code} - {item.finish_name}</option>)}</select></LabeledField>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="overflow-hidden border-slate-200 shadow-sm xl:sticky xl:top-20">
            <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 bg-white/80"><div><h3 className="font-black text-slate-950">Elevation Preview</h3><p className="text-sm font-semibold text-slate-500">Scaled 2D system preview</p></div><span className="rounded-full bg-orange/10 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-orange">{labelize(viewDirection)}</span></CardHeader>
            <CardContent className="bg-[radial-gradient(circle_at_top,#ffffff,#f8fafc_55%,#eef2f7)] p-3 sm:p-5">
              <SystemElevationPreview realWidthMm={safeWidthMm} realHeightMm={safeHeightMm} systemType={systemType} panelLayout={layout} panelCount={safePanelCount} trackCount={safeTrackCount} designReference={initialConfiguration?.design_reference ?? "W01"} viewDirection={viewDirection} className="min-h-[300px] md:min-h-[360px] xl:min-h-[460px]" />
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <Card className="border-orange/25 bg-gradient-to-br from-white to-orange/5 shadow-sm">
            <CardHeader className="pb-3"><h3 className="flex items-center gap-2 font-black text-slate-950"><Sparkles className="h-5 w-5 text-orange" /> Live Summary</h3><p className="text-sm font-semibold text-slate-500">Compact design and readiness check.</p></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <SummaryRow label="System" value={systemDefaults[systemType]?.title ?? labelize(systemType)} />
              <SummaryRow label="Design Ref" value={designReference} />
              <SummaryRow label="Size" value={`${safeWidthMm || "--"} x ${safeHeightMm || "--"} mm`} />
              <SummaryRow label="Quantity" value={`${safeQuantity}`} />
              <SummaryRow label="Panels" value={`${safePanelCount}`} />
              <SummaryRow label="Tracks" value={`${safeTrackCount}`} />
              <SummaryRow label="Mesh" value={meshEnabled ? "Included" : "Not included"} />
              <div className="rounded-2xl bg-charcoal p-4 text-white"><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Opening Area</p><p className="mt-1 text-2xl font-black text-orange">{((safeWidthMm * safeHeightMm * safeQuantity) / 1_000_000).toFixed(2)} sqm</p></div>
               <div className="rounded-2xl border border-slate-200 bg-white p-3"><p className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">Workflow Readiness</p><div className="mt-2 grid gap-1 text-sm font-semibold text-slate-600"><p>Project: {projectName ? "Ready" : "Missing"}</p><p>Size/Layout: {safeWidthMm > 0 && safeHeightMm > 0 ? "Ready" : "Needs dimensions"}</p><p>Series: {selectedSeries ? `${mappedRoleCount} roles mapped` : "Select before calculation"}</p><p>Template: {selectedTemplate ? (missingRequiredRoles.length ? `${missingRequiredRoles.length} missing roles` : "Ready") : "Optional"}</p><p>Data: {dataReadiness.status === "ready" ? "Ready" : `${dataReadiness.criticalCount} critical, ${dataReadiness.warningCount} warnings`}</p></div></div>
              <ReadinessPanel summary={dataReadiness} />
              {formWarnings.length ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-amber-800"><p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em]"><AlertTriangle className="h-4 w-4" /> Warnings</p><div className="mt-2 space-y-1">{formWarnings.map((warning) => <p key={warning} className="text-sm font-semibold">{warning}</p>)}</div></div> : null}
              <Button type="submit" className="w-full"><Save className="h-4 w-4" /> {submitLabel}</Button>
              <Link href="/systems-configurator/libraries" className="block rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-center text-sm font-black text-slate-700 transition hover:border-orange hover:text-orange">Manage Libraries</Link>
            </CardContent>
          </Card>
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3"><h3 className="font-black text-slate-950">Outputs After Calculation</h3></CardHeader>
            <CardContent className="space-y-2 text-sm font-semibold text-slate-600">
              <p><Calculator className="mr-2 inline h-4 w-4 text-orange" /> Cutting list calculation</p>
              <p><Calculator className="mr-2 inline h-4 w-4 text-orange" /> Glass and beading sizes</p>
              <p><Calculator className="mr-2 inline h-4 w-4 text-orange" /> Hardware BOM and costing</p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </form>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2"><span className="font-bold text-slate-500">{label}</span><span className="text-right font-black text-slate-950">{value}</span></div>;
}

function LabeledField({ label, suffix, children }: { label: string; suffix?: string; children: ReactNode }) {
  return <label className="block space-y-1"><span className="flex items-center justify-between text-xs font-black uppercase tracking-[0.08em] text-slate-500"><span>{label}</span>{suffix ? <span className="text-slate-400">{suffix}</span> : null}</span>{children}</label>;
}

function HeaderMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p><p className="mt-1 truncate text-sm font-black text-slate-950">{value}</p></div>;
}

function ReadinessPanel({ summary }: { summary: DataReadinessSummary }) {
  const className = summary.status === "critical" ? "border-red-200 bg-red-50 text-red-900" : summary.status === "warning" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900";
  return (
    <div className={`rounded-2xl border p-3 ${className}`}>
      <p className="text-xs font-black uppercase tracking-[0.12em]">Production Data</p>
      <p className="mt-1 text-sm font-bold">{summary.status === "ready" ? "Libraries and selections are ready for calculation." : `${summary.criticalCount} critical issue${summary.criticalCount === 1 ? "" : "s"}, ${summary.warningCount} warning${summary.warningCount === 1 ? "" : "s"}`}</p>
      {summary.issues.length ? <div className="mt-2 space-y-1">{summary.issues.slice(0, 4).map((issue) => <p key={`${issue.code}-${issue.message}`} className="text-xs font-semibold leading-5">{issue.message}</p>)}</div> : null}
    </div>
  );
}

function ProfileMappingPanel({ mappings, requiredRoles, missingRoles }: { mappings: any[]; requiredRoles: string[]; missingRoles: string[] }) {
  const visibleRoles = requiredRoles.length ? requiredRoles : Array.from(new Set(mappings.map((item) => item.component_role))).slice(0, 12);
  const mappingByRole = new Map(mappings.map((item) => [item.component_role, item]));

  if (!mappings.length && !requiredRoles.length) {
    return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-3 text-sm font-semibold text-slate-500">Select a series and template to review profile-role readiness.</div>;
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3"><p className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">Profile Role Mapping</p><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${missingRoles.length ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{missingRoles.length ? `${missingRoles.length} Missing` : "Ready"}</span></div>
      <div className="mt-3 grid gap-2">
        {visibleRoles.map((role) => {
          const mapping = mappingByRole.get(role);
          const profile = Array.isArray(mapping?.aluminium_profiles) ? mapping.aluminium_profiles[0] : mapping?.aluminium_profiles;
          return <div key={role} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2"><div><p className="text-xs font-black text-slate-800">{labelize(role)}</p><p className="text-[11px] font-semibold text-slate-500">{mapping?.display_name ?? "Required by template"}</p></div><span className={`max-w-[130px] truncate rounded-full px-2 py-1 text-[10px] font-black ${mapping ? "bg-white text-slate-700 ring-1 ring-slate-200" : "bg-amber-100 text-amber-800"}`}>{mapping ? (profile?.profile_code ?? "Mapped") : "Missing"}</span></div>;
        })}
      </div>
      {requiredRoles.length > visibleRoles.length ? <p className="mt-2 text-xs font-semibold text-slate-500">Showing {visibleRoles.length} of {requiredRoles.length} required roles.</p> : null}
    </div>
  );
}

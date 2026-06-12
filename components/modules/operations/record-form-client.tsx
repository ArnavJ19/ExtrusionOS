"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { saveDispatchAction } from "@/lib/actions/dispatches";
import { saveProductionJobAction } from "@/lib/actions/production";
import { createClient } from "@/lib/supabase/browser";
import { getErrorMessage } from "@/lib/utils/errors";
import { nextBusinessNumber, type NumberPrefix } from "@/lib/utils/numbering";
import { calculateBilletWeightKg, calculateFoundryFurnaceMix, calculateRequiredBilletCount, calculateTotalBilletWeightKg, inchesToMm } from "@/lib/calculations/foundry";
import { compositionToEditableRows, compositionsMatch, getStandardAlloyComposition, normalizeCompositionRows, type AlloyComposition } from "@/lib/calculations/alloy-composition";
import type { SessionContext } from "@/types/app";
import { getModuleConfig, type FieldConfig, type ModuleKey } from "./module-config";

type LookupOption = { value: string; label: string; [key: string]: any };
type LookupMap = Record<string, LookupOption[]>;
type ChemistryField = "element" | "min" | "max";

type ProductionOrderItem = {
  profile_id: string | null;
  die_id: string | null;
  item_description: string | null;
  quantity_pieces: number | null;
  length_per_piece_m: number | null;
  total_weight_kg: number | null;
  billing_weight_kg: number | null;
  production_pieces?: number | null;
  aluminium_profiles?: { profile_code?: string | null; profile_name?: string | null } | null;
  dies?: { die_number?: string | null; rack_location?: string | null } | null;
};

function labelFor(row: Record<string, any>, fields: string[]) {
  return fields.map((field) => row[field]).filter(Boolean).join(" · ") || row.id;
}

function normalizeRow(row: Record<string, any>, defaults: Record<string, any>) {
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, row[key] ?? (typeof fallback === "boolean" ? false : "")])) as Record<string, any>;
}

export function RecordFormClient({ moduleKey, context, recordId }: { moduleKey: ModuleKey; context: SessionContext; recordId?: string }) {
  const config = getModuleConfig(moduleKey);
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [form, setForm] = useState<Record<string, any>>(config.defaultValues ?? {});
  const [lookups, setLookups] = useState<LookupMap>({});
  const [productionOrderItems, setProductionOrderItems] = useState<ProductionOrderItem[]>([]);
  const [productionAutofillSummary, setProductionAutofillSummary] = useState<string | null>(null);
  const [productionAutofillLoading, setProductionAutofillLoading] = useState(false);
  const [packagingAutofillSummary, setPackagingAutofillSummary] = useState<string | null>(null);
  const [availableBillets, setAvailableBillets] = useState<any[]>([]);
  const [selectedBillets, setSelectedBillets] = useState<Set<string>>(new Set());
  const [billetsLoading, setBilletsLoading] = useState(false);
  const [availablePackagingMaterials, setAvailablePackagingMaterials] = useState<any[]>([]);
  const [selectedPackagingMaterials, setSelectedPackagingMaterials] = useState<{ id: string, material_id: string, quantity_required: number }[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingIds, setExistingIds] = useState<string[] | null>(null);
  const editing = Boolean(recordId);

  async function loadForm() {
    setLoading(true);
    setError(null);
    const lookupFields = (config.fields ?? []).filter((field) => field.lookup);
    const lookupEntries = await Promise.all(lookupFields.map(async (field) => {
      const lookup = field.lookup!;
      let request = supabase.from(lookup.table as any).select(lookup.select).eq("company_id", context.companyId);
      Object.entries(lookup.filter ?? {}).forEach(([key, value]) => { request = request.eq(key, value); });
      const { data, error: lookupError } = await request.order(lookup.orderBy, { ascending: true }).limit(250);
      if (lookupError) throw lookupError;
      return [field.name, (data ?? []).map((row: any) => ({ ...row, value: row.id, label: labelFor(row, lookup.labelFields) }))] as const;
    }));
    setLookups(Object.fromEntries(lookupEntries));

    if (!editing && config.numberField && (config.generateNumber || config.numberPrefix)) {
      const { data } = await supabase.from(config.table as any).select(config.numberField).eq("company_id", context.companyId);
      setExistingIds((data ?? []).map((row: any) => row[config.numberField!]).filter(Boolean));
    } else {
      setExistingIds([]);
    }

    if (recordId) {
      const { data, error: recordError } = await supabase.from(config.table as any).select("*").eq("id", recordId).eq("company_id", context.companyId).single();
      if (recordError) throw recordError;
      setForm(normalizeRow(data, config.defaultValues ?? {}));
    }
  }

  useEffect(() => {
    loadForm().catch((err) => {
      const message = getErrorMessage(err, `Could not load ${config.title.toLowerCase()} form`);
      setError(message);
      toast.error(message);
    }).finally(() => setLoading(false));
  }, [moduleKey, recordId]);

  async function loadAvailableBillets() {
    setBilletsLoading(true);
    try {
      let orFilter = "status.eq.cast,status.eq.allocated";
      if (recordId) orFilter += `,production_job_id.eq.${recordId}`;
      const { data, error } = await supabase
        .from("foundry_billets")
        .select("id, billet_code, alloy, temper, weight_kg, status, order_id, production_job_id, billet_diameter_inch, source_type")
        .eq("company_id", context.companyId)
        .or(orFilter)
        .order("created_at", { ascending: true });
        
      if (error) throw error;
      
      const profile = lookups.profile_id?.find((p: any) => p.value === form.profile_id);
      const reqDiameter = profile?.billet_diameter_required_inch;
      const reqAlloy = profile?.alloy;
      
       const filtered = (data ?? []).filter((b: any) => {
          if (recordId && b.production_job_id === recordId) return true;
          if (b.status === "allocated" && b.order_id === form.order_id && !b.production_job_id) return true;
          if (b.status !== "cast") return false;
          if (b.order_id && b.order_id !== form.order_id) return false;
          if (reqDiameter && Number(b.billet_diameter_inch) !== Number(reqDiameter)) return false;
          if (reqAlloy && String(b.alloy ?? "").toLowerCase() !== String(reqAlloy).toLowerCase()) return false;
          return true;
       });
      
      setAvailableBillets(filtered);
      if (recordId && selectedBillets.size === 0) {
        setSelectedBillets(new Set(filtered.filter((b: any) => b.production_job_id === recordId).map((b: any) => b.id)));
      }
    } catch (err) {
      console.error("Billets fetch error:", err);
    } finally {
      setBilletsLoading(false);
    }
  }

  useEffect(() => {
    if (!editing && existingIds !== null && config.numberField) {
      let newNumber: string | undefined;
      if (config.generateNumber) {
        newNumber = config.generateNumber(form, existingIds);
      } else if (config.numberPrefix && !form[config.numberField]) {
        // Fallback to basic nextBusinessNumber for simple prefixed ones if it's not set
        newNumber = nextBusinessNumber(config.numberPrefix as NumberPrefix, existingIds);
      }
      
      if (newNumber && form[config.numberField] !== newNumber) {
        setForm((prev) => ({ ...prev, [config.numberField!]: newNumber }));
      }
    }
  }, [editing, existingIds, config, form]);

  async function loadPackagingMaterials() {
    setMaterialsLoading(true);
    try {
      const { data, error } = await supabase
        .from("packaging_materials")
        .select("id, material_code, material_name, current_stock, unit")
        .eq("company_id", context.companyId)
        .eq("is_active", true)
        .order("material_name", { ascending: true });
      if (error) throw error;
      setAvailablePackagingMaterials(data ?? []);
      
      if (recordId) {
        const { data: jobMaterials, error: jmError } = await supabase
          .from("packaging_job_materials")
          .select("id, material_id, quantity_required")
          .eq("company_id", context.companyId)
          .eq("job_id", recordId);
        if (jmError) throw jmError;
        setSelectedPackagingMaterials(jobMaterials ?? []);
      } else {
        setSelectedPackagingMaterials([]);
      }
    } catch (err) {
      console.error("Packaging materials fetch error:", err);
    } finally {
      setMaterialsLoading(false);
    }
  }

  useEffect(() => {
    if (moduleKey === "production" && (form.order_id || form.profile_id) && lookups.profile_id) {
      void loadAvailableBillets();
    }
  }, [moduleKey, form.order_id, form.profile_id, lookups.profile_id, recordId]);

  useEffect(() => {
    if (moduleKey === "packaging") {
      void loadPackagingMaterials();
    }
  }, [moduleKey, recordId]);

  function update(field: string, value: string | boolean) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function foundryMixFor(values: Record<string, any>) {
    const totalWeight = calculateTotalBilletWeightKg(Number(values.billet_length_mm ?? 0), Number(values.billet_diameter_mm ?? 0), Number(values.billet_count ?? 0), Number(values.alloy_density_kg_m3 ?? 2700));
    return calculateFoundryFurnaceMix(totalWeight, Number(values.furnace_efficiency_percent ?? 80), Number(values.scrap_percentage ?? 0), Number(values.external_aluminium_percentage ?? 100));
  }

  function applyFoundryMix(values: Record<string, any>) {
    const mix = foundryMixFor(values);
    return { ...values, required_furnace_charge_kg: mix.requiredFurnaceChargeKg, scrap_aluminium_kg: mix.scrapAluminiumKg, external_aluminium_kg: mix.externalAluminiumKg, ingot_kg: mix.externalAluminiumKg };
  }

  function defaultCompositionFor(alloy: string) {
    return getStandardAlloyComposition(alloy)?.composition ?? {};
  }

  function sourceForAlloy(alloy: string) {
    return getStandardAlloyComposition(alloy)?.source ?? "";
  }

  function applyAlloyComposition(alloy: string, resetActual: boolean) {
    const defaultComposition = defaultCompositionFor(alloy);
    const source = sourceForAlloy(alloy);
    setForm((current) => {
      const existingActual = current.alloy_composition_actual && Object.keys(current.alloy_composition_actual).length ? current.alloy_composition_actual as AlloyComposition : defaultComposition;
      const actual = resetActual ? defaultComposition : existingActual;
      return {
        ...current,
        alloy,
        alloy_composition_default: defaultComposition,
        alloy_composition_actual: actual,
        alloy_composition_altered: !compositionsMatch(defaultComposition, actual),
        alloy_composition_source: source
      };
    });
  }

  useEffect(() => {
    if (moduleKey !== "foundry") return;
    setForm((current) => {
      const next = applyFoundryMix(current);
      if (
        Number(current.required_furnace_charge_kg ?? 0) === next.required_furnace_charge_kg
        && Number(current.scrap_aluminium_kg ?? 0) === next.scrap_aluminium_kg
        && Number(current.external_aluminium_kg ?? 0) === next.external_aluminium_kg
      ) return current;
      return next;
    });
  }, [moduleKey, form.billet_length_mm, form.billet_diameter_mm, form.billet_count, form.alloy_density_kg_m3, form.furnace_efficiency_percent, form.scrap_percentage, form.external_aluminium_percentage]);

  useEffect(() => {
    if (moduleKey !== "foundry" || !form.alloy) return;
    if (form.alloy_composition_default && Object.keys(form.alloy_composition_default).length) return;
    applyAlloyComposition(String(form.alloy), false);
  }, [moduleKey, form.alloy]);

  function summarizeProductionItem(item: ProductionOrderItem, itemCount: number) {
    const profileLookup = item.profile_id ? lookups.profile_id?.find((option) => option.value === item.profile_id) : null;
    const dieLookup = item.die_id ? lookups.die_id?.find((option) => option.value === item.die_id) : null;
    const profile = item.aluminium_profiles ? [item.aluminium_profiles.profile_code, item.aluminium_profiles.profile_name].filter(Boolean).join(" · ") : profileLookup?.label ?? "linked profile";
    const die = item.die_id ? `, die ${item.dies?.die_number ?? dieLookup?.label ?? "selected"}` : ", die missing";
    const pieces = item.quantity_pieces ? `, ${item.quantity_pieces} pcs` : "";
    const length = item.length_per_piece_m ? ` x ${item.length_per_piece_m} m` : "";
    const location = item.dies?.rack_location || dieLookup?.rack_location ? ` Die location: ${item.dies?.rack_location ?? dieLookup?.rack_location}.` : "";
    const multiple = itemCount > 1 ? ` This order has ${itemCount} profile lines; change Profile to plan another line.` : "";
    return `Auto-filled ${profile}${die}${pieces}${length}.${location}${multiple}`;
  }

  function applyProductionItemAutofill(items: ProductionOrderItem[], profileId?: string | null) {
    const item = (profileId ? items.find((entry) => entry.profile_id === profileId) : items[0]) ?? null;
    if (!item?.profile_id) {
      setProductionAutofillSummary("No quote or direct-order production profile was found. Select profile, die, and planned kg manually.");
      return;
    }
    const plannedWeight = Number(item.billing_weight_kg ?? item.total_weight_kg ?? 0);
    const fallbackDie = item.profile_id ? lookups.die_id?.find((option) => option.profile_id === item.profile_id && !["inactive", "dead"].includes(String(option.die_status ?? "")))?.value ?? null : null;
    const dieId = item.die_id ?? fallbackDie;
    const billetWeight = Number(form.billet_weight_kg ?? 0) || 0;
    const estimatedBillets = calculateRequiredBilletCount(plannedWeight, billetWeight, Number(form.extrusion_efficiency_percent ?? 75));
    setForm((current) => ({
      ...current,
      profile_id: item.profile_id ?? current.profile_id,
      die_id: dieId ?? "",
      planned_quantity_kg: plannedWeight > 0 ? plannedWeight : current.planned_quantity_kg,
      pieces: item.quantity_pieces ?? item.production_pieces ?? current.pieces ?? 0,
      length_per_piece_m: item.length_per_piece_m ?? current.length_per_piece_m,
      required_billet_count: estimatedBillets > 0 ? estimatedBillets : current.required_billet_count,
      remarks: item.item_description ? `From order quote item: ${item.item_description}` : current.remarks
    }));
    setProductionAutofillSummary(dieId ? summarizeProductionItem({ ...item, die_id: dieId }, items.length) : "No active die exists for this order/profile. Add the die in Die Master before scheduling production.");
  }

  async function loadProductionOrderAutofill(orderId: string) {
    if (!orderId) {
      setProductionOrderItems([]);
      setProductionAutofillSummary(null);
      setForm((current) => ({ ...current, order_id: "", profile_id: "", die_id: "", planned_quantity_kg: 0, remarks: "" }));
      return;
    }

    setProductionAutofillLoading(true);
    try {
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .select("id, order_number, quote_id, expected_dispatch_date, priority, notes, production_profile_id, production_die_id, production_quantity_kg, production_pieces, production_notes, billets_required, billets_allocated, billets_short, billet_allocation_status")
        .eq("company_id", context.companyId)
        .eq("id", orderId)
        .single();
      if (orderError) throw orderError;

      let items: ProductionOrderItem[] = [];
      const { data: orderItems, error: orderItemsError } = await supabase
        .from("order_items")
        .select("profile_id, die_id, item_description, quantity_pieces, length_per_piece_m, total_weight_kg, billing_weight_kg, aluminium_profiles(profile_code, profile_name), dies(die_number, rack_location)")
        .eq("company_id", context.companyId)
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });
      if (orderItemsError) throw orderItemsError;
      items = (orderItems ?? []) as unknown as ProductionOrderItem[];
      if (!items.length && order?.quote_id) {
        const { data: quoteItems, error: itemsError } = await supabase
          .from("quote_items")
          .select("profile_id, die_id, item_description, quantity_pieces, length_per_piece_m, total_weight_kg, billing_weight_kg, aluminium_profiles(profile_code, profile_name), dies(die_number, rack_location)")
          .eq("company_id", context.companyId)
          .eq("quote_id", order.quote_id)
          .order("created_at", { ascending: true });
        if (itemsError) throw itemsError;
        items = (quoteItems ?? []) as unknown as ProductionOrderItem[];
      }
      if (!items.length && order?.production_profile_id) {
        items = [{
          profile_id: order.production_profile_id,
          die_id: order.production_die_id ?? null,
          item_description: order.production_notes || order.notes || "Direct order production requirement",
          quantity_pieces: null,
          production_pieces: order.production_pieces ?? null,
          length_per_piece_m: null,
          total_weight_kg: order.production_quantity_kg ?? null,
          billing_weight_kg: order.production_quantity_kg ?? null
        }];
      }

      const { count: linkedBilletCount, error: billetError } = await supabase
        .from("foundry_billets")
        .select("id", { count: "exact", head: true })
        .eq("company_id", context.companyId)
        .eq("order_id", orderId)
        .in("status", ["allocated", "issued"]);
      if (billetError) throw billetError;

      setProductionOrderItems(items);
      setForm((current) => ({
        ...current,
        order_id: orderId,
        required_billet_count: Number(order?.billets_allocated ?? linkedBilletCount ?? order?.billets_required ?? current.required_billet_count ?? 0),
        planned_date: order?.expected_dispatch_date ? String(order.expected_dispatch_date).slice(0, 10) : current.planned_date,
        remarks: order?.production_notes ? `Order production notes: ${order.production_notes}` : order?.notes ? `Order notes: ${order.notes}` : order?.priority === "urgent" || order?.priority === "high" ? `Priority order: ${order.priority}` : current.remarks
      }));
      applyProductionItemAutofill(items);
      setForm((current) => ({
        ...current,
        required_billet_count: Number(order?.billets_allocated ?? linkedBilletCount ?? order?.billets_required ?? current.required_billet_count ?? 0)
      }));
      if (linkedBilletCount) {
        setProductionAutofillSummary((current) => `${current ?? "Auto-filled production details."} ${linkedBilletCount} linked billet${linkedBilletCount === 1 ? "" : "s"} found for this order.`);
      } else if (Number(order?.billets_short ?? 0) > 0) {
        setProductionAutofillSummary((current) => `${current ?? "Auto-filled production details."} Billet shortage: ${order.billets_short} more billet${Number(order.billets_short) === 1 ? "" : "s"} required before full production.`);
      }
    } catch (err) {
      const message = getErrorMessage(err, "Could not auto-fill production details from the selected order");
      setProductionAutofillSummary(message);
      toast.error(message);
    } finally {
      setProductionAutofillLoading(false);
    }
  }

  async function loadPackagingOrderAutofill(orderId: string) {
    if (!orderId) {
      setPackagingAutofillSummary(null);
      setForm((current) => ({ ...current, order_id: "", production_job_id: "", pieces: 0, profile_weight_kg: 0, profile_length_m: 0 }));
      return;
    }

    const { data: jobs, error: jobsError } = await supabase
      .from("production_jobs")
      .select("id, job_number, pieces, actual_quantity_kg, planned_quantity_kg, length_per_piece_m, status")
      .eq("company_id", context.companyId)
      .eq("order_id", orderId)
      .eq("status", "completed")
      .order("updated_at", { ascending: false })
      .limit(1);
    if (jobsError) {
      const message = getErrorMessage(jobsError, "Could not load completed production job for packaging");
      setPackagingAutofillSummary(message);
      toast.error(message);
      return;
    }
    const job = jobs?.[0] as any;
    if (!job) {
      setPackagingAutofillSummary("No completed production job found for this order. Complete production before packaging.");
      return;
    }
    const pieces = Number(job.pieces ?? 0);
    const weight = Number(job.actual_quantity_kg ?? job.planned_quantity_kg ?? 0);
    const lengthM = Number(job.length_per_piece_m ?? 0) * pieces;
    setForm((current) => ({ ...current, order_id: orderId, production_job_id: job.id, pieces, profile_weight_kg: weight, profile_length_m: lengthM }));
    setPackagingAutofillSummary(`Auto-filled completed job ${job.job_number}: ${pieces.toLocaleString("en-IN")} pcs, ${weight.toLocaleString("en-IN")} kg, ${lengthM.toLocaleString("en-IN")} m profile length.`);
  }

  function handleFieldChange(field: FieldConfig, value: string | boolean) {
    if (moduleKey === "production" && field.name === "order_id" && typeof value === "string") {
      void loadProductionOrderAutofill(value);
      return;
    }
    if (moduleKey === "production" && field.name === "profile_id" && typeof value === "string") {
      update(field.name, value);
      if (productionOrderItems.length) applyProductionItemAutofill(productionOrderItems, value);
      return;
    }
    if (moduleKey === "orders" && field.name === "production_profile_id" && typeof value === "string") {
      const profile = lookups.production_profile_id?.find((option) => option.value === value);
      setForm((current) => ({ ...current, production_profile_id: value, production_die_id: "", billet_diameter_required_inch: profile?.billet_diameter_required_inch ?? "" }));
      return;
    }
    if (moduleKey === "orders" && field.name === "production_die_id" && typeof value === "string") {
      const die = lookups.production_die_id?.find((option) => option.value === value);
      setForm((current) => ({ ...current, production_die_id: value, billet_diameter_required_inch: die?.billet_diameter_required_inch ?? current.billet_diameter_required_inch }));
      return;
    }
    if (moduleKey === "foundry" && field.name === "order_id" && typeof value === "string") {
      const order = lookups.order_id?.find((option) => option.value === value);
      const diameterInch = Number(order?.billet_diameter_required_inch ?? form.billet_diameter_inch ?? 6);
      setForm((current) => ({ ...current, order_id: value, billet_diameter_inch: diameterInch, billet_diameter_mm: inchesToMm(diameterInch), billet_count: diameterInch === 6 ? 24 : diameterInch === 4 ? 48 : current.billet_count }));
      return;
    }
    if (moduleKey === "foundry" && field.name === "billet_diameter_inch" && typeof value === "string") {
      const diameterInch = Number(value);
      setForm((current) => ({ ...current, billet_diameter_inch: value, billet_diameter_mm: inchesToMm(diameterInch), billet_count: diameterInch === 6 ? 24 : diameterInch === 4 ? 48 : current.billet_count }));
      return;
    }
    if (moduleKey === "foundry" && field.name === "scrap_percentage" && typeof value === "string") {
      const scrapPercentage = Number(value || 0);
      setForm((current) => ({ ...current, scrap_percentage: value, external_aluminium_percentage: Number.isFinite(scrapPercentage) ? Number(Math.max(0, 100 - scrapPercentage).toFixed(3)) : current.external_aluminium_percentage }));
      return;
    }
    if (moduleKey === "foundry" && field.name === "external_aluminium_percentage" && typeof value === "string") {
      const externalPercentage = Number(value || 0);
      setForm((current) => ({ ...current, external_aluminium_percentage: value, scrap_percentage: Number.isFinite(externalPercentage) ? Number(Math.max(0, 100 - externalPercentage).toFixed(3)) : current.scrap_percentage }));
      return;
    }
    if (moduleKey === "foundry" && field.name === "alloy" && typeof value === "string") {
      applyAlloyComposition(value, true);
      return;
    }
    if (moduleKey === "packaging" && field.name === "order_id" && typeof value === "string") {
      void loadPackagingOrderAutofill(value);
      return;
    }
    if (moduleKey === "packaging" && field.name === "production_job_id" && typeof value === "string") {
      update(field.name, value);
      return;
    }
    if (moduleKey === "packaging_materials" && field.name === "consumption_rate" && typeof value === "string") {
      setForm((current) => ({ ...current, consumption_rate: value, consumption_per_profile_meter: current.calculation_method === "per_profile_meter" ? value : current.consumption_per_profile_meter }));
      return;
    }
    if (moduleKey === "packaging_materials" && field.name === "calculation_method" && typeof value === "string") {
      setForm((current) => ({ ...current, calculation_method: value, consumption_per_profile_meter: value === "per_profile_meter" ? current.consumption_rate : current.consumption_per_profile_meter }));
      return;
    }
    update(field.name, value);
  }

  async function submit() {
    if (!config.schema) return;
    let formForSubmit = form;
    if (moduleKey === "foundry") {
      const defaultComposition = form.alloy_composition_default && Object.keys(form.alloy_composition_default).length ? form.alloy_composition_default as AlloyComposition : defaultCompositionFor(String(form.alloy ?? ""));
      const actualComposition = form.alloy_composition_actual && Object.keys(form.alloy_composition_actual).length ? form.alloy_composition_actual as AlloyComposition : defaultComposition;
      formForSubmit = applyFoundryMix({
        ...form,
        alloy_composition_default: defaultComposition,
        alloy_composition_actual: actualComposition,
        alloy_composition_altered: !compositionsMatch(defaultComposition, actualComposition),
        alloy_composition_source: form.alloy_composition_source || sourceForAlloy(String(form.alloy ?? ""))
      });
    }
    const parsed = config.schema.safeParse(formForSubmit);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Please check the form");
    setSaving(true);
    const sanitized = Object.fromEntries(Object.entries(parsed.data as Record<string, unknown>).map(([key, value]) => [key, value === "" ? null : value]));
    if (moduleKey === "foundry" && Number(sanitized.scrap_percentage ?? 0) > 0 && !sanitized.scrap_id) {
      setSaving(false);
      return toast.error("Select a scrap batch when scrap percentage is greater than zero.");
    }
    if (moduleKey === "foundry" && sanitized.scrap_id && !Number(sanitized.scrap_aluminium_kg ?? 0)) {
      setSaving(false);
      return toast.error("Calculated scrap kg is zero. Increase scrap percentage or clear the selected scrap batch.");
    }
    if (moduleKey === "foundry" && sanitized.external_source_id && !Number(sanitized.external_aluminium_kg ?? 0)) {
      setSaving(false);
      return toast.error("Calculated external aluminium kg is zero. Increase external aluminium percentage or clear the selected source.");
    }
    if (moduleKey === "foundry" && sanitized.alloy_composition_altered) {
      toast.warning("Alloy chemistry was altered from the standard composition. This will be saved on the foundry batch.");
    }
    if (moduleKey === "production") {
      if (!sanitized.die_id) {
        setSaving(false);
        return toast.error("Production cannot be scheduled because no active die exists for this order/profile. Add the die in Die Master first.");
      }
      const required = Number(sanitized.required_billet_count || 0);
      if (required > 0 && selectedBillets.size === 0) {
        setSaving(false);
        return toast.error("Select at least one allocated billet for this production job. Partial production is allowed when billet supply is tight.");
      }
    }
    if (moduleKey === "profiles" && !sanitized.standard_length_m) {
      setSaving(false);
      return toast.error("Profile standard length is missing. Add stock length before using this profile for BOM, cutting list, or inventory planning.");
    }
    if (moduleKey === "expenses" && editing && String(form.approval_status || "").toLowerCase() === "approved") {
      setSaving(false);
      return toast.error("Approved expenses cannot be edited directly. Use payment entries or reversal workflow.");
    }
    if (config.uniqueField && sanitized[config.uniqueField]) {
      let duplicateRequest = supabase
        .from(config.table as any)
        .select("id", { count: "exact", head: true })
        .eq("company_id", context.companyId)
        .eq(config.uniqueField, sanitized[config.uniqueField] as any);
      if (editing && recordId) duplicateRequest = duplicateRequest.neq("id", recordId);
      const duplicate = await duplicateRequest;
      if (duplicate.error) {
        setSaving(false);
        return toast.error(getErrorMessage(duplicate.error, `Could not validate ${config.uniqueLabel ?? config.uniqueField}`));
      }
      if ((duplicate.count ?? 0) > 0) {
        setSaving(false);
        return toast.error(`${config.uniqueLabel ?? config.uniqueField} already exists for this company. Use a unique code/number to avoid traceability issues.`);
      }
    }
    let payload: Record<string, any> = { ...sanitized, company_id: context.companyId, created_by: context.userId };
    if (moduleKey === "production") {
      const result = await saveProductionJobAction({
        ...sanitized,
        editing_id: editing ? recordId : null,
        selected_billet_ids: Array.from(selectedBillets)
      } as any);
      setSaving(false);
      if (!result.success || !result.jobId) return toast.error(result.success ? "Could not save production job" : result.error);
      toast.success(editing ? `${config.title} updated` : `${config.title} saved`);
      router.push(`${config.basePath}/${result.jobId}`);
      router.refresh();
      return;
    }
    if (moduleKey === "dispatches") {
      const result = await saveDispatchAction({
        ...sanitized,
        editing_id: editing ? recordId : null
      } as any);
      setSaving(false);
      if (!result.success || !result.dispatchId) return toast.error(result.success ? "Could not save dispatch" : result.error);
      toast.success(editing ? `${config.title} updated` : `${config.title} saved`);
      router.push(`${config.basePath}/${result.dispatchId}`);
      router.refresh();
      return;
    }
    if (moduleKey === "foundry_external_sources" || moduleKey === "foundry_scrap") {
      const qty = Number(payload.weight_kg ?? 0);
      const rate = Number(payload.rate ?? 0);
      const base = Number(payload.base_amount ?? 0) || Number((qty * rate).toFixed(2));
      const total = Number(payload.total_amount ?? 0) || Number((base + Number(payload.tax_amount ?? 0) + Number(payload.freight_amount ?? 0) - Number(payload.discount_amount ?? 0)).toFixed(2));
      payload = { ...payload, unit: payload.unit || "kg", base_amount: base, total_amount: total };
    }
    if (moduleKey === "outsourced_billets") {
      const qty = Number(payload.weight_kg ?? 0);
      const rate = Number(payload.price_per_kg ?? 0);
      const base = Number(payload.base_amount ?? 0) || Number(payload.total_price ?? 0) || Number((qty * rate).toFixed(2));
      const total = Number(payload.total_price ?? 0) || Number((base + Number(payload.tax_amount ?? 0) + Number(payload.freight_amount ?? 0) - Number(payload.discount_amount ?? 0)).toFixed(2));
      payload = { ...payload, unit: payload.unit || "kg", base_amount: base, total_price: total };
    }
    if (moduleKey === "packaging_material_purchases") {
      const qty = Number(payload.quantity ?? 0);
      const rate = Number(payload.rate ?? 0);
      const base = Number(payload.base_amount ?? 0) || Number((qty * rate).toFixed(2));
      const total = Number(payload.total_amount ?? 0) || Number((base + Number(payload.tax_amount ?? 0) + Number(payload.freight_amount ?? 0) - Number(payload.discount_amount ?? 0)).toFixed(2));
      payload = { ...payload, base_amount: base, total_amount: total };
    }
    if (moduleKey === "expenses") {
      const qty = Number(payload.quantity ?? 0);
      const rate = Number(payload.rate ?? 0);
      const base = Number(payload.base_amount ?? 0) || Number((qty * rate).toFixed(2));
      const total = Number(payload.total_amount ?? 0) || Number((base + Number(payload.tax_amount ?? 0) + Number(payload.freight_amount ?? 0) - Number(payload.discount_amount ?? 0)).toFixed(2));
      payload = { ...payload, base_amount: base, total_amount: total };
    }
    if (moduleKey === "foundry_scrap" && !payload.available_weight_kg) payload.available_weight_kg = payload.weight_kg;
    if (moduleKey === "foundry_external_sources" && !editing && !payload.available_weight_kg) payload.available_weight_kg = payload.weight_kg;
    if (!editing && config.numberField) {
      const { data: existing } = await supabase.from(config.table as any).select(config.numberField).eq("company_id", context.companyId);
      if (config.generateNumber) {
        payload = { ...payload, [config.numberField]: config.generateNumber(payload, (existing ?? []).map((row: any) => row[config.numberField!]).filter(Boolean)) };
      } else if (config.numberPrefix) {
        payload = { ...payload, [config.numberField]: nextBusinessNumber(config.numberPrefix as NumberPrefix, (existing ?? []).map((row: any) => row[config.numberField!]).filter(Boolean)) };
      }
    }
    const result = editing
      ? await supabase.from(config.table as any).update(payload).eq("id", recordId).eq("company_id", context.companyId).select("id").single()
      : await supabase.from(config.table as any).insert(payload).select("id").single();
    if (!result.error && result.data && moduleKey === "packaging" && selectedPackagingMaterials.length > 0) {
      if (editing) {
        await supabase.from("packaging_job_materials").delete().eq("job_id", result.data.id).eq("company_id", context.companyId);
      }
      const inserts = selectedPackagingMaterials.map(m => ({
        job_id: result.data.id,
        material_id: m.material_id,
        quantity_required: Number(m.quantity_required),
        company_id: context.companyId
      }));
      await supabase.from("packaging_job_materials").insert(inserts);
    }
    setSaving(false);
    if (result.error || !result.data) return toast.error(getErrorMessage(result.error, "Could not save record"));
    toast.success(editing ? `${config.title} updated` : `${config.title} saved`);
    router.push(`${config.basePath}/${result.data.id}`);
    router.refresh();
  }

  function renderField(field: FieldConfig) {
    const value = form[field.name] ?? "";
    const options: LookupOption[] = field.lookup ? lookups[field.name] ?? [] : field.options ?? [];
    const dieProfileId = moduleKey === "production" && field.name === "die_id" ? form.profile_id : moduleKey === "orders" && field.name === "production_die_id" ? form.production_profile_id : "";
    const fieldOptions = dieProfileId
      ? options.filter((option) => (!option.profile_id || option.profile_id === dieProfileId) && !["inactive", "dead"].includes(String(option.die_status ?? "")))
      : options;
    return (
      <label key={field.name} className={field.type === "textarea" ? "block space-y-1.5 md:col-span-2" : "block space-y-1.5"}>
        <span className="form-label">{field.label}{field.required ? " *" : ""}</span>
        {field.type === "textarea" ? <textarea className="form-input min-h-24" value={value} placeholder={field.placeholder} readOnly={field.readOnly} onChange={(event) => handleFieldChange(field, event.target.value)} /> : field.type === "select" ? <SearchableSelect value={String(value)} options={fieldOptions} placeholder="Select" onChange={(nextValue) => handleFieldChange(field, nextValue)} disabled={field.readOnly || (productionAutofillLoading && field.name === "order_id")} /> : field.type === "checkbox" ? <input className="form-input" type="checkbox" checked={Boolean(value)} disabled={field.readOnly} onChange={(event) => handleFieldChange(field, event.target.checked)} /> : <input className="form-input" type={field.type ?? "text"} step={field.step} value={value} placeholder={field.placeholder} readOnly={field.readOnly} onChange={(event) => handleFieldChange(field, event.target.value)} />}
      </label>
    );
  }

  function updateChemistryRow(index: number, field: ChemistryField, value: string) {
    const rows = compositionToEditableRows((form.alloy_composition_actual ?? {}) as AlloyComposition);
    rows[index] = { ...rows[index], [field]: value };
    const actual = normalizeCompositionRows(rows);
    const standard = (form.alloy_composition_default ?? {}) as AlloyComposition;
    setForm((current) => ({ ...current, alloy_composition_actual: actual, alloy_composition_altered: !compositionsMatch(standard, actual) }));
  }

  function addChemistryRow() {
    const rows = compositionToEditableRows((form.alloy_composition_actual ?? {}) as AlloyComposition);
    const actual = normalizeCompositionRows([...rows, { element: `Element${rows.length + 1}`, min: "", max: "" }]);
    const standard = (form.alloy_composition_default ?? {}) as AlloyComposition;
    setForm((current) => ({ ...current, alloy_composition_actual: actual, alloy_composition_altered: !compositionsMatch(standard, actual) }));
  }

  function removeChemistryRow(index: number) {
    const rows = compositionToEditableRows((form.alloy_composition_actual ?? {}) as AlloyComposition).filter((_, rowIndex) => rowIndex !== index);
    const actual = normalizeCompositionRows(rows);
    const standard = (form.alloy_composition_default ?? {}) as AlloyComposition;
    setForm((current) => ({ ...current, alloy_composition_actual: actual, alloy_composition_altered: !compositionsMatch(standard, actual) }));
  }

  if (loading) return <LoadingState title={`Loading ${config.title.toLowerCase()} form`} description="Preparing clean data-entry fields." />;
  if (error) return <ErrorState description={error} onRetry={() => void loadForm()} />;

  const billetWeightKg = moduleKey === "foundry" ? calculateBilletWeightKg(Number(form.billet_length_mm ?? 0), Number(form.billet_diameter_mm ?? 0), Number(form.alloy_density_kg_m3 ?? 2700)) : 0;
  const totalBilletWeightKg = moduleKey === "foundry" ? calculateTotalBilletWeightKg(Number(form.billet_length_mm ?? 0), Number(form.billet_diameter_mm ?? 0), Number(form.billet_count ?? 0), Number(form.alloy_density_kg_m3 ?? 2700)) : 0;
  const chemistryRows = moduleKey === "foundry" ? compositionToEditableRows((form.alloy_composition_actual ?? {}) as AlloyComposition) : [];

  return (
    <div className="space-y-6">
      <div>
        <Link href={editing && recordId ? `${config.basePath}/${recordId}` : config.basePath} className="mb-3 inline-flex items-center gap-2 text-sm font-black text-slate-500 transition hover:text-orange"><ArrowLeft className="h-4 w-4" /> Back to {config.title}</Link>
        <h1 className="text-3xl font-black tracking-tight text-slate-950">{editing ? `Edit ${config.title}` : config.primaryAction}</h1>
        <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-slate-500">Use this focused form without a full database table competing for attention.</p>
      </div>
      <Card>
        <CardHeader><h2 className="section-title">Record Details</h2></CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">{(config.fields ?? []).map(renderField)}</div>
          {moduleKey === "production" && (productionAutofillLoading || productionAutofillSummary) ? (
            <div className="mt-4 rounded-2xl border border-orange/20 bg-orange/5 px-4 py-3 text-sm font-semibold text-slate-700">
              {productionAutofillLoading ? "Loading order details for production autofill..." : productionAutofillSummary}
            </div>
          ) : null}
          {moduleKey === "production" ? (
            <div className="mt-6 border-t border-slate-200 pt-5">
              <h3 className="mb-3 text-sm font-semibold text-slate-900">Allocate Billets for Production</h3>
              {billetsLoading ? (
                <div className="text-sm text-slate-500">Loading available billets...</div>
              ) : availableBillets.length === 0 ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  No compatible cast billets available for this order and profile diameter. You cannot start production until billets are cast.
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-sm text-slate-600">
                    Required for full order: <strong className="text-slate-900">{form.required_billet_count || 0}</strong> &middot; 
                    Selected for this run: <strong className={selectedBillets.size <= 0 ? "text-red-600" : selectedBillets.size < (form.required_billet_count || 0) ? "text-orange" : "text-green-600"}>{selectedBillets.size}</strong>
                    {selectedBillets.size > 0 && selectedBillets.size < (form.required_billet_count || 0) ? <span className="ml-2 font-semibold text-orange">Partial production run</span> : null}
                  </div>
                  <div className="grid max-h-64 gap-2 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2 md:grid-cols-3">
                    {availableBillets.map(billet => {
                      const isSelected = selectedBillets.has(billet.id);
                      return (
                        <label key={billet.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${isSelected ? "border-orange bg-orange/5" : "border-slate-200 hover:bg-slate-50"}`}>
                          <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-orange focus:ring-orange" checked={isSelected} onChange={(e) => {
                            const next = new Set(selectedBillets);
                            if (e.target.checked) next.add(billet.id);
                            else next.delete(billet.id);
                            setSelectedBillets(next);
                          }} />
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-slate-900">{billet.billet_code}</span>
                            <span className="text-xs text-slate-500">{billet.alloy} &middot; {billet.billet_diameter_inch} in &middot; {billet.source_type} &middot; {billet.weight_kg} kg</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : null}
          {moduleKey === "foundry" ? (
            <div className="mt-4 rounded-2xl border border-orange/20 bg-orange/5 px-4 py-3 text-sm font-semibold text-slate-700">
              Calculated billet weight: {billetWeightKg.toLocaleString("en-IN")} kg each, {totalBilletWeightKg.toLocaleString("en-IN")} kg total. Furnace charge: {Number(form.required_furnace_charge_kg ?? 0).toLocaleString("en-IN")} kg at {Number(form.furnace_efficiency_percent ?? 80).toLocaleString("en-IN")}% efficiency. Billet IDs follow Furnace-Date-Batch-Diameter-Billet Number.
            </div>
          ) : null}
          {moduleKey === "foundry" ? (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-sm font-black text-slate-950">Alloy Chemistry</h3>
                  <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">Standard composition is loaded from the selected alloy. Edit ranges only when the heat chemistry differs from the standard.</p>
                  {form.alloy_composition_source ? <p className="mt-1 break-all text-xs font-semibold text-slate-500">Source: {form.alloy_composition_source}</p> : null}
                </div>
                <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={addChemistryRow}><Plus className="h-4 w-4" /> Add Element</Button>
              </div>
              {form.alloy_composition_altered ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-800">Warning: chemistry was altered from the standard alloy composition and will be saved on this batch.</div> : null}
              <div className="mt-4 space-y-2">
                <div className="grid grid-cols-[1.2fr_1fr_1fr_auto] gap-2 text-xs font-black uppercase tracking-[0.12em] text-slate-500"><span>Element</span><span>Min %</span><span>Max %</span><span>Action</span></div>
                {chemistryRows.map((row, index) => (
                  <div key={`${row.element}-${index}`} className="grid grid-cols-[1.2fr_1fr_1fr_auto] gap-2">
                    <input className="form-input" value={row.element} onChange={(event) => updateChemistryRow(index, "element", event.target.value)} />
                    <input className="form-input" type="number" step="0.001" value={row.min} onChange={(event) => updateChemistryRow(index, "min", event.target.value)} />
                    <input className="form-input" type="number" step="0.001" value={row.max} onChange={(event) => updateChemistryRow(index, "max", event.target.value)} />
                    <Button type="button" variant="ghost" className="px-2 py-2 text-slate-400 hover:text-red-500" onClick={() => removeChemistryRow(index)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                {!chemistryRows.length ? <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm font-semibold text-slate-500">No standard chemistry exists for this alloy. Add lab chemistry manually if required.</div> : null}
              </div>
            </div>
          ) : null}
          {moduleKey === "packaging" ? (
            <div className="mt-6 border-t border-slate-200 pt-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-900">Packaging Materials</h3>
                <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setSelectedPackagingMaterials([...selectedPackagingMaterials, { id: Math.random().toString(), material_id: "", quantity_required: 1 }])}><Plus className="h-4 w-4 mr-1" /> Add Material</Button>
              </div>
              {materialsLoading ? (
                <div className="text-sm text-slate-500">Loading materials...</div>
              ) : (
                <div className="space-y-3">
                  {selectedPackagingMaterials.map((item, index) => (
                    <div key={item.id} className="flex flex-col sm:flex-row sm:items-center gap-3">
                      <SearchableSelect className="flex-1" value={item.material_id} placeholder="Select material" options={availablePackagingMaterials.map((m) => ({ value: m.id, label: `${m.material_name} (${m.material_code}) - Stock: ${m.current_stock} ${m.unit}` }))} onChange={(nextValue) => {
                        const next = [...selectedPackagingMaterials];
                        next[index].material_id = nextValue;
                        setSelectedPackagingMaterials(next);
                      }} />
                      <div className="flex items-center gap-3 w-full sm:w-auto">
                        <input type="number" step="0.001" className="form-input w-32" value={item.quantity_required} onChange={(e) => {
                          const next = [...selectedPackagingMaterials];
                          next[index].quantity_required = Number(e.target.value);
                          setSelectedPackagingMaterials(next);
                        }} />
                        <Button type="button" variant="ghost" className="px-2 py-2 text-slate-400 hover:text-red-500 shrink-0" onClick={() => {
                          const next = [...selectedPackagingMaterials];
                          next.splice(index, 1);
                          setSelectedPackagingMaterials(next);
                        }}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  ))}
                  {selectedPackagingMaterials.length === 0 && (
                    <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                      No materials selected. Click &quot;Add Material&quot; to include packaging.
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}
          {moduleKey === "packaging" && packagingAutofillSummary ? (
            <div className="mt-4 rounded-2xl border border-orange/20 bg-orange/5 px-4 py-3 text-sm font-semibold text-slate-700">{packagingAutofillSummary}</div>
          ) : null}
          {moduleKey === "packaging" && !form.material_id ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">This packaging job can stay queued without material. Stock will be issued only after a packaging material is selected.</div>
          ) : null}
          <div className="mt-6 flex flex-col gap-2 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button>
            <Button type="button" disabled={saving} onClick={submit}>{saving ? "Saving..." : editing ? "Update" : "Save"}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

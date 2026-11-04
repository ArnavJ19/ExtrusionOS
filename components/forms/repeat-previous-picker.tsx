"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { createClient } from "@/lib/supabase/browser";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { REPEAT_RULES, buildRepeatDraft, type RepeatChecks, type RepeatDraft, type RepeatFamily } from "@/lib/forms/repeat-previous";
import type { SessionContext } from "@/types/app";

export type RepeatSource = { family: RepeatFamily; id: string; label: string; draft: RepeatDraft; labels: Record<string, string> };

const SOURCES: Record<RepeatFamily, { table: string; number: string; columns: string; date: string }> = {
  production_jobs: { table: "production_jobs_authorized", number: "job_number", columns: "id, job_number, machine_id, shift, extrusion_efficiency_percent, planned_date, created_at", date: "planned_date" },
  dispatches: { table: "dispatches", number: "dispatch_number", columns: "id, dispatch_number, order_id, transporter_name, vehicle_number, driver_name, driver_phone, dispatch_date, created_at", date: "dispatch_date" },
  packaging_material_purchases: { table: "packaging_material_purchases", number: "purchase_number", columns: "id, purchase_number, material_id, vendor_id, unit, rate, payment_method, received_date, created_at", date: "received_date" }
};

/** NOV-009: choose a recent record of this company as the starting point for a new one. */
export function RepeatPreviousPicker({ family, context, disabled, onApply }: { family: RepeatFamily; context: SessionContext; disabled?: boolean; onApply: (source: RepeatSource) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const source = SOURCES[family];
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [selected, setSelected] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const version = useRef(0);

  useEffect(() => {
    const current = ++version.current;
    setState("loading");
    const timer = setTimeout(async () => {
      let query = supabase.from(source.table as any).select(source.columns).eq("company_id", context.companyId).order("created_at", { ascending: false }).limit(8);
      const term = search.replace(/[^\p{L}\p{N}\-/ ]/gu, "").trim();
      if (term) query = query.ilike(source.number, `%${term}%`);
      const { data, error } = await query;
      if (version.current !== current) return;
      if (error || !Array.isArray(data)) { setState("error"); return; }
      setRows(data as unknown as Record<string, unknown>[]); setState("ready");
    }, 200);
    return () => { clearTimeout(timer); };
  }, [supabase, source, context.companyId, search, retry]);

  const options: SearchableSelectOption[] = rows.map(row => ({ value: String(row.id), label: String(row[source.number] ?? "Record"), description: [row[source.date], row.transporter_name, row.vehicle_number, row.shift].filter(Boolean).join(" · ") }));

  async function apply() {
    const row = rows.find(item => item.id === selected);
    if (!row || applying) return;
    setApplying(true); setMessage("");
    try {
      // Copied references are re-read now: an inactive press, closed order or inactive master is dropped.
      const checks: RepeatChecks = { today: getBusinessDateBoundaries().today };
      const labels: Record<string, string> = {};
      if (family === "production_jobs" && row.machine_id) {
        const { data, error } = await supabase.from("machines").select("id, machine_name, machine_type, status, is_active").eq("company_id", context.companyId).eq("id", String(row.machine_id)).maybeSingle();
        if (error) throw error;
        const machine = data as { machine_name?: string; machine_type?: string; status?: string; is_active?: boolean } | null;
        checks.machineUsable = Boolean(machine?.is_active && machine.machine_type === "extrusion_press" && ["active", "operational", "idle"].includes(String(machine.status)));
        if (machine?.machine_name) labels.machine_id = machine.machine_name;
      }
      if (family === "dispatches" && row.order_id) {
        const { data, error } = await supabase.from("orders_authorized").select("id, order_number, current_stage, customer_name, company_name").eq("company_id", context.companyId).eq("id", String(row.order_id)).maybeSingle();
        if (error) throw error;
        const order = data as { order_number?: string; current_stage?: string; company_name?: string; customer_name?: string } | null;
        checks.orderStage = order?.current_stage ?? null;
        if (order?.order_number) labels.order_id = `${order.order_number}${order.company_name || order.customer_name ? ` · ${order.company_name || order.customer_name}` : ""}`;
      }
      if (family === "packaging_material_purchases") {
        const [material, vendor] = await Promise.all([
          row.material_id ? supabase.from("packaging_materials").select("id, is_active").eq("company_id", context.companyId).eq("id", String(row.material_id)).maybeSingle() : Promise.resolve({ data: null, error: null }),
          row.vendor_id ? supabase.from("vendors").select("id, is_active").eq("company_id", context.companyId).eq("id", String(row.vendor_id)).maybeSingle() : Promise.resolve({ data: null, error: null })
        ]);
        if (material.error || vendor.error) throw material.error ?? vendor.error;
        checks.materialActive = Boolean((material.data as { is_active?: boolean } | null)?.is_active);
        checks.vendorActive = Boolean((vendor.data as { is_active?: boolean } | null)?.is_active);
      }
      const draft = buildRepeatDraft(family, row, checks);
      onApply({ family, id: String(row.id), label: String(row[source.number] ?? "previous record"), draft, labels });
      setMessage(`Started from ${String(row[source.number] ?? "the previous record")}. Review every value; nothing is saved yet.`);
    } catch { setMessage("The previous record could not be rechecked. Retry, or enter the values directly."); }
    finally { setApplying(false); }
  }

  return <section aria-label={`Repeat a previous ${REPEAT_RULES[family].label}`} className="space-y-3 rounded-2xl border border-dashed border-neutral-300 bg-white p-4">
    <div><h2 className="text-sm font-bold text-neutral-900">Start from a previous {REPEAT_RULES[family].label}</h2>
      <p className="text-xs text-neutral-600">Copies only {REPEAT_RULES[family].copy.map(key => key.replace(/_id$/, "").replace(/_/g, " ")).join(", ")}. Dates are refreshed; quantities, weights, document numbers and approvals are never copied.</p></div>
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1"><SearchableSelect ariaLabel={`Previous ${REPEAT_RULES[family].label}`} value={selected} options={options} disabled={disabled || applying} onChange={setSelected} onSearchChange={setSearch}
        searching={state === "loading"} error={state === "error" ? "Previous records are unavailable." : undefined} onRetry={() => setRetry(value => value + 1)} placeholder={`Search recent ${REPEAT_RULES[family].label}s`} /></div>
      <Button type="button" variant="secondary" disabled={!selected || disabled || applying} onClick={() => void apply()}>{applying ? "Rechecking..." : "Use as starting point"}</Button>
    </div>
    {message ? <p role="status" className="text-xs font-semibold text-neutral-700">{message}</p> : null}
  </section>;
}

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { controlAction } from "@/lib/actions/operations-control";
import { AUTHORITY_ROLES, CUSTODY_CATEGORIES, canUseControlAction, controlLookupSchema, controlMutationSchema, type ControlAction, type ControlMutation } from "@/lib/workflow/operations-control";
import { useControlAction } from "./action-center";

type LookupKind = "locations" | "po_lines" | "task_kinds";
type Field = { key: string; label: string; type?: "text" | "note" | "instant" | "number" | "boolean" | "limits"; lookup?: LookupKind; options?: Record<string, string>;
  step?: string; min?: number; max?: number; optional?: boolean; help?: string };
const alloy: Field = { key: "alloy", label: "Billet alloy", max: 20, help: "As recorded on billet batches, for example 6063." };
const diameter: Field = { key: "diameter_inch", label: "Billet diameter (inches)", type: "number", step: "0.001", min: 0.5, max: 30 };
export const CONTROL_ACTION_FORMS: Record<ControlAction, { title: string; fields: Field[] }> = {
  "facts.refresh": { title: "Refresh job facts from the order line", fields: [] },
  "facts.keep": { title: "Record these differences as deliberate", fields: [] },
  "handoff.resolve": { title: "Confirm the physical position and resolve", fields: [] },
  "policy.set": { title: "Set billet purchasing policy", fields: [alloy, diameter, { key: "lead_days", label: "Supplier lead time (days)", type: "number", step: "1", min: 0, max: 365 },
    { key: "min_order_kg", label: "Minimum order (kg)", type: "number", step: "0.001", min: 0 }, { key: "pack_kg", label: "Pack or lot size (kg)", type: "number", step: "0.001", min: 0.001, optional: true, help: "Leave blank when the supplier has no fixed lot." },
    { key: "safety_stock_kg", label: "Safety stock (kg)", type: "number", step: "0.001", min: 0, help: "Held separately from order demand." }] },
  "supply.link": { title: "Count a purchase line as billet supply", fields: [{ key: "po_line_id", label: "Purchase order line (kg only)", lookup: "po_lines" }, alloy, diameter] },
  "plan.generate": { title: "Generate the billet purchasing plan", fields: [] },
  "plan.review": { title: "Review this purchasing proposal", fields: [{ key: "decision", label: "Decision", options: { accepted: "Accept for purchasing", dismissed: "Dismiss with reason" } }] },
  "wip.observe": { title: "Record where this material is", fields: [{ key: "location_id", label: "Observed location", lookup: "locations" },
    { key: "quantity_kg", label: "Quantity seen (kg)", type: "number", step: "0.001", min: 0.001, optional: true, help: "Leave blank if the material was not weighed." }] },
  "custody.explain": { title: "Explain a vendor custody difference", fields: [{ key: "category", label: "Explanation", options: CUSTODY_CATEGORIES },
    { key: "quantity_kg", label: "Quantity (kg)", type: "number", step: "0.001", min: 0.001 }, { key: "evidence", label: "Evidence (slip, gate pass or claim reference)", type: "note", max: 500 }] },
  "custody.reverse": { title: "Reverse this custody explanation", fields: [] },
  "authority.publish": { title: "Publish approval limits", fields: [{ key: "decision_type", label: "Decision", options: { overdue_dispatch: "Dispatch with overdue payments", low_margin_quote: "Low-margin quotation release" } },
    { key: "limits", label: "Approval limit by role", type: "limits", help: "Blank means no limit beyond the existing exception policy. Owners are never limited." },
    { key: "effective_from", label: "Effective from (IST)", type: "instant" }] },
  "contract.publish": { title: "Publish definition of done", fields: [{ key: "task_kind", label: "Task kind", lookup: "task_kinds" },
    { key: "exclusive_source", label: "One source record may complete only one task of this kind", type: "boolean" }] },
  "rollout.classify": { title: "Set how this change is rolled out", fields: [{ key: "change_class", label: "Rollout", options: { informational: "Informational; no acknowledgement", acknowledgement_required: "Acknowledgement required before bound work starts" } }] },
  "rollout.acknowledge": { title: "Acknowledge this instruction change", fields: [] }
};

function Lookup({ field, value, disabled, inputId, onChange }: { field: Field; value: string; disabled: boolean; inputId: string; onChange: (value: string) => void }) {
  const [options, setOptions] = useState<SearchableSelectOption[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  // Task kinds are chosen by their label; the server validates the kind itself.
  const byLabel = field.lookup === "task_kinds";
  useEffect(() => {
    const version = ++generation.current;
    let live = true;
    setLoading(true); setError("");
    const timer = setTimeout(async () => {
      try {
        const result = await controlAction({ command: "lookup", kind: field.lookup, search: query });
        const selected = value && !byLabel ? await controlAction({ command: "lookup", kind: field.lookup, selected_id: value }) : null;
        if (!live || version !== generation.current) return;
        if (!result.success) throw new Error(result.error);
        if (selected && !selected.success) throw new Error(selected.error);
        const list = controlLookupSchema.parse(result.data);
        const exact = selected?.success ? controlLookupSchema.parse(selected.data) : [];
        const rows = [...new Map([...exact, ...list].map(row => [byLabel ? row.label : row.value, { value: byLabel ? row.label : row.value, label: row.label, description: row.context }])).values()];
        setOptions(rows);
        if (value && !byLabel && !exact.some(row => row.value === value)) setError("The selected record is no longer eligible. Clear it and choose a current record.");
      } catch (cause) { if (live && version === generation.current) setError(cause instanceof Error ? cause.message : "Lookup unavailable. Retry."); }
      finally { if (live && version === generation.current) setLoading(false); }
    }, 180);
    return () => { live = false; clearTimeout(timer); };
  }, [field.lookup, query, value, retry, byLabel]);
  return <SearchableSelect inputId={inputId} ariaLabel={field.label} value={value} options={options} disabled={disabled} onChange={onChange} onSearchChange={setQuery} searching={loading} error={error} onRetry={() => setRetry(previous => previous + 1)} placeholder={`Search ${field.label.toLowerCase()}`} />;
}

/** Builds the typed mutation from text inputs. Blank optional numbers are omitted, never sent as zero. */
export function buildControlMutation(action: ControlAction, fields: Field[], values: Record<string, string>, fixed: Record<string, unknown>) {
  const mutation: Record<string, unknown> = { action, ...fixed };
  for (const field of fields) {
    const value = values[field.key] ?? "";
    if (field.type === "number") { if (value.trim()) mutation[field.key] = Number(value); else if (!field.optional) mutation[field.key] = undefined; }
    else if (field.type === "boolean") mutation[field.key] = value === "true" ? true : value === "false" ? false : undefined;
    else if (field.type === "instant") { const parsed = new Date(`${value}:00+05:30`); mutation[field.key] = Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : ""; }
    else if (field.type === "limits") {
      const decision = (fixed.decision_type ?? values.decision_type) as keyof typeof AUTHORITY_ROLES | undefined;
      const limits: Record<string, number> = {};
      for (const role of decision ? AUTHORITY_ROLES[decision] ?? [] : []) { const raw = (values[`limit:${role}`] ?? "").trim(); if (raw) limits[role] = Number(raw); }
      mutation.limits = limits;
    } else mutation[field.key] = value;
  }
  return controlMutationSchema.safeParse(mutation);
}

export function ControlMutationForm({ action, role, fixed = {}, initial = {} }: { action: ControlAction; role: string; fixed?: Record<string, unknown>; initial?: Record<string, string> }) {
  const descriptor = CONTROL_ACTION_FORMS[action];
  const id = useId();
  const { locked, review } = useControlAction();
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<string | null>(null);
  if (!canUseControlAction(role, action)) return null;
  const fields = [...descriptor.fields.filter(field => !(field.key in fixed)), { key: "note", label: "Reason or supporting evidence", type: "note" as const, max: 500 }];
  function update(field: string, value: string) { setValues(current => ({ ...current, [field]: value })); setError(""); setErrorField(null); }
  async function submit() {
    const parsed = buildControlMutation(action, fields, values, fixed);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]; const key = String(issue?.path[0] ?? "note");
      setError(issue?.message ?? "Review these details."); setErrorField(key);
      document.getElementById(`${id}-${key}`)?.focus(); return;
    }
    await review(parsed.data as ControlMutation);
  }
  const decision = (fixed.decision_type ?? values.decision_type) as keyof typeof AUTHORITY_ROLES | undefined;
  const invalid = (key: string) => ({ "aria-invalid": errorField === key || undefined, "aria-describedby": errorField === key ? `${id}-error` : undefined });
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h3 className="font-bold text-slate-900">{descriptor.title}</h3>
    <fieldset disabled={locked} className="grid min-w-0 gap-4 sm:grid-cols-2">
      {fields.map(field => <div key={field.key} className={`min-w-0 space-y-1 ${field.type === "note" || field.type === "limits" ? "sm:col-span-2" : ""}`}>
        {field.type === "limits" ? <fieldset id={`${id}-${field.key}`} tabIndex={-1} className="space-y-2" {...invalid("limits")}><legend className="form-label">{field.label}</legend>
          {decision ? <div className="grid gap-3 sm:grid-cols-3">{AUTHORITY_ROLES[decision].map(entry => <label key={entry} className="space-y-1"><span className="text-sm font-semibold capitalize">{entry.replace(/_/g, " ")}</span>
            <input className="form-input" type="number" inputMode="decimal" min={0} step="0.01" value={values[`limit:${entry}`] ?? ""} onChange={event => update(`limit:${entry}`, event.target.value)} /></label>)}</div>
            : <p className="text-sm text-slate-600">Choose the decision first.</p>}
        </fieldset> : <>
        <label htmlFor={`${id}-${field.key}`} className="form-label">{field.label}{field.optional ? " (optional)" : ""}</label>
        {field.lookup ? <Lookup field={field} value={values[field.key] ?? ""} disabled={locked} inputId={`${id}-${field.key}`} onChange={value => update(field.key, value)} />
          : field.options || field.type === "boolean" ? <select id={`${id}-${field.key}`} className="form-input" value={values[field.key] ?? ""} required {...invalid(field.key)} onChange={event => update(field.key, event.target.value)}>
              <option value="" disabled>Choose</option>{Object.entries(field.options ?? { true: "Yes", false: "No" }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          : field.type === "note" ? <textarea id={`${id}-${field.key}`} className="form-input min-h-24" value={values[field.key] ?? ""} maxLength={field.max ?? 500} required {...invalid(field.key)} onChange={event => update(field.key, event.target.value)} />
          : <input id={`${id}-${field.key}`} className="form-input" type={field.type === "instant" ? "datetime-local" : field.type === "number" ? "number" : "text"} inputMode={field.type === "number" ? "decimal" : undefined}
              step={field.step} min={field.min} max={field.type === "number" ? field.max : undefined} maxLength={field.type !== "number" ? field.max ?? 160 : undefined} value={values[field.key] ?? ""} required={!field.optional} {...invalid(field.key)} onChange={event => update(field.key, event.target.value)} />}
        </>}
        {field.help ? <p className="text-xs text-slate-600">{field.help}</p> : null}
      </div>)}
    </fieldset>
    {error ? <p id={`${id}-error`} role="alert" className="text-sm font-semibold text-red-800">{error}</p> : null}
    <p className="text-xs text-slate-500">Review the server-generated consequence before confirming. Only a confirmed database result completes the action.</p>
    <Button type="submit" disabled={locked}>Review this action</Button>
  </form>;
}

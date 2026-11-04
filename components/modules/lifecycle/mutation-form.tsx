"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { lifecycleAction } from "@/lib/actions/lifecycle";
import { JOURNEY_KINDS, LABEL_FIELDS, SAMPLE_REASONS, TRACE_START_TYPES, canUseLifecycleAction, lifecycleLookupSchema, type LifecycleAction, type LifecycleMutation } from "@/lib/workflow/lifecycle";
import { MAX_MERGE, MAX_OUTPUTS, MAX_TRANCHES, buildLifecycleMutation, lifecycleFieldVisible, type LifecycleField as Field } from "@/lib/workflow/lifecycle-form";
import { useLifecycleAction } from "./action-center";

const evidence: Field = { key: "evidence", label: "Evidence (document, photo, slip or call reference)", type: "note", max: 500 };
const yesNo = (key: string, label: string, help?: string): Field => ({ key, label, type: "boolean", help });
export const LIFECYCLE_ACTION_FORMS: Record<LifecycleAction, { title: string; fields: Field[] }> = {
  "closure.carry": { title: "Carry this item past closure", fields: [] },
  "closure.close": { title: "Close this order", fields: [{ key: "kind", label: "Closure", options: { operational: "Operational: fulfilment complete, receivables stay in accounts", final: "Final: commercially settled" } }] },
  "closure.reopen": { title: "Reopen this order", fields: [] },
  "sample.require": { title: "Require a sample or first-piece approval", fields: [{ key: "order_id", label: "Order", lookup: "orders", filter: "samples" }, { key: "profile_id", label: "Profile on the order", lookup: "profiles", contextKey: "order_id" },
    { key: "die_id", label: "Die the sample must prove", lookup: "dies", contextKey: "profile_id", optional: true }, { key: "drawing_revision_id", label: "Drawing revision", lookup: "drawing_revisions", contextKey: "profile_id", optional: true },
    { key: "reason", label: "Reason", options: SAMPLE_REASONS }, { key: "authority", label: "Approved by", options: { customer: "The customer", internal: "Internal quality (first piece)" } },
    { key: "quantity_pieces", label: "Sample pieces", type: "number", step: "1", min: 1, max: 10000 }, { key: "response_days", label: "Expected response (days)", type: "number", step: "1", min: 1, max: 90 },
    yesNo("gates_production", "Production waits for approval", "Only the sample job may start until the sample is approved.")] },
  "sample.record": { title: "Record a sample step", fields: [{ key: "event", label: "Step", options: { produced: "Sample produced", measured: "Measurements recorded", sent: "Sent for decision", lost: "Sample lost" } },
    { key: "job_id", label: "Sample job", lookup: "jobs", contextKey: "id", when: { event: ["produced"] } }, { key: "sample_tag", label: "Sample tag", max: 60, when: { event: ["produced"] } },
    { key: "location", label: "Where the sample is kept", max: 120, when: { event: ["produced"] } }, { key: "recipient", label: "Sent to", max: 120, when: { event: ["sent"] } },
    { key: "expected_response", label: "Decision expected by", type: "date", when: { event: ["sent"] } }, evidence] },
  "sample.decide": { title: "Record the sample decision", fields: [{ key: "decision", label: "Decision", options: { approved: "Approved", conditional: "Approved with a limit", rejected: "Rejected", clarification: "Clarification requested" } },
    { key: "customer_contact", label: "Customer person who decided", max: 120, optional: true, help: "Required for a customer decision; not used for an internal first-piece check." },
    { key: "limit_kg", label: "Approved quantity (kg)", type: "number", step: "0.001", min: 0.001, when: { decision: ["conditional"] } }, evidence] },
  "sample.invalidate": { title: "Require renewed approval", fields: [] },
  "sample.withdraw": { title: "Withdraw the sample requirement", fields: [] },
  "template.create": { title: "Create a packing and label template", fields: [{ key: "scope", label: "Applies to", options: { company: "All customers", customer: "One customer", project: "One project", order: "One order" } },
    { key: "customer_id", label: "Customer", lookup: "customers", when: { scope: ["customer"] } }, { key: "project_id", label: "Project", lookup: "projects", when: { scope: ["project"] } },
    { key: "order_id", label: "Order", lookup: "orders", filter: "templates", when: { scope: ["order"] } }, { key: "instructions", label: "Packing instructions", type: "note", max: 1000 },
    { key: "max_bundle_kg", label: "Maximum net kg per bundle", type: "number", step: "0.001", min: 0.001, optional: true }, { key: "max_pieces", label: "Maximum pieces per bundle", type: "number", step: "1", min: 1, optional: true },
    yesNo("spacer_required", "Spacers required between layers"), { key: "wrapping", label: "Wrapping required", max: 200, optional: true, help: "For example stretch film and corner guards." },
    { key: "label_fields", label: "Label fields (business facts only)", type: "label_fields" }] },
  "template.approve": { title: "Approve this template revision", fields: [] },
  "label.pack": { title: "Confirm packing and prepare the label", fields: [yesNo("spacers_used", "Spacers used"), yesNo("wrapping_done", "Wrapping done"),
    { key: "deviation", label: "Reviewed deviation (dispatch manager only)", type: "note", max: 500, optional: true, help: "Only when packing cannot meet the template." }] },
  "label.reprint": { title: "Reprint the label", fields: [{ key: "reason", label: "Why", options: { reprint: "Lost or unreadable", damaged: "Label damaged" } }] },
  "promise.propose": { title: "Check a delivery promise", fields: [{ key: "order_id", label: "Order", lookup: "orders", filter: "promises" }, { key: "tranches", label: "Delivery parts", type: "tranches", help: "Dates must increase. Leave unused rows blank." }] },
  "promise.accept": { title: "Accept this promise", fields: [] },
  "promise.withdraw": { title: "Withdraw this promise", fields: [] },
  "trace.open": { title: "Open a traceability investigation", fields: [{ key: "node_type", label: "Trace from", options: TRACE_START_TYPES }, { key: "node_id", label: "Record", lookup: "trace_nodes", filterKey: "node_type" }] },
  "trace.link": { title: "Record an evidenced source link", fields: [{ key: "from_type", label: "Source", options: { billet_batch: "Billet batch", foundry_billet: "Cast billet", production_job: "Production job" } },
    { key: "from_id", label: "Source record", lookup: "trace_nodes", filterKey: "from_type" }, { key: "to_type", label: "Used in", options: { production_job: "Production job", stock_batch: "Stock bundle" } },
    { key: "to_id", label: "Record", lookup: "trace_nodes", filterKey: "to_type" }, { key: "quantity_kg", label: "Quantity (kg)", type: "number", step: "0.001", min: 0.001, optional: true }, evidence] },
  "trace.hold": { title: "Put this stock on QC hold", fields: [] },
  "trace.close": { title: "Close the investigation", fields: [] },
  "bundle.split": { title: "Split a bundle", fields: [{ key: "stock_batch_id", label: "Bundle to split", lookup: "stock" }, { key: "outputs", label: "New bundles", type: "outputs", help: "Every piece goes into a new bundle. New tags must be unused." },
    { key: "variance_reason", label: "Reason for any weight difference", max: 300, optional: true }] },
  "bundle.merge": { title: "Combine bundles", fields: [{ key: "stock_batch_ids", label: "Bundles to combine", type: "stock_list" }, { key: "bundle_number", label: "New bundle tag", max: 40, upper: true },
    { key: "output_kg", label: "Weighed net kg", type: "number", step: "0.001", min: 0.001 }, { key: "variance_reason", label: "Reason for any weight difference", max: 300, optional: true }] },
  "bundle.reverse": { title: "Reverse a recording mistake", fields: [] },
  "journey.open": { title: "Start a journey review", fields: [{ key: "order_id", label: "Order to walk through", lookup: "orders", filter: "journeys" }, { key: "title", label: "Title", max: 120 },
    { key: "participants", label: "People involved", max: 300, help: "For example sales, press supervisor, dispatch and accounts." }, { key: "baseline_from", label: "Baseline from", type: "date" }, { key: "baseline_to", label: "Baseline to", type: "date" }] },
  "journey.annotate": { title: "Add an observation", fields: [{ key: "kind", label: "What kind of time", options: JOURNEY_KINDS }, { key: "minutes", label: "Minutes (if measured)", type: "number", step: "1", min: 1, optional: true },
    yesNo("private", "Private", "Private observations are visible only to you, the review owner, the factory manager and admins.")] },
  "journey.action": { title: "Assign an improvement action", fields: [{ key: "finding", label: "Finding and change", max: 300 }, { key: "owner_id", label: "Owner", lookup: "employees" }, { key: "due_date", label: "Due", type: "date" }] },
  "journey.progress": { title: "Update the action", fields: [{ key: "status", label: "Move to", options: { trial: "On trial", done: "Done", dropped: "Dropped" } }] },
  "journey.measure": { title: "Record a measure", fields: [{ key: "phase", label: "Phase", options: { baseline: "Baseline", trial: "Trial" } }, { key: "metric", label: "Metric (lower case)", max: 41, help: "For example quote_to_order_days. Trial measures reuse the baseline name and unit." },
    { key: "value", label: "Value", type: "number", step: "0.001", min: 0 }, { key: "unit", label: "Unit", options: { hours: "Hours", days: "Days", minutes: "Minutes", count: "Count", percent: "Percent" } },
    { key: "sample_size", label: "Sample size", type: "number", step: "1", min: 1 }, { key: "limitations", label: "Limitations", type: "note", max: 500 }] },
  "journey.close": { title: "Close the review", fields: [] }
};

function Lookup({ field, value, disabled, inputId, context, filter, onChange }: { field: Field; value: string; disabled: boolean; inputId: string; context?: string; filter?: string; onChange: (value: string) => void }) {
  const [options, setOptions] = useState<SearchableSelectOption[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const waiting = Boolean((field.contextKey && !context) || (field.filterKey && !filter));
  useEffect(() => {
    const version = ++generation.current;
    let live = true;
    if (waiting) { setOptions([]); setLoading(false); setError(""); return; }
    setLoading(true); setError("");
    const scope = { ...(context ? { context_id: context } : {}), ...(filter ? { filter } : {}) };
    const timer = setTimeout(async () => {
      try {
        const result = await lifecycleAction({ command: "lookup", kind: field.lookup, search: query, ...scope });
        const selected = value ? await lifecycleAction({ command: "lookup", kind: field.lookup, selected_id: value, ...scope }) : null;
        if (!live || version !== generation.current) return;
        if (!result.success) throw new Error(result.error);
        if (selected && !selected.success) throw new Error(selected.error);
        const list = lifecycleLookupSchema.parse(result.data);
        const exact = selected?.success ? lifecycleLookupSchema.parse(selected.data) : [];
        setOptions([...new Map([...exact, ...list].map(row => [row.value, { value: row.value, label: row.label, description: row.context }])).values()]);
        if (value && !exact.some(row => row.value === value)) setError("The selected record is no longer eligible. Clear it and choose a current record.");
      } catch (cause) { if (live && version === generation.current) setError(cause instanceof Error ? cause.message : "Lookup unavailable. Retry."); }
      finally { if (live && version === generation.current) setLoading(false); }
    }, 180);
    return () => { live = false; clearTimeout(timer); };
  }, [field.lookup, query, value, retry, context, filter, waiting]);
  return <SearchableSelect inputId={inputId} ariaLabel={field.label} value={value} options={options} disabled={disabled || waiting} onChange={onChange} onSearchChange={setQuery} searching={loading}
    error={error} onRetry={() => setRetry(previous => previous + 1)} placeholder={waiting ? "Choose the record above first" : `Search ${field.label.toLowerCase()}`} />;
}

export function LifecycleMutationForm({ action, role, fixed = {}, initial = {}, title }: { action: LifecycleAction; role: string; fixed?: Record<string, unknown>; initial?: Record<string, string>; title?: string }) {
  const descriptor = LIFECYCLE_ACTION_FORMS[action];
  const id = useId();
  const { locked, review } = useLifecycleAction();
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [rows, setRows] = useState({ tranches: 1, outputs: 2, stock: 2 });
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<string | null>(null);
  if (!canUseLifecycleAction(role, action)) return null;
  const fields = [...descriptor.fields.filter(field => !(field.key in fixed)), { key: "note", label: "Reason or supporting evidence", type: "note" as const, max: 500 }];
  const shown = fields.filter(field => lifecycleFieldVisible(field, values, fixed));
  function update(field: string, value: string) { setValues(current => ({ ...current, [field]: value })); setError(""); setErrorField(null); }
  async function submit() {
    const parsed = buildLifecycleMutation(action, fields, values, fixed);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]; const key = String(issue?.path[0] ?? "note");
      setError(issue?.message ?? "Review these details."); setErrorField(key);
      document.getElementById(`${id}-${key}`)?.focus(); return;
    }
    await review(parsed.data as LifecycleMutation);
  }
  const invalid = (key: string) => ({ "aria-invalid": errorField === key || undefined, "aria-describedby": errorField === key ? `${id}-error` : undefined });
  const add = (key: keyof typeof rows, max: number, label: string) => rows[key] < max ? <Button type="button" variant="secondary" onClick={() => setRows(current => ({ ...current, [key]: current[key] + 1 }))}>{label}</Button> : null;
  const input = (key: string, label: string, props: Record<string, unknown> = {}) => <label className="min-w-0 space-y-1"><span className="text-sm font-semibold">{label}</span>
    <input className="form-input" value={values[key] ?? ""} onChange={event => update(key, event.target.value)} {...props} /></label>;
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h3 className="font-bold text-slate-900">{title ?? descriptor.title}</h3>
    <fieldset disabled={locked} className="grid min-w-0 gap-4 sm:grid-cols-2">
      {shown.map(field => {
        const wide = ["note", "tranches", "outputs", "stock_list", "label_fields"].includes(field.type ?? "");
        if (field.type === "tranches") return <fieldset key={field.key} id={`${id}-tranches`} tabIndex={-1} className="min-w-0 space-y-3 sm:col-span-2" {...invalid("tranches")}><legend className="form-label">{field.label}</legend>
          {Array.from({ length: rows.tranches }, (_, index) => <div key={index} className="grid gap-3 sm:grid-cols-2">{input(`tranche:${index}:date`, `Part ${index + 1} date`, { type: "date" })}
            {input(`tranche:${index}:kg`, `Part ${index + 1} kg`, { type: "number", inputMode: "decimal", step: "0.001", min: 0.001 })}</div>)}
          {add("tranches", MAX_TRANCHES, "Add a delivery part")}{field.help ? <p className="text-xs text-slate-600">{field.help}</p> : null}</fieldset>;
        if (field.type === "outputs") return <fieldset key={field.key} id={`${id}-outputs`} tabIndex={-1} className="min-w-0 space-y-3 sm:col-span-2" {...invalid("outputs")}><legend className="form-label">{field.label}</legend>
          {Array.from({ length: rows.outputs }, (_, index) => <div key={index} className="grid gap-3 sm:grid-cols-3">{input(`output:${index}:bundle_number`, `Bundle ${index + 1} tag`, { maxLength: 40, autoCapitalize: "characters" })}
            {input(`output:${index}:pieces`, "Pieces", { type: "number", inputMode: "numeric", step: "1", min: 1 })}{input(`output:${index}:kg`, "Net kg", { type: "number", inputMode: "decimal", step: "0.001", min: 0.001 })}</div>)}
          {add("outputs", MAX_OUTPUTS, "Add a new bundle")}{field.help ? <p className="text-xs text-slate-600">{field.help}</p> : null}</fieldset>;
        if (field.type === "stock_list") return <fieldset key={field.key} id={`${id}-${field.key}`} tabIndex={-1} className="min-w-0 space-y-3 sm:col-span-2" {...invalid(field.key)}><legend className="form-label">{field.label}</legend>
          {Array.from({ length: rows.stock }, (_, index) => <div key={index} className="space-y-1"><span className="text-sm font-semibold">Bundle {index + 1}</span>
            <Lookup field={{ key: `stock:${index}`, label: `Bundle ${index + 1}`, lookup: "stock" }} value={values[`stock:${index}`] ?? ""} disabled={locked} inputId={`${id}-stock-${index}`} onChange={value => update(`stock:${index}`, value)} /></div>)}
          {add("stock", MAX_MERGE, "Add another bundle")}</fieldset>;
        if (field.type === "label_fields") return <fieldset key={field.key} id={`${id}-${field.key}`} tabIndex={-1} className="min-w-0 space-y-2 sm:col-span-2" {...invalid(field.key)}><legend className="form-label">{field.label}</legend>
          <div className="grid gap-2 sm:grid-cols-2">{Object.entries(LABEL_FIELDS).map(([key, label]) => <label key={key} className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5" checked={values[`label:${key}`] === "true"} onChange={event => update(`label:${key}`, event.target.checked ? "true" : "")} />{label}</label>)}</div>
          <p className="text-xs text-slate-600">Prices, costs, margins and internal notes cannot be printed on a label.</p></fieldset>;
        return <div key={field.key} className={`min-w-0 space-y-1 ${wide ? "sm:col-span-2" : ""}`}>
          <label htmlFor={`${id}-${field.key}`} className="form-label">{field.label}{field.optional ? " (optional)" : ""}</label>
          {field.lookup ? <Lookup field={field} value={values[field.key] ?? ""} disabled={locked} inputId={`${id}-${field.key}`} context={field.contextKey ? String(fixed[field.contextKey] ?? values[field.contextKey] ?? "") || undefined : undefined}
              filter={field.filterKey ? String(fixed[field.filterKey] ?? values[field.filterKey] ?? "") || undefined : field.filter} onChange={value => update(field.key, value)} />
            : field.options || field.type === "boolean" ? <select id={`${id}-${field.key}`} className="form-input" value={values[field.key] ?? ""} required={!field.optional} {...invalid(field.key)} onChange={event => update(field.key, event.target.value)}>
                <option value="" disabled={!field.optional}>{field.optional ? "Not applicable" : "Choose"}</option>{Object.entries(field.options ?? { true: "Yes", false: "No" }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            : field.type === "note" ? <textarea id={`${id}-${field.key}`} className="form-input min-h-24" value={values[field.key] ?? ""} maxLength={field.max ?? 500} required={!field.optional} {...invalid(field.key)} onChange={event => update(field.key, event.target.value)} />
            : <input id={`${id}-${field.key}`} className="form-input" type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"} inputMode={field.type === "number" ? "decimal" : undefined}
                step={field.step} min={field.min} max={field.type === "number" ? field.max : undefined} maxLength={field.type === "number" || field.type === "date" ? undefined : field.max ?? 160}
                value={values[field.key] ?? ""} required={!field.optional} {...invalid(field.key)} onChange={event => update(field.key, event.target.value)} />}
          {field.help ? <p className="text-xs text-slate-600">{field.help}</p> : null}
        </div>;
      })}
    </fieldset>
    {error ? <p id={`${id}-error`} role="alert" className="text-sm font-semibold text-red-800">{error}</p> : null}
    <p className="text-xs text-slate-500">Review the server-generated consequence before confirming. Only a confirmed database result completes the action.</p>
    <Button type="submit" disabled={locked}>Review this action</Button>
  </form>;
}

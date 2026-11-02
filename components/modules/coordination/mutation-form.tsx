"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { coordinationAction } from "@/lib/actions/coordination";
import { canUseCoordinationAction, coordinationLookupSchema, coordinationMutationSchema, type CoordinationAction, type CoordinationMutation } from "@/lib/workflow/coordination";
import { useCoordinationAction } from "./action-center";

type LookupKind = "employees" | "orders" | "invoices" | "profiles";
type Field = { key: string; label: string; type?: "text" | "note" | "date" | "instant" | "number"; lookup?: LookupKind; options?: Record<string, string>; step?: string; min?: number; max?: number; help?: string };
export const ACTION_FORMS: Record<CoordinationAction, { title: string; fields: Field[] }> = {
  "coordinator.propose": { title: "Propose coordinator transfer", fields: [{ key: "order_id", label: "Order", lookup: "orders" }, { key: "employee_id", label: "Proposed coordinator", lookup: "employees" }] },
  "coordinator.accept": { title: "Accept coordinator responsibility", fields: [{ key: "order_id", label: "Order", lookup: "orders" }] },
  "priority.set": { title: "Set operational priority", fields: [{ key: "order_id", label: "Order", lookup: "orders" }, { key: "priority", label: "Priority", options: { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" } }] },
  "collection.create": { title: "Record a payment promise", fields: [{ key: "invoice_id", label: "Issued invoice", lookup: "invoices" }, { key: "employee_id", label: "Collection owner", lookup: "employees" }, { key: "amount", label: "Promised amount (INR)", type: "number", step: "0.01", min: 0.01 }, { key: "due_date", label: "Promised date", type: "date" }, { key: "disputed_amount", label: "Disputed amount (INR)", type: "number", step: "0.01", min: 0 }] },
  "collection.update": { title: "Update collection follow-up", fields: [{ key: "employee_id", label: "Collection owner", lookup: "employees" }, { key: "due_date", label: "Next follow-up date", type: "date" }, { key: "disputed_amount", label: "Disputed amount (INR)", type: "number", step: "0.01", min: 0 }] },
  "collection.withdraw": { title: "Withdraw this promise", fields: [] },
  "contract.publish": { title: "Publish receiving expectations", fields: [{ key: "team", label: "Receiving team", options: { packaging: "Packaging", quality: "Quality", dispatch: "Dispatch" } }, { key: "response_hours", label: "Response target (elapsed hours)", type: "number", step: "1", min: 1, max: 720, help: "Elapsed hours include nights and holidays. This does not change the existing acceptance checks." }, { key: "requirements", label: "Required identity, quantity, location and prerequisites", type: "note", max: 1200 }, { key: "evidence", label: "Required evidence and permitted clarification route", type: "note", max: 500 }] },
  "coverage.propose": { title: "Propose backup coverage", fields: [{ key: "primary_id", label: "Primary employee", lookup: "employees" }, { key: "backup_id", label: "Eligible backup", lookup: "employees" }, { key: "responsibility", label: "Responsibility covered", max: 160 }, { key: "starts_at", label: "Coverage starts (IST)", type: "instant" }, { key: "ends_at", label: "Coverage ends (IST)", type: "instant" }] },
  "coverage.acknowledge": { title: "Acknowledge backup responsibility", fields: [] },
  "coverage.cancel": { title: "End backup coverage", fields: [] },
  "coverage.reconcile": { title: "Reconcile coverage windows", fields: [] },
  "session.start": { title: "Capture a daily coordination session", fields: [] },
  "decision.create": { title: "Record an assigned decision", fields: [{ key: "order_id", label: "Affected order", lookup: "orders" }, { key: "title", label: "Agreed action", max: 160 }, { key: "employee_id", label: "Decision owner", lookup: "employees" }, { key: "due_date", label: "Due date", type: "date" }] },
  "request.create": { title: "Ask another team", fields: [{ key: "order_id", label: "Affected order", lookup: "orders" }, { key: "employee_id", label: "Recipient", lookup: "employees" }, { key: "due_date", label: "Needed by", type: "date" }, { key: "message", label: "What is needed", type: "note", max: 300 }, { key: "criteria", label: "Completion criteria", type: "note", max: 500 }] },
  "request.progress": { title: "Respond to this request", fields: [{ key: "stage", label: "Response", options: { acknowledged: "Acknowledge", clarification: "Ask for clarification", resolved: "Resolve with evidence", withdrawn: "Withdraw (requester only)" } }] },
  "steward.assign": { title: "Assign section-weight stewards", fields: [{ key: "employee_id", label: "Primary steward", lookup: "employees" }, { key: "backup_id", label: "Backup steward", lookup: "employees" }] },
  "correction.report": { title: "Report a profile weight correction", fields: [{ key: "profile_id", label: "Profile", lookup: "profiles" }, { key: "proposed_weight", label: "Proposed section weight (kg/m)", type: "number", step: "0.001", min: 0.001, max: 1000 }, { key: "evidence", label: "Source evidence and revision", type: "note", max: 500 }] },
  "correction.review": { title: "Review profile correction", fields: [{ key: "decision", label: "Review outcome", options: { approved: "Approve current-master correction", rejected: "Reject with reason", superseded: "Supersede stale proposal" } }] }
};

function Lookup({ field, value, disabled, inputId, onChange }: { field: Field; value: string; disabled: boolean; inputId: string; onChange: (value: string) => void }) {
  const [options, setOptions] = useState<SearchableSelectOption[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const version = ++generation.current;
    let live = true;
    setLoading(true); setError("");
    const timer = setTimeout(async () => {
      try {
        const result = await coordinationAction({ command: "lookup", kind: field.lookup, search: query });
        const selected = value ? await coordinationAction({ command: "lookup", kind: field.lookup, selected_id: value }) : null;
        if (!live || version !== generation.current) return;
        if (!result.success) throw new Error(result.error);
        if (selected && !selected.success) throw new Error(selected.error);
        const list = coordinationLookupSchema.parse(result.data);
        const exact = selected?.success ? coordinationLookupSchema.parse(selected.data) : [];
        const rows = [...new Map([...exact, ...list].map(row => [row.value, { ...row, description: row.context }])).values()];
        setOptions(rows);
        if (value && !exact.some(row => row.value === value)) setError("The selected record is no longer eligible. Clear it and choose a current record.");
      } catch (cause) { if (live && version === generation.current) setError(cause instanceof Error ? cause.message : "Lookup unavailable. Retry."); }
      finally { if (live && version === generation.current) setLoading(false); }
    }, 180);
    return () => { live = false; clearTimeout(timer); };
  }, [field.lookup, query, value, retry]);
  return <SearchableSelect inputId={inputId} ariaLabel={field.label} value={value} options={options} disabled={disabled} onChange={onChange} onSearchChange={setQuery} searching={loading} error={error} onRetry={() => setRetry(previous => previous + 1)} placeholder={`Search ${field.label.toLowerCase()}`} />;
}

export function CoordinationMutationForm({ action, role, fixed = {}, initial = {} }: { action: CoordinationAction; role: string; fixed?: Record<string, string>; initial?: Record<string, string> }) {
  const descriptor = ACTION_FORMS[action];
  const id = useId();
  const { locked, review } = useCoordinationAction();
  const [values, setValues] = useState<Record<string, string>>({ disputed_amount: "0", ...initial });
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<string | null>(null);
  if (!canUseCoordinationAction(role, action)) return null;
  const fields = [...descriptor.fields.filter(field => !(field.key in fixed)), { key: "note", label: "Reason, contact outcome or supporting decision", type: "note" as const, max: 500 }];
  function update(field: string, value: string) { setValues(current => ({ ...current, [field]: value })); setError(""); setErrorField(null); }
  async function submit() {
    const mutation: Record<string, unknown> = { action, ...fixed };
    for (const field of fields) {
      const value = values[field.key] ?? "";
      if (field.type === "number") mutation[field.key] = value.trim() ? Number(value) : undefined;
      else if (field.type === "instant") {
        // These controls are explicitly India time regardless of the browser's timezone.
        const parsed = new Date(`${value}:00+05:30`);
        mutation[field.key] = Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : "";
      } else mutation[field.key] = value;
    }
    const parsed = coordinationMutationSchema.safeParse(mutation);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]; const key = String(issue?.path[0] ?? "note");
      setError(issue?.message ?? "Review these details."); setErrorField(key);
      document.getElementById(`${id}-${key}`)?.focus(); return;
    }
    await review(parsed.data as CoordinationMutation);
  }
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h3 className="font-bold text-slate-900">{descriptor.title}</h3>
    <fieldset disabled={locked} className="grid min-w-0 gap-4 sm:grid-cols-2">
      {fields.map(field => <div key={field.key} className={`min-w-0 space-y-1 ${field.type === "note" ? "sm:col-span-2" : ""}`}>
        <label htmlFor={`${id}-${field.key}`} className="form-label">{field.label}</label>
        {field.lookup ? <Lookup field={field} value={values[field.key] ?? ""} disabled={locked} inputId={`${id}-${field.key}`} onChange={value => update(field.key, value)} />
          : field.options ? <select id={`${id}-${field.key}`} className="form-input" value={values[field.key] ?? ""} required onChange={event => update(field.key, event.target.value)}><option value="" disabled>Choose {field.label.toLowerCase()}</option>{Object.entries(field.options).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          : field.type === "note" ? <textarea id={`${id}-${field.key}`} className="form-input min-h-24" value={values[field.key] ?? ""} maxLength={field.max ?? 500} required aria-invalid={errorField === field.key || undefined} aria-describedby={errorField === field.key ? `${id}-error` : undefined} onChange={event => update(field.key, event.target.value)} />
          : <input id={`${id}-${field.key}`} className="form-input" type={field.type === "instant" ? "datetime-local" : field.type === "date" ? "date" : field.type === "number" ? "number" : "text"} step={field.step} min={field.min} max={field.type === "number" ? field.max : undefined} maxLength={field.type !== "number" ? field.max ?? 160 : undefined} value={values[field.key] ?? ""} required aria-invalid={errorField === field.key || undefined} aria-describedby={errorField === field.key ? `${id}-error` : undefined} onChange={event => update(field.key, event.target.value)} />}
        {field.help ? <p className="text-xs text-slate-600">{field.help}</p> : null}
      </div>)}
    </fieldset>
    {error ? <p id={`${id}-error`} role="alert" className="text-sm font-semibold text-red-800">{error}</p> : null}
    <p className="text-xs text-slate-500">Review the server-generated consequence before confirming. Only a confirmed database result completes the action.</p>
    <Button type="submit" disabled={locked}>Review this action</Button>
  </form>;
}

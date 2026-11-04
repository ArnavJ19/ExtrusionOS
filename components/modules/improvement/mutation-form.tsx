"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { improvementAction } from "@/lib/actions/improvement";
import { DENOMINATORS, DIE_TYPES, NOTELESS_ACTIONS, OCCURRENCE_TYPES, PROBLEM_CATEGORIES, SERVICE_EVENTS, SUGGESTION_CATEGORIES, SUGGESTION_RESPONSES, THRESHOLD_BASES,
  canUseImprovementAction, improvementLookupSchema, type ImprovementAction, type ImprovementMutation } from "@/lib/workflow/improvement";
import { buildImprovementMutation, improvementFieldVisible, type ImprovementField as Field } from "@/lib/workflow/improvement-form";
import { useImprovementAction } from "./action-center";

export const IMPROVEMENT_ACTION_FORMS: Record<ImprovementAction, { title: string; fields: Field[] }> = {
  "problem.open": { title: "Open a recurring problem", fields: [{ key: "title", label: "Problem", max: 120 }, { key: "category", label: "Category", options: PROBLEM_CATEGORIES },
    { key: "description", label: "What keeps happening", type: "note", max: 1000 }, { key: "owner_id", label: "Improvement owner", lookup: "employees" },
    { key: "containment", label: "Immediate containment (optional)", type: "note", max: 500, optional: true, help: "What protects customers now, for example 100% inspection. This is not the fix." }] },
  "problem.link": { title: "Link an occurrence", fields: [{ key: "source_type", label: "Kind of occurrence", options: OCCURRENCE_TYPES },
    { key: "source_id", label: "Occurrence", lookup: "incidents", filterKey: "source_type", help: "Each occurrence belongs to one problem. Only adverse records are listed." }] },
  "problem.unlink": { title: "Remove a wrongly linked occurrence", fields: [] },
  "problem.investigate": { title: "Record the cause", fields: [{ key: "cause", label: "Cause", type: "note", max: 800 },
    { key: "cause_basis", label: "Basis", options: { observation: "Observation (not yet established)", established: "Established by investigation" } },
    { key: "cause_evidence", label: "Investigation evidence", type: "note", max: 500, optional: true, help: "Required when the cause is established: tests, photos, trial runs." }] },
  "problem.plan": { title: "Plan the improvement and its trial", fields: [{ key: "proposed_action", label: "Proposed change", type: "note", max: 800 }, { key: "trial_scope", label: "Trial scope", max: 300, help: "Where and for how long, for example Press A for one week." },
    { key: "review_date", label: "Effectiveness review date", type: "date" }, { key: "denominator", label: "Measure recurrence per", options: DENOMINATORS },
    { key: "procedure_improvement_id", label: "Linked procedure change (optional)", lookup: "procedure_improvements", optional: true }] },
  "problem.trial": { title: "Start the trial now", fields: [] },
  "problem.cancel_trial": { title: "Cancel the trial", fields: [] },
  "problem.review": { title: "Record the effectiveness review", fields: [{ key: "decision", label: "Decision", options: { effective: "Effective: close the problem", not_effective: "Not effective: investigate again" } },
    { key: "evidence", label: "Evidence for the decision", type: "note", max: 500 }] },
  "problem.reopen": { title: "Reopen the problem", fields: [] },
  "problem.reassign": { title: "Change the improvement owner", fields: [{ key: "owner_id", label: "New owner", lookup: "employees" }] },
  "suggestion.submit": { title: "Suggest an improvement", fields: [{ key: "category", label: "What kind of friction", options: SUGGESTION_CATEGORIES },
    { key: "description", label: "What happened and what would help", type: "note", max: 1000, help: "Describe the step, not a person. Do not paste customer or salary details." },
    { key: "evidence", label: "Supporting reference (optional)", max: 500, optional: true, help: "For example a photo number or record number. Draft form values are never attached." }] },
  "suggestion.respond": { title: "Respond to the suggestion", fields: [{ key: "status", label: "Move to", options: SUGGESTION_RESPONSES },
    { key: "response", label: "Response to the contributor", type: "note", max: 800 }, { key: "decline_reason", label: "Why it is declined", type: "note", max: 500, when: { status: ["declined"] } },
    { key: "internal_note", label: "Internal note (process owners only, optional)", type: "note", max: 800, optional: true }] },
  "suggestion.clarify": { title: "Add the requested clarification", fields: [{ key: "clarification", label: "Clarification", type: "note", max: 800 }] },
  "suggestion.merge": { title: "Merge with a similar suggestion", fields: [{ key: "into_id", label: "Keep following under", lookup: "suggestions" }] },
  "suggestion.link": { title: "Link to improvement work", fields: [{ key: "problem_id", label: "Recurring problem (optional)", lookup: "problems", optional: true },
    { key: "procedure_improvement_id", label: "Procedure change (optional)", lookup: "procedure_improvements", optional: true }] },
  "suggestion.reassign": { title: "Route to another process owner", fields: [{ key: "owner_id", label: "Process owner", lookup: "managers" }] },
  "route.set": { title: "Route a kind of suggestion", fields: [{ key: "category", label: "Kind of suggestion", options: SUGGESTION_CATEGORIES }, { key: "owner_id", label: "Process owner", lookup: "managers" }] },
  "threshold.propose": { title: "Propose a die service threshold", fields: [{ key: "die_type", label: "Die type (optional; blank applies to all dies)", options: DIE_TYPES, optional: true },
    { key: "basis", label: "Count", options: THRESHOLD_BASES }, { key: "service_event", label: "Restart the count after", options: SERVICE_EVENTS },
    { key: "warn_at", label: "Warn at", type: "number", step: "0.001", min: 1, help: "Kg allow three decimals; runs and days are whole numbers." }, { key: "rationale", label: "Technical rationale", type: "note", max: 500 }] },
  "threshold.approve": { title: "Approve the threshold", fields: [] },
  "threshold.retire": { title: "Retire the threshold", fields: [] }
};

function Lookup({ field, value, disabled, inputId, filter, onChange }: { field: Field; value: string; disabled: boolean; inputId: string; filter?: string; onChange: (value: string) => void }) {
  const [options, setOptions] = useState<SearchableSelectOption[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const waiting = Boolean(field.filterKey && !filter);
  useEffect(() => {
    const version = ++generation.current;
    let live = true;
    if (waiting) { setOptions([]); setLoading(false); setError(""); return; }
    setLoading(true); setError("");
    const scope = filter ? { filter } : {};
    const timer = setTimeout(async () => {
      try {
        const result = await improvementAction({ command: "lookup", kind: field.lookup, search: query, ...scope });
        const selected = value ? await improvementAction({ command: "lookup", kind: field.lookup, selected_id: value, ...scope }) : null;
        if (!live || version !== generation.current) return;
        if (!result.success) throw new Error(result.error);
        if (selected && !selected.success) throw new Error(selected.error);
        const rows = improvementLookupSchema.parse(result.data);
        const exact = selected?.success ? improvementLookupSchema.parse(selected.data) : [];
        setOptions([...new Map([...exact, ...rows].map(row => [row.value, { value: row.value, label: row.label, description: row.context }])).values()]);
        if (value && !exact.some(row => row.value === value)) setError("The selected record is no longer eligible. Clear it and choose a current record.");
      } catch (cause) { if (live && version === generation.current) setError(cause instanceof Error ? cause.message : "Lookup unavailable. Retry."); }
      finally { if (live && version === generation.current) setLoading(false); }
    }, 180);
    return () => { live = false; clearTimeout(timer); };
  }, [field.lookup, query, value, retry, filter, waiting]);
  return <SearchableSelect inputId={inputId} ariaLabel={field.label} value={value} options={options} disabled={disabled || waiting} onChange={onChange} onSearchChange={setQuery} searching={loading}
    error={error} onRetry={() => setRetry(previous => previous + 1)} placeholder={waiting ? "Choose the kind above first" : `Search ${field.label.toLowerCase()}`} />;
}

export function ImprovementMutationForm({ action, role, fixed = {}, initial = {}, title, only }: { action: ImprovementAction; role: string; fixed?: Record<string, unknown>; initial?: Record<string, string>; title?: string; only?: readonly string[] }) {
  const descriptor = IMPROVEMENT_ACTION_FORMS[action];
  const id = useId();
  const { locked, review } = useImprovementAction();
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<string | null>(null);
  if (!canUseImprovementAction(role, action)) return null;
  const noteless = NOTELESS_ACTIONS.includes(action);
  const fields = [...descriptor.fields.filter(field => !(field.key in fixed)), ...(noteless ? [] : [{ key: "note", label: "Reason or supporting evidence", type: "note" as const, max: 500 }])];
  const shown = fields.filter(field => improvementFieldVisible(field, values, fixed));
  function update(field: string, value: string) { setValues(current => ({ ...current, [field]: value })); setError(""); setErrorField(null); }
  async function submit() {
    const parsed = buildImprovementMutation(action, fields, values, fixed);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]; const key = String(issue?.path[0] ?? "note");
      setError(issue?.message ?? "Review these details."); setErrorField(key);
      document.getElementById(`${id}-${key}`)?.focus(); return;
    }
    await review(parsed.data as ImprovementMutation);
  }
  const invalid = (key: string) => ({ "aria-invalid": errorField === key || undefined, "aria-describedby": errorField === key ? `${id}-error` : undefined });
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h3 className="font-bold text-slate-900">{title ?? descriptor.title}</h3>
    <fieldset disabled={locked} className="grid min-w-0 gap-4 sm:grid-cols-2">
      {shown.map(field => {
        const options = field.options && only && field.key === "status" ? Object.fromEntries(Object.entries(field.options).filter(([key]) => only.includes(key))) : field.options;
        return <div key={field.key} className={`min-w-0 space-y-1 ${field.type === "note" ? "sm:col-span-2" : ""}`}>
          <label htmlFor={`${id}-${field.key}`} className="form-label">{field.label}</label>
          {field.lookup ? <Lookup field={field} value={values[field.key] ?? ""} disabled={locked} inputId={`${id}-${field.key}`}
              filter={field.filterKey ? String(fixed[field.filterKey] ?? values[field.filterKey] ?? "") || undefined : undefined} onChange={value => update(field.key, value)} />
            : options ? <select id={`${id}-${field.key}`} className="form-input" value={values[field.key] ?? ""} required={!field.optional} {...invalid(field.key)} onChange={event => update(field.key, event.target.value)}>
                <option value="" disabled={!field.optional}>{field.optional ? "Not applicable" : "Choose"}</option>{Object.entries(options).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            : field.type === "note" ? <textarea id={`${id}-${field.key}`} className="form-input min-h-24" value={values[field.key] ?? ""} maxLength={field.max ?? 500} required={!field.optional} {...invalid(field.key)} onChange={event => update(field.key, event.target.value)} />
            : <input id={`${id}-${field.key}`} className="form-input" type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"} inputMode={field.type === "number" ? "decimal" : undefined}
                step={field.step} min={field.min} maxLength={field.type === "number" || field.type === "date" ? undefined : field.max ?? 160}
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

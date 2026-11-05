"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { executionAction } from "@/lib/actions/execution";
import { ASSIGNABLE_ROLES, CUSTODIAN_KINDS, GATE_KINDS, MESSAGE_TEMPLATES, NOTELESS_ACTIONS, ROUTE_NON_SKIPPABLE, STAGES, WIP_STAGES, canUseExecutionAction, executionLookupSchema,
  type ExecutionAction, type ExecutionMutation } from "@/lib/workflow/execution";
import { buildExecutionMutation, executionFieldVisible, executionLookupKind, type ExecutionField as Field } from "@/lib/workflow/execution-form";
import { useExecutionAction } from "./action-center";

const SKIPPABLE = Object.fromEntries(Object.entries(STAGES).filter(([key]) => !(ROUTE_NON_SKIPPABLE as readonly string[]).includes(key)));
const OUTCOMES = { completed: "Completed: unloaded and accepted", unloading_failed: "Unloading failed", missed: "Missed: nobody received it in the slot" };

export const EXECUTION_ACTION_FORMS: Record<ExecutionAction, { title: string; fields: Field[] }> = {
  "appointment.request": { title: "Request a delivery appointment", fields: [{ key: "order_id", label: "Order", lookup: "orders" },
    { key: "dispatch_id", label: "Dispatch (optional)", lookup: "dispatches", parentKey: "order_id", optional: true, help: "Leave blank for a whole-order appointment." },
    { key: "requested_start", label: "Slot starts (IST)", type: "datetime" }, { key: "requested_end", label: "Slot ends (IST)", type: "datetime", help: "An overnight slot is allowed; at most 48 hours." },
    { key: "owner_id", label: "Who secures the confirmation", lookup: "employees" },
    { key: "site_address", label: "Delivery site address (optional)", type: "note", max: 400, optional: true, help: "Leave blank to use the customer's default address. A different address is kept with this appointment only." },
    { key: "contact_name", label: "Receiving contact (optional)", max: 80, optional: true }, { key: "contact_phone", label: "Contact mobile (optional)", type: "phone", optional: true, help: "Shown in full only to dispatch and sales." },
    { key: "access_restrictions", label: "Access restrictions (optional)", type: "note", max: 300, optional: true }, { key: "preparations", label: "Site preparation needed (optional)", type: "note", max: 300, optional: true }] },
  "appointment.confirm": { title: "Record the site's confirmation", fields: [{ key: "confirmed_start", label: "Confirmed slot starts (IST)", type: "datetime" }, { key: "confirmed_end", label: "Confirmed slot ends (IST)", type: "datetime" },
    { key: "confirmed_by_name", label: "Confirmed by (name and role at the site)", max: 80 }] },
  "appointment.reschedule": { title: "Reschedule or change the arrangements", fields: [{ key: "requested_start", label: "New slot starts (IST)", type: "datetime" }, { key: "requested_end", label: "New slot ends (IST)", type: "datetime" },
    { key: "site_address", label: "New site address (optional)", type: "note", max: 400, optional: true }, { key: "contact_name", label: "Receiving contact (optional)", max: 80, optional: true },
    { key: "contact_phone", label: "Contact mobile (optional)", type: "phone", optional: true }, { key: "access_restrictions", label: "Access restrictions (optional)", type: "note", max: 300, optional: true },
    { key: "preparations", label: "Site preparation needed (optional)", type: "note", max: 300, optional: true }] },
  "appointment.cancel": { title: "Cancel the appointment", fields: [] },
  "appointment.arrive": { title: "Record arrival at the site", fields: [] },
  "appointment.outcome": { title: "Record the delivery outcome", fields: [{ key: "result", label: "Outcome", options: OUTCOMES }] },
  "gatepass.issue": { title: "Issue a returnable gate pass", fields: [{ key: "item_kind", label: "What is leaving", options: GATE_KINDS },
    { key: "die_id", label: "Die", lookup: "dies", when: { item_kind: ["die"] } }, { key: "item_label", label: "Item description", max: 120 },
    { key: "serial_ref", label: "Serial or tag number (optional)", max: 60, optional: true, help: "A serial number makes the item one-of-a-kind: quantity 1, one open pass." },
    { key: "quantity", label: "Quantity", type: "number", step: "1", min: 1 }, { key: "custodian_name", label: "Held by", max: 120 }, { key: "custodian_kind", label: "Custodian is a", options: CUSTODIAN_KINDS },
    { key: "purpose", label: "Why it is leaving", type: "note", max: 300 }, { key: "due_date", label: "Expected back", type: "date" }, { key: "owner_id", label: "Return follow-up", lookup: "employees" }] },
  "gatepass.depart": { title: "Record departure", fields: [] },
  "gatepass.acknowledge": { title: "Record the custodian's acknowledgement", fields: [{ key: "acknowledged_by_name", label: "Received by", max: 80 }] },
  "gatepass.return": { title: "Record a return", fields: [{ key: "quantity", label: "Quantity returned", type: "number", step: "1", min: 1 }, { key: "condition", label: "Condition", options: { good: "Good", damaged: "Damaged" } }] },
  "gatepass.lose": { title: "Record a loss", fields: [{ key: "quantity", label: "Quantity lost", type: "number", step: "1", min: 1 }] },
  "gatepass.extend": { title: "Extend the expected return", fields: [{ key: "due_date", label: "New expected return", type: "date" }] },
  "gatepass.cancel": { title: "Cancel the gate pass", fields: [] },
  "loadplan.stop": { title: "Set the unloading stop", fields: [{ key: "stop_seq", label: "Stop number (1 unloads first)", type: "number", step: "1", min: 1, max: 20 }, { key: "unload_note", label: "Unloading note (optional)", max: 200, optional: true }] },
  "loadplan.confirm": { title: "Record loading", fields: [{ key: "status", label: "Result", options: { loaded: "Loaded on the vehicle", not_loaded: "Not loaded: removed from this load", unloaded_exception: "Unloading exception (was loaded)" } },
    { key: "method", label: "How it was confirmed", options: { scan: "Label scanned", manual: "Checked by hand" } }] },
  "loadplan.review": { title: "Review this load for departure", fields: [] },
  "window.set": { title: "Set the protected execution window", fields: [{ key: "machine_id", label: "Press (optional; blank covers all presses)", lookup: "machines", optional: true },
    { key: "horizon_hours", label: "Protect the next (hours)", type: "number", step: "1", min: 12, max: 168 }, { key: "enforce", label: "Mode", type: "bool", options: { no: "Advisory: record and show", yes: "Enforced: the server refuses direct changes" } }] },
  "window.retire": { title: "Retire the window", fields: [] },
  "window.request": { title: "Request a change inside the window", fields: [{ key: "job_id", label: "Production job", lookup: "jobs" }, { key: "new_date", label: "New planned date", type: "date" },
    { key: "new_shift", label: "New shift (optional)", max: 20, optional: true }, { key: "customer_effect", label: "Effect on the customer", type: "note", max: 300, help: "For example: delivery moves by two days; customer informed." }] },
  "window.approve": { title: "Approve and apply the change", fields: [] },
  "window.reject": { title: "Reject the change", fields: [] },
  "wip.set_limit": { title: "Set an advisory stage limit", fields: [{ key: "stage", label: "Stage", options: WIP_STAGES }, { key: "unit", label: "Measured in", options: { kg: "Kilograms", jobs: "Number of jobs" }, help: "Pick one unit; kg and jobs are never added together." },
    { key: "limit_value", label: "Limit", type: "number", step: "0.001", min: 0.001 }, { key: "basis", label: "Why this limit", type: "note", max: 300, help: "For example: the packing bay holds about one shift of output." }] },
  "wip.retire_limit": { title: "Retire the limit", fields: [] },
  "wip.release": { title: "Record a release past the limit", fields: [{ key: "job_id", label: "Production job being released", lookup: "jobs" }] },
  "rule.set": { title: "Set the assignment rule", fields: [{ key: "task_type", label: "Task type", max: 40, help: "As on the task, for example inspection or general." },
    { key: "allowed_roles", label: "Roles that may take it", type: "multi", options: ASSIGNABLE_ROLES }, { key: "competency_id", label: "Required competency (optional)", lookup: "competencies", optional: true },
    { key: "estimate_minutes", label: "Typical minutes (optional)", type: "number", step: "1", min: 1, optional: true, help: "Leave blank if unknown. Unknown is counted as unestimated, never as zero." }] },
  "rule.retire": { title: "Retire the rule", fields: [] },
  "availability.record": { title: "Record unavailability", fields: [{ key: "employee_id", label: "Employee", lookup: "employees" }, { key: "starts_on", label: "From", type: "date" }, { key: "ends_on", label: "To (inclusive)", type: "date" },
    { key: "kind", label: "Reason", options: { leave: "Leave", training: "Training", off_shift: "Off shift", other: "Other" } }] },
  "availability.cancel": { title: "Cancel the unavailability", fields: [] },
  "assignment.assign": { title: "Assign the task", fields: [{ key: "assignee_id", label: "Assign to", lookup: "employees" },
    { key: "override_reason", label: "Reason to assign despite conflicts (optional)", type: "note", max: 300, optional: true, help: "Required when the person is unavailable or already heavily committed." }] },
  "route.define": { title: "Define a workflow route", fields: [{ key: "code", label: "Code", max: 30, help: "Lowercase letters, digits and underscores, for example stock_sale." }, { key: "name", label: "Name", max: 80 },
    { key: "applies_when", label: "Use this route when", type: "note", max: 300 }, { key: "required_stages", label: "Required stages", type: "multi", options: STAGES, help: "Order confirmation, packing and dispatch are always required." },
    { key: "optional_stages", label: "Optional stages", type: "multi", options: STAGES, optional: true }] },
  "route.approve": { title: "Approve the route", fields: [] },
  "route.retire": { title: "Retire the route", fields: [] },
  "route.bind": { title: "Bind an order to a route", fields: [{ key: "order_id", label: "Order", lookup: "orders" }, { key: "family_id", label: "Approved route", lookup: "families" }] },
  "route.deviate": { title: "Request a deviation from the route", fields: [{ key: "stage", label: "Stage to skip", options: SKIPPABLE }] },
  "route.decide": { title: "Decide the deviation", fields: [{ key: "decision", label: "Decision", options: { approve: "Approve", reject: "Reject" } }] },
  "message.prepare": { title: "Prepare a customer message", fields: [{ key: "template", label: "Message", options: Object.fromEntries(Object.entries(MESSAGE_TEMPLATES).filter(([key]) => key !== "appointment_notice")) },
    { key: "entity_id", label: "Order or dispatch", lookupBy: { key: "template", kinds: { order_confirmation: "orders", dispatch_notice: "dispatches" } } },
    { key: "recipient_phone", label: "Recipient mobile (optional)", type: "phone", optional: true, help: "Leave blank to use the customer's recorded number." }] },
  "message.mark": { title: "Record how the message was used", fields: [{ key: "state", label: "What you did", options: { copied: "Copied the text", printed: "Printed it", downloaded: "Downloaded it" } }] },
  "message.cancel": { title: "Cancel the prepared message", fields: [] },
  "queue.update": { title: "Update tasks", fields: [] }
};

export function ExecutionLookup({ field, kind, parent, value, disabled, inputId, onChange }: { field: Field; kind: NonNullable<Field["lookup"]>; parent?: string; value: string; disabled: boolean; inputId: string; onChange: (value: string) => void }) {
  const [options, setOptions] = useState<SearchableSelectOption[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const waiting = Boolean(field.parentKey && !parent);
  useEffect(() => {
    const version = ++generation.current;
    let live = true;
    if (waiting) { setOptions([]); setLoading(false); setError(""); return; }
    setLoading(true); setError("");
    const scope = parent ? { parent_id: parent } : {};
    const timer = setTimeout(async () => {
      try {
        const result = await executionAction({ command: "lookup", kind, search: query, ...scope });
        const selected = value ? await executionAction({ command: "lookup", kind, selected_id: value, ...scope }) : null;
        if (!live || version !== generation.current) return;
        if (!result.success) throw new Error(result.error);
        if (selected && !selected.success) throw new Error(selected.error);
        const rows = executionLookupSchema.parse(result.data);
        const exact = selected?.success ? executionLookupSchema.parse(selected.data) : [];
        setOptions([...new Map([...exact, ...rows].map(row => [row.value, { value: row.value, label: row.label, description: row.context }])).values()]);
        if (value && !exact.some(row => row.value === value)) setError("The selected record is no longer available. Clear it and choose a current record.");
      } catch (cause) { if (live && version === generation.current) setError(cause instanceof Error ? cause.message : "Lookup unavailable. Retry."); }
      finally { if (live && version === generation.current) setLoading(false); }
    }, 180);
    return () => { live = false; clearTimeout(timer); };
  }, [kind, query, value, retry, parent, waiting]);
  return <SearchableSelect inputId={inputId} ariaLabel={field.label} value={value} options={options} disabled={disabled || waiting} onChange={onChange} onSearchChange={setQuery} searching={loading}
    error={error} onRetry={() => setRetry(previous => previous + 1)} placeholder={waiting ? "Choose the order first" : `Search ${field.label.toLowerCase()}`} />;
}

export function ExecutionMutationForm({ action, role, fixed = {}, initial = {}, title }: { action: ExecutionAction; role: string; fixed?: Record<string, unknown>; initial?: Record<string, string>; title?: string }) {
  const descriptor = EXECUTION_ACTION_FORMS[action];
  const id = useId();
  const { locked, review } = useExecutionAction();
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<string | null>(null);
  if (!canUseExecutionAction(role, action)) return null;
  const noteless = NOTELESS_ACTIONS.includes(action);
  const fields = [...descriptor.fields.filter(field => !(field.key in fixed)), ...(noteless ? [] : [{ key: "note", label: "Reason or supporting evidence", type: "note" as const, max: 500 }])];
  const shown = fields.filter(field => executionFieldVisible(field, values, fixed));
  function update(field: string, value: string) { setValues(current => ({ ...current, [field]: value })); setError(""); setErrorField(null); }
  async function submit() {
    const parsed = buildExecutionMutation(action, fields, values, fixed);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]; const key = String(issue?.path[0] ?? "note");
      setError(issue?.message ?? "Review these details."); setErrorField(key);
      document.getElementById(`${id}-${key}`)?.focus(); return;
    }
    await review(parsed.data as ExecutionMutation);
  }
  const invalid = (key: string) => ({ "aria-invalid": errorField === key || undefined, "aria-describedby": errorField === key ? `${id}-error` : undefined });
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h3 className="font-bold text-slate-900">{title ?? descriptor.title}</h3>
    <fieldset disabled={locked} className="grid min-w-0 gap-4 sm:grid-cols-2">
      {shown.map(field => {
        const kind = executionLookupKind(field, values, fixed);
        const options = field.options;
        const current = values[field.key] ?? "";
        return <div key={field.key} className={`min-w-0 space-y-1 ${field.type === "note" || field.type === "multi" ? "sm:col-span-2" : ""}`}>
          <label htmlFor={`${id}-${field.key}`} className="form-label">{field.label}</label>
          {!kind && field.lookupBy ? <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Choose the message first.</p> : kind ? <ExecutionLookup field={field} kind={kind} parent={field.parentKey ? String(fixed[field.parentKey] ?? values[field.parentKey] ?? "") || undefined : undefined} value={current} disabled={locked} inputId={`${id}-${field.key}`} onChange={value => update(field.key, value)} />
            : field.type === "multi" && options ? <div id={`${id}-${field.key}`} role="group" aria-label={field.label} className="grid gap-2 sm:grid-cols-2" tabIndex={-1}>{Object.entries(options).map(([value, label]) => {
                const chosen = current.split(",").filter(Boolean);
                return <label key={value} className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm"><input type="checkbox" checked={chosen.includes(value)}
                  onChange={event => update(field.key, (event.target.checked ? [...chosen, value] : chosen.filter(item => item !== value)).join(","))} />{label}</label>; })}</div>
            : field.type === "bool" && options ? <select id={`${id}-${field.key}`} className="form-input" value={current} required {...invalid(field.key)} onChange={event => update(field.key, event.target.value)}><option value="" disabled>Choose</option>
                {Object.entries(options).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            : options ? <select id={`${id}-${field.key}`} className="form-input" value={current} required={!field.optional} {...invalid(field.key)} onChange={event => update(field.key, event.target.value)}>
                <option value="" disabled={!field.optional}>{field.optional ? "Not applicable" : "Choose"}</option>{Object.entries(options).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            : field.type === "note" ? <textarea id={`${id}-${field.key}`} className="form-input min-h-24" value={current} maxLength={field.max ?? 500} required={!field.optional} {...invalid(field.key)} onChange={event => update(field.key, event.target.value)} />
            : <input id={`${id}-${field.key}`} className="form-input" type={field.type === "date" ? "date" : field.type === "datetime" ? "datetime-local" : field.type === "number" ? "number" : field.type === "phone" ? "tel" : "text"}
                inputMode={field.type === "number" ? "decimal" : field.type === "phone" ? "tel" : undefined} step={field.step} min={field.min} max={field.type === "number" ? field.max : undefined}
                maxLength={["number", "date", "datetime"].includes(field.type ?? "") ? undefined : field.max ?? 160} value={current} required={!field.optional} {...invalid(field.key)} onChange={event => update(field.key, event.target.value)} />}
          {field.help ? <p className="text-xs text-slate-600">{field.help}</p> : null}
        </div>;
      })}
    </fieldset>
    {error ? <p id={`${id}-error`} role="alert" className="text-sm font-semibold text-red-800">{error}</p> : null}
    <p className="text-xs text-slate-500">Review the server-generated consequence before confirming. Only a confirmed database result completes the action.</p>
    <Button type="submit" disabled={locked}>Review this action</Button>
  </form>;
}

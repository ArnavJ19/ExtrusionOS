"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { commercialAction } from "@/lib/actions/commercial";
import { CHARGE_TYPES, CLAIM_TYPES, EVIDENCE_KINDS, NOTELESS_ACTIONS, ORIGIN_KINDS, OUTCOME_KINDS, PARTY_KEYS, REASON_CODES, REMEDIES, SCENARIO_KINDS, UNIT_BASES, canUseCommercialAction, commercialLookupSchema,
  type CommercialAction, type CommercialMutation, type ScenarioChange } from "@/lib/workflow/commercial";
import { buildCommercialMutation, commercialFieldVisible, type CommercialField as Field } from "@/lib/workflow/commercial-form";
import { useCommercialAction } from "./action-center";

export const COMMERCIAL_ACTION_FORMS: Record<CommercialAction, { title: string; fields: Field[] }> = {
  "pricing.define": { title: "Define a pricing rule", fields: [{ key: "code", label: "Code", help: "Lowercase letters, digits and underscores, for example vol_kg. A new version of the same code replaces the old one when approved." },
    { key: "name", label: "Name" }, { key: "charge_type", label: "Charge", options: CHARGE_TYPES }, { key: "unit_basis", label: "Priced per", options: UNIT_BASES },
    { key: "customer_id", label: "Customer agreement (optional)", lookup: "customers", optional: true, help: "Leave blank for a rule that applies to every customer." },
    { key: "finishing_type", label: "Finish (optional)", optional: true, help: "Leave blank for any finish." },
    { key: "processing_code", label: "Processing code", when: { charge_type: ["processing_charge"] }, help: "For example cutting or packing. Different codes stack; the same code never does." },
    { key: "amount", label: "Amount (INR)", type: "number", step: "0.01", min: 0.01, when: { charge_type: ["minimum_charge", "processing_charge"] }, help: "The minimum for a line, or the charge per unit for processing." },
    { key: "precedence", label: "Precedence (0 to 100)", type: "number", step: "1", min: 0, max: 100, help: "If two approved rules of the same scope overlap, the higher precedence applies. Use 0 unless a rule must win." },
    { key: "effective_from", label: "Effective from", type: "date" }, { key: "effective_to", label: "Effective until (optional)", type: "date", optional: true },
    { key: "brackets", label: "Quantity brackets", type: "brackets", when: { charge_type: ["bracket_rate"] }, help: "One per line: start | end | rate. A bracket starts at its start and ends before its end; leave the last end empty. Example: 0 | 100 | 250 then 100 | | 230." }] },
  "pricing.approve": { title: "Approve the pricing rule", fields: [] },
  "pricing.retire": { title: "Retire the pricing rule", fields: [] },
  "pricing.void": { title: "Void the recorded price", fields: [] },
  "pricing.price": { title: "Calculate and record a price", fields: [{ key: "customer_id", label: "Customer", lookup: "customers" }, { key: "unit_basis", label: "Priced per", options: UNIT_BASES }, { key: "quantity", label: "Quantity", type: "number", step: "0.001", min: 0.001 },
    { key: "finishing_type", label: "Finish (optional)", optional: true }, { key: "processing_codes", label: "Processing charges (optional)", type: "codes", optional: true, help: "Comma-separated codes, for example cutting, packing." },
    { key: "quote_id", label: "Draft quotation (optional)", lookup: "quotes", parentKey: "customer_id", optional: true, help: "Attach the price to a quotation that has not been issued." },
    { key: "override_rate", label: "Override rate (optional)", type: "number", step: "0.0001", min: 0.0001, optional: true, help: "Sales managers only. It replaces the bracket rate and needs a reason." },
    { key: "override_reason", label: "Override reason", type: "note", max: 300, optional: true }] },
  "claim.submit": { title: "Submit a supplier claim", fields: [{ key: "purchase_order_line_id", label: "Purchase order line", lookup: "po_lines" }, { key: "claim_type", label: "Claim", options: CLAIM_TYPES },
    { key: "quantity", label: "Quantity claimed", type: "number", step: "0.001", min: 0.001, help: "Only the quantity still open to claim is accepted." }, { key: "amount", label: "Amount claimed (INR)", type: "number", step: "0.01", min: 0.01 },
    { key: "remedy", label: "Remedy requested", options: REMEDIES }, { key: "owner_id", label: "Follow-up owner", lookup: "employees" }, { key: "response_due", label: "Supplier response due", type: "date" }] },
  "claim.respond": { title: "Record the supplier response", fields: [{ key: "response", label: "Response", options: { agreed: "Agreed", disputed: "Disputed", rejected: "Rejected" } },
    { key: "agreed_quantity", label: "Agreed quantity", type: "number", step: "0.001", min: 0, when: { response: ["agreed"] }, help: "Use 0 where only an amount was agreed." },
    { key: "agreed_amount", label: "Agreed amount (INR)", type: "number", step: "0.01", min: 0, when: { response: ["agreed"] }, help: "Use 0 where only a quantity was agreed." }] },
  "claim.link": { title: "Link a recovery to the claim", fields: [{ key: "kind", label: "Recovery", options: REMEDIES },
    { key: "receipt_line_id", label: "Replacement receipt", lookup: "receipt_lines", parentKey: "id", when: { kind: ["replacement"] }, help: "Only receipts recorded after the claim can be linked." },
    { key: "quantity", label: "Quantity replaced", type: "number", step: "0.001", min: 0.001, when: { kind: ["replacement"] } },
    { key: "credit_id", label: "Posted supplier credit", lookup: "credits", parentKey: "id", when: { kind: ["credit", "refund"] }, help: "Choose a credit or refund the finance workflow already posted. This does not create one." }] },
  "claim.unlink": { title: "Reverse a linked recovery", fields: [] },
  "claim.close": { title: "Close the claim", fields: [] },
  "profit.snapshot": { title: "Record a profitability snapshot", fields: [{ key: "finalize", label: "Status", type: "bool", options: { no: "Provisional: more costs or invoices may follow", yes: "Final: agreed record for this order" } }] },
  "commitment.set": { title: "Record the supplier's promised date", fields: [{ key: "purchase_order_id", label: "Purchase order", lookup: "purchase_orders" }, { key: "promised_date", label: "Promised delivery date", type: "date" }] },
  "outcome.record": { title: "Record the quotation outcome", fields: [{ key: "quote_id", label: "Quotation", lookup: "quotes" }, { key: "outcome", label: "Outcome", options: OUTCOME_KINDS }, { key: "reason_code", label: "Main reason", options: REASON_CODES },
    { key: "evidence", label: "Where the reason came from", options: EVIDENCE_KINDS }, { key: "product_family", label: "Product family (optional)", optional: true }] },
  "outcome.reopen": { title: "Reopen the quotation", fields: [] },
  "remnant.record": { title: "Record a reusable remnant", fields: [{ key: "profile_id", label: "Profile", lookup: "profiles" }, { key: "length_mm", label: "Measured length (mm)", type: "number", step: "1", min: 100, max: 12000 },
    { key: "pieces", label: "Pieces", type: "number", step: "1", min: 1 }, { key: "finish", label: "Finish", help: "For example anodizing, powder coating or mill finish." }, { key: "origin_type", label: "Where it came from", options: ORIGIN_KINDS },
    { key: "location", label: "Rack or location" }, { key: "alloy", label: "Alloy (optional)", optional: true, help: "Defaults to the profile's alloy." }, { key: "temper", label: "Temper (optional)", optional: true },
    { key: "condition", label: "Condition", options: { good: "Good", damaged: "Damaged" }, optional: true }] },
  "remnant.review": { title: "Review the remnant", fields: [{ key: "decision", label: "Decision", options: { usable: "Usable: suggest it for matching requirements", hold: "Hold: keep it out of suggestions", damaged: "Damaged: remove it from suggestions" } }] },
  "remnant.reserve": { title: "Reserve pieces for an order line", fields: [{ key: "order_item_id", label: "Order line", lookup: "order_items", parentKey: "id" }, { key: "pieces", label: "Pieces to reserve", type: "number", step: "1", min: 1 }] },
  "remnant.consume": { title: "Record the pieces as cut and used", fields: [] },
  "remnant.release": { title: "Release the reservation", fields: [] },
  "remnant.scrap": { title: "Scrap the lot", fields: [] },
  "remnant.correct": { title: "Correct the measured lot", fields: [{ key: "length_mm", label: "Measured length (mm)", type: "number", step: "1", min: 100, max: 12000 }, { key: "pieces", label: "Pieces counted", type: "number", step: "1", min: 1 }] },
  "mapping.define": { title: "Define the invoice export mapping", fields: [{ key: "sales_ledger", label: "Sales ledger name in the accounting package" }, { key: "tax_ledger", label: "Tax ledger name in the accounting package" },
    { key: "party_key", label: "Identify the party by", options: PARTY_KEYS }] },
  "mapping.approve": { title: "Approve the export mapping", fields: [] },
  "mapping.retire": { title: "Retire the export mapping", fields: [] },
  "transfer.prepare": { title: "Prepare an invoice export batch", fields: [{ key: "count", label: "Number of invoices (oldest first, at most 25)", type: "number", step: "1", min: 1, max: 25 }] },
  "transfer.export": { title: "Record the batch as exported", fields: [] },
  "transfer.result": { title: "Record the accounting package result", fields: [{ key: "result", label: "Result", options: { accepted: "Accepted by the package", rejected: "Rejected by the package" } },
    { key: "external_reference", label: "Reference given by the package", when: { result: ["accepted"] } }] },
  "transfer.cancel": { title: "Cancel the prepared batch", fields: [] },
  "run.save": { title: "Save the run proposal", fields: [] },
  "run.accept": { title: "Accept the run proposal", fields: [] },
  "run.dismiss": { title: "Dismiss the run proposal", fields: [] },
  "scenario.create": { title: "Create a what-if scenario", fields: [{ key: "name", label: "Scenario name" }, { key: "horizon_days", label: "Horizon (days from today)", type: "number", step: "1", min: 3, max: 14 },
    { key: "changes", label: "Hypothetical changes", type: "changes", help: "Add up to six. Everything here is hypothetical and never changes the live plan." }] },
  "scenario.share": { title: "Share the scenario for review", fields: [] },
  "scenario.discard": { title: "Discard the scenario", fields: [] },
  "scenario.accept": { title: "Accept the scenario", fields: [] }
};

export function CommercialLookup({ field, kind, parent, value, disabled, inputId, onChange }: { field: Pick<Field, "label" | "parentKey">; kind: NonNullable<Field["lookup"]>; parent?: string; value: string; disabled: boolean; inputId: string; onChange: (value: string) => void }) {
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
        const result = await commercialAction({ command: "lookup", kind, search: query, ...scope });
        const selected = value ? await commercialAction({ command: "lookup", kind, selected_id: value, ...scope }) : null;
        if (!live || version !== generation.current) return;
        if (!result.success) throw new Error(result.error);
        if (selected && !selected.success) throw new Error(selected.error);
        const rows = commercialLookupSchema.parse(result.data);
        const exact = selected?.success ? commercialLookupSchema.parse(selected.data) : [];
        setOptions([...new Map([...exact, ...rows].map(row => [row.value, { value: row.value, label: row.label, description: row.context }])).values()]);
        if (value && !exact.some(row => row.value === value)) setError("The selected record is no longer available. Clear it and choose a current record.");
      } catch (cause) { if (live && version === generation.current) setError(cause instanceof Error ? cause.message : "Lookup unavailable. Retry."); }
      finally { if (live && version === generation.current) setLoading(false); }
    }, 180);
    return () => { live = false; clearTimeout(timer); };
  }, [kind, query, value, retry, parent, waiting]);
  return <SearchableSelect inputId={inputId} ariaLabel={field.label} value={value} options={options} disabled={disabled || waiting} onChange={onChange} onSearchChange={setQuery} searching={loading}
    error={error} onRetry={() => setRetry(previous => previous + 1)} placeholder={waiting ? "Choose the earlier field first" : `Search ${field.label.toLowerCase()}`} />;
}

const describe = (change: ScenarioChange) => change.type === "machine_down" ? `Press down from ${change.from_date} for ${change.days} day(s)` : change.type === "extra_shift" ? `Extra ${change.kg} kg on ${change.date}`
  : change.type === "urgent_order" ? `Urgent order of ${change.kg} kg due ${change.due_date}` : `Receipt delayed ${change.days} day(s) for one job`;

/** NOV-024: builds the list of hypothetical changes one at a time; the value is kept as JSON text in the form. */
function ChangesBuilder({ id, value, disabled, onChange }: { id: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  const [kind, setKind] = useState<ScenarioChange["type"]>("machine_down");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState("");
  let changes: ScenarioChange[] = [];
  try { const parsed = JSON.parse(value || "[]"); if (Array.isArray(parsed)) changes = parsed; } catch { changes = []; }
  const set = (key: string, next: string) => { setDraft(current => ({ ...current, [key]: next })); setProblem(""); };
  function add() {
    const number = (key: string) => Number(draft[key]);
    const next = kind === "machine_down" ? { type: kind, machine_id: draft.machine_id, from_date: draft.from_date, days: number("days") }
      : kind === "extra_shift" ? { type: kind, machine_id: draft.machine_id, date: draft.date, kg: number("kg") }
      : kind === "urgent_order" ? { type: kind, machine_id: draft.machine_id, kg: number("kg"), due_date: draft.due_date } : { type: kind, job_id: draft.job_id, days: number("days") };
    if (Object.values(next).some(entry => entry === undefined || entry === "" || Number.isNaN(entry))) { setProblem("Complete every field of this change first."); return; }
    if (changes.length >= 6) { setProblem("A scenario holds at most six changes."); return; }
    onChange(JSON.stringify([...changes, next])); setDraft({}); setProblem("");
  }
  return <div id={id} tabIndex={-1} className="space-y-3 rounded-xl border border-slate-200 p-3">
    {changes.length ? <ol className="space-y-1 text-sm">{changes.map((change, index) => <li key={index} className="flex flex-wrap items-center justify-between gap-2"><span>{index + 1}. {describe(change)}</span>
      <Button type="button" variant="secondary" disabled={disabled} onClick={() => onChange(JSON.stringify(changes.filter((_, position) => position !== index)))}>Remove</Button></li>)}</ol> : <p className="text-sm text-slate-600">No hypothetical change added yet.</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1"><span className="form-label">Kind of change</span><select className="form-input" value={kind} disabled={disabled} onChange={event => { setKind(event.target.value as ScenarioChange["type"]); setDraft({}); setProblem(""); }}>
        {Object.entries(SCENARIO_KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {kind !== "delayed_receipt" ? <div className="space-y-1"><span className="form-label">Press</span><CommercialLookup field={{ label: "Press" }} kind="machines" value={draft.machine_id ?? ""} disabled={disabled} inputId={`${id}-machine`} onChange={next => set("machine_id", next)} /></div>
        : <div className="space-y-1"><span className="form-label">Production job</span><CommercialLookup field={{ label: "Production job" }} kind="jobs" value={draft.job_id ?? ""} disabled={disabled} inputId={`${id}-job`} onChange={next => set("job_id", next)} /></div>}
      {kind === "machine_down" ? <><label className="space-y-1"><span className="form-label">First day down</span><input className="form-input" type="date" value={draft.from_date ?? ""} disabled={disabled} onChange={event => set("from_date", event.target.value)} /></label>
        <label className="space-y-1"><span className="form-label">Days down</span><input className="form-input" type="number" step="1" min={1} max={14} value={draft.days ?? ""} disabled={disabled} onChange={event => set("days", event.target.value)} /></label></> : null}
      {kind === "extra_shift" ? <><label className="space-y-1"><span className="form-label">Day of the extra shift</span><input className="form-input" type="date" value={draft.date ?? ""} disabled={disabled} onChange={event => set("date", event.target.value)} /></label>
        <label className="space-y-1"><span className="form-label">Extra capacity (kg)</span><input className="form-input" type="number" step="0.001" min={0.001} value={draft.kg ?? ""} disabled={disabled} onChange={event => set("kg", event.target.value)} /></label></> : null}
      {kind === "urgent_order" ? <><label className="space-y-1"><span className="form-label">Quantity (kg)</span><input className="form-input" type="number" step="0.001" min={0.001} value={draft.kg ?? ""} disabled={disabled} onChange={event => set("kg", event.target.value)} /></label>
        <label className="space-y-1"><span className="form-label">Due date</span><input className="form-input" type="date" value={draft.due_date ?? ""} disabled={disabled} onChange={event => set("due_date", event.target.value)} /></label></> : null}
      {kind === "delayed_receipt" ? <label className="space-y-1"><span className="form-label">Delay (days)</span><input className="form-input" type="number" step="1" min={1} max={14} value={draft.days ?? ""} disabled={disabled} onChange={event => set("days", event.target.value)} /></label> : null}
    </div>
    {problem ? <p role="alert" className="text-sm font-semibold text-red-800">{problem}</p> : null}
    <Button type="button" variant="secondary" disabled={disabled || changes.length >= 6} onClick={add}>Add this change</Button>
  </div>;
}

export function CommercialMutationForm({ action, role, fixed = {}, initial = {}, title }: { action: CommercialAction; role: string; fixed?: Record<string, unknown>; initial?: Record<string, string>; title?: string }) {
  const descriptor = COMMERCIAL_ACTION_FORMS[action];
  const id = useId();
  const { locked, review } = useCommercialAction();
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<string | null>(null);
  if (!canUseCommercialAction(role, action)) return null;
  const noteless = NOTELESS_ACTIONS.includes(action);
  const fields = [...descriptor.fields.filter(field => !(field.key in fixed)), ...(noteless ? [] : [{ key: "note", label: "Reason or supporting evidence", type: "note" as const, max: 500 }])];
  const shown = fields.filter(field => commercialFieldVisible(field, values, fixed));
  function update(field: string, value: string) { setValues(current => ({ ...current, [field]: value })); setError(""); setErrorField(null); }
  async function submit() {
    const parsed = buildCommercialMutation(action, fields, values, fixed);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]; const key = String(issue?.path[0] ?? "note");
      setError(issue?.message ?? "Review these details."); setErrorField(key);
      document.getElementById(`${id}-${key}`)?.focus(); return;
    }
    await review(parsed.data as CommercialMutation);
  }
  const invalid = (key: string) => ({ "aria-invalid": errorField === key || undefined, "aria-describedby": errorField === key ? `${id}-error` : undefined });
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h3 className="font-bold text-slate-900">{title ?? descriptor.title}</h3>
    <fieldset disabled={locked} className="grid min-w-0 gap-4 sm:grid-cols-2">
      {shown.map(field => {
        const options = field.options;
        const current = values[field.key] ?? "";
        const wide = field.type === "note" || field.type === "brackets" || field.type === "changes" || field.type === "codes";
        return <div key={field.key} className={`min-w-0 space-y-1 ${wide ? "sm:col-span-2" : ""}`}>
          <label htmlFor={`${id}-${field.key}`} className="form-label">{field.label}</label>
          {field.lookup ? <CommercialLookup field={field} kind={field.lookup} parent={field.parentKey ? String(fixed[field.parentKey] ?? values[field.parentKey] ?? "") || undefined : undefined} value={current} disabled={locked} inputId={`${id}-${field.key}`} onChange={value => update(field.key, value)} />
            : field.type === "changes" ? <ChangesBuilder id={`${id}-${field.key}`} value={current} disabled={locked} onChange={value => update(field.key, value)} />
            : field.type === "bool" && options ? <select id={`${id}-${field.key}`} className="form-input" value={current} required {...invalid(field.key)} onChange={event => update(field.key, event.target.value)}><option value="" disabled>Choose</option>
                {Object.entries(options).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            : options ? <select id={`${id}-${field.key}`} className="form-input" value={current} required={!field.optional} {...invalid(field.key)} onChange={event => update(field.key, event.target.value)}>
                <option value="" disabled={!field.optional}>{field.optional ? "Not applicable" : "Choose"}</option>{Object.entries(options).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            : field.type === "note" || field.type === "brackets" ? <textarea id={`${id}-${field.key}`} className="form-input min-h-24 font-mono" value={current} maxLength={field.max ?? 1000} required={!field.optional} {...invalid(field.key)} onChange={event => update(field.key, event.target.value)} />
            : <input id={`${id}-${field.key}`} className="form-input" type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
                inputMode={field.type === "number" ? "decimal" : undefined} step={field.step} min={field.min} max={field.type === "number" ? field.max : undefined}
                maxLength={["number", "date"].includes(field.type ?? "") ? undefined : field.max ?? 160} value={current} required={!field.optional} {...invalid(field.key)} onChange={event => update(field.key, event.target.value)} />}
          {field.help ? <p className="text-xs text-slate-600">{field.help}</p> : null}
        </div>;
      })}
    </fieldset>
    {error ? <p id={`${id}-error`} role="alert" className="text-sm font-semibold text-red-800">{error}</p> : null}
    <p className="text-xs text-slate-500">Review the server-generated consequence before confirming. Only a confirmed database result completes the action.</p>
    <Button type="submit" disabled={locked}>Review this action</Button>
  </form>;
}

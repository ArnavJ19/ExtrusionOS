"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { assuranceAction } from "@/lib/actions/assurance";
import { CHANGE_FIELDS, COUNT_DECISIONS, DELIVERY_DISPOSITIONS, DELIVERY_RESOLUTIONS, RETURN_RESPONSES, assuranceLookupSchema, canUseAssuranceAction,
  type AssuranceAction, type AssuranceMutation } from "@/lib/workflow/assurance";
import { NUMERIC_CHANGES, buildAssuranceMutation, type AssuranceField as Field } from "@/lib/workflow/assurance-form";
import { useAssuranceAction } from "./action-center";

const evidence: Field = { key: "evidence", label: "Evidence (document, slip, photo or call reference)", type: "note", max: 500 };
const kg: Field = { key: "quantity_kg", label: "Quantity (kg)", type: "number", step: "0.001", min: 0.001 };
const instant = (key: string, label: string): Field => ({ key, label, type: "instant" });
export const ASSURANCE_ACTION_FORMS: Record<AssuranceAction, { title: string; fields: Field[] }> = {
  "drawing.register": { title: "Register a drawing revision", fields: [{ key: "drawing_id", label: "Drawing", lookup: "drawings" }, { key: "revision_label", label: "Revision label", max: 20, help: "For example R2. A changed file always needs a new label." },
    { key: "file_sha256", label: "Drawing file", type: "file_hash", help: "The file is read on this device only to record its SHA-256 checksum. Upload it through Documents." },
    { key: "profile_id", label: "Profile it applies to", lookup: "profiles", optional: true }, { key: "customer_approval_required", label: "Customer approval required before release", type: "boolean" },
    { key: "technical_note", label: "What changed (shown in comparisons)", type: "note", max: 300, optional: true }] },
  "drawing.customer": { title: "Record a customer drawing event", fields: [{ key: "event", label: "Event", options: { submitted: "Sent to customer", customer_query: "Customer technical query", customer_approved: "Customer approved", customer_rejected: "Customer rejected" } },
    { key: "customer_contact", label: "Customer person who decided", max: 120, optional: true, help: "Required for an approval or rejection." }, evidence] },
  "drawing.release": { title: "Release for manufacture", fields: [] },
  "drawing.deviation": { title: "Permit one job to use this revision", fields: [{ key: "job_id", label: "Unstarted job", lookup: "jobs", contextKey: "revision_id" }, { key: "valid_until", label: "Valid until", type: "date" }, evidence] },
  "drawing.withdraw": { title: "Withdraw this revision", fields: [] },
  "incoming.dispose": { title: "Record a quality decision", fields: [{ key: "disposition", label: "Decision", options: { accept: "Accept", concession: "Accept under concession", reject: "Reject" } },
    { key: "quantity", label: "Quantity (purchase unit)", type: "number", step: "0.001", min: 0.001 }, { key: "certificate_ref", label: "Mill test certificate reference", max: 80, optional: true, help: "Required to accept. A concession can accept without it." }, evidence] },
  "incoming.return": { title: "Record return to supplier", fields: [{ key: "quantity", label: "Quantity returned (purchase unit)", type: "number", step: "0.001", min: 0.001 }, { ...evidence, label: "Gate pass or delivery challan reference" }] },
  "incoming.release": { title: "Release accepted kg to billet stock", fields: [kg, { key: "batch_number", label: "Billet batch number", max: 40, upper: true }, { key: "alloy", label: "Alloy", max: 20, upper: true, help: "For example 6063." },
    { key: "temper", label: "Billet temper", max: 10, upper: true, help: "For example F." }, { key: "diameter_mm", label: "Diameter (mm)", type: "number", step: "0.1", min: 20, max: 800, optional: true },
    { key: "heat_number", label: "Heat or cast number", max: 40, optional: true }] },
  "incoming.reverse": { title: "Reverse this decision", fields: [] },
  "delivery.record": { title: "Record what the customer did", fields: [{ key: "disposition", label: "Disposition", options: DELIVERY_DISPOSITIONS }, kg, { key: "receiver_name", label: "Received or reported by", max: 120 }, evidence] },
  "delivery.resolve": { title: "Resolve this exception", fields: [{ key: "resolution", label: "Resolution", options: DELIVERY_RESOLUTIONS },
    { key: "response", label: "Response for the return", options: { credit: RETURN_RESPONSES.credit, replacement: RETURN_RESPONSES.replacement, rework_return: RETURN_RESPONSES.rework_return }, optional: true, help: "Only when material will be returned." }] },
  "delivery.reverse": { title: "Reverse this disposition", fields: [] },
  "change.propose": { title: "Assess an order line change", fields: [{ key: "order_item_id", label: "Order line", lookup: "order_items" }, { key: "changes", label: "Proposed values", type: "changes", help: "Fill only the facts that change." }] },
  "change.decide": { title: "Decide on this change", fields: [{ key: "decision", label: "Decision", options: { approved: "Approve", abandoned: "Abandon" } }] },
  "change.resolve": { title: "Resolve this impact", fields: [{ key: "outcome", label: "Outcome", options: { done: "Done", not_required: "Not required" } }] },
  "capability.criteria": { title: "Set qualification evidence", fields: [{ key: "competency_id", label: "Competency", lookup: "competencies" }, { key: "supervised_required", label: "Supervised confirmations required", type: "number", step: "1", min: 0, max: 50 },
    { key: "observed_trial_required", label: "An observed procedure trial is required", type: "boolean" }] },
  "capability.assess": { title: "Record a qualification assessment", fields: [{ key: "employee_id", label: "Employee", lookup: "employees" }, { key: "competency_id", label: "Competency", lookup: "competencies" },
    { key: "outcome", label: "Outcome", options: { independent: "Independent: evidence demonstrated", more_practice: "More supervised practice needed" } }] },
  "instrument.register": { title: "Register a measuring instrument", fields: [{ key: "code", label: "Instrument code", max: 30, upper: true }, { key: "name", label: "Name", max: 120 },
    { key: "unit", label: "Measures", options: { mm: "mm", "kg/m": "kg/m", HW: "Webster hardness", micron: "micron", percent: "percent" } },
    { key: "range_min", label: "Range from", type: "number", step: "0.0001" }, { key: "range_max", label: "Range to", type: "number", step: "0.0001" }, { key: "location", label: "Location", max: 120, optional: true }] },
  "instrument.check": { title: "Record calibration or check evidence", fields: [{ key: "checked_on", label: "Checked on", type: "date" }, { key: "valid_until", label: "Valid until", type: "date" },
    { key: "result", label: "Result", options: { pass: "Pass", fail: "Fail" } }, { key: "certificate_ref", label: "Certificate or check reference", max: 80 }] },
  "instrument.withdraw": { title: "Withdraw this instrument", fields: [] },
  "instrument.bind": { title: "Record the instrument used for a result", fields: [{ key: "result_id", label: "Measured result", lookup: "results" }, { key: "instrument_id", label: "Instrument", lookup: "instruments" }] },
  "instrument.policy": { title: "Set instrument evidence policy", fields: [{ key: "mode", label: "When evidence is missing or invalid", options: { warn: "Warn only", block: "Block inspection approval" } }] },
  "instrument.review": { title: "Close this impact review", fields: [] },
  "capacity.move": { title: "Replan this slot", fields: [{ key: "machine_id", label: "Press", lookup: "presses" }, instant("start_at", "Start (IST)"), instant("end_at", "End (IST)"), { key: "shift", label: "Shift name", max: 40 }] },
  "capacity.unplan": { title: "Return this slot to planning", fields: [] },
  "capacity.review": { title: "Review this order promise", fields: [{ key: "decision", label: "Outcome", options: { promise_holds: "Promise still holds", customer_informed: "Customer informed", date_review_needed: "Date needs commercial review" } }] },
  "count.open": { title: "Open a cycle count", fields: [{ key: "location", label: "Stock location (as recorded on bundles)", max: 120 }, { key: "blind", label: "Hide expected quantities from counters", type: "boolean" }] },
  "count.record": { title: "Record a count", fields: [{ key: "unlisted_label", label: "Unlisted bundle label", max: 80, optional: true, help: "Only for a bundle not in the list." },
    { key: "counted_pieces", label: "Pieces counted", type: "number", step: "1", min: 0 }, { key: "counted_kg", label: "Weight (kg)", type: "number", step: "0.001", min: 0, optional: true, help: "Leave blank if not weighed." }] },
  "count.review": { title: "Review this line", fields: [{ key: "decision", label: "Decision", options: COUNT_DECISIONS }] },
  "count.close": { title: "Close this count", fields: [] },
  "pack.link": { title: "Link evidence", fields: [{ key: "document_id", label: "Document", lookup: "documents", contextKey: "dispatch_id" }] },
  "pack.waive": { title: "Authorize a deviation", fields: [] },
  "pack.issue": { title: "Issue the quality document pack", fields: [] },
  "pack.withdraw": { title: "Withdraw the issued pack", fields: [] },
  "return.authorize": { title: "Authorize a customer return", fields: [{ key: "packing_item_id", label: "Shipped bundle", lookup: "packing_items" }, { key: "expected_kg", label: "Expected quantity (kg)", type: "number", step: "0.001", min: 0.001 },
    { key: "response", label: "Approved response", options: RETURN_RESPONSES }] },
  "return.link": { title: "Link what resolves this return", fields: [{ key: "target_id", label: "Record", lookup: "return_targets", contextKey: "id", filterKey: "link_type" },
    { key: "quantity_kg", label: "Replacement quantity (kg)", type: "number", step: "0.001", min: 0.001, optional: true, help: "Credit quantities come from the credit note." }] },
  "return.close": { title: "Close this return", fields: [] },
  "return.reject": { title: "Reject this claim", fields: [] }
};

function Lookup({ field, value, disabled, inputId, context, filter, onChange }: { field: Field; value: string; disabled: boolean; inputId: string; context?: string; filter?: string; onChange: (value: string) => void }) {
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
    const scope = { ...(context ? { context_id: context } : {}), ...(filter ? { filter } : {}) };
    const timer = setTimeout(async () => {
      try {
        const result = await assuranceAction({ command: "lookup", kind: field.lookup, search: query, ...scope });
        const selected = value ? await assuranceAction({ command: "lookup", kind: field.lookup, selected_id: value, ...scope }) : null;
        if (!live || version !== generation.current) return;
        if (!result.success) throw new Error(result.error);
        if (selected && !selected.success) throw new Error(selected.error);
        const list = assuranceLookupSchema.parse(result.data);
        const exact = selected?.success ? assuranceLookupSchema.parse(selected.data) : [];
        setOptions([...new Map([...exact, ...list].map(row => [row.value, { value: row.value, label: row.label, description: row.context }])).values()]);
        if (value && !exact.some(row => row.value === value)) setError("The selected record is no longer eligible. Clear it and choose a current record.");
      } catch (cause) { if (live && version === generation.current) setError(cause instanceof Error ? cause.message : "Lookup unavailable. Retry."); }
      finally { if (live && version === generation.current) setLoading(false); }
    }, 180);
    return () => { live = false; clearTimeout(timer); };
  }, [field.lookup, query, value, retry, context, filter]);
  return <SearchableSelect inputId={inputId} ariaLabel={field.label} value={value} options={options} disabled={disabled} onChange={onChange} onSearchChange={setQuery} searching={loading} error={error} onRetry={() => setRetry(previous => previous + 1)} placeholder={`Search ${field.label.toLowerCase()}`} />;
}

/** SHA-256 of a local file, read in the browser only. */
async function fileChecksum(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export function AssuranceMutationForm({ action, role, fixed = {}, initial = {}, title }: { action: AssuranceAction; role: string; fixed?: Record<string, unknown>; initial?: Record<string, string>; title?: string }) {
  const descriptor = ASSURANCE_ACTION_FORMS[action];
  const id = useId();
  const { locked, review } = useAssuranceAction();
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<string | null>(null);
  const [hashing, setHashing] = useState(false);
  if (!canUseAssuranceAction(role, action)) return null;
  const fields = [...descriptor.fields.filter(field => !(field.key in fixed)), { key: "note", label: "Reason or supporting evidence", type: "note" as const, max: 500 }];
  function update(field: string, value: string) { setValues(current => ({ ...current, [field]: value })); setError(""); setErrorField(null); }
  async function hash(file: File | undefined) {
    if (!file) return;
    setHashing(true);
    try { const checksum = await fileChecksum(file); setValues(current => ({ ...current, file_sha256: checksum, file_name: file.name })); setError(""); }
    catch { setError("This browser could not read the file to record its checksum."); setErrorField("file_sha256"); }
    finally { setHashing(false); }
  }
  async function submit() {
    const parsed = buildAssuranceMutation(action, fields, values, fixed);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]; const key = String(issue?.path[0] ?? "note");
      setError(issue?.message ?? "Review these details."); setErrorField(key);
      document.getElementById(`${id}-${key}`)?.focus(); return;
    }
    await review(parsed.data as AssuranceMutation);
  }
  const invalid = (key: string) => ({ "aria-invalid": errorField === key || undefined, "aria-describedby": errorField === key ? `${id}-error` : undefined });
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h3 className="font-bold text-slate-900">{title ?? descriptor.title}</h3>
    <fieldset disabled={locked || hashing} className="grid min-w-0 gap-4 sm:grid-cols-2">
      {fields.map(field => <div key={field.key} className={`min-w-0 space-y-1 ${field.type === "note" || field.type === "changes" ? "sm:col-span-2" : ""}`}>
        {field.type === "changes" ? <fieldset id={`${id}-changes`} tabIndex={-1} className="space-y-2" {...invalid("changes")}><legend className="form-label">{field.label}</legend>
          <div className="grid gap-3 sm:grid-cols-2">{Object.entries(CHANGE_FIELDS).map(([key, label]) => <label key={key} className="space-y-1"><span className="text-sm font-semibold">{label}</span>
            <input className="form-input" type={NUMERIC_CHANGES.has(key) ? "number" : "text"} inputMode={NUMERIC_CHANGES.has(key) ? "decimal" : undefined} step={key === "pieces_per_bundle" ? "1" : "0.001"}
              maxLength={NUMERIC_CHANGES.has(key) ? undefined : key === "packing_instruction" ? 500 : 40} value={values[`change:${key}`] ?? ""} onChange={event => update(`change:${key}`, event.target.value)} /></label>)}</div>
        </fieldset> : <>
        <label htmlFor={`${id}-${field.key}`} className="form-label">{field.label}{field.optional ? " (optional)" : ""}</label>
        {field.lookup ? <Lookup field={field} value={values[field.key] ?? ""} disabled={locked} inputId={`${id}-${field.key}`} context={field.contextKey ? String(fixed[field.contextKey] ?? values[field.contextKey] ?? "") || undefined : undefined}
            filter={field.filterKey ? String(fixed[field.filterKey] ?? values[field.filterKey] ?? "") || undefined : undefined} onChange={value => update(field.key, value)} />
          : field.type === "file_hash" ? <><input id={`${id}-${field.key}`} className="form-input" type="file" accept=".pdf,.dwg,.dxf,.png,.jpg,.jpeg" {...invalid(field.key)} onChange={event => void hash(event.target.files?.[0])} />
            <p className="break-all text-xs text-slate-600">{hashing ? "Reading the file…" : values.file_sha256 ? `Checksum ${values.file_sha256.slice(0, 16)}… for ${values.file_name}` : "No file chosen."}</p></>
          : field.options || field.type === "boolean" ? <select id={`${id}-${field.key}`} className="form-input" value={values[field.key] ?? ""} required={!field.optional} {...invalid(field.key)} onChange={event => update(field.key, event.target.value)}>
              <option value="" disabled={!field.optional}>{field.optional ? "Not applicable" : "Choose"}</option>{Object.entries(field.options ?? { true: "Yes", false: "No" }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          : field.type === "note" ? <textarea id={`${id}-${field.key}`} className="form-input min-h-24" value={values[field.key] ?? ""} maxLength={field.max ?? 500} required={!field.optional} {...invalid(field.key)} onChange={event => update(field.key, event.target.value)} />
          : <input id={`${id}-${field.key}`} className="form-input" type={field.type === "instant" ? "datetime-local" : field.type === "date" ? "date" : field.type === "number" ? "number" : "text"} inputMode={field.type === "number" ? "decimal" : undefined}
              step={field.step} min={field.min} max={field.type === "number" ? field.max : undefined} maxLength={field.type === "number" || field.type === "date" || field.type === "instant" ? undefined : field.max ?? 160}
              value={values[field.key] ?? ""} required={!field.optional} {...invalid(field.key)} onChange={event => update(field.key, event.target.value)} />}
        </>}
        {field.help ? <p className="text-xs text-slate-600">{field.help}</p> : null}
      </div>)}
    </fieldset>
    {error ? <p id={`${id}-error`} role="alert" className="text-sm font-semibold text-red-800">{error}</p> : null}
    <p className="text-xs text-slate-500">Review the server-generated consequence before confirming. Only a confirmed database result completes the action.</p>
    <Button type="submit" disabled={locked || hashing}>Review this action</Button>
  </form>;
}

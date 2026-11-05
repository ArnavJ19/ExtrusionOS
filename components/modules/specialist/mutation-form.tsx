"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { specialistAction } from "@/lib/actions/specialist";
import { ALLOCATION_KINDS, DISPOSITIONS, FINISH_TYPES, LAB_DECISIONS, LAB_OUTCOMES, MATERIAL_KINDS, NOTELESS_ACTIONS, PRIORITIES, PROCESSES, QUANTITY_UNITS, SHADE_DECISIONS, TOLL_KINDS, TRIGGER_KINDS,
  canUseSpecialistAction, specialistLookupSchema, type SpecialistAction, type SpecialistLookupKind, type SpecialistMutation } from "@/lib/workflow/specialist";
import { buildSpecialistMutation, specialistFieldVisible, type SpecialistColumn, type SpecialistField as Field } from "@/lib/workflow/specialist-form";
import { useSpecialistAction } from "./action-center";

const yesNo = (yes: string, no: string) => ({ yes, no });
export const SPECIALIST_ACTION_FORMS: Record<SpecialistAction, { title: string; fields: Field[] }> = {
  "intake.submit": { title: "Submit a customer purchase order", fields: [{ key: "customer_id", label: "Customer", lookup: "customers" }, { key: "customer_po_ref", label: "Customer purchase order number" },
    { key: "po_date", label: "Purchase order date (optional)", type: "date", optional: true }, { key: "quote_id", label: "Quotation to compare with (optional)", lookup: "quotes", parentKey: "customer_id", optional: true },
    { key: "source_text", label: "Purchase order text", type: "multiline", max: 20000, help: "Paste the text of the purchase order or enquiry. It is kept with a checksum. Values are proposed only where a line states them plainly; nothing in the text is acted on." }] },
  "intake.resolve": { title: "Resolve the line", fields: [{ key: "decision", label: "This line is", options: { line: "An order line: confirm its values", not_a_line: "Not an order line: keep it as evidence only" } },
    { key: "profile_id", label: "Profile", lookup: "profiles", when: { decision: ["line"] }, optional: true, help: "Leave blank to keep the profile the text matched." },
    { key: "quantity", label: "Quantity", type: "number", step: "0.001", min: 0.001, when: { decision: ["line"] }, optional: true, help: "Leave blank to keep the quantity read from the line." },
    { key: "quantity_unit", label: "Unit", options: QUANTITY_UNITS, when: { decision: ["line"] }, optional: true }, { key: "length_mm", label: "Cut length (mm)", type: "number", step: "1", min: 100, max: 12000, when: { decision: ["line"] }, optional: true },
    { key: "finish", label: "Finish", when: { decision: ["line"] }, optional: true }, { key: "due_date", label: "Required date", type: "date", when: { decision: ["line"] }, optional: true }] },
  "intake.ready": { title: "Mark the draft ready for order entry", fields: [] },
  "intake.link": { title: "Link the order entered from this draft", fields: [{ key: "order_id", label: "Order", lookup: "orders", parentKey: "id" }] },
  "intake.discard": { title: "Discard the intake", fields: [] },
  "automation.define": { title: "Define an automation rule", fields: [{ key: "rule_code", label: "Rule code", help: "Lowercase letters, digits and underscores. A new version of the same code replaces the old one when approved." },
    { key: "name", label: "Name" }, { key: "trigger_kind", label: "When", options: TRIGGER_KINDS }, { key: "min_days", label: "Days", type: "number", step: "1", min: 0, max: 365, help: "Overdue or pending by at least this many days; for quotations, expiring within this many days." },
    { key: "min_amount", label: "Minimum balance due (INR, optional)", type: "number", step: "0.01", min: 0, optional: true, when: { trigger_kind: ["invoice_overdue"] } },
    { key: "task_priority", label: "Task priority", options: PRIORITIES }, { key: "assign_to", label: "Assign tasks to (optional)", lookup: "employees", optional: true }, { key: "due_in_days", label: "Task due in days", type: "number", step: "1", min: 0, max: 30 }] },
  "automation.approve": { title: "Approve the rule", fields: [] },
  "automation.state": { title: "Change the rule state", fields: [{ key: "state", label: "New state", options: { paused: "Paused", approved: "Resumed", retired: "Retired" } }] },
  "automation.simulate": { title: "Simulate the rule", fields: [] },
  "automation.execute": { title: "Run the rule", fields: [] },
  "lab.request": { title: "Request external laboratory testing", fields: [{ key: "sample_ref", label: "Sample reference (as labelled)" }, { key: "material_kind", label: "Material", options: MATERIAL_KINDS },
    { key: "production_job_id", label: "Production job", lookup: "jobs", when: { material_kind: ["production_job"] } }, { key: "billet_batch_id", label: "Billet batch", lookup: "billets", when: { material_kind: ["billet_batch"] } },
    { key: "material_note", label: "Material description", when: { material_kind: ["other"] } }, { key: "lab_vendor_id", label: "Laboratory", lookup: "vendors" },
    { key: "tests", label: "Tests and method revisions", type: "rows", columns: [{ key: "code", label: "Test code (e.g. tensile)" }, { key: "method", label: "Method and revision" }] },
    { key: "promised_date", label: "Promised result date", type: "date" }, { key: "estimated_charge", label: "Estimated charge (INR, optional)", type: "number", step: "0.01", min: 0, optional: true }] },
  "lab.custody": { title: "Record custody", fields: [{ key: "stage", label: "Event", options: { dispatched: "Sample dispatched to the laboratory", received: "Laboratory acknowledged receipt" } },
    { key: "reference", label: "Reference", help: "The consignment number when dispatched; the sample reference the laboratory acknowledged when received." }] },
  "lab.revise": { title: "Record a revised date", fields: [{ key: "revised_date", label: "Revised result date", type: "date" }] },
  "lab.result": { title: "Record a laboratory result", fields: [{ key: "test_code", label: "Test code" }, { key: "statement", label: "Laboratory statement", help: "As written on the report, with units." },
    { key: "lab_outcome", label: "Laboratory outcome", options: LAB_OUTCOMES }, { key: "report_ref", label: "Report or certificate number" }] },
  "lab.review": { title: "Record the quality decision", fields: [{ key: "decision", label: "Decision", options: LAB_DECISIONS }, { key: "retest_promised_date", label: "Retest promised date", type: "date", when: { decision: ["retest"] } }] },
  "lab.stop": { title: "Stop the request", fields: [{ key: "outcome", label: "Reason", options: { lost: "Sample lost", cancelled: "Request cancelled" } }] },
  "shade.define": { title: "Define a finish and shade reference", fields: [{ key: "ref_code", label: "Reference code" }, { key: "shade_name", label: "Shade name" }, { key: "finish_type", label: "Finish", options: FINISH_TYPES },
    { key: "specification", label: "Specification", help: "For example RAL code, gloss, micron range." }, { key: "customer_id", label: "Customer (optional)", lookup: "customers", optional: true, help: "Leave blank for a reference any customer may use." },
    { key: "project_ref", label: "Project or site (optional)", optional: true }, { key: "sample_location", label: "Where the physical sample is kept" }, { key: "assessment_conditions", label: "Agreed assessment conditions", help: "Light source, distance and angle the match is judged under." }] },
  "shade.approve": { title: "Approve the reference", fields: [] },
  "shade.withdraw": { title: "Withdraw the reference", fields: [] },
  "shade.bind": { title: "Bind a reference to an order line", fields: [{ key: "order_item_id", label: "Order line", lookup: "order_items" }, { key: "reference_id", label: "Approved reference", lookup: "shade_refs", parentKey: "order_item_id" }] },
  "shade.decide": { title: "Record a batch match decision", fields: [{ key: "batch_label", label: "Vendor batch or lot" }, { key: "finishing_job_id", label: "Finishing job (optional)", lookup: "finishing_jobs", parentKey: "id", optional: true },
    { key: "decision", label: "Decision", options: SHADE_DECISIONS }, { key: "assessed_under", label: "Assessed under", help: "The conditions actually used." }] },
  "agreement.define": { title: "Define a blanket agreement", fields: [{ key: "customer_id", label: "Customer", lookup: "customers" }, { key: "customer_ref", label: "Customer agreement reference" },
    { key: "valid_from", label: "Valid from", type: "date" }, { key: "valid_to", label: "Valid until", type: "date" }, { key: "overrun_percent", label: "Agreed overrun (%)", type: "number", step: "0.01", min: 0, max: 20, help: "Use 0 unless the contract allows releases beyond the agreed quantity." },
    { key: "lines", label: "Agreement lines", type: "rows", columns: [{ key: "profile_id", label: "Profile", lookup: "profiles" }, { key: "finish", label: "Finish" }, { key: "agreed_kg", label: "Agreed kg", type: "number", step: "0.001", min: 0.001 }, { key: "rate_per_kg", label: "Rate per kg (INR)", type: "number", step: "0.01", min: 0.01 }] }] },
  "agreement.approve": { title: "Approve the agreement", fields: [] },
  "agreement.rate": { title: "Record a rate revision", fields: [{ key: "rate_per_kg", label: "Rate per kg (INR)", type: "number", step: "0.01", min: 0.01 }, { key: "effective_from", label: "Effective from", type: "date" }] },
  "agreement.amend": { title: "Amend the agreed quantity", fields: [{ key: "agreed_kg", label: "Agreed kg", type: "number", step: "0.001", min: 0.001 }] },
  "agreement.close": { title: "Close the agreement", fields: [{ key: "carry_forward", label: "Remaining quantity", type: "bool", options: yesNo("Carry it forward to a new draft agreement", "Do not carry it forward") },
    { key: "new_valid_to", label: "New agreement valid until", type: "date", when: { carry_forward: ["yes"] } }] },
  "release.create": { title: "Call off a release", fields: [{ key: "quantity_kg", label: "Quantity (kg)", type: "number", step: "0.001", min: 0.001 }, { key: "site", label: "Delivery site" }, { key: "requested_date", label: "Delivery date", type: "date" }] },
  "release.firm": { title: "Firm the release", fields: [] },
  "release.cancel": { title: "Cancel or reduce the release", fields: [{ key: "quantity_kg", label: "Quantity to cancel (kg)", type: "number", step: "0.001", min: 0.001 }] },
  "release.fulfil": { title: "Record the order that fulfils the release", fields: [{ key: "order_id", label: "Order", lookup: "orders", parentKey: "id" }] },
  "release.return": { title: "Record a return against the release", fields: [{ key: "quantity_kg", label: "Returned quantity (kg)", type: "number", step: "0.001", min: 0.001 }] },
  "tooling.define": { title: "Define a tooling commercial agreement", fields: [{ key: "die_id", label: "Die", lookup: "dies" }, { key: "customer_id", label: "Customer", lookup: "customers" },
    { key: "owner_party", label: "Agreed owner of the die", options: { company: "Our company", customer: "The customer" } }, { key: "die_charge", label: "Die charge (INR)", type: "number", step: "0.01", min: 0 },
    { key: "customer_contribution", label: "Customer contribution (INR)", type: "number", step: "0.01", min: 0 }, { key: "waiver_amount", label: "Waiver (INR)", type: "number", step: "0.01", min: 0, help: "Use 0 for none. A waiver is approved with the agreement by a second person." },
    { key: "recovery_basis", label: "Recovery through later orders", options: { none: "None", per_kg: "Per kilogram dispatched, up to a cap" } },
    { key: "recovery_rate_per_kg", label: "Recovery per kg (INR)", type: "number", step: "0.0001", min: 0.0001, when: { recovery_basis: ["per_kg"] } }, { key: "recovery_cap", label: "Recovery cap (INR)", type: "number", step: "0.01", min: 0.01, when: { recovery_basis: ["per_kg"] } },
    { key: "tax_reference", label: "Tax and accounting treatment reference" }, { key: "terms", label: "Agreed terms", type: "note", max: 500 }] },
  "tooling.approve": { title: "Approve the tooling agreement", fields: [] },
  "tooling.allocate": { title: "Link a finance record", fields: [{ key: "kind", label: "Record", options: ALLOCATION_KINDS },
    { key: "invoice_id", label: "Invoice", lookup: "invoices", parentKey: "id", when: { kind: ["charge_invoice", "recovery"] } }, { key: "payment_id", label: "Payment", lookup: "payments", parentKey: "id", when: { kind: ["payment"] } },
    { key: "credit_note_id", label: "Credit note", lookup: "credit_notes", parentKey: "id", when: { kind: ["credit_note"] } },
    { key: "amount", label: "Amount allocated (INR)", type: "number", step: "0.01", min: 0.01, when: { kind: ["charge_invoice", "payment", "credit_note"] }, help: "A recovery is calculated from dispatched kilograms instead." }] },
  "tooling.reverse": { title: "Reverse a linked record", fields: [] },
  "tooling.dispute": { title: "Dispute", fields: [{ key: "state", label: "Dispute", options: { open: "Open a dispute", resolved: "Resolve the dispute" } }] },
  "transfer.request": { title: "Request a warehouse transfer", fields: [{ key: "to_location_id", label: "Destination", lookup: "locations" }, { key: "batch_ids", label: "Bundles", type: "multi", lookup: "stock_batches", help: "Up to 25 available bundles. Each moves whole." },
    { key: "planned_date", label: "Planned date", type: "date" }] },
  "transfer.issue": { title: "Issue the transfer", fields: [{ key: "transport_ref", label: "Vehicle or LR number" }, { key: "gate_ref", label: "Gate pass (optional)", optional: true }] },
  "transfer.receive": { title: "Receive a bundle", fields: [{ key: "bundle_label", label: "Bundle number (scan or type)" }, { key: "condition_note", label: "Condition note (optional)", optional: true }] },
  "transfer.dispose": { title: "Disposition of a bundle", fields: [{ key: "disposition", label: "What happened", options: DISPOSITIONS }] },
  "transfer.cancel": { title: "Cancel the transfer", fields: [] },
  "transfer.close": { title: "Close the transfer", fields: [] },
  "recipe.define": { title: "Define a treatment recipe revision", fields: [{ key: "recipe_code", label: "Recipe code" }, { key: "name", label: "Name" }, { key: "process", label: "Process", options: PROCESSES },
    { key: "alloys", label: "Compatible alloys", type: "list", help: "Comma-separated, for example 6063, 6060." }, { key: "target_temper", label: "Target temper" },
    { key: "temp_min_c", label: "Minimum temperature (°C)", type: "number", step: "0.1", min: 20, max: 700 }, { key: "temp_max_c", label: "Maximum temperature (°C)", type: "number", step: "0.1", min: 20, max: 700 },
    { key: "soak_min_minutes", label: "Minimum cycle (minutes)", type: "number", step: "1", min: 1, max: 2880 }, { key: "soak_max_minutes", label: "Maximum cycle (minutes)", type: "number", step: "1", min: 1, max: 2880 },
    { key: "min_readings", label: "Temperature readings required", type: "number", step: "1", min: 1, max: 100 }] },
  "recipe.approve": { title: "Approve the recipe revision", fields: [] },
  "treat.create": { title: "Load a treatment batch", fields: [{ key: "recipe_id", label: "Approved recipe", lookup: "recipes" }, { key: "machine_id", label: "Oven", lookup: "ovens" },
    { key: "inputs", label: "Input jobs", type: "rows", columns: [{ key: "job_id", label: "Production job", lookup: "jobs" }, { key: "kg", label: "Kilograms", type: "number", step: "0.001", min: 0.001 }] },
    { key: "load_note", label: "Loading arrangement", type: "note", max: 300 }] },
  "treat.start": { title: "Start the cycle", fields: [] },
  "treat.observe": { title: "Record a temperature reading", fields: [{ key: "temperature_c", label: "Temperature read (°C)", type: "number", step: "0.1", min: 0, max: 800 }, { key: "instrument_ref", label: "Instrument" },
    { key: "reading_note", label: "Note (optional)", optional: true }] },
  "treat.end": { title: "End the cycle", fields: [{ key: "interrupted", label: "Cycle", type: "bool", options: yesNo("Interrupted before completion", "Completed as planned") }] },
  "treat.review": { title: "Review the batch", fields: [{ key: "outcomes", label: "Outcome by input", type: "rows", columns: [{ key: "input_id", label: "Input" }, { key: "accepted_kg", label: "Accepted kg", type: "number", step: "0.001", min: 0 },
      { key: "rejected_kg", label: "Rejected kg", type: "number", step: "0.001", min: 0 }, { key: "retreat_kg", label: "Retreatment kg", type: "number", step: "0.001", min: 0 }] },
    { key: "accept_deviation", label: "Deviations", type: "bool", options: yesNo("I accept the recorded deviations for the accepted material", "No deviation is accepted") }] },
  "toll.define": { title: "Define a job-work agreement", fields: [{ key: "customer_id", label: "Customer", lookup: "customers" }, { key: "material_spec", label: "Material specification" }, { key: "alloy", label: "Alloy" },
    { key: "permitted_mixing", label: "Mixing with company metal", type: "bool", options: yesNo("Authorised by the customer", "Not authorised") },
    { key: "allowed_loss_percent", label: "Agreed loss allowance (%, optional)", type: "number", step: "0.01", min: 0, max: 10, optional: true, help: "Leave blank when no allowance is agreed. It is never assumed." },
    { key: "conversion_rate_per_kg", label: "Conversion charge per kg (INR)", type: "number", step: "0.01", min: 0.01 }, { key: "billing_basis", label: "Charged on", options: { output_kg: "Good output kilograms", input_kg: "Issued kilograms" } }] },
  "toll.approve": { title: "Approve the job-work agreement", fields: [] },
  "toll.receive": { title: "Receive customer metal", fields: [{ key: "received_kg", label: "Received (kg)", type: "number", step: "0.001", min: 0.001 }, { key: "challan_ref", label: "Customer challan" }, { key: "location", label: "Storage location" },
    { key: "heat_ref", label: "Heat or cast number (optional)", optional: true }, { key: "alloy", label: "Alloy (optional)", optional: true, help: "Defaults to the agreement alloy." }] },
  "toll.inspect": { title: "Inspect the receipt", fields: [{ key: "decision", label: "Decision", options: { accepted: "Accepted for this customer's jobs", rejected: "Rejected: return only" } }] },
  "toll.move": { title: "Record a movement", fields: [{ key: "kind", label: "Movement", options: TOLL_KINDS },
    { key: "receipt_id", label: "Receipt", lookup: "toll_receipts", parentKey: "customer_id", when: { kind: ["issue", "return_metal"] } },
    { key: "production_job_id", label: "Production job", lookup: "jobs", parentKey: "customer_id", when: { kind: ["issue", "output", "scrap", "explained_loss"] } },
    { key: "quantity_kg", label: "Quantity (kg)", type: "number", step: "0.001", min: 0.001 }, { key: "reference", label: "Reference (optional)", optional: true }] },
  "toll.reverse": { title: "Reverse a movement", fields: [] },
  "toll.statement": { title: "Prepare a material statement", fields: [] },
  "toll.settle": { title: "Settle the statement", fields: [{ key: "decision", label: "Customer response", options: { agree: "Agreed", dispute: "Disputed" } }] },
  "weigh.open": { title: "Open a weighing session", fields: [{ key: "movement_kind", label: "Movement", options: { dispatch: "Outgoing dispatch", purchase_receipt: "Incoming purchase receipt" } },
    { key: "dispatch_id", label: "Dispatch", lookup: "dispatches", when: { movement_kind: ["dispatch"] } }, { key: "purchase_receipt_id", label: "Purchase receipt", lookup: "receipts", when: { movement_kind: ["purchase_receipt"] } },
    { key: "vehicle_registration", label: "Vehicle registration" }, { key: "vehicle_id", label: "Company vehicle (optional)", lookup: "vehicles", optional: true }, { key: "instrument_ref", label: "Weighbridge" },
    { key: "calibration_valid_until", label: "Calibration certificate valid until", type: "date" }, { key: "tolerance_kg", label: "Accepted difference (kg)", type: "number", step: "0.001", min: 0, max: 1000 }] },
  "weigh.read": { title: "Record a reading", fields: [{ key: "kind", label: "Reading", options: { gross: "Gross (loaded)", tare: "Tare (empty)" } }, { key: "weight_value", label: "Weight", type: "number", step: "0.001", min: 0.001 },
    { key: "unit", label: "Unit", options: { kg: "kg", t: "tonnes" } }, { key: "read_at", label: "Taken at", type: "datetime" }, { key: "source", label: "Source", options: { manual: "Read from the display or slip", device: "Device packet" } },
    { key: "provider_ref", label: "Packet reference", when: { source: ["device"] } }, { key: "stable", label: "Display", type: "bool", options: yesNo("Stable", "Not stable") },
    { key: "vehicle_registration_read", label: "Vehicle on the slip" }, { key: "slip_ref", label: "Slip number (optional)", optional: true }] },
  "weigh.pair": { title: "Pair gross and tare", fields: [] },
  "weigh.finalize": { title: "Finalise the weighing", fields: [{ key: "accept_difference", label: "Difference", type: "bool", options: yesNo("Accept the difference with the reason below", "Within tolerance: nothing to accept") }] },
  "weigh.supersede": { title: "Supersede the weighing", fields: [] },
  "weigh.cancel": { title: "Cancel the weighing", fields: [] }
};

export function SpecialistLookup({ field, kind, parent, value, disabled, inputId, onChange }: { field: Pick<Field, "label" | "parentKey">; kind: SpecialistLookupKind; parent?: string; value: string; disabled: boolean; inputId: string; onChange: (value: string) => void }) {
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
        const result = await specialistAction({ command: "lookup", kind, search: query, ...scope });
        const selected = value ? await specialistAction({ command: "lookup", kind, selected_id: value, ...scope }) : null;
        if (!live || version !== generation.current) return;
        if (!result.success) throw new Error(result.error);
        if (selected && !selected.success) throw new Error(selected.error);
        const rows = specialistLookupSchema.parse(result.data);
        const exact = selected?.success ? specialistLookupSchema.parse(selected.data) : [];
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

const readRows = (value: string): Record<string, string>[] => { try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; } };

/** Repeated entries (tests, agreement lines, input jobs, outcomes) kept as JSON text in the form. */
function RowsBuilder({ id, columns, value, disabled, fixedRows, onChange }: { id: string; columns: SpecialistColumn[]; value: string; disabled: boolean; fixedRows?: boolean; onChange: (value: string) => void }) {
  const rows = readRows(value);
  const set = (index: number, key: string, next: string) => onChange(JSON.stringify(rows.map((row, position) => position === index ? { ...row, [key]: next } : row)));
  return <div id={id} tabIndex={-1} className="space-y-3 rounded-xl border border-slate-200 p-3">
    {rows.length ? rows.map((row, index) => <fieldset key={index} className="grid gap-3 rounded-lg border border-slate-100 p-2 sm:grid-cols-2">
      <legend className="px-1 text-xs font-bold text-slate-600">Entry {index + 1}{fixedRows && row.label ? ` · ${row.label}` : ""}</legend>
      {columns.filter(column => !(fixedRows && column.key === "input_id")).map(column => <div key={column.key} className="min-w-0 space-y-1">
        <label htmlFor={`${id}-${index}-${column.key}`} className="form-label">{column.label}</label>
        {column.lookup ? <SpecialistLookup field={{ label: column.label }} kind={column.lookup} value={row[column.key] ?? ""} disabled={disabled} inputId={`${id}-${index}-${column.key}`} onChange={next => set(index, column.key, next)} />
          : <input id={`${id}-${index}-${column.key}`} className="form-input" type={column.type === "number" ? "number" : "text"} inputMode={column.type === "number" ? "decimal" : undefined} step={column.step} min={column.min}
              value={row[column.key] ?? ""} disabled={disabled} onChange={event => set(index, column.key, event.target.value)} />}
      </div>)}
      {!fixedRows ? <div className="sm:col-span-2"><Button type="button" variant="secondary" disabled={disabled} onClick={() => onChange(JSON.stringify(rows.filter((_, position) => position !== index)))}>Remove entry {index + 1}</Button></div> : null}
    </fieldset>) : <p className="text-sm text-slate-600">No entry added yet.</p>}
    {!fixedRows ? <Button type="button" variant="secondary" disabled={disabled || rows.length >= 20} onClick={() => onChange(JSON.stringify([...rows, {}]))}>Add an entry</Button> : null}
  </div>;
}

/** Several records from one lookup, for example the bundles on a transfer. */
function MultiLookup({ id, kind, label, value, disabled, onChange }: { id: string; kind: SpecialistLookupKind; label: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  const [pick, setPick] = useState("");
  const [labels, setLabels] = useState<Record<string, string>>({});
  let ids: string[] = [];
  try { const parsed = JSON.parse(value || "[]"); if (Array.isArray(parsed)) ids = parsed; } catch { ids = []; }
  useEffect(() => {
    if (!pick) return;
    let live = true;
    void specialistAction({ command: "lookup", kind, selected_id: pick }).then(result => {
      if (!live || !result.success) return;
      const row = specialistLookupSchema.parse(result.data)[0];
      if (row) setLabels(current => ({ ...current, [row.value]: `${row.label} · ${row.context}` }));
    });
    return () => { live = false; };
  }, [pick, kind]);
  return <div id={id} tabIndex={-1} className="space-y-3 rounded-xl border border-slate-200 p-3">
    {ids.length ? <ol className="space-y-1 text-sm">{ids.map((entry, index) => <li key={entry} className="flex flex-wrap items-center justify-between gap-2"><span className="break-words">{index + 1}. {labels[entry] ?? entry}</span>
      <Button type="button" variant="secondary" disabled={disabled} onClick={() => onChange(JSON.stringify(ids.filter(item => item !== entry)))}>Remove</Button></li>)}</ol> : <p className="text-sm text-slate-600">Nothing added yet.</p>}
    <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end"><div className="min-w-0 space-y-1"><span className="form-label">Find {label.toLowerCase()}</span>
      <SpecialistLookup field={{ label }} kind={kind} value={pick} disabled={disabled} inputId={`${id}-pick`} onChange={setPick} /></div>
      <Button type="button" variant="secondary" disabled={disabled || !pick || ids.includes(pick) || ids.length >= 25} onClick={() => { onChange(JSON.stringify([...ids, pick])); setPick(""); }}>Add</Button></div>
  </div>;
}

export function SpecialistMutationForm({ action, role, fixed = {}, initial = {}, title, fixedRows }: { action: SpecialistAction; role: string; fixed?: Record<string, unknown>; initial?: Record<string, string>; title?: string; fixedRows?: boolean }) {
  const descriptor = SPECIALIST_ACTION_FORMS[action];
  const id = useId();
  const { locked, review } = useSpecialistAction();
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<string | null>(null);
  if (!canUseSpecialistAction(role, action)) return null;
  const noteless = NOTELESS_ACTIONS.includes(action);
  const fields = [...descriptor.fields.filter(field => !(field.key in fixed)), ...(noteless ? [] : [{ key: "note", label: "Reason or supporting evidence", type: "note" as const, max: 500 }])];
  const shown = fields.filter(field => specialistFieldVisible(field, values, fixed));
  function update(field: string, value: string) { setValues(current => ({ ...current, [field]: value })); setError(""); setErrorField(null); }
  async function submit() {
    // Rows given as fixed context (for example the inputs of a batch) carry hidden identities and display labels.
    const parsed = buildSpecialistMutation(action, fields, values, fixed);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]; const key = String(issue?.path[0] ?? "note");
      setError(issue?.message ?? "Review these details."); setErrorField(key);
      document.getElementById(`${id}-${key}`)?.focus(); return;
    }
    await review(parsed.data as SpecialistMutation);
  }
  const invalid = (key: string) => ({ "aria-invalid": errorField === key || undefined, "aria-describedby": errorField === key ? `${id}-error` : undefined });
  return <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h3 className="font-bold text-slate-900">{title ?? descriptor.title}</h3>
    <fieldset disabled={locked} className="grid min-w-0 gap-4 sm:grid-cols-2">
      {shown.map(field => {
        const options = field.options;
        const current = values[field.key] ?? "";
        const wide = ["note", "multiline", "rows", "list", "multi"].includes(field.type ?? "");
        return <div key={field.key} className={`min-w-0 space-y-1 ${wide ? "sm:col-span-2" : ""}`}>
          <label htmlFor={`${id}-${field.key}`} className="form-label">{field.label}</label>
          {field.type === "multi" && field.lookup ? <MultiLookup id={`${id}-${field.key}`} kind={field.lookup} label={field.label} value={current} disabled={locked} onChange={value => update(field.key, value)} />
            : field.lookup ? <SpecialistLookup field={field} kind={field.lookup} parent={field.parentKey ? String(fixed[field.parentKey] ?? values[field.parentKey] ?? "") || undefined : undefined} value={current} disabled={locked} inputId={`${id}-${field.key}`} onChange={value => update(field.key, value)} />
            : field.type === "rows" ? <RowsBuilder id={`${id}-${field.key}`} columns={field.columns ?? []} value={current} disabled={locked} fixedRows={fixedRows} onChange={value => update(field.key, value)} />
            : field.type === "bool" && options ? <select id={`${id}-${field.key}`} className="form-input" value={current} required {...invalid(field.key)} onChange={event => update(field.key, event.target.value)}><option value="" disabled>Choose</option>
                {Object.entries(options).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            : options ? <select id={`${id}-${field.key}`} className="form-input" value={current} required={!field.optional} {...invalid(field.key)} onChange={event => update(field.key, event.target.value)}>
                <option value="" disabled={!field.optional}>{field.optional ? "Not applicable" : "Choose"}</option>{Object.entries(options).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            : field.type === "note" || field.type === "multiline" ? <textarea id={`${id}-${field.key}`} className={`form-input ${field.type === "multiline" ? "min-h-48 font-mono text-sm" : "min-h-24"}`} value={current} maxLength={field.max ?? 1000} required={!field.optional} {...invalid(field.key)} onChange={event => update(field.key, event.target.value)} />
            : <input id={`${id}-${field.key}`} className="form-input" type={field.type === "date" ? "date" : field.type === "datetime" ? "datetime-local" : field.type === "number" ? "number" : "text"}
                inputMode={field.type === "number" ? "decimal" : undefined} step={field.step} min={field.min} max={field.type === "number" ? field.max : undefined}
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

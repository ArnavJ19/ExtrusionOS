// November batch 10 (NOV-032/037/061/065/067/071/072/073/074/080): customer purchase-order intake, the
// controlled automation workbench, external laboratory testing, finish and shade references, blanket
// agreements, die and tooling commercial accounts, warehouse transfers, heat-treatment batches, customer-owned
// metal and weighbridge transactions. The database owns every read model and guarded action; this module
// validates commands and responses and mirrors role access so screens never offer an action the server would refuse.
import { z } from "zod";

export const SPECIALIST_VIEWS = {
  intake: "Purchase order intake", automation: "Automation workbench", lab: "Laboratory testing", shades: "Finish and shade references", agreements: "Blanket agreements",
  tooling: "Tooling accounts", transfers: "Warehouse transfers", treatment: "Heat treatment", tolling: "Customer metal", weighing: "Weighbridge"
} as const;
export type SpecialistView = keyof typeof SPECIALIST_VIEWS;
export const SPECIALIST_DESCRIPTIONS: Record<SpecialistView, string> = {
  intake: "Pasted customer purchase orders turned into reviewed draft lines, with the source line kept for every value.",
  automation: "Approved rules that create internal tasks, with simulations and real runs shown separately.",
  lab: "External tests from sample dispatch to the laboratory's statement and the separate quality decision.",
  shades: "Approved finish and shade references bound to order lines, and the match decision for each returned batch.",
  agreements: "Customer agreements with their balance, dated rates and the releases called off against them.",
  tooling: "Who owns each die, what the customer contributes and what linked invoices, payments and recoveries show.",
  transfers: "Bundles moving between locations: requested, in transit, received or dispositioned.",
  treatment: "Ageing and heat-treatment batches with recipe revisions, actual readings and quality review.",
  tolling: "Customer-owned metal received, issued, converted and returned, with differences kept open.",
  weighing: "Gross and tare readings paired into a net weight and reconciled with bundles or receipts."
};
const viewKeys = Object.keys(SPECIALIST_VIEWS) as [SpecialistView, ...SpecialistView[]];

export const SPECIALIST_ROLES = ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "quality", "viewer"] as const;
const VIEW_ROLES: Record<SpecialistView, readonly string[]> = {
  intake: ["owner", "admin", "sales_manager", "sales"],
  automation: ["owner", "admin", "factory_manager", "accounts"],
  lab: ["owner", "admin", "quality", "factory_manager", "production_manager", "inventory_manager"],
  shades: ["owner", "admin", "quality", "sales_manager", "sales", "factory_manager", "production_manager", "dispatch_manager", "dispatch", "viewer"],
  agreements: ["owner", "admin", "sales_manager", "sales", "accounts"],
  tooling: ["owner", "admin", "sales_manager", "accounts"],
  transfers: ["owner", "admin", "inventory_manager", "factory_manager", "dispatch_manager", "dispatch", "quality", "viewer"],
  treatment: ["owner", "admin", "production_manager", "production", "quality", "factory_manager", "viewer"],
  tolling: ["owner", "admin", "inventory_manager", "factory_manager", "production_manager", "accounts", "quality"],
  weighing: ["owner", "admin", "dispatch_manager", "dispatch", "inventory_manager", "factory_manager", "viewer"]
};
/** Mirrors private.specialist_read_allowed. */
export function canReadSpecialist(role: string, view?: SpecialistView) {
  if (!(SPECIALIST_ROLES as readonly string[]).includes(role)) return false;
  return view ? VIEW_ROLES[view].includes(role) : true;
}

const uuid = z.string().uuid("Choose a record from the search results");
const control = /[\u0000-\u001f\u007f]/;
const note = z.string().trim().min(5, "Explain the action in at least 5 characters").max(500, "Keep the explanation within 500 characters").refine(value => !control.test(value), "Remove control characters");
const text = (min: number, max: number, label: string) => z.string().trim().min(min, `${label} needs at least ${min} character${min === 1 ? "" : "s"}`).max(max, `Keep ${label.toLowerCase()} within ${max} characters`)
  .refine(value => !control.test(value), "Remove control characters");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const decimals = (value: number, places: number) => Math.abs(value * 10 ** places - Math.round(value * 10 ** places)) < 1e-6;
const amount = (min: number, max: number, label: string, places: number) => z.number({ invalid_type_error: `Enter ${label.toLowerCase()}` }).finite().min(min, `${label}: ${min} or more`).max(max, `${label}: at most ${max.toLocaleString("en-IN")}`)
  .refine(value => decimals(value, places), places === 0 ? `${label} must be a whole number` : `${label}: at most ${places} decimal place(s)`);
const keysOf = <T extends Record<string, string>>(value: T) => Object.keys(value) as [keyof T & string, ...(keyof T & string)[]];
const code = (label: string) => z.string().regex(/^[a-z0-9_]{3,30}$/, `${label}: use 3 to 30 lowercase letters, digits or underscores`);

export const TRIGGER_KINDS = { invoice_overdue: "Invoice overdue", dispatch_overdue: "Dispatch still pending after its date", quote_expiring: "Sent quotation about to expire" } as const;
export const PRIORITIES = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" } as const;
export const MATERIAL_KINDS = { production_job: "Production job output", billet_batch: "Billet batch", other: "Other material" } as const;
export const LAB_OUTCOMES = { pass: "Pass", fail: "Fail", no_conclusion: "No conclusion" } as const;
export const LAB_DECISIONS = { release: "Release", nonconformance: "Nonconformance", retest: "Retest" } as const;
export const FINISH_TYPES = { mill_finish: "Mill finish", powder_coating: "Powder coating", anodizing: "Anodizing", anodized_silver: "Anodized silver", anodized_bronze: "Anodized bronze", anodized_black: "Anodized black",
  wood_finish: "Wood finish", wood_grain: "Wood grain", pvdf: "PVDF", other: "Other" } as const;
export const SHADE_DECISIONS = { match: "Matches the reference", deviation_accepted: "Authorised deviation accepted", reject: "Does not match: reject" } as const;
export const ALLOCATION_KINDS = { charge_invoice: "Die charge invoice", payment: "Payment against a linked invoice", credit_note: "Credit note against a linked invoice", recovery: "Recovery through a later order" } as const;
export const DISPOSITIONS = { damaged: "Received damaged", returned_to_source: "Returned to source", lost: "Lost in transit" } as const;
export const PROCESSES = { artificial_ageing: "Artificial ageing", solution_treatment: "Solution treatment", homogenising: "Homogenising" } as const;
export const TOLL_KINDS = { issue: "Issue to a job", output: "Good output", scrap: "Process scrap", explained_loss: "Loss within the agreed allowance", return_metal: "Return metal to the customer", return_scrap: "Return scrap to the customer" } as const;
export const QUANTITY_UNITS = { kg: "Kilograms", piece: "Pieces", metre: "Metres" } as const;

const test = z.object({ code: z.string().regex(/^[a-z0-9_]{2,30}$/, "Test code: lowercase letters, digits or underscores"), method: text(2, 60, "Method revision") }).strict();
const agreementLine = z.object({ profile_id: uuid, finish: text(2, 40, "Finish"), agreed_kg: amount(0.001, 100000000, "Agreed kg", 3), rate_per_kg: amount(0.01, 10000000, "Rate", 2) }).strict();
const input = z.object({ job_id: uuid, kg: amount(0.001, 1000000, "Kilograms", 3) }).strict();
const outcome = z.object({ input_id: uuid, accepted_kg: amount(0, 1000000, "Accepted kg", 3), rejected_kg: amount(0, 1000000, "Rejected kg", 3), retreat_kg: amount(0, 1000000, "Retreatment kg", 3) }).strict();
const kg = (label: string) => amount(0.001, 10000000, label, 3);

export const specialistMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("intake.submit"), customer_id: uuid, customer_po_ref: text(1, 60, "Customer purchase order"), source_text: z.string().min(10, "Paste the purchase order text").max(20000, "Keep the pasted text within 20,000 characters"),
    po_date: day.optional(), quote_id: uuid.optional() }).strict(),
  z.object({ action: z.literal("intake.resolve"), line_id: uuid, decision: z.enum(["line", "not_a_line"]), profile_id: uuid.optional(), quantity: amount(0.001, 100000000, "Quantity", 3).optional(),
    quantity_unit: z.enum(keysOf(QUANTITY_UNITS)).optional(), length_mm: amount(100, 12000, "Length", 0).optional(), finish: text(2, 40, "Finish").optional(), due_date: day.optional(), note }).strict(),
  z.object({ action: z.literal("intake.ready"), id: uuid, note }).strict(),
  z.object({ action: z.literal("intake.link"), id: uuid, order_id: uuid, note }).strict(),
  z.object({ action: z.literal("intake.discard"), id: uuid, note }).strict(),
  z.object({ action: z.literal("automation.define"), rule_code: code("Rule code"), name: text(3, 80, "Name"), trigger_kind: z.enum(keysOf(TRIGGER_KINDS)), min_days: amount(0, 365, "Days", 0),
    min_amount: amount(0, 1000000000, "Minimum amount", 2).optional(), task_priority: z.enum(keysOf(PRIORITIES)), assign_to: uuid.optional(), due_in_days: amount(0, 30, "Due in days", 0), note }).strict(),
  z.object({ action: z.literal("automation.approve"), id: uuid, note }).strict(),
  z.object({ action: z.literal("automation.state"), id: uuid, state: z.enum(["paused", "approved", "retired"]), note }).strict(),
  z.object({ action: z.literal("automation.simulate"), id: uuid }).strict(),
  z.object({ action: z.literal("automation.execute"), id: uuid, note }).strict(),
  z.object({ action: z.literal("lab.request"), sample_ref: text(2, 60, "Sample reference"), material_kind: z.enum(keysOf(MATERIAL_KINDS)), production_job_id: uuid.optional(), billet_batch_id: uuid.optional(),
    material_note: text(5, 200, "Material description").optional(), lab_vendor_id: uuid, tests: z.array(test).min(1, "Add a test").max(10, "At most ten tests"), promised_date: day,
    estimated_charge: amount(0, 100000000, "Estimated charge", 2).optional(), note }).strict(),
  z.object({ action: z.literal("lab.custody"), id: uuid, stage: z.enum(["dispatched", "received"]), reference: text(1, 60, "Reference"), note }).strict(),
  z.object({ action: z.literal("lab.revise"), id: uuid, revised_date: day, note }).strict(),
  z.object({ action: z.literal("lab.result"), id: uuid, test_code: z.string().regex(/^[a-z0-9_]{2,30}$/, "Choose the test"), statement: text(1, 200, "Laboratory statement"), lab_outcome: z.enum(keysOf(LAB_OUTCOMES)), report_ref: text(1, 60, "Report reference") }).strict(),
  z.object({ action: z.literal("lab.review"), id: uuid, decision: z.enum(keysOf(LAB_DECISIONS)), retest_promised_date: day.optional(), note }).strict(),
  z.object({ action: z.literal("lab.stop"), id: uuid, outcome: z.enum(["lost", "cancelled"]), note }).strict(),
  z.object({ action: z.literal("shade.define"), ref_code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,29}$/, "Use 2 to 30 letters, digits, dots, hyphens or underscores"), shade_name: text(2, 60, "Shade name"),
    finish_type: z.enum(keysOf(FINISH_TYPES)), specification: text(5, 300, "Specification"), sample_location: text(2, 80, "Sample location"), assessment_conditions: text(5, 200, "Assessment conditions"),
    customer_id: uuid.optional(), project_ref: text(2, 80, "Project").optional(), note }).strict(),
  z.object({ action: z.literal("shade.approve"), id: uuid, note }).strict(),
  z.object({ action: z.literal("shade.withdraw"), id: uuid, note }).strict(),
  z.object({ action: z.literal("shade.bind"), order_item_id: uuid, reference_id: uuid, note }).strict(),
  z.object({ action: z.literal("shade.decide"), id: uuid, batch_label: text(1, 60, "Batch"), decision: z.enum(keysOf(SHADE_DECISIONS)), assessed_under: text(5, 200, "Assessment conditions"), finishing_job_id: uuid.optional(), note }).strict(),
  z.object({ action: z.literal("agreement.define"), customer_id: uuid, customer_ref: text(1, 60, "Customer reference"), valid_from: day, valid_to: day, overrun_percent: amount(0, 20, "Overrun", 2),
    lines: z.array(agreementLine).min(1, "Add an agreement line").max(20, "At most twenty lines"), note }).strict(),
  z.object({ action: z.literal("agreement.approve"), id: uuid, note }).strict(),
  z.object({ action: z.literal("agreement.rate"), line_id: uuid, rate_per_kg: amount(0.01, 10000000, "Rate", 2), effective_from: day, note }).strict(),
  z.object({ action: z.literal("agreement.amend"), line_id: uuid, agreed_kg: amount(0.001, 100000000, "Agreed kg", 3), note }).strict(),
  z.object({ action: z.literal("agreement.close"), id: uuid, carry_forward: z.boolean(), new_valid_to: day.optional(), note }).strict(),
  z.object({ action: z.literal("release.create"), line_id: uuid, quantity_kg: amount(0.001, 100000000, "Quantity", 3), site: text(2, 120, "Delivery site"), requested_date: day, note }).strict(),
  z.object({ action: z.literal("release.firm"), id: uuid, note }).strict(),
  z.object({ action: z.literal("release.cancel"), id: uuid, quantity_kg: amount(0.001, 100000000, "Quantity", 3), note }).strict(),
  z.object({ action: z.literal("release.fulfil"), id: uuid, order_id: uuid, note }).strict(),
  z.object({ action: z.literal("release.return"), id: uuid, quantity_kg: amount(0.001, 100000000, "Quantity", 3), note }).strict(),
  z.object({ action: z.literal("tooling.define"), die_id: uuid, customer_id: uuid, owner_party: z.enum(["company", "customer"]), die_charge: amount(0, 1000000000, "Die charge", 2),
    customer_contribution: amount(0, 1000000000, "Customer contribution", 2), waiver_amount: amount(0, 1000000000, "Waiver", 2), recovery_basis: z.enum(["none", "per_kg"]),
    recovery_rate_per_kg: amount(0.0001, 1000000, "Recovery rate", 4).optional(), recovery_cap: amount(0.01, 1000000000, "Recovery cap", 2).optional(), tax_reference: text(2, 120, "Tax and accounting reference"), terms: text(5, 500, "Terms"), note }).strict(),
  z.object({ action: z.literal("tooling.approve"), id: uuid, note }).strict(),
  z.object({ action: z.literal("tooling.allocate"), id: uuid, kind: z.enum(keysOf(ALLOCATION_KINDS)), invoice_id: uuid.optional(), payment_id: uuid.optional(), credit_note_id: uuid.optional(), amount: amount(0.01, 1000000000, "Amount", 2).optional(), note }).strict(),
  z.object({ action: z.literal("tooling.reverse"), id: uuid, allocation_id: uuid, note }).strict(),
  z.object({ action: z.literal("tooling.dispute"), id: uuid, state: z.enum(["open", "resolved"]), note }).strict(),
  z.object({ action: z.literal("transfer.request"), to_location_id: uuid, batch_ids: z.array(uuid).min(1, "Choose at least one bundle").max(25, "At most 25 bundles"), planned_date: day, note }).strict(),
  z.object({ action: z.literal("transfer.issue"), id: uuid, transport_ref: text(1, 60, "Transport reference"), gate_ref: text(1, 60, "Gate pass").optional(), note }).strict(),
  z.object({ action: z.literal("transfer.receive"), id: uuid, bundle_label: text(1, 60, "Bundle"), condition_note: text(2, 200, "Condition note").optional() }).strict(),
  z.object({ action: z.literal("transfer.dispose"), line_id: uuid, disposition: z.enum(keysOf(DISPOSITIONS)), note }).strict(),
  z.object({ action: z.literal("transfer.cancel"), id: uuid, note }).strict(),
  z.object({ action: z.literal("transfer.close"), id: uuid, note }).strict(),
  z.object({ action: z.literal("recipe.define"), recipe_code: code("Recipe code"), name: text(3, 80, "Name"), process: z.enum(keysOf(PROCESSES)), alloys: z.array(text(1, 20, "Alloy")).min(1, "List the compatible alloys").max(10, "At most ten alloys"),
    target_temper: text(1, 10, "Target temper"), temp_min_c: amount(20, 700, "Minimum temperature", 1), temp_max_c: amount(20, 700, "Maximum temperature", 1), soak_min_minutes: amount(1, 2880, "Minimum minutes", 0),
    soak_max_minutes: amount(1, 2880, "Maximum minutes", 0), min_readings: amount(1, 100, "Readings required", 0), note }).strict(),
  z.object({ action: z.literal("recipe.approve"), id: uuid, note }).strict(),
  z.object({ action: z.literal("treat.create"), recipe_id: uuid, machine_id: uuid, inputs: z.array(input).min(1, "Add an input job").max(20, "At most twenty inputs"), load_note: text(5, 300, "Loading arrangement") }).strict(),
  z.object({ action: z.literal("treat.start"), id: uuid }).strict(),
  z.object({ action: z.literal("treat.observe"), id: uuid, temperature_c: amount(0, 800, "Temperature", 1), instrument_ref: text(2, 60, "Instrument"), reading_note: text(1, 200, "Reading note").optional() }).strict(),
  z.object({ action: z.literal("treat.end"), id: uuid, interrupted: z.boolean(), note }).strict(),
  z.object({ action: z.literal("treat.review"), id: uuid, outcomes: z.array(outcome).min(1, "Enter the outcome for each input").max(20), accept_deviation: z.boolean(), note }).strict(),
  z.object({ action: z.literal("toll.define"), customer_id: uuid, material_spec: text(3, 120, "Material specification"), alloy: text(1, 40, "Alloy"), permitted_mixing: z.boolean(),
    allowed_loss_percent: amount(0, 10, "Loss allowance", 2).optional(), conversion_rate_per_kg: amount(0.01, 1000000, "Conversion rate", 2), billing_basis: z.enum(["output_kg", "input_kg"]), note }).strict(),
  z.object({ action: z.literal("toll.approve"), id: uuid, note }).strict(),
  z.object({ action: z.literal("toll.receive"), customer_id: uuid, received_kg: kg("Received kg"), challan_ref: text(1, 60, "Challan"), location: text(2, 60, "Location"), heat_ref: text(1, 60, "Heat").optional(), alloy: text(1, 40, "Alloy").optional(), note }).strict(),
  z.object({ action: z.literal("toll.inspect"), receipt_id: uuid, decision: z.enum(["accepted", "rejected"]), note }).strict(),
  z.object({ action: z.literal("toll.move"), customer_id: uuid, kind: z.enum(keysOf(TOLL_KINDS)), quantity_kg: kg("Quantity"), receipt_id: uuid.optional(), production_job_id: uuid.optional(), reference: text(1, 60, "Reference").optional(), note }).strict(),
  z.object({ action: z.literal("toll.reverse"), movement_id: uuid, note }).strict(),
  z.object({ action: z.literal("toll.statement"), customer_id: uuid, note }).strict(),
  z.object({ action: z.literal("toll.settle"), statement_id: uuid, decision: z.enum(["agree", "dispute"]), note }).strict(),
  z.object({ action: z.literal("weigh.open"), movement_kind: z.enum(["dispatch", "purchase_receipt"]), dispatch_id: uuid.optional(), purchase_receipt_id: uuid.optional(), vehicle_id: uuid.optional(),
    vehicle_registration: text(4, 20, "Vehicle registration"), instrument_ref: text(2, 60, "Weighbridge"), calibration_valid_until: day, tolerance_kg: amount(0, 1000, "Tolerance", 3), note }).strict(),
  z.object({ action: z.literal("weigh.read"), id: uuid, kind: z.enum(["gross", "tare"]), weight_value: amount(0.001, 100000, "Weight", 3), unit: z.enum(["kg", "t"]), read_at: z.string().datetime({ offset: true, message: "Enter when the reading was taken" }),
    source: z.enum(["manual", "device"]), stable: z.boolean(), vehicle_registration_read: text(4, 20, "Vehicle on the slip"), provider_ref: text(1, 80, "Packet reference").optional(), slip_ref: text(1, 60, "Slip").optional() }).strict(),
  z.object({ action: z.literal("weigh.pair"), id: uuid, gross_reading_id: uuid, tare_reading_id: uuid, note }).strict(),
  z.object({ action: z.literal("weigh.finalize"), id: uuid, accept_difference: z.boolean(), note }).strict(),
  z.object({ action: z.literal("weigh.supersede"), id: uuid, note }).strict(),
  z.object({ action: z.literal("weigh.cancel"), id: uuid, note }).strict()
]).superRefine((value, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (value.action === "intake.resolve" && value.decision === "not_a_line" && [value.profile_id, value.quantity, value.quantity_unit, value.length_mm, value.finish, value.due_date].some(item => item !== undefined)) issue("decision", "A line that is not an order line has no values");
  if (value.action === "automation.define" && value.min_amount !== undefined && value.trigger_kind !== "invoice_overdue") issue("min_amount", "Only the overdue invoice trigger has a minimum amount");
  if (value.action === "lab.request") {
    if ((value.material_kind === "production_job") !== Boolean(value.production_job_id)) issue("production_job_id", "Choose the production job");
    if ((value.material_kind === "billet_batch") !== Boolean(value.billet_batch_id)) issue("billet_batch_id", "Choose the billet batch");
    if (value.material_kind === "other" && !value.material_note) issue("material_note", "Describe the material being tested");
    if (new Set(value.tests.map(item => item.code)).size !== value.tests.length) issue("tests", "Each test is listed once");
  }
  if (value.action === "lab.review" && (value.decision === "retest") !== Boolean(value.retest_promised_date)) issue("retest_promised_date", "A retest needs the new promised date, and only a retest has one");
  if (value.action === "agreement.define" && value.valid_to < value.valid_from) issue("valid_to", "The agreement cannot end before it starts");
  if (value.action === "agreement.close" && value.carry_forward !== Boolean(value.new_valid_to)) issue("new_valid_to", "A carry-forward needs the new end date, and only a carry-forward has one");
  if (value.action === "tooling.define") {
    if (value.customer_contribution > value.die_charge) issue("customer_contribution", "The contribution cannot exceed the die charge");
    if (value.waiver_amount > value.customer_contribution) issue("waiver_amount", "The waiver cannot exceed the contribution");
    if ((value.recovery_basis === "per_kg") !== (value.recovery_rate_per_kg !== undefined && value.recovery_cap !== undefined)) issue("recovery_rate_per_kg", "Recovery per kg needs a rate and a cap; no recovery has neither");
    if (value.recovery_basis === "none" && (value.recovery_rate_per_kg !== undefined || value.recovery_cap !== undefined)) issue("recovery_rate_per_kg", "No recovery has no rate or cap");
  }
  if (value.action === "tooling.allocate") {
    const needs = { charge_invoice: "invoice_id", recovery: "invoice_id", payment: "payment_id", credit_note: "credit_note_id" } as const;
    for (const key of ["invoice_id", "payment_id", "credit_note_id"] as const) if ((needs[value.kind] === key) !== Boolean(value[key])) issue(key, "Link one record of the chosen kind");
    if ((value.kind === "recovery") === (value.amount !== undefined)) issue("amount", value.kind === "recovery" ? "A recovery is calculated from dispatched kilograms; leave the amount blank" : "Enter the amount allocated");
  }
  if (value.action === "transfer.request" && new Set(value.batch_ids).size !== value.batch_ids.length) issue("batch_ids", "A bundle is listed twice");
  if (value.action === "recipe.define") {
    if (value.temp_max_c <= value.temp_min_c) issue("temp_max_c", "The maximum temperature must be above the minimum");
    if (value.soak_max_minutes < value.soak_min_minutes) issue("soak_max_minutes", "The maximum time cannot be below the minimum");
  }
  if (value.action === "treat.create" && new Set(value.inputs.map(item => item.job_id)).size !== value.inputs.length) issue("inputs", "A job is listed twice");
  if (value.action === "toll.move") {
    const receipt = value.kind === "issue" || value.kind === "return_metal"; const job = ["issue", "output", "scrap", "explained_loss"].includes(value.kind);
    if (receipt !== Boolean(value.receipt_id)) issue("receipt_id", receipt ? "Choose the receipt" : "This movement does not name a receipt");
    if (job !== Boolean(value.production_job_id)) issue("production_job_id", job ? "Choose the production job" : "This movement does not name a job");
  }
  if (value.action === "weigh.open") {
    if ((value.movement_kind === "dispatch") !== Boolean(value.dispatch_id)) issue("dispatch_id", "Choose the dispatch being weighed");
    if ((value.movement_kind === "purchase_receipt") !== Boolean(value.purchase_receipt_id)) issue("purchase_receipt_id", "Choose the purchase receipt being weighed");
  }
  if (value.action === "weigh.read" && value.source === "device" && !value.provider_ref) issue("provider_ref", "A device reading needs its packet reference");
});
export type SpecialistMutation = z.infer<typeof specialistMutationSchema>;
export type SpecialistAction = SpecialistMutation["action"];
/** Actions carried by their own meaning; they have no separate explanation field. Mirrors private.specialist_spec. */
export const NOTELESS_ACTIONS: readonly SpecialistAction[] = ["intake.submit", "automation.simulate", "lab.result", "transfer.receive", "treat.create", "treat.start", "treat.observe", "weigh.read"];

const ACTION_VIEW: Record<string, SpecialistView> = { intake: "intake", automation: "automation", lab: "lab", shade: "shades", agreement: "agreements", release: "agreements", tooling: "tooling",
  transfer: "transfers", recipe: "treatment", treat: "treatment", toll: "tolling", weigh: "weighing" };
export function specialistMutationView(action: SpecialistAction): SpecialistView { return ACTION_VIEW[action.split(".")[0]]; }

const ACTION_ROLES = (action: SpecialistAction): readonly string[] => {
  if (action.startsWith("intake.")) return ["owner", "admin", "sales_manager", "sales"];
  if (action === "automation.simulate") return ["owner", "admin", "factory_manager", "accounts"];
  if (action.startsWith("automation.")) return ["owner", "admin", "factory_manager"];
  if (action === "lab.review") return ["owner", "admin", "quality"];
  if (action.startsWith("lab.")) return ["owner", "admin", "quality", "factory_manager"];
  if (action === "shade.define") return ["owner", "admin", "quality", "sales_manager"];
  if (["shade.approve", "shade.withdraw", "shade.decide"].includes(action)) return ["owner", "admin", "quality"];
  if (action === "shade.bind") return ["owner", "admin", "sales_manager", "sales", "quality", "factory_manager"];
  if (action === "agreement.approve") return ["owner", "admin", "sales_manager", "accounts"];
  if (action.startsWith("agreement.")) return ["owner", "admin", "sales_manager"];
  if (action.startsWith("release.")) return ["owner", "admin", "sales_manager", "sales"];
  if (action.startsWith("tooling.")) return ["owner", "admin", "sales_manager", "accounts"];
  if (action.startsWith("transfer.")) return ["owner", "admin", "inventory_manager", "factory_manager"];
  if (action === "recipe.define") return ["owner", "admin", "quality", "production_manager"];
  if (action === "recipe.approve" || action === "treat.review") return ["owner", "admin", "quality"];
  if (action.startsWith("treat.")) return ["owner", "admin", "production_manager", "production", "factory_manager"];
  if (["toll.define", "toll.approve", "toll.statement", "toll.settle"].includes(action)) return ["owner", "admin", "accounts"];
  if (action === "toll.inspect") return ["owner", "admin", "quality"];
  if (action.startsWith("toll.")) return ["owner", "admin", "inventory_manager", "factory_manager", "production_manager"];
  if (action === "weigh.finalize" || action === "weigh.supersede") return ["owner", "admin", "dispatch_manager", "inventory_manager"];
  return ["owner", "admin", "dispatch_manager", "dispatch", "inventory_manager"];
};
/** Mirrors private.specialist_action_allowed. The server further limits some actions to a second person. */
export function canUseSpecialistAction(role: string, action: SpecialistAction) {
  return canReadSpecialist(role, specialistMutationView(action)) && role !== "viewer" && ACTION_ROLES(action).includes(role);
}

export const SPECIALIST_LOOKUPS = ["employees", "customers", "quotes", "orders", "profiles", "vendors", "jobs", "billets", "order_items", "shade_refs", "finishing_jobs", "dies", "invoices", "payments", "credit_notes",
  "stock_batches", "locations", "ovens", "recipes", "toll_receipts", "dispatches", "receipts", "vehicles"] as const;
export type SpecialistLookupKind = typeof SPECIALIST_LOOKUPS[number];
const page = z.number().int().min(1).max(100000).default(1);
export const specialistCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("list"), view: z.enum(viewKeys), page, search: z.string().trim().max(80).default(""), state: z.enum(["active", "all"]).default("active"),
    status: z.string().regex(/^[a-z_]{1,40}$/).optional(), sort: z.enum(["priority", "newest", "due"]).default("priority") }).strict(),
  z.object({ command: z.literal("detail"), view: z.enum(viewKeys), id: uuid, page }).strict(),
  z.object({ command: z.literal("lookup"), kind: z.enum(SPECIALIST_LOOKUPS), search: z.string().trim().max(80).default(""), selected_id: uuid.optional(), parent_id: uuid.optional() }).strict(),
  z.object({ command: z.literal("preview"), request_id: uuid, mutation: specialistMutationSchema }).strict(),
  z.object({ command: z.literal("commit"), request_id: uuid, fingerprint: z.string().regex(/^[0-9a-f]{32}$/) }).strict(),
  z.object({ command: z.literal("outcome"), request_id: uuid }).strict(),
  z.object({ command: z.literal("abandon"), request_id: uuid }).strict()
]);
export type SpecialistCommand = z.input<typeof specialistCommandSchema>;

export const specialistRowSchema = z.object({
  id: uuid, label: z.string(), status: z.string(), owner: z.string().nullable(), due_date: z.string().nullable(), summary: z.string(), source_href: z.string().nullable(), details: z.record(z.unknown())
}).strict();
export type SpecialistRow = z.infer<typeof specialistRowSchema>;
export const specialistListSchema = z.object({ rows: z.array(specialistRowSchema).max(10), total_count: z.number().int().nonnegative(), as_of: z.string() }).strict();
export type SpecialistList = z.infer<typeof specialistListSchema>;
export const specialistDetailSchema = z.object({ row: specialistRowSchema, events: z.array(z.object({ id: uuid, action: z.string(), actor: z.string(), note: z.string(), recorded_at: z.string() }).strict()).max(10),
  event_count: z.number().int().nonnegative(), as_of: z.string() }).strict();
export type SpecialistDetail = z.infer<typeof specialistDetailSchema>;
export const specialistLookupSchema = z.array(z.object({ value: uuid, label: z.string(), context: z.string() }).strict()).max(20);
export const specialistOutcomeSchema = z.object({
  request_id: uuid, state: z.enum(["prepared", "confirmed", "rejected", "abandoned", "not_recorded"]), fingerprint: z.string().regex(/^[0-9a-f]{32}$/),
  expires_at: z.string(), action: z.string(),
  review: z.object({ title: z.string(), effect: z.string(), warnings: z.array(z.string()), facts: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])) }).strict(),
  result: z.object({ label: z.string(), href: z.string().nullable(), message: z.string() }).strict().nullable()
}).strict();
export type SpecialistOutcome = z.infer<typeof specialistOutcomeSchema>;
export type SpecialistResult<T = unknown> = { success: true; data: T } | { success: false; error: string; uncertain?: boolean; unavailable?: boolean };

export function parseSpecialistData(command: string, value: unknown) {
  if (command === "list") return specialistListSchema.parse(value);
  if (command === "detail") return specialistDetailSchema.parse(value);
  if (command === "lookup") return specialistLookupSchema.parse(value);
  return specialistOutcomeSchema.parse(value);
}

export const SPECIALIST_STATUS: Record<string, string> = {
  review: "In review", needs_resolution: "Lines need a person to resolve", ready: "Ready for order entry", linked: "Order entered", superseded: "Replaced by a later revision", discarded: "Discarded",
  draft: "Draft; awaiting a second approver", approved: "Approved", paused: "Paused", retired: "Retired", simulated: "Simulation only: nothing executed", succeeded: "Run completed", partial: "Run partly failed", failed: "Run failed", nothing_due: "Nothing was due",
  requested: "Requested", dispatched: "Sample dispatched", at_lab: "Acknowledged by the laboratory", reported: "Every test has a result; awaiting quality review", reviewed: "Quality decision recorded", lost: "Lost", cancelled: "Cancelled", overdue: "Results overdue",
  withdrawn: "Withdrawn", mixed_reference: "Mixed references on one order", rejected_batch: "A batch was rejected", withdrawn_reference: "Bound reference withdrawn", superseded_reference: "A newer revision is approved",
  awaiting_decision: "Awaiting a batch decision", unreviewed_batches: "Some batches have no decision", matched: "Every batch matches", replaced: "Replaced",
  active: "Active", expired: "Expired", closed: "Closed", disputed: "Disputed",
  in_transit: "In transit", partially_received: "Partly received", received: "Every bundle resolved",
  loaded: "Loaded", running: "Cycle running", ended: "Cycle ended; awaiting review", interrupted: "Interrupted; needs attention", released: "Released", partially_released: "Partly released", rejected: "Rejected", retreatment: "Sent for retreatment",
  open: "Open", pending_inspection: "Receipt awaiting inspection", unexplained_difference: "Unexplained difference", agreed: "Agreed",
  paired: "Paired; ready to finalise", finalized: "Finalised"
};
/** The same word can mean different things in different views, so a view may override the label. */
const VIEW_STATUS: Partial<Record<SpecialistView, Record<string, string>>> = {
  weighing: { open: "Open; readings being recorded", interrupted: "Open for more than a day" }, transfers: { requested: "Requested; nothing has moved" }, tolling: { open: "Open account" },
  agreements: { active: "Active" }, tooling: { active: "Active agreement" }, automation: { approved: "Approved; runs when started" }
};
export function specialistStatusLabel(status: string, view?: SpecialistView) { return (view && VIEW_STATUS[view]?.[status]) ?? SPECIALIST_STATUS[status] ?? status.replace(/_/g, " "); }

/** Actions started from a database page rather than from a record. */
export const SPECIALIST_CREATES: Record<SpecialistView, SpecialistAction[]> = {
  intake: ["intake.submit"], automation: ["automation.define"], lab: ["lab.request"], shades: ["shade.define", "shade.bind"], agreements: ["agreement.define"], tooling: ["tooling.define"],
  transfers: ["transfer.request"], treatment: ["recipe.define", "treat.create"], tolling: ["toll.define", "toll.receive"], weighing: ["weigh.open"]
};

export function specialistRecoveryKey(companyId: string, userId: string) { return `extrusionos:specialist:v1:${companyId}:${userId}`; }

/** Normalises a registration as the server does: letters and digits only, upper case. */
export function normalizeRegistration(value: string) { return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase(); }

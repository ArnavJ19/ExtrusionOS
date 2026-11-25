// Foundry scrap receiving: command schemas for the database gateway public.ap_scrap_receipt, the labels shared by the
// screens, and the pure rules the screens show before the database re-checks them (net weight, accepted kg, the exit
// attempt limit and the Indian mobile format). The database takes the company and the actor from the session.
import { z } from "zod";
import { standardAlloys } from "../../types/app.ts";

export const SCRAP_RECEIVERS = ["owner", "admin", "production_manager", "production", "factory_manager"] as const;
export const SCRAP_RECEIPT_READERS = [...SCRAP_RECEIVERS, "accounts"] as const;
export const METAL_FINANCE_ROLES = ["owner", "admin", "accounts"] as const;
export const EXIT_APPROVER_ROLE = "factory_manager" as const;
export const SCRAP_TYPE_MANAGERS = ["owner", "admin", "factory_manager"] as const;
/** Exit attempts after step 1 before the receiver must give a reason and the factory manager is alerted. */
export const EXIT_ATTEMPT_LIMIT = 5;

export const ALLOY_OPTIONS = standardAlloys.filter((alloy) => alloy !== "other");

export const VISUAL_CHECKS = {
  matches_type: "Material matches the scrap type expected",
  dry: "Dry: no water, oil or emulsion",
  no_iron_steel: "No iron or steel pieces, screws or inserts",
  no_plastic_rubber_wood: "No plastic, rubber, gaskets or wood",
  no_sealed_containers: "No sealed or closed containers (explosion risk in the furnace)",
  single_alloy: "One alloy family only, no mixed alloys",
  clean_surface: "Surface acceptable: no heavy paint, dirt or corrosion"
} as const;
export type VisualCheck = keyof typeof VISUAL_CHECKS;
export const VISUAL_CHECK_KEYS = Object.keys(VISUAL_CHECKS) as VisualCheck[];

export const QUALITY_ISSUES = {
  wrong_type: "Not the scrap type ordered",
  moisture_oil: "Wet, oily or with emulsion",
  paint_coating: "Painted, powder-coated or lacquered",
  iron_steel: "Iron or steel attachments",
  plastic_rubber_wood: "Plastic, rubber, gaskets or wood",
  mixed_alloy: "Mixed or unknown alloy",
  dirt_sand: "Dirt, sand or dust",
  oxidation: "Heavy oxidation or corrosion",
  sealed_containers: "Sealed containers or pressure vessels",
  other: "Other (describe in the reason)"
} as const;
export type QualityIssue = keyof typeof QUALITY_ISSUES;

export const PROCESSING_STEPS = {
  sorting: "Sorting / segregation",
  removing_attachments: "Removing attachments",
  cleaning: "Cleaning",
  de_coating: "De-coating",
  drying: "Drying",
  cutting: "Cutting to charge size",
  baling: "Baling"
} as const;
export type ProcessingStep = keyof typeof PROCESSING_STEPS;

export const READINESS = { ready_to_use: "Ready to use in the furnace", needs_processing: "Needs further processing" } as const;
export const RECEIPT_QUALITIES = { clean: "Clean", painted: "Painted", mixed: "Mixed", contaminated: "Contaminated", segregation_required: "Segregation required" } as const;
export const RECEIPT_STATUS: Record<string, string> = { inspection: "Visual verification", details: "Material details", completed: "Received", exited: "Left with approval" };
export const FINANCE_STATUS: Record<string, string> = { not_ready: "Not ready", pending: "Bill pending", completed: "Bill recorded" };
export const REQUEST_STATUS: Record<string, string> = { open: "Open", fulfilled: "Fulfilled", cancelled: "Closed" };
export const FILE_KINDS = { inspection_photo: "Scrap photo", rejection_photo: "Quality problem photo", weighbridge_slip: "Weighbridge slip", bill: "Bill", eway_bill: "E-way bill", supporting: "Supporting document" } as const;
export type FileKind = keyof typeof FILE_KINDS;
export const FINANCE_FILE_KINDS: FileKind[] = ["bill", "eway_bill", "supporting"];

/** Net weighbridge weight in kg (gross minus tare), or null while either is missing or the gross is not above the tare. */
export function netWeightKg(gross: number | null | undefined, tare: number | null | undefined) {
  if (gross === null || gross === undefined || tare === null || tare === undefined || !Number.isFinite(gross) || !Number.isFinite(tare)) return null;
  if (gross <= tare || tare < 0) return null;
  return Math.round((gross - tare) * 1000) / 1000;
}

/** Kilograms taken into stock: the net weight less the portion not of quality (all of it when the whole load failed). */
export function acceptedKg(net: number, qualityOk: boolean, scope: "all" | "partial" | null, rejectedKg: number | null) {
  if (qualityOk) return net;
  if (scope === "all") return 0;
  const rejected = rejectedKg ?? 0;
  return rejected > 0 && rejected < net ? Math.round((net - rejected) * 1000) / 1000 : null;
}

/** What the exit button does on the next press after `attempts` refused attempts. */
export function exitAttemptState(attempts: number, pending: boolean) {
  if (pending) return { kind: "pending" as const, remaining: 0 };
  const remaining = Math.max(EXIT_ATTEMPT_LIMIT - attempts - 1, 0);
  return attempts + 1 >= EXIT_ATTEMPT_LIMIT ? { kind: "needs_reason" as const, remaining: 0 } : { kind: "refuse" as const, remaining };
}

/** Bill value as the expense ledger derives it: kg x rate (rounded to paise) + GST + freight - discount. */
export function billTotal(kg: number, rate: number, tax = 0, freight = 0, discount = 0) {
  const base = Math.round(kg * rate * 100) / 100;
  return { base, total: Math.round((base + tax + freight - discount) * 100) / 100 };
}

/** A 10-digit Indian mobile in +91 form, accepting spaces, dashes and a leading 0 or 91; null when it is not one. */
export function indianMobile(value: string) {
  const digits = value.replace(/[\s-]/g, "").replace(/^\+91/, "").replace(/^(0|91)(?=[6-9]\d{9}$)/, "");
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

const uuid = z.string().uuid();
const page = z.number().int().min(1).max(100000).optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const clean = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);
const text = (min: number, max: number, label: string) => z.string().trim().min(min, `${label}: at least ${min} characters`).max(max, `${label}: at most ${max} characters`).refine(clean, `${label}: remove control characters`);
const kg = (label: string, min = 0) => z.number({ invalid_type_error: `${label} must be a number` }).finite().min(min, `${label} must be at least ${min}`).max(200000, `${label} is more than 2,00,000 kg`);
const money = (label: string) => z.number({ invalid_type_error: `${label} must be a number` }).finite().min(0, `${label} cannot be negative`).max(1_000_000_000);
const alloy = z.string().trim().min(2, "Choose the alloy").max(20);
const enumOf = <T extends Record<string, string>>(labels: T) => z.enum(Object.keys(labels) as [keyof T & string, ...(keyof T & string)[]]);

const checklist = z.object(Object.fromEntries(VISUAL_CHECK_KEYS.map((key) => [key, z.boolean()])) as Record<VisualCheck, z.ZodBoolean>).strict();
const finance = {
  vendor_id: uuid,
  invoice_number: text(1, 40, "Bill number"),
  invoice_date: day,
  due_date: day.optional(),
  rate_per_kg: z.number({ invalid_type_error: "Rate per kg must be a number" }).finite().min(0.01, "Enter the rate per kg").max(100000),
  tax_amount: money("GST amount").optional(),
  freight_amount: money("Freight").optional(),
  discount_amount: money("Discount").optional(),
  payment_method: text(2, 40, "Payment method").optional(),
  notes: text(3, 600, "Notes").optional()
};

export const scrapReceiptCommands = {
  types: z.object({ include_inactive: z.boolean().optional() }).strict(),
  add_type: z.object({ name: text(3, 80, "Scrap type name") }).strict(),
  set_type_active: z.object({ id: uuid, is_active: z.boolean() }).strict(),
  request: z.object({ scrap_type_id: uuid, alloy, quantity_kg: kg("Quantity", 1), required_by: day.optional(), purpose: text(3, 300, "Purpose").optional() }).strict(),
  cancel_request: z.object({ id: uuid, reason: text(10, 300, "Reason") }).strict(),
  requests: z.object({ page, status: z.enum(["open", "fulfilled", "cancelled", "all"]).optional() }).strict(),
  current: z.object({}).strict(),
  start: z.union([
    z.object({ present: z.literal(true), request_id: uuid.optional() }).strict(),
    z.object({ present: z.literal(false), request_id: uuid.optional(), proxy_name: text(2, 80, "Name of the person receiving"),
      proxy_phone: z.string().trim().refine((value) => indianMobile(value) !== null, "Enter a 10-digit Indian mobile number"), proxy_reason: text(10, 300, "Reason you are not at the site") }).strict()
  ]),
  add_file: z.object({ receipt_id: uuid.optional(), external_source_id: uuid.optional(), kind: enumOf(FILE_KINDS), storage_path: z.string().min(10).max(400),
    file_name: text(1, 200, "File name"), mime_type: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]), size_bytes: z.number().int().min(1).max(10485760).optional() }).strict()
    .refine((value) => Boolean(value.receipt_id) !== Boolean(value.external_source_id), "Invalid request."),
  inspect: z.object({ receipt_id: uuid, vehicle_number: text(4, 20, "Vehicle number"), challan_number: text(1, 40, "Challan number").optional(),
    weighbridge_reference: text(1, 60, "Weighbridge slip number"), gross_kg: kg("Gross weight", 1), tare_kg: kg("Tare weight"), quality_ok: z.boolean(), checklist,
    issues: z.array(enumOf(QUALITY_ISSUES)).max(10).optional(), rejection_scope: z.enum(["all", "partial"]).optional(), rejected_kg: kg("Weight not of quality").optional(),
    rejection_reason: text(15, 600, "Reason the scrap is not of quality").optional(), notes: text(3, 600, "Inspection notes").optional() }).strict()
    .refine((value) => value.gross_kg > value.tare_kg, { message: "Gross weight must be more than the tare weight", path: ["gross_kg"] }),
  complete: z.object({ receipt_id: uuid, scrap_type_id: uuid, alloy, readiness: enumOf(READINESS), processing_steps: z.array(enumOf(PROCESSING_STEPS)).max(7).optional(),
    scrap_quality: enumOf(RECEIPT_QUALITIES).optional(), notes: text(3, 600, "Notes").optional() }).strict(),
  abort: z.object({ receipt_id: uuid, reason: text(10, 300, "Reason you need to leave the receipt").optional() }).strict(),
  decide_exit: z.object({ receipt_id: uuid, decision: z.enum(["approved", "declined"]), reason: text(10, 300, "Reason") }).strict(),
  receipts: z.object({ page, status: z.enum(["all", "in_progress", "exit_requested", "completed", "exited", "finance_pending", "finance_completed"]).optional(), search: z.string().trim().max(60).optional() }).strict(),
  get: z.object({ id: uuid }).strict(),
  finance_save: z.object({ receipt_id: uuid, ...finance }).strict(),
  source_finance_save: z.object({ source_id: uuid, ...finance }).strict(),
  finance_queue: z.object({ page, status: z.enum(["pending", "completed"]).optional() }).strict(),
  source_get: z.object({ id: uuid }).strict()
};

export const SCRAP_RECEIPT_READS = ["types", "requests", "receipts", "current", "finance_queue", "source_get"] as const;

export type ScrapType = { id: string; code: string; name: string; is_active: boolean };
export type ReceiptFile = { id: string; kind: FileKind; storage_path: string; file_name: string; mime_type: string; uploaded_by: string; uploaded_at: string };
export type ReceiptDetail = {
  id: string; receipt_number: string; status: string; started_at: string; started_by: string; is_receiver: boolean; can_decide_exit: boolean; can_finance: boolean;
  request: { id: string; request_number: string; quantity_kg: number; alloy: string; scrap_type: string } | null;
  receiver_present: boolean; proxy_name: string | null; proxy_phone: string | null; proxy_reason: string | null;
  vehicle_number: string | null; challan_number: string | null; weighbridge_reference: string | null; gross_kg: number | null; tare_kg: number | null; net_kg: number | null;
  quality_ok: boolean | null; checklist: Partial<Record<VisualCheck, boolean>>; issues: QualityIssue[]; rejection_scope: "all" | "partial" | null; rejected_kg: number | null;
  rejection_reason: string | null; inspection_notes: string | null; inspected_at: string | null;
  scrap_type_id: string | null; scrap_type: string | null; alloy: string | null; readiness: keyof typeof READINESS | null; processing_steps: ProcessingStep[]; scrap_quality: string | null;
  detail_notes: string | null; accepted_kg: number | null; completed_at: string | null; completed_by: string | null;
  accepted_lot: { id: string; scrap_number: string; status: string; available_weight_kg: number } | null; rejected_lot: { id: string; scrap_number: string; status: string } | null;
  abort_attempts: number; escalated_at: string | null; exit_requested_at: string | null; exit_request_reason: string | null; exit_decision: "approved" | "declined" | null;
  exit_decided_by: string | null; exit_decided_at: string | null; exit_decision_reason: string | null; finance_status: string;
  finance: null | { vendor_id: string | null; vendor_name: string | null; invoice_number: string | null; invoice_date: string | null; due_date: string | null; rate_per_kg: number | null;
    tax_amount: number | null; freight_amount: number | null; discount_amount: number | null; payment_method: string | null; notes: string | null; completed_by: string | null; completed_at: string | null;
    expense: { id: string; expense_number: string; total_amount: number; approval_status: string; payment_status: string } | null };
  files: ReceiptFile[];
};

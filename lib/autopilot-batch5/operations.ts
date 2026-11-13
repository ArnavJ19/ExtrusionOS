import { z } from "zod";
import { planBilletInput } from "../calculations/production-performance.ts";

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const reason = z.string().trim().min(10).max(500).refine(v => !/[\u0000-\u001f\u007f]/.test(v), "Remove control characters");
const list = { page: z.number().int().min(1).max(100000).optional(), search: z.string().trim().max(80).optional(),
  sort: z.enum(["date", "name"]).optional(), show: z.enum(["attention", "all"]).optional() };

export const MANAGEMENT = ["owner", "admin", "factory_manager"];
export const PLANNERS = [...MANAGEMENT, "production_manager", "inventory_manager"];
export const COORDINATORS = [...PLANNERS, "sales_manager", "sales", "dispatch_manager"];
export const FINANCE = ["owner", "admin", "accounts"];

export const stockCommands = {
  balances: z.object(list).strict(),
  movements: z.object({ ...list, item_id: uuid }).strict(),
  requests: z.object({ ...list, item_id: uuid.optional() }).strict(),
  request_adjustment: z.object({ request_id: uuid, item_id: uuid, direction: z.enum(["in", "out"]), quantity: z.number().finite().positive().max(100000000),
    expected_stock: z.number().finite().nonnegative(), reason }).strict(),
  decide_adjustment: z.object({ id: uuid, decision: z.enum(["approve", "reject"]), reason }).strict(),
  stock_policy: z.object({}).strict(),
  save_stock_policy: z.object({ threshold: z.number().finite().nonnegative().max(100000000), reason }).strict(),
  trace: z.object({ ...list, table: z.enum(["inventory_items", "profile_stock_batches", "billet_batches", "packaging_materials", "foundry_aluminium_scrap", "foundry_external_aluminium_sources"]), id: uuid }).strict()
};
export const planningCommands = {
  billet_forecast: z.object(list).strict(),
  prepare_billet: z.object({}).strict(),
  red_list: z.object({ ...list, order_id: uuid.optional() }).strict(),
  predict: z.object({}).strict()
};
export const accountsCommands = {
  close_checklist: z.object({ month }).strict(),
  head_options: z.object({}).strict(),
  nominate_close_head: z.object({ actor_id: uuid }).strict(),
  request_close_exception: z.object({ month, fingerprint: z.string().regex(/^[a-f0-9]{32}$/), reason }).strict(),
  decide_close_exception: z.object({ id: uuid, decision: z.enum(["approve", "reject"]), reason }).strict(),
  msme_queue: z.object(list).strict(),
  msme_vendor: z.object({ vendor_id: uuid }).strict(),
  save_msme_vendor: z.object({ vendor_id: uuid, category: z.enum(["micro", "small", "medium", "none"]), udyam: z.string().trim().regex(/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/).optional(),
    agreed_days: z.number().int().min(1).max(365).optional(), reason }).strict().refine(v => v.category === "none" || !!v.udyam, "Enter the Udyam number"),
  save_msme_policy: z.object({ statutory_limit: z.number().int().min(1).max(45), no_agreement_days: z.number().int().min(1).max(15), reason }).strict(),
  bill_acceptance: z.object({ bill_id: uuid, accepted_on: day, reason }).strict(),
  msme_note: z.object({ bill_id: uuid, reason }).strict()
};
export const digestCommands = {
  digest: z.object({ date: day.optional() }).strict(),
  prepare_digest: z.object({}).strict(),
  digest_read: z.object({ id: uuid, kind: z.enum(["read", "copied"]) }).strict()
};
export const OPERATIONS_READS = ["balances", "movements", "requests", "stock_policy", "trace", "billet_forecast", "red_list", "close_checklist", "head_options", "msme_queue", "msme_vendor", "digest"];

/** Same input/recovery basis as planBilletInput; null inputs stay unknown. */
export function forecastInput(output: number | null, recovery: number | null): number | null {
  const plan = planBilletInput({ goodOutputKg: output, recoveryPercent: recovery });
  return plan.ok ? plan.plannedInputKg : null;
}

export function msmeDeadline(acceptedOn: string | null, agreedDays: number | null, limit = 45, noAgreementDays = 15): string | null {
  if (!acceptedOn) return null;
  const date = new Date(`${acceptedOn}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== acceptedOn) return null;
  date.setUTCDate(date.getUTCDate() + (agreedDays === null ? noAgreementDays : Math.min(agreedDays, limit)));
  return date.toISOString().slice(0, 10);
}

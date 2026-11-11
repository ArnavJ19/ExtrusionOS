// AP-007: cut-over checklist. Each section loads from the go-live sheet, must equal the totals signed on that sheet,
// and posts into the existing ledgers as "opening" entries. Signing off the plan locks entries before the cut-over date.
import { z } from "zod";
import { CUTOVER_DEFINITIONS, CUTOVER_SECTION_KEYS, type CutoverSectionKey } from "../master-data/import/definitions.ts";

export { CUTOVER_SECTION_KEYS, type CutoverSectionKey };
export const SECTION_ROLES: Record<CutoverSectionKey, readonly string[]> = {
  profile_stock: ["owner", "admin", "inventory_manager"], billet_stock: ["owner", "admin", "inventory_manager"], consumable_stock: ["owner", "admin", "inventory_manager"],
  receivables: ["owner", "admin", "accounts"], payables: ["owner", "admin", "accounts"], open_orders: ["owner", "admin"], die_custody: ["owner", "admin", "factory_manager", "production_manager"]
};
export const SECTION_LEDGER: Record<CutoverSectionKey, string> = {
  profile_stock: "Finished stock bundles typed Opening balance", billet_stock: "Billet batches received on the cut-over date", consumable_stock: "Stores items with an opening-stock movement",
  receivables: "Receivables numbered OB-, outside the GST invoice series", payables: "Expense ledger entries from source opening_balance", open_orders: "Orders marked as opening, one per customer order",
  die_custody: "Die status and location (custody)"
};
export const CUTOVER_READERS = ["owner", "admin", "accounts", "inventory_manager", "factory_manager", "production_manager", "sales_manager"] as const;

export function sectionLabel(section: CutoverSectionKey) { return CUTOVER_DEFINITIONS[section].label; }

const totals = z.object({ count: z.number(), quantity: z.number().optional(), amount: z.number().optional() });
export const cutoverPlanSchema = z.object({
  id: z.string().uuid(), cutover_date: z.string(), status: z.enum(["draft", "signed_off"]), signed_off_at: z.string().nullable(), signed_off_by: z.string().nullable(),
  locked_through: z.string().nullable(),
  sections: z.array(z.object({
    id: z.string().uuid(), section: z.enum(CUTOVER_SECTION_KEYS), status: z.enum(["open", "loaded", "signed_off"]), control_count: z.number().nullable(),
    control_quantity: z.number().nullable(), control_amount: z.number().nullable(), source_file_name: z.string().nullable(), loaded_at: z.string().nullable(),
    loaded_by: z.string().nullable(), signed_off_at: z.string().nullable(), signed_off_by: z.string().nullable(), loaded_totals: totals, ledger_totals: totals.nullable(),
    reversal_reason: z.string().nullable(), can_act: z.boolean(),
    lines: z.array(z.object({ row: z.number(), payload: z.record(z.unknown()), posted_table: z.string().nullable(), posted_id: z.string().nullable() }))
  }))
});
export type CutoverPlan = z.infer<typeof cutoverPlanSchema>;
export const cutoverGetSchema = z.object({ plan: cutoverPlanSchema.nullable(), can_start: z.boolean(), today: z.string() });

const reason = z.string().trim().min(10, "Give a reason of at least 10 characters").max(300).refine(value => !/[\u0000-\u001f\u007f]/.test(value), "Remove control characters");
export const cutoverCommandSchemas = {
  get: z.object({}).strict(),
  start: z.object({ cutover_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the cut-over date") }).strict(),
  sign_off_section: z.object({ section: z.enum(CUTOVER_SECTION_KEYS) }).strict(),
  reverse_section: z.object({ section: z.enum(CUTOVER_SECTION_KEYS), reason }).strict(),
  sign_off_plan: z.object({ empty_sections_confirmed: z.boolean().optional() }).strict()
} as const;

/** Control totals typed from the signed sheet; blank stays blank (not zero) and is then not compared. */
export const controlTotalsSchema = z.object({
  count: z.number().int().min(0).max(5000),
  quantity: z.number().min(0).max(1e12).nullable(),
  amount: z.number().min(0).max(1e12).nullable()
}).strict();

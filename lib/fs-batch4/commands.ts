// FABLE_SUGGESTIONS batch 4: command schemas for the database gateways public.fs_kpi (FS-77/FS-132), fs_history (FS-79),
// fs_monitoring (FS-07), fs_security (FS-51), fs_weight_basis (FS-65) and fs_authority (FS-75). The database re-checks
// every command and takes the company, the actor and the role from the session; these schemas only refuse malformed
// input early and list the roles each screen is for.
import { z } from "zod";

const uuid = z.string().uuid();
const page = z.number().int().min(1).max(1000).optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const clean = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);
const text = (min: number, max: number, label: string) => z.string().trim().min(min, `${label}: at least ${min} characters`).max(max, `${label}: at most ${max} characters`).refine(clean, `${label}: remove control characters`);
const amount = z.number().finite().min(0, "Amounts cannot be negative").max(1e13, "Amount too large");

export const KPI_READERS = ["owner", "admin", "accounts", "sales_manager", "factory_manager", "production_manager", "quality", "dispatch_manager"] as const;
export const FINANCE_KPI_ROLES = ["owner", "admin", "accounts"] as const;
export const kpiCommands = {
  values: z.object({ from: day.optional(), to: day.optional() }).strict(),
};

/** The record types with a history tab, and the roles that may open each (the same roles as the record's page). */
export const HISTORY_ENTITIES = {
  order: "orders", quote: "quotes", invoice: "invoices", payment: "payments", dispatch: "dispatches", inventory_item: "inventory_items",
  die: "dies", customer: "customers", profile: "aluminium_profiles", production_job: "production_jobs", vendor: "vendors", machine: "machines",
} as const;
export type HistoryEntity = keyof typeof HISTORY_ENTITIES;
const entity = z.enum(Object.keys(HISTORY_ENTITIES) as [HistoryEntity, ...HistoryEntity[]]);
/** Cost, margin, profit, supplier rates and internal notes: shown only to these roles (the SQL twin is in fs_history). */
export const HISTORY_COST_ROLES = ["owner", "admin", "accounts", "sales_manager"] as const;
export const historyCommands = {
  record: z.object({ entity_type: entity, entity_id: uuid, page }).strict(),
};

export const monitoringCommands = {
  report: z.object({ route: z.string().max(300), name: z.string().max(80).optional(), message: z.string().max(2000), digest: z.string().max(80).optional(), release: z.string().max(80).optional() }).strict(),
  health: z.object({ page }).strict(),
};

export const securityCommands = {
  login_history: z.object({ page }).strict(),
};

export const WEIGHT_BASES = { actual_weighed: "Actual weighed kg", theoretical: "Theoretical kg (pieces × length × kg/m)" } as const;
export type WeightBasis = keyof typeof WEIGHT_BASES;
const basis = z.enum(Object.keys(WEIGHT_BASES) as [WeightBasis, ...WeightBasis[]]);
export const WEIGHT_POLICY_READERS = ["owner", "admin", "accounts", "sales_manager", "dispatch_manager", "factory_manager"] as const;
/** Roles that see theoretical against actual weight on a dispatch (the same list as fs_weight_basis dispatch_weights). */
export const WEIGHT_DISPATCH_ROLES = ["owner", "admin", "accounts", "sales_manager", "sales", "dispatch_manager", "dispatch", "factory_manager", "inventory_manager", "viewer"] as const;
export const weightCommands = {
  policy: z.object({}).strict(),
  save_policy: z.object({ invoice_basis: basis.nullable(), default_tolerance_percent: z.number().finite().min(0).max(25, "At most 25%").nullable(), reason: text(5, 300, "Reason") }).strict(),
  save_customer: z.object({ customer_id: uuid, invoice_basis: basis.nullable(), reason: text(5, 300, "Reason") }).strict(),
  dispatch_weights: z.object({ dispatch_id: uuid }).strict(),
};

export const AUTHORITY_TYPES = {
  quote: "Quotation approval", low_margin_quote: "Low-margin quotation", expense: "Expense", discount: "Discount", credit_limit_override: "Credit-limit override",
  stock_adjustment: "Stock adjustment", write_off: "Write-off", purchase_order: "Purchase order", payment: "Payment", concession: "Quality concession", price_override: "Price override",
} as const;
export type AuthorityType = keyof typeof AUTHORITY_TYPES;
/** Types whose approval workflow reads the matrix today. The others can be configured but are not yet enforced. */
export const ENFORCED_AUTHORITY_TYPES: AuthorityType[] = ["quote", "low_margin_quote", "expense"];
export const APPROVER_ROLES = ["owner", "admin", "sales_manager", "accounts", "factory_manager", "production_manager", "inventory_manager", "dispatch_manager", "quality"] as const;
const authorityType = z.enum(Object.keys(AUTHORITY_TYPES) as [AuthorityType, ...AuthorityType[]]);
const approver = z.enum(APPROVER_ROLES);
export const authorityCommands = {
  overview: z.object({}).strict(),
  save_rule: z.object({ transaction_type: authorityType, min_amount: amount, max_amount: amount.nullable(), approver_roles: z.array(approver).min(1, "Choose at least one approving role").max(6),
    second_approver_from: amount.nullable(), second_approver_roles: z.array(approver).max(6).nullable(), reason: text(5, 300, "Reason"), replaces: uuid.optional() }).strict()
    .refine(v => v.max_amount === null || v.max_amount > v.min_amount, "The band must end above where it starts")
    .refine(v => v.second_approver_from === null || (v.second_approver_from >= v.min_amount && (v.max_amount === null || v.second_approver_from < v.max_amount)), "The second-approver amount must fall inside the band"),
  retire_rule: z.object({ id: uuid, reason: text(5, 300, "Reason") }).strict(),
  delegate: z.object({ from_user: uuid, to_user: uuid, starts_on: day, ends_on: day, transaction_types: z.array(authorityType).max(11).optional(), reason: text(5, 300, "Reason") }).strict()
    .refine(v => v.from_user !== v.to_user, "Choose two different people").refine(v => v.ends_on >= v.starts_on, "The leave must end on or after it starts"),
  revoke_delegation: z.object({ id: uuid }).strict(),
  report: z.object({ month: day.optional() }).strict(),
  awaiting: z.object({}).strict(),
};

export const BATCH4_COMMANDS = {
  fs_kpi: kpiCommands, fs_history: historyCommands, fs_monitoring: monitoringCommands, fs_security: securityCommands, fs_weight_basis: weightCommands, fs_authority: authorityCommands,
} as const;
export type Batch4Gateway = keyof typeof BATCH4_COMMANDS;
export const BATCH4_READS = new Set(["values", "record", "health", "login_history", "policy", "dispatch_weights", "overview", "report", "awaiting", "report_error"]);
export const BATCH4_PATHS: Record<Batch4Gateway, string[]> = {
  fs_kpi: [], fs_history: [], fs_monitoring: [], fs_security: [],
  fs_weight_basis: ["/settings/weight-basis"], fs_authority: ["/settings/authority", "/tasks/approvals"],
};

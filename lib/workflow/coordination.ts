import { z } from "zod";

export const COORDINATION_VIEWS = {
  orders: "Order coordination", collections: "Collections", handoffs: "Handoff contracts",
  coverage: "Backup coverage", sessions: "Daily coordination", decisions: "Open decisions",
  requests: "Team requests", stewards: "Master-data stewards", corrections: "Profile corrections"
} as const;
export type CoordinationView = keyof typeof COORDINATION_VIEWS;
export const COLLECTION_BUCKETS = { all: "All collection promises", follow_up_due: "Follow-ups due today", missed_promise: "Missed promises", disputed: "Disputed invoices", owner_unavailable: "Owner unavailable", partially_fulfilled: "Partly fulfilled", promise_met: "Promise met; balance remains" } as const;
const viewKeys = Object.keys(COORDINATION_VIEWS) as [CoordinationView, ...CoordinationView[]];
export const OPERATIONAL_ROLES = ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch", "inventory_manager", "accounts", "quality", "viewer"] as const;
export const COORDINATION_MANAGERS = ["owner", "admin", "factory_manager", "production_manager", "dispatch_manager", "sales_manager"] as const;
const finance = ["owner", "admin", "accounts"];
const technical = ["owner", "admin", "production_manager"];
const profileReaders = [...technical, "factory_manager", "inventory_manager", "sales_manager", "sales", "production", "quality", "viewer"];
const handoffReaders = ["owner", "admin", "factory_manager", "production_manager", "production", "dispatch_manager", "dispatch", "quality", "viewer"];

export function canReadCoordination(role: string, view?: CoordinationView) {
  if (!(OPERATIONAL_ROLES as readonly string[]).includes(role)) return false;
  if (view === "collections") return finance.includes(role);
  if (view === "handoffs") return handoffReaders.includes(role);
  if (view === "stewards" || view === "corrections") return profileReaders.includes(role);
  return true;
}

const uuid = z.string().uuid("Choose a record from the search results");
const note = z.string().trim().min(5, "Explain the action in at least 5 characters").max(500).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "Remove control characters");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date").refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, "Choose a real calendar date");
const money = z.number().finite().nonnegative().max(99999999999.99).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.001, "Use at most two decimal places");
const instant = z.string().datetime({ offset: true });
export const coordinationMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("coordinator.propose"), order_id: uuid, employee_id: uuid, note }).strict(),
  z.object({ action: z.literal("coordinator.accept"), order_id: uuid, note }).strict(),
  z.object({ action: z.literal("priority.set"), order_id: uuid, priority: z.enum(["urgent", "high", "normal", "low"]), note }).strict(),
  z.object({ action: z.literal("collection.create"), invoice_id: uuid, employee_id: uuid, amount: money.refine(value => value > 0, "Enter a positive promised amount"), due_date: date, disputed_amount: money.default(0), note }).strict(),
  z.object({ action: z.literal("collection.update"), id: uuid, employee_id: uuid, due_date: date, disputed_amount: money, note }).strict(),
  z.object({ action: z.literal("collection.withdraw"), id: uuid, note }).strict(),
  z.object({ action: z.literal("contract.publish"), team: z.enum(["packaging", "quality", "dispatch"]), response_hours: z.number().int().min(1).max(720), requirements: z.string().trim().min(10).max(1200), evidence: z.string().trim().min(5).max(500), note }).strict(),
  z.object({ action: z.literal("coverage.propose"), primary_id: uuid, backup_id: uuid, starts_at: instant, ends_at: instant, responsibility: z.string().trim().min(3).max(160), note }).strict(),
  z.object({ action: z.literal("coverage.acknowledge"), id: uuid, note }).strict(),
  z.object({ action: z.literal("coverage.cancel"), id: uuid, note }).strict(),
  z.object({ action: z.literal("coverage.reconcile"), note }).strict(),
  z.object({ action: z.literal("session.start"), note }).strict(),
  z.object({ action: z.literal("decision.create"), session_id: uuid, order_id: uuid, employee_id: uuid, due_date: date, title: z.string().trim().min(5).max(160), note }).strict(),
  z.object({ action: z.literal("request.create"), order_id: uuid, employee_id: uuid, due_date: date, message: z.string().trim().min(5).max(300), criteria: z.string().trim().min(5).max(500), note }).strict(),
  z.object({ action: z.literal("request.progress"), id: uuid, stage: z.enum(["acknowledged", "clarification", "resolved", "withdrawn"]), note }).strict(),
  z.object({ action: z.literal("steward.assign"), employee_id: uuid, backup_id: uuid, note }).strict(),
  z.object({ action: z.literal("correction.report"), profile_id: uuid, proposed_weight: z.number().finite().positive().max(1000).refine(value => Math.abs(value * 1000 - Math.round(value * 1000)) < 0.001, "Use at most three decimal places for kg/m"), evidence: z.string().trim().min(5).max(500), note }).strict(),
  z.object({ action: z.literal("correction.review"), id: uuid, decision: z.enum(["approved", "rejected", "superseded"]), note }).strict()
]);
export type CoordinationMutation = z.infer<typeof coordinationMutationSchema>;
export type CoordinationAction = CoordinationMutation["action"];

export function mutationView(action: CoordinationAction): CoordinationView {
  const prefix = action.split(".")[0];
  const views: Record<string, CoordinationView> = { coordinator: "orders", priority: "orders", collection: "collections", contract: "handoffs", coverage: "coverage", session: "sessions", decision: "decisions", request: "requests", steward: "stewards", correction: "corrections" };
  return views[prefix];
}

export function canUseCoordinationAction(role: string, action: CoordinationAction) {
  if (!canReadCoordination(role, mutationView(action)) || role === "viewer") return false;
  if (action.startsWith("collection.")) return finance.includes(role);
  if (action === "coordinator.propose" || action === "priority.set") return ["owner", "admin", "factory_manager", "sales_manager"].includes(role);
  if (action === "contract.publish") return ["owner", "admin", "factory_manager"].includes(role);
  if (["coverage.propose", "session.start", "decision.create"].includes(action)) return (COORDINATION_MANAGERS as readonly string[]).includes(role);
  if (action === "steward.assign" || action === "correction.review") return technical.includes(role);
  return true;
}

const page = z.number().int().min(1).max(100000).default(1);
export const coordinationCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("list"), view: z.enum(viewKeys), page, search: z.string().trim().max(80).default(""), state: z.enum(["active", "all"]).default("active"), bucket: z.enum(["all", "follow_up_due", "missed_promise", "disputed", "owner_unavailable", "partially_fulfilled", "promise_met"]).default("all"), sort: z.enum(["priority", "newest", "due"]).default("priority") }).strict(),
  z.object({ command: z.literal("detail"), view: z.enum(viewKeys), id: uuid, page }).strict(),
  z.object({ command: z.literal("lookup"), kind: z.enum(["employees", "orders", "invoices", "profiles"]), search: z.string().trim().max(80).default(""), selected_id: uuid.optional() }).strict(),
  z.object({ command: z.literal("preview"), request_id: uuid, mutation: coordinationMutationSchema }).strict(),
  z.object({ command: z.literal("commit"), request_id: uuid, fingerprint: z.string().regex(/^[0-9a-f]{32}$/) }).strict(),
  z.object({ command: z.literal("outcome"), request_id: uuid }).strict(),
  z.object({ command: z.literal("abandon"), request_id: uuid }).strict()
]);
export type CoordinationCommand = z.input<typeof coordinationCommandSchema>;

export const coordinationRowSchema = z.object({
  id: uuid, label: z.string(), status: z.string(), owner: z.string().nullable(), due_date: z.string().nullable(),
  summary: z.string(), source_href: z.string().nullable(), details: z.record(z.unknown())
}).strict();
export type CoordinationRow = z.infer<typeof coordinationRowSchema>;
export const coordinationListSchema = z.object({ rows: z.array(coordinationRowSchema).max(10), total_count: z.number().int().nonnegative(), as_of: z.string() }).strict();
export type CoordinationList = z.infer<typeof coordinationListSchema>;
export const coordinationDetailSchema = z.object({ row: coordinationRowSchema, events: z.array(z.object({ id: uuid, action: z.string(), actor: z.string(), note: z.string(), recorded_at: z.string() }).strict()).max(10), event_count: z.number().int().nonnegative(), as_of: z.string() }).strict();
export type CoordinationDetail = z.infer<typeof coordinationDetailSchema>;
export const handoffServiceSnapshotSchema = z.array(z.object({
  task_id: uuid, contract_id: uuid, response_due_at: z.string(),
  handoff_service_contracts: z.object({ team: z.string(), revision: z.number().int(), requirements: z.string(), evidence: z.string() }).strict()
}).strict()).max(10);
export type HandoffServiceSnapshot = z.infer<typeof handoffServiceSnapshotSchema>[number];
export const coordinationLookupSchema = z.array(z.object({ value: uuid, label: z.string(), context: z.string() }).strict()).max(20);
export const coordinationOutcomeSchema = z.object({
  request_id: uuid, state: z.enum(["prepared", "confirmed", "rejected", "abandoned", "not_recorded"]), fingerprint: z.string().regex(/^[0-9a-f]{32}$/),
  expires_at: z.string(), action: z.string(), review: z.object({ title: z.string(), effect: z.string(), warnings: z.array(z.string()), facts: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])) }).strict(),
  result: z.object({ label: z.string(), href: z.string().nullable(), message: z.string() }).strict().nullable()
}).strict();
export type CoordinationOutcome = z.infer<typeof coordinationOutcomeSchema>;
export type CoordinationResult<T = unknown> = { success: true; data: T } | { success: false; error: string; uncertain?: boolean; unavailable?: boolean };

export function parseCoordinationData(command: string, value: unknown) {
  if (command === "list") return coordinationListSchema.parse(value);
  if (command === "detail") return coordinationDetailSchema.parse(value);
  if (command === "lookup") return coordinationLookupSchema.parse(value);
  return coordinationOutcomeSchema.parse(value);
}

export const PRIORITY_POLICY = "existing-priority-due-v1";
export function operationalPriorityRank(priority: string | null | undefined) {
  return ({ urgent: 0, high: 1, normal: 2, low: 3 } as Record<string, number>)[priority ?? "normal"] ?? 2;
}
export function compareOperationalWork(a: { id: string; priority?: string | null; due_date?: string | null }, b: { id: string; priority?: string | null; due_date?: string | null }) {
  return operationalPriorityRank(a.priority) - operationalPriorityRank(b.priority)
    || (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31") || a.id.localeCompare(b.id);
}

export function actionRecoveryKey(companyId: string, userId: string) { return `extrusionos:coordination:v1:${companyId}:${userId}`; }
export function parseRecoveryMarker(raw: string | null, now = Date.now()) {
  if (!raw) return null;
  try {
    const value = z.object({ request_id: uuid, created_at: z.number().finite() }).strict().parse(JSON.parse(raw));
    return value.created_at <= now + 60000 ? value : null;
  } catch { return null; }
}

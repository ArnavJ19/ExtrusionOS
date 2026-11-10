import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionContext, UserRole } from "@/types/app";
import type { FeatureFlagState } from "@/lib/enterprise/features";
import { can, type Resource } from "../auth/permissions.ts";
import { hasRouteAccess } from "../auth/route-permissions.ts";
import { isFeatureEnabled } from "../enterprise/features.ts";
import { getBusinessDateBoundaries } from "../utils/business-date.ts";
import { nextRecordAction, type NextActionRecord } from "../workflow/record-next-action.ts";
import { proposalHref, type ProposalRow } from "../proposals/proposals.ts";

export const MY_WORK_LIMIT = 10;

export type WorkItem = {
  id: string;
  title: string;
  status: string;
  date: string | null;
  dateLabel: string;
  priority: string | null;
  href: string;
  actionLabel: string;
  blocker: string | null;
  ownership?: string;
};

export type WorkQueue = {
  key: string;
  title: string;
  description: string;
  href: string;
  items: WorkItem[];
  hasMore: boolean;
  error: string | null;
  errorKind?: "denied" | "unavailable";
};

export type MyWork = { today: string; assigned: WorkQueue; unassigned: WorkQueue; departments: WorkQueue[] };

type Source = {
  table: string;
  resource: Resource;
  route: string;
  action: string;
  statusField: string;
  module?: keyof FeatureFlagState;
  aliases: string[];
};

const sources: Source[] = [
  { table: "production_jobs", resource: "production", route: "/production", action: "Open job workflow", statusField: "status", module: "production_planning", aliases: ["production", "production_job", "production_jobs"] },
  { table: "dispatches", resource: "dispatches", route: "/dispatches", action: "Open dispatch", statusField: "delivery_status", aliases: ["dispatch", "dispatches"] },
  { table: "invoices", resource: "financials", route: "/invoices", action: "Review collection", statusField: "status", aliases: ["invoice", "invoices"] },
  { table: "quotes", resource: "quotes", route: "/quotes", action: "Open quotation", statusField: "status", aliases: ["quote", "quotes"] },
  { table: "orders", resource: "orders", route: "/orders", action: "Open order", statusField: "current_stage", aliases: ["order", "orders"] },
  { table: "quality_inspections", resource: "quality", route: "/quality", action: "Review inspection", statusField: "status", module: "quality_compliance", aliases: ["quality", "quality_inspection", "quality_inspections"] },
  { table: "inventory_items", resource: "inventory", route: "/inventory", action: "Review stock", statusField: "id", module: "advanced_inventory", aliases: ["inventory", "inventory_item", "inventory_items"] },
  { table: "customers", resource: "customers", route: "/customers", action: "Open customer", statusField: "id", aliases: ["customer", "customers"] },
  { table: "aluminium_profiles", resource: "profiles", route: "/profiles", action: "Open profile", statusField: "id", aliases: ["profile", "profiles", "aluminium_profile", "aluminium_profiles"] },
  { table: "dies", resource: "dies", route: "/dies", action: "Open die", statusField: "status", aliases: ["die", "dies"] },
];

type Department = {
  table: string;
  roles: UserRole[];
  title: string;
  description: string;
  select: string;
  identifier: string;
  date: string | null;
  dateLabel: string;
  statuses?: string[];
};

const departments: Department[] = [
  { table: "production_jobs", roles: ["owner", "admin", "production_manager", "production", "factory_manager"], title: "Production team queue", description: "Shared active jobs for your production team. Your own assignments appear separately.", select: "id, job_number, status, planned_date", identifier: "job_number", date: "planned_date", dateLabel: "Planned", statuses: ["planned", "ready", "in_progress", "on_hold"] },
  { table: "dispatches", roles: ["owner", "admin", "dispatch_manager", "dispatch", "factory_manager"], title: "Dispatch team queue", description: "Pending loads and delayed deliveries for the dispatch team.", select: "id, dispatch_number, delivery_status, dispatch_date", identifier: "dispatch_number", date: "dispatch_date", dateLabel: "Dispatch date", statuses: ["pending", "delayed"] },
  { table: "invoices", roles: ["owner", "admin", "accounts"], title: "Collections team queue", description: "Issued invoices with an outstanding balance. Review the invoice before recording a receipt.", select: "id, invoice_number, status, due_date", identifier: "invoice_number", date: "due_date", dateLabel: "Due", statuses: ["generated", "sent", "partially_paid", "overdue"] },
  { table: "quotes", roles: ["sales_manager", "sales"], title: "Sales team queue", description: "Quotations awaiting review, a customer response, or conversion to an order.", select: "id, quote_number, status, valid_until", identifier: "quote_number", date: "valid_until", dateLabel: "Valid until", statuses: ["internal_review", "sent", "customer_approved"] },
  { table: "quality_inspections", roles: ["quality"], title: "Quality team queue", description: "Inspections awaiting a decision or requiring follow-up.", select: "id, batch_number, status, inspection_date", identifier: "batch_number", date: "inspection_date", dateLabel: "Inspection date", statuses: ["pending", "rejected", "rework"] },
  { table: "inventory_items", roles: ["inventory_manager"], title: "Stock attention queue", description: "Active stock items recorded at zero or below. Check the stock workflow before replenishment.", select: "id, item_code", identifier: "item_code", date: null, dateLabel: "" },
];

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function availableSources(role: UserRole, flags: Partial<FeatureFlagState>) {
  return sources.filter((source) => can(role, "read", source.resource) && hasRouteAccess(source.route, role)
    && (!source.module || isFeatureEnabled(flags, source.module)));
}

function recordedBlocker(status: string): string | null {
  if (["on_hold", "blocked", "quality_hold"].includes(status)) return "On hold. Review the recorded reason and release conditions in the workflow.";
  if (["rejected", "rework", "damaged", "returned"].includes(status)) return "Requires review of the recorded exception before continuing.";
  if (status === "delayed") return "Delivery is recorded as delayed. Review the dispatch and follow-up.";
  return null;
}

function queue(key: string, title: string, description: string, href: string): WorkQueue {
  return { key, title, description, href, items: [], hasMore: false, error: null };
}

type Row = Record<string, any>;

async function readQueue(target: WorkQueue, read: () => PromiseLike<{ data: Row[] | null; error: unknown }>, map: (row: Row) => WorkItem) {
  try {
    const result = await read();
    if (result.error || !Array.isArray(result.data)) {
      const code = (result.error as { code?: string } | null)?.code;
      target.errorKind = ["42501", "PGRST301", "PGRST302"].includes(code ?? "") ? "denied" : "unavailable";
      throw new Error("Queue unavailable");
    }
    target.hasMore = result.data.length > MY_WORK_LIMIT;
    target.items = result.data.slice(0, MY_WORK_LIMIT).map(map);
  } catch {
    target.error = "Could not load this queue. Refresh to retry; its workload is unknown.";
  }
}

async function resolveTaskLinks(supabase: SupabaseClient, context: SessionContext, permitted: Source[], queues: WorkQueue[]) {
  const items = queues.flatMap((value) => value.items);
  await Promise.all(permitted.map(async (source) => {
    const linked = items.filter((item) => item.href.startsWith(`${source.route}/`));
    if (!linked.length) return;
    const ids = [...new Set(linked.map((item) => item.href.split("/").at(-1)!))];
    try {
      let query = supabase.from(source.table).select(source.statusField === "id" ? "id" : `id, ${source.statusField}`).eq("company_id", context.companyId).in("id", ids);
      if (["orders", "quotes", "invoices"].includes(source.table)) query = query.is("deleted_at", null);
      if (source.table === "production_jobs") query = query.eq("is_active", true);
      const { data, error } = await query.limit(ids.length);
      if (error || !data) throw new Error("Linked records unavailable");
      const records = new Map((data as Row[]).map((row) => [row.id, row]));
      for (const item of linked) {
        const record = records.get(item.href.split("/").at(-1)!);
        // A task keeps its own purpose: it opens the linked record, whose detail page shows the record's next action.
        if (record) item.blocker = recordedBlocker(String(record[source.statusField]));
        else unavailableTaskLink(item);
      }
    } catch {
      for (const item of linked) {
        unavailableTaskLink(item);
      }
    }
  }));
}

function unavailableTaskLink(item: WorkItem) {
  item.href = `/tasks/${item.id}`;
  item.actionLabel = "Review task";
  item.blocker = "Linked record unavailable. Review the task before continuing.";
}

const unavailableCodes = new Set(["PGRST202", "42883", "42P01"]);

const SAMPLE_ROLES: UserRole[] = ["owner", "admin", "quality", "factory_manager"];

/** Proposals this person may decide (AP-002), active pilot work on records they can read (AP-041) and quality samples due (AP-016). */
async function loadAutopilotQueues(supabase: SupabaseClient, role: UserRole): Promise<WorkQueue[]> {
  if (typeof supabase.rpc !== "function") return [];
  let proposals: { data: any; error: { code?: string } | null }, attention: { data: any; error: { code?: string } | null };
  let samples: { data: any; error: { code?: string } | null } | null = null;
  try {
    [proposals, attention, samples] = await Promise.all([
      supabase.rpc("ap_proposals", { p_command: "list", p_payload: { status: "open" } }),
      supabase.rpc("ap_home_work", { p_command: "attention", p_payload: { limit: MY_WORK_LIMIT } }),
      SAMPLE_ROLES.includes(role) ? supabase.rpc("ap_sampling", { p_command: "queue", p_payload: { limit: MY_WORK_LIMIT } }) : Promise.resolve(null)
    ]);
  } catch { return []; }
  const queues: WorkQueue[] = [];
  if (!unavailableCodes.has(proposals.error?.code ?? "")) {
    const target = queue("proposals", "Waiting for your confirmation", "Prepared by the system from existing records. Nothing changes until you accept; stale proposals cannot be accepted.", "/dashboard");
    if (proposals.error) target.error = "Could not load proposals. Refresh to retry.";
    else if (Array.isArray(proposals.data?.rows)) {
      const rows = (proposals.data.rows as Row[]).filter(row => row.can_decide && !row.stale_now);
      target.items = rows.slice(0, MY_WORK_LIMIT).map(row => ({ id: row.id, title: row.title, status: "Waiting for you", date: String(row.expires_at ?? "").slice(0, 10) || null,
        dateLabel: "Decide by", priority: null, href: row.proposal_type === "series.adopt" ? `/invoices/numbering#proposal-${row.id}` : proposalHref(row as ProposalRow), actionLabel: "Review proposal", blocker: null }));
      target.hasMore = Number(proposals.data.total_count ?? 0) > target.items.length;
    }
    if (target.items.length || target.error) queues.push(target);
  }
  if (!unavailableCodes.has(attention.error?.code ?? "")) {
    const target = queue("linked_work", "Work on your records", "Open reviews, promises, controls and follow-ups attached to orders, jobs, dies, dispatches and invoices.", "/tasks");
    if (attention.error) target.error = "Could not load linked work. Refresh to retry.";
    else if (Array.isArray(attention.data?.items)) {
      const items = attention.data.items as Row[];
      target.items = items.slice(0, MY_WORK_LIMIT).map(row => ({ id: `${row.hub}:${row.view}:${row.id}`, title: row.label ?? "Record", status: row.status ?? "open",
        date: /^\d{4}-\d{2}-\d{2}/.test(String(row.due_date ?? "")) ? String(row.due_date).slice(0, 10) : null, dateLabel: "Due", priority: null,
        href: row.href, actionLabel: "Open", blocker: null, ownership: row.summary ?? undefined }));
      target.hasMore = items.length > MY_WORK_LIMIT;
    }
    if (target.items.length || target.error) queues.push(target);
  }
  if (samples && !unavailableCodes.has(samples.error?.code ?? "")) {
    const target = queue("qc_samples", "Quality samples due", "Created from press output by the inspection plan's triggers. Samples that block QC release come first.", "/quality/samples");
    if (samples.error) target.error = "Could not load samples. Refresh to retry.";
    else if (Array.isArray(samples.data?.rows)) {
      target.items = (samples.data.rows as Row[]).slice(0, MY_WORK_LIMIT).map(row => ({ id: row.id, title: `${row.job_number ?? "Job"} · ${row.machine ?? "Press"}`,
        status: row.status === "missed" ? "Missed window" : "Due", date: String(row.due_at ?? "").slice(0, 10) || null, dateLabel: "Due", priority: row.blocks_release ? "high" : null,
        href: `/quality/samples/${row.id}`, actionLabel: "Record sample", blocker: row.blocks_release ? "QC release waits for this sample." : null }));
      target.hasMore = Number(samples.data.total_count ?? 0) > target.items.length;
    }
    if (target.items.length || target.error) queues.push(target);
  }
  return queues;
}

/** Session identity is supplied by the server; every query still runs through the user's RLS client. */
export async function loadMyWork(supabase: SupabaseClient, context: SessionContext, flags: Partial<FeatureFlagState>, now = new Date()): Promise<MyWork> {
  const { today } = getBusinessDateBoundaries(now);
  const assigned = queue("assigned", "Assigned to me", "Your open tasks, earliest due first. Undated tasks follow dated work.", "/tasks");
  const unassigned = queue("unassigned", "Unassigned team tasks", "Factory tasks with no assignee and a source you can access. Opening one does not assign it to you.", "/tasks");
  const work: MyWork = { today, assigned, unassigned, departments: [] };
  // Dealer users retain their existing portal; this internal read model fails closed if called directly.
  if (context.dealerId || ["dealer_admin", "dealer_staff"].includes(context.role)) return work;
  const permitted = availableSources(context.role, flags);
  const allowedTypes = permitted.flatMap((source) => source.aliases);
  const taskEligibility = ["related_entity_type.is.null", ...(allowedTypes.length ? [`related_entity_type.in.(${allowedTypes.join(",")})`] : [])].join(",");
  const readTasks = (personal: boolean) => {
    let query = supabase.from("tasks").select("id, title, status, priority, due_date, related_entity_type, related_entity_id")
      .eq("company_id", context.companyId).in("status", ["open", "in_progress"]);
    query = personal ? query.eq("assigned_to", context.userId) : query.is("assigned_to", null);
    if (!personal) query = query.is("dealership_id", null).or(taskEligibility);
    return query.order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true }).order("id").limit(MY_WORK_LIMIT + 1);
  };
  const taskItem = (row: Row): WorkItem => {
    const source = permitted.find((value) => value.aliases.includes(row.related_entity_type));
    const linked = source && uuid.test(row.related_entity_id ?? "");
    return { id: row.id, title: row.title, status: row.status, date: row.due_date, dateLabel: "Due", priority: row.priority,
      href: linked ? `${source.route}/${row.related_entity_id}` : `/tasks/${row.id}`, actionLabel: linked ? source.action : "Open task", blocker: null };
  };
  const reads: Promise<void>[] = [];
  if (can(context.role, "read", "tasks") && hasRouteAccess("/tasks", context.role)) {
    reads.push(readQueue(assigned, () => readTasks(true), (row) => ({ ...taskItem(row), ownership: "Assigned to you" })));
    reads.push(readQueue(unassigned, () => readTasks(false), (row) => ({ ...taskItem(row), ownership: "Unassigned; opening does not claim this task" })));
  }
  for (const definition of departments) {
    const source = permitted.find((value) => value.table === definition.table);
    if (!source || !definition.roles.includes(context.role)) continue;
    const target = queue(definition.table, definition.title, definition.description, source.route);
    work.departments.push(target);
    reads.push(readQueue(target, () => {
      let query = supabase.from(source.table).select(definition.select).eq("company_id", context.companyId);
      if (definition.statuses) query = query.in(source.statusField, definition.statuses);
      if (source.table === "production_jobs") query = query.eq("is_active", true);
      if (source.table === "invoices") query = query.is("deleted_at", null).gt("balance_due", 0);
      if (source.table === "quotes") query = query.is("deleted_at", null);
      if (source.table === "inventory_items") query = query.eq("is_active", true).lte("current_stock", 0);
      if (definition.date) query = query.order(definition.date, { ascending: true, nullsFirst: false });
      return query.order("id").limit(MY_WORK_LIMIT + 1);
    }, (row) => ({
      id: row.id, title: row[definition.identifier] || `Record ${String(row.id).slice(0, 8)}`,
      status: source.table === "inventory_items" ? "Stock attention" : row[source.statusField],
      date: definition.date ? row[definition.date] : null, dateLabel: definition.dateLabel, priority: null,
      href: `${source.route}/${row.id}`, actionLabel: source.action, blocker: recordedBlocker(row[source.statusField]),
      ownership: "Shared team work; check the record's owner before continuing",
    })));
  }
  const autopilot = loadAutopilotQueues(supabase, context.role);
  await Promise.all(reads);
  // AP-002 / AP-041: proposals waiting for this person and pilot work on records come first.
  work.departments.unshift(...(await autopilot));
  await resolveTaskLinks(supabase, context, permitted, [assigned, unassigned]);
  const kinds: Record<string, NextActionRecord["kind"]> = { production_jobs: "production", dispatches: "dispatch", invoices: "invoice", quotes: "quote", quality_inspections: "quality" };
  for (const department of work.departments) for (const item of department.items) {
    const kind = kinds[department.key];
    const action = kind ? nextRecordAction(context.role, { kind, id: item.id, status: item.status }, context.dealerId) : null;
    if (action?.href) { item.href = action.href; item.actionLabel = action.label; }
  }
  return work;
}

export function workDateLabel(item: Pick<WorkItem, "date" | "dateLabel">, today: string) {
  if (!item.dateLabel) return null;
  const value = item.date;
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Date not captured";
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return "Date not captured";
  const formatted = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  if (item.dateLabel === "Due" && value < today) return `Overdue - ${formatted}`;
  if (value === today) return `${item.dateLabel} today`;
  return `${item.dateLabel} ${formatted}`;
}

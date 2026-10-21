import { z } from "zod";
import type { UserRole } from "@/types/app";

export const exceptionReasons = {
  material_shortage: "Material shortage",
  die_damage: "Die damage",
  surface_defect: "Surface defect",
  machine_breakdown: "Machine breakdown",
  other: "Other exception"
} as const;

const uuid = z.string().uuid();
const text = (max: number) => z.string().trim().max(max).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), "Remove control characters");
const required = (max: number) => text(max).refine(value => value.length > 0, "This value is required");
export function isCalendarDate(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 1900 && Number(value.slice(0, 4)) <= 9999 && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
const date = z.string().refine(value => { try { return isCalendarDate(value); } catch { return false; } }, "Use a valid calendar date");
const page = z.number().int().min(1).max(100000).default(1);
const locationEntity = z.enum(["die", "inventory_item"]);
const exceptionReason = z.enum(["material_shortage", "die_damage", "surface_defect", "machine_breakdown", "other"]);

export const operatorCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("aliases.list"), customer_id: uuid, page }).strict(),
  z.object({ command: z.literal("aliases.search"), customer_id: uuid, search: required(80) }).strict(),
  z.object({ command: z.literal("aliases.create"), customer_id: uuid, profile_code: required(80), alias: required(80), request_id: uuid }).strict(),
  z.object({ command: z.literal("aliases.deactivate"), customer_id: uuid, alias_id: uuid }).strict(),
  z.object({ command: z.literal("locations.load"), entity_type: locationEntity, entity_id: uuid, page }).strict(),
  z.object({ command: z.literal("locations.move"), entity_type: locationEntity, entity_id: uuid, expected_location: text(160), location: required(160), reason: required(500), request_id: uuid }).strict(),
  z.object({ command: z.literal("exceptions.list"), job_id: uuid, page }).strict(),
  z.object({ command: z.literal("exceptions.report"), job_id: uuid, reason: exceptionReason, note: text(1000), request_id: uuid }).strict(),
  z.object({ command: z.literal("commitments.list"), customer_id: uuid, commitment_id: uuid.optional(), status: z.enum(["open", "completed", "cancelled", "all"]).default("open"), page }).strict(),
  z.object({ command: z.literal("commitments.queue"), status: z.enum(["open", "completed", "cancelled", "all"]).default("open"), scope: z.enum(["mine", "all"]).default("mine"), search: text(80).default(""), sort: z.enum(["due", "newest"]).default("due"), page }).strict(),
  z.object({ command: z.literal("commitments.create"), customer_id: uuid, title: required(160), due_date: date, request_id: uuid }).strict(),
  z.object({ command: z.literal("commitments.reschedule"), customer_id: uuid, commitment_id: uuid, expected_due_date: date, due_date: date, reason: required(1000), request_id: uuid }).strict(),
  z.object({ command: z.literal("commitments.close"), customer_id: uuid, commitment_id: uuid, status: z.enum(["completed", "cancelled"]), outcome: required(1000), request_id: uuid }).strict(),
  z.object({ command: z.literal("commitments.history"), customer_id: uuid, commitment_id: uuid, page }).strict()
]);
export type OperatorCommand = z.infer<typeof operatorCommandSchema>;
export type OperatorCommandName = OperatorCommand["command"];

const customerReaders = ["owner", "admin", "sales_manager", "sales", "production_manager", "factory_manager", "accounts", "viewer"];
const customerWriters = ["owner", "admin", "sales_manager", "sales"];
const productionReaders = ["owner", "admin", "factory_manager", "production_manager", "production", "quality", "viewer"];
const productionWriters = ["owner", "admin", "factory_manager", "production_manager", "production", "quality"];
const dieReaders = ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "accounts", "viewer"];
const inventoryReaders = ["owner", "admin", "sales_manager", "sales", "factory_manager", "production_manager", "production", "inventory_manager", "dispatch_manager", "dispatch", "quality", "viewer"];

export function canUseOperatorCommand(role: UserRole, command: OperatorCommandName, entityType?: string) {
  if (command.startsWith("aliases.")) return (command === "aliases.list" || command === "aliases.search" ? customerReaders : customerWriters).includes(role);
  if (command.startsWith("commitments.")) return (["commitments.list", "commitments.history", "commitments.queue"].includes(command) ? customerReaders : customerWriters).includes(role);
  if (command.startsWith("exceptions.")) return (command === "exceptions.list" ? productionReaders : productionWriters).includes(role);
  if (entityType === "die") return (command === "locations.load" ? dieReaders : ["owner", "admin", "sales_manager", "production_manager"]).includes(role);
  return entityType === "inventory_item" && (command === "locations.load" ? inventoryReaders : ["owner", "admin", "factory_manager", "production_manager", "inventory_manager"]).includes(role);
}

export type ProfileAliasOption = { profile_id: string; profile_code: string; profile_name: string; alias: string };
export type OperatorRow = Record<string, string | number | boolean | null>;
export type OperatorData = { rows?: OperatorRow[]; total_count?: number; current_location?: string | null; id?: string; profiles?: ProfileAliasOption[] };
export type OperatorResult = { success: true; data: OperatorData } | { success: false; error: string; uncertain?: boolean; unavailable?: boolean };

export function parseOperatorData(value: unknown, command?: OperatorCommandName): OperatorData {
  const row = z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean(), z.null()]));
  const data = z.object({
    rows: z.array(row).max(10).optional(), total_count: z.number().int().nonnegative().optional(),
    current_location: z.string().nullable().optional(), id: uuid.optional(),
    profiles: z.array(z.object({ profile_id: uuid, profile_code: z.string(), profile_name: z.string(), alias: z.string() }).strict()).max(10).optional()
  }).strict().parse(value);
  if (!command) return data;
  if (command === "aliases.search") {
    if (!data.profiles || Object.keys(data).some(key => key !== "profiles") || new Set(data.profiles.map(profile => profile.profile_id)).size !== data.profiles.length) throw new Error("Invalid alias response");
    return data;
  }
  const rowFields: Partial<Record<OperatorCommandName, string[]>> = {
    "aliases.list": ["id", "alias", "profile_id", "profile_code", "profile_name", "is_active", "created_at", "deactivated_at"],
    "locations.load": ["id", "previous_location", "location", "reason", "recorded_at"],
    "exceptions.list": ["id", "reason", "note", "reporter_name", "operator_name", "recorded_at"],
    "commitments.list": ["id", "title", "responsible_name", "original_due_date", "due_date", "status", "outcome", "created_at", "closed_at"],
    "commitments.queue": ["id", "title", "customer_id", "customer_name", "customer_available", "responsible_name", "original_due_date", "due_date", "status", "outcome", "created_at", "closed_at"],
    "commitments.history": ["id", "event_type", "previous_due_date", "due_date", "note", "reporter_name", "recorded_at"]
  };
  const allowed = rowFields[command];
  if (allowed) {
    const keys = command === "locations.load" ? ["rows", "total_count", "current_location"] : ["rows", "total_count"];
    if (!data.rows || data.total_count === undefined || data.total_count < data.rows.length || keys.some(key => !Object.hasOwn(data, key)) || Object.keys(data).some(key => !keys.includes(key))) throw new Error("Incomplete workflow response");
    const ids = new Set<string>();
    for (const entry of data.rows) {
      const id = uuid.parse(entry.id);
      if (command === "commitments.queue") uuid.parse(entry.customer_id);
      if (command === "aliases.list") uuid.parse(entry.profile_id);
      if (ids.has(id) || Object.keys(entry).some(key => !allowed.includes(key))) throw new Error("Unexpected workflow row");
      ids.add(id);
    }
  } else if (!data.id || Object.keys(data).some(key => key !== "id")) throw new Error("Missing workflow confirmation");
  return data;
}

export function operatorUnavailableMessage() {
  return "These workflow tools are not available on this database yet. The database upgrade must be applied before they can be used.";
}

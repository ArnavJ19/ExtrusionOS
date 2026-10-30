import { z } from "zod";

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const decimal = z.union([z.number(), z.string().trim().regex(/^\d+(\.\d{1,3})?$/)]).transform(Number)
  .refine(value => Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 1000)));
const positive = decimal.refine(value => value > 0);
const iso = z.string().datetime({ offset: true });

export const factoryPlanningSnapshotSchema = z.object({
  company_id: uuid,
  from_date: date,
  through_date: date,
  today: date,
  fingerprint: z.string().regex(/^[a-f0-9]{32}$/),
  machines: z.array(z.object({ id: uuid, machine_name: z.string(), status: z.string(), is_active: z.boolean() }).strict()).max(200),
  jobs: z.array(z.object({
    id: uuid, job_number: z.string(), order_id: uuid, order_number: z.string(), customer_name: z.string().nullable(), profile_code: z.string().nullable(),
    die_number: z.string().nullable(), status: z.enum(["planned", "ready", "in_progress", "on_hold"]), machine_id: uuid.nullable(),
    planned_quantity_kg: decimal, actual_quantity_kg: decimal, planned_date: date.nullable(), finishing_type: z.string(), source_line_id: uuid.nullable(),
    die_status: z.string().nullable(), billet_allocation_status: z.string(), billets_short: z.number().int().nonnegative()
  }).strict()).max(200),
  slots: z.array(z.object({
    id: uuid, production_job_id: uuid, machine_id: uuid, planned_start_at: iso, planned_end_at: iso.nullable(), shift: z.string().nullable(),
    sequence_number: z.number().int().nonnegative(), capacity_kg: decimal.nullable(), status: z.enum(["draft", "scheduled", "released"])
  }).strict()).max(1000),
  shift_capacities: z.array(z.object({
    id: uuid, machine_id: uuid, weekday: z.number().int().min(1).max(7), shift_name: z.string(), starts_local: z.string().regex(/^\d{2}:\d{2}/),
    ends_local: z.string().regex(/^\d{2}:\d{2}/), capacity_kg: positive
  }).strict()).max(500),
  maintenance_blocks: z.array(z.object({ id: uuid, machine_id: uuid, starts_at: iso, ends_at: iso, reason: z.string(), status: z.literal("planned") }).strict()).max(500),
  finishing_lead_times: z.array(z.object({ finishing_type: z.string(), lead_days: z.number().int().min(0).max(365) }).strict()).max(200)
}).strict();
export type FactoryPlanningSnapshot = z.infer<typeof factoryPlanningSnapshotSchema>;

export const factoryShiftCapacityInputSchema = z.object({
  machine_id: uuid,
  weekday: z.number().int().min(1).max(7),
  shift_name: z.string().trim().min(1).max(40).refine(value => !/[\u0000-\u001f]/.test(value)),
  starts_local: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  ends_local: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  capacity_kg: positive
}).strict().refine(value => value.starts_local !== value.ends_local, { message: "A shift must have different start and end times." });

export const factoryMaintenanceBlockInputSchema = z.object({
  id: uuid,
  machine_id: uuid,
  starts_at: iso,
  ends_at: iso,
  reason: z.string().trim().min(3).max(240).refine(value => !/[\u0000-\u001f]/.test(value))
}).strict().refine(value => Date.parse(value.ends_at) > Date.parse(value.starts_at), { message: "Maintenance must end after it starts." });

export const factoryFinishingLeadTimeInputSchema = z.object({
  finishing_type: z.string().trim().min(1).max(60).refine(value => !/[\u0000-\u001f]/.test(value)),
  lead_days: z.number().int().min(0).max(365)
}).strict();

export const scheduleMoveInputSchema = z.object({
  request_id: uuid,
  production_job_id: uuid,
  slot_id: uuid.nullable(),
  machine_id: uuid,
  planned_start_at: iso,
  planned_end_at: iso,
  shift: z.string().trim().min(1).max(40),
  capacity_kg: positive,
  sequence_number: z.number().int().min(0).max(1000000),
  from_date: date,
  through_date: date,
  fingerprint: z.string().regex(/^[a-f0-9]{32}$/)
}).strict().refine(value => Date.parse(value.planned_end_at) > Date.parse(value.planned_start_at), { message: "Planned end must be after planned start." })
  .refine(value => value.through_date >= value.from_date && Date.parse(`${value.through_date}T00:00:00Z`) - Date.parse(`${value.from_date}T00:00:00Z`) <= 60 * 86400000,
    { message: "The reviewed planning window is no longer valid. Refresh the schedule." });

const lineSchema = z.object({
  order_item_id: uuid, order_id: uuid, order_number: z.string(), customer_name: z.string().nullable(), order_stage: z.string(), line_label: z.string(), profile_code: z.string().nullable(),
  ordered_kg: decimal.nullable(), from_stock_kg: decimal, produced_kg: decimal, planned_open_kg: decimal, packed_kg: decimal, dispatched_kg: decimal,
  line_required_date: date.nullable(), effective_date: date.nullable(), effective_priority: z.string(), order_closed: z.boolean()
}).strict();
export const factoryDeliveryDataSchema = z.object({
  company_id: uuid,
  today: date,
  order: z.object({
    id: uuid, order_number: z.string(), current_stage: z.string(), expected_dispatch_date: date.nullable(), billets_short: z.number().int().nonnegative(), billet_allocation_status: z.string()
  }).strict(),
  lines: z.array(lineSchema).max(200),
  jobs: z.array(z.object({
    id: uuid, job_number: z.string(), source_line_id: uuid.nullable(), status: z.enum(["planned", "ready", "in_progress", "on_hold"]),
    planned_quantity_kg: decimal, actual_quantity_kg: decimal, machine_id: uuid.nullable(), finishing_type: z.string()
  }).strict()).max(200),
  slots: factoryPlanningSnapshotSchema.shape.slots,
  shift_capacities: factoryPlanningSnapshotSchema.shape.shift_capacities,
  maintenance_blocks: factoryPlanningSnapshotSchema.shape.maintenance_blocks,
  finishing_lead_times: factoryPlanningSnapshotSchema.shape.finishing_lead_times,
  eligible_stock_kg: decimal,
  eligible_bundle_count: z.number().int().nonnegative().max(100000),
  unlinked_packed_kg: decimal,
  active_load_dates: z.array(date).max(1000)
}).strict();
export type FactoryDeliveryData = z.infer<typeof factoryDeliveryDataSchema>;

export type CapacityConflict = { code: "invalid_window" | "shift_not_configured" | "outside_shift" | "maintenance" | "press_overlap" | "capacity_exceeded" | "job_already_scheduled"; message: string };

function localParts(isoValue: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(isoValue));
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { day: `${value.year}-${value.month}-${value.day}`, time: `${value.hour}:${value.minute}` };
}

function weekday(day: string) {
  const [year, month, dateOfMonth] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, dateOfMonth)).getUTCDay() || 7;
}

function localEpoch(day: string, time: string) {
  const [year, month, dateOfMonth] = day.split("-").map(Number);
  const [hour, minute] = time.slice(0, 5).split(":").map(Number);
  return Date.UTC(year, month - 1, dateOfMonth, hour, minute) - 330 * 60000;
}

function shiftWindow(day: string, starts: string, ends: string) {
  const startsAt = localEpoch(day, starts);
  let endsAt = localEpoch(day, ends);
  if (endsAt <= startsAt) endsAt += 86400000;
  return { startsAt, endsAt };
}

export function inspectProposedScheduleMove(
  snapshot: FactoryPlanningSnapshot,
  input: Pick<z.infer<typeof scheduleMoveInputSchema>, "production_job_id" | "slot_id" | "machine_id" | "planned_start_at" | "planned_end_at" | "shift" | "capacity_kg">
): CapacityConflict[] {
  const start = Date.parse(input.planned_start_at);
  const end = Date.parse(input.planned_end_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isFinite(input.capacity_kg) || input.capacity_kg <= 0) {
    return [{ code: "invalid_window", message: "Enter a valid start, end and positive kg capacity." }];
  }
  const localStart = localParts(input.planned_start_at);
  const previousDay = plusDays(localStart.day, -1);
  const shift = snapshot.shift_capacities.find(row => row.machine_id === input.machine_id
    && (row.weekday === weekday(localStart.day) || (row.ends_local <= row.starts_local && row.weekday === weekday(previousDay)))
    && row.shift_name.toLowerCase() === input.shift.trim().toLowerCase());
  if (!shift) return [{ code: "shift_not_configured", message: "Configure this press and weekly shift before scheduling work." }];
  const shiftDay = shift.weekday === weekday(localStart.day) ? localStart.day : previousDay;
  const window = shiftWindow(shiftDay, shift.starts_local, shift.ends_local);
  const shiftEnd = window.endsAt;
  const issues: CapacityConflict[] = [];
  if (start < window.startsAt || end > shiftEnd) issues.push({ code: "outside_shift", message: "The proposed slot must fit inside the configured machine shift." });
  if (snapshot.maintenance_blocks.some(block => block.machine_id === input.machine_id && Date.parse(block.starts_at) < end && Date.parse(block.ends_at) > start)) {
    issues.push({ code: "maintenance", message: "The proposed slot overlaps a planned maintenance block." });
  }
  const duplicate = snapshot.slots.find(slot => slot.production_job_id === input.production_job_id && slot.id !== input.slot_id);
  if (duplicate) issues.push({ code: "job_already_scheduled", message: "This job already has an active press slot." });
  if (snapshot.slots.some(slot => slot.machine_id === input.machine_id && slot.id !== input.slot_id
    && slot.planned_end_at && Date.parse(slot.planned_start_at) < end && Date.parse(slot.planned_end_at) > start)) {
    issues.push({ code: "press_overlap", message: "This press already has a slot that overlaps the proposed time." });
  }
  const used = snapshot.slots.filter(slot => slot.machine_id === input.machine_id && slot.id !== input.slot_id && ["scheduled", "released"].includes(slot.status)
    && slot.shift?.toLowerCase() === input.shift.trim().toLowerCase() && Date.parse(slot.planned_start_at) >= window.startsAt && Date.parse(slot.planned_start_at) < shiftEnd)
    .reduce((sum, slot) => sum + Number(slot.capacity_kg ?? 0), 0);
  if (used + input.capacity_kg > shift.capacity_kg + 0.001) issues.push({ code: "capacity_exceeded", message: `This move would use ${(used + input.capacity_kg).toFixed(3)} kg of ${shift.capacity_kg} kg configured for the shift.` });
  return issues;
}

export type DeliveryProposal = {
  orderNumber: string;
  proposalDate: string | null;
  eligibleStockKg: number;
  remainingDispatchKg: number;
  productionCapacityKg: number;
  capacityExplanation: string;
  assumptions: string[];
  missing: string[];
};

function plusDays(day: string, count: number) {
  const parsed = new Date(`${day}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + count);
  return parsed.toISOString().slice(0, 10);
}

export function buildFactoryDeliveryProposal(data: FactoryDeliveryData): DeliveryProposal {
  const missing: string[] = [];
  const assumptions: string[] = ["This is an operational forecast, not an approved customer commitment."];
  const knownLines = data.lines.filter(line => line.ordered_kg !== null && line.ordered_kg > 0);
  if (knownLines.length !== data.lines.length) missing.push("One or more order lines have no physical kg quantity.");
  if (!data.lines.length) missing.push("No order-line quantity is available for this order.");
  const totalOrdered = knownLines.reduce((sum, line) => sum + Number(line.ordered_kg ?? 0), 0);
  const dispatched = knownLines.reduce((sum, line) => sum + line.dispatched_kg, 0);
  const remainingDispatch = Math.max(totalOrdered - dispatched, 0);
  const packedAwaitingDispatch = knownLines.reduce((sum, line) => sum + Math.max(line.packed_kg - line.dispatched_kg, 0), 0);
  const readyStock = Math.min(data.eligible_stock_kg + packedAwaitingDispatch, remainingDispatch);
  const jobsByLine = new Map<string, typeof data.jobs>();
  for (const job of data.jobs) {
    if (!job.source_line_id) continue;
    const rows = jobsByLine.get(job.source_line_id) ?? [];
    rows.push(job);
    jobsByLine.set(job.source_line_id, rows);
  }
  const requiredByJob = data.jobs.map(job => ({ ...job, requiredKg: Math.max(job.planned_quantity_kg - job.actual_quantity_kg, 0) })).filter(job => job.requiredKg > 0.001);
  const totalProductionCapacity = requiredByJob.reduce((sum, job) => sum + job.requiredKg, 0);
  const unscheduledDemand = knownLines.reduce((sum, line) => {
    const jobNeed = (jobsByLine.get(line.order_item_id) ?? []).reduce((total, job) => total + Math.max(job.planned_quantity_kg - job.actual_quantity_kg, 0), 0);
    return sum + Math.max(Number(line.ordered_kg ?? 0) - line.from_stock_kg - line.produced_kg - jobNeed, 0);
  }, 0);
  if (unscheduledDemand > 0.001) missing.push(`${unscheduledDemand.toFixed(3)} kg of production demand has no production job yet.`);
  if (data.order.billets_short > 0 || ["pending", "partial", "shortage"].includes(data.order.billet_allocation_status)) {
    missing.push(`${data.order.billets_short} billets are still short or allocation is incomplete.`);
  }
  if (data.eligible_bundle_count === 0 && packedAwaitingDispatch <= 0.001 && remainingDispatch > 0.001) missing.push("No currently eligible measured bundle covers the remaining dispatch quantity.");
  if (readyStock + 0.001 < remainingDispatch && data.jobs.length === 0) missing.push("The remaining quantity has no production-job schedule to forecast.");
  if (data.unlinked_packed_kg > 0.001) missing.push(`${data.unlinked_packed_kg.toFixed(3)} kg of packed goods has no verified order-line relationship.`);

  const remainingByShift = new Map<string, number>();
  const productionDates: string[] = [];
  for (const job of requiredByJob) {
    const existing = data.slots.find(slot => slot.production_job_id === job.id && ["scheduled", "released"].includes(slot.status));
    let finishDay: string | null = null;
    if (existing) {
      if (Number(existing.capacity_kg ?? 0) + 0.001 < job.requiredKg || !existing.planned_end_at) {
        missing.push(`${job.job_number} has a committed slot that does not cover its remaining ${job.requiredKg.toFixed(3)} kg.`);
      } else {
        finishDay = localParts(existing.planned_end_at).day < data.today ? data.today : localParts(existing.planned_end_at).day;
      }
    } else {
      let left = job.requiredKg;
      for (let dayOffset = 0; dayOffset <= 90 && left > 0.001; dayOffset += 1) {
        const day = plusDays(data.today, dayOffset);
        for (const capacity of data.shift_capacities) {
          if (capacity.weekday !== weekday(day) || (job.machine_id && capacity.machine_id !== job.machine_id)) continue;
          const window = shiftWindow(day, capacity.starts_local, capacity.ends_local);
          if (data.maintenance_blocks.some(block => block.machine_id === capacity.machine_id && Date.parse(block.starts_at) < window.endsAt && Date.parse(block.ends_at) > window.startsAt)) continue;
          const key = `${capacity.machine_id}|${day}|${capacity.shift_name.toLowerCase()}`;
          if (!remainingByShift.has(key)) {
            const used = data.slots.filter(slot => slot.machine_id === capacity.machine_id && slot.shift?.toLowerCase() === capacity.shift_name.toLowerCase()
              && ["scheduled", "released"].includes(slot.status) && Date.parse(slot.planned_start_at) >= window.startsAt && Date.parse(slot.planned_start_at) < window.endsAt)
              .reduce((sum, slot) => sum + Number(slot.capacity_kg ?? 0), 0);
            remainingByShift.set(key, Math.max(capacity.capacity_kg - used, 0));
          }
          const available = remainingByShift.get(key) ?? 0;
          if (available <= 0.001) continue;
          const assigned = Math.min(left, available);
          remainingByShift.set(key, available - assigned);
          left -= assigned;
          finishDay = localParts(new Date(window.endsAt).toISOString()).day;
        }
      }
      if (left > 0.001 || !finishDay) missing.push(`${job.job_number} has no configured press capacity in the next 90 days for ${job.requiredKg.toFixed(3)} kg.`);
    }
    if (finishDay) {
      const lead = data.finishing_lead_times.find(item => item.finishing_type.toLowerCase() === job.finishing_type.toLowerCase());
      if (!lead) missing.push(`No finishing lead time is configured for ${job.finishing_type}.`);
      else productionDates.push(plusDays(finishDay, lead.lead_days));
    }
  }
  const loadDates = Array.from(new Set(data.active_load_dates.map(loadDate => loadDate < data.today ? data.today : loadDate)));
  if (loadDates.length) assumptions.push("Reviewed vehicle-load dates are included as existing dispatch commitments.");
  if (!data.shift_capacities.length && totalProductionCapacity > 0.001) missing.push("No machine-shift kg capacities are configured.");
  assumptions.push(`${data.eligible_bundle_count} measured eligible bundles account for ${data.eligible_stock_kg.toFixed(3)} kg of unshipped stock.`);
  if (packedAwaitingDispatch > 0.001) assumptions.push(`${packedAwaitingDispatch.toFixed(3)} kg is already packed and awaiting confirmed departure.`);
  assumptions.push("Capacity is counted by configured machine-shift kg limits after existing scheduled slots and maintenance blocks.");
  if (requiredByJob.some(job => job.machine_id === null)) assumptions.push("Jobs without a selected press are forecast against any active extrusion press with configured capacity.");

  let proposalDate: string | null = null;
  const demandUnavailable = data.lines.length === 0 || knownLines.length !== data.lines.length;
  if (!demandUnavailable && data.unlinked_packed_kg <= 0.001 && remainingDispatch <= 0.001) proposalDate = data.today;
  else if (!demandUnavailable && data.unlinked_packed_kg <= 0.001 && readyStock + 0.001 >= remainingDispatch) proposalDate = data.today;
  else if (requiredByJob.length && unscheduledDemand <= 0.001 && productionDates.length >= requiredByJob.length
    && !demandUnavailable && data.unlinked_packed_kg <= 0.001
    && !missing.some(value => /no configured press capacity|committed slot|No finishing lead time|no verified order-line relationship/.test(value))) {
    proposalDate = [...productionDates, ...loadDates].sort().at(-1) ?? null;
  }
  if (data.eligible_stock_kg > remainingDispatch + 0.001) assumptions.push("Eligible stock above the remaining dispatch quantity is excluded from the proposed date.");
  if (data.active_load_dates.length) assumptions.push("Active reviewed loads are planning commitments only; dispatch has not been issued.");
  return {
    orderNumber: data.order.order_number,
    proposalDate,
    eligibleStockKg: data.eligible_stock_kg,
    remainingDispatchKg: remainingDispatch,
    productionCapacityKg: totalProductionCapacity + unscheduledDemand,
    capacityExplanation: proposalDate
      ? `${totalProductionCapacity.toFixed(3)} kg in open production jobs plus ${unscheduledDemand.toFixed(3)} kg unscheduled demand was checked against configured press shifts.`
      : "A date is withheld until the missing capacity, source or readiness inputs are resolved.",
    assumptions: Array.from(new Set(assumptions)),
    missing: Array.from(new Set(missing))
  };
}

export const factoryVehicleSchema = z.object({
  id: uuid, registration_number: z.string(), vehicle_label: z.string(), capacity_kg: positive, version: z.number().int().positive(), fingerprint: z.string().regex(/^[a-f0-9]{32}$/)
}).strict();
const bundleSchema = z.object({
  id: uuid, fingerprint: z.string().regex(/^[a-f0-9]{32}$/), bundle_number: z.string(), order_id: uuid, order_number: z.string(), customer_id: uuid,
  customer_name: z.string().nullable(), destination: z.string().nullable(), party_basis: z.string(), source_line_id: uuid, source_kind: z.enum(["production", "reservation", "dealer_stock"]),
  profile_id: uuid, net_weight_kg: positive, number_of_pieces: z.number().int().positive(), net_length_m: positive,
  source_document_quote_id: uuid.nullable(), source_document_revision: z.number().int().positive().nullable()
}).strict();
const loadSummarySchema = z.object({
  id: uuid, vehicle_id: uuid, registration_number: z.string(), vehicle_label: z.string(), load_date: date,
  status: z.enum(["reviewed", "closed", "cancelled"]), capacity_kg: positive, total_weight_kg: decimal,
  item_count: z.number().int().nonnegative(), version: z.number().int().positive()
}).strict();
const loadItemSchema = bundleSchema.extend({ status: z.enum(["active", "removed"]), updated_fingerprint: z.string().regex(/^[a-f0-9]{32}$/).nullable() }).strict();
export const factoryVehicleLoadSnapshotSchema = z.object({
  company_id: uuid, page: z.number().int().positive(), page_size: z.literal(10), total_bundle_count: z.number().int().nonnegative(),
  search: z.string().max(80), vehicles: z.array(factoryVehicleSchema).max(100),
  bundles: z.array(bundleSchema).max(10), loads: z.array(loadSummarySchema).max(10), load_total_count: z.number().int().nonnegative(),
  current_load: z.object({ ...loadSummarySchema.shape, items: z.array(loadItemSchema).max(500) }).strict().nullable()
}).strict();
export type FactoryVehicleLoadSnapshot = z.infer<typeof factoryVehicleLoadSnapshotSchema>;

export const factoryVehicleInputSchema = z.object({
  registration_number: z.string().trim().min(1).max(30).refine(value => !/[\u0000-\u001f]/.test(value)),
  vehicle_label: z.string().trim().min(1).max(80).refine(value => !/[\u0000-\u001f]/.test(value)),
  capacity_kg: positive
}).strict();
export const factoryVehicleLoadInputSchema = z.object({
  request_id: uuid,
  load_id: uuid.nullable(),
  expected_version: z.number().int().nonnegative(),
  vehicle_id: uuid,
  vehicle_fingerprint: z.string().regex(/^[a-f0-9]{32}$/),
  load_date: date,
  bundles: z.array(z.object({ id: uuid, fingerprint: z.string().regex(/^[a-f0-9]{32}$/) }).strict()).max(500)
}).strict().refine(value => value.load_id !== null || value.bundles.length > 0, { message: "Select at least one measured bundle for a new vehicle load." })
  .refine(value => new Set(value.bundles.map(item => item.id)).size === value.bundles.length, { message: "A bundle cannot appear more than once in a vehicle load." });

export function factoryVehicleLoadWeight(bundles: Array<{ net_weight_kg: number }>) {
  return Number(bundles.reduce((sum, bundle) => sum + bundle.net_weight_kg, 0).toFixed(3));
}

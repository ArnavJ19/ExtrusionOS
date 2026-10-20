export type AllocationBillet = {
  id: string; company_id: string; billet_code: string; alloy: string | null; temper: string | null;
  billet_diameter_inch: number | null; status: string; order_id: string | null; production_job_id: string | null;
};

export type AllocationOption = {
  company_id: string; order_id: string; order_number: string; priority: string; current_stage: string;
  requirement_count: number; billets_required: number; billets_allocated: number; billets_short: number;
};

export type AllocationOptions = {
  company_id: string; billet: AllocationBillet; search: string; page: number; page_size: 10;
  total_count: number; items: AllocationOption[];
};

export const isAllocationRecordId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const nullableId = (value: unknown) => value === null || isAllocationRecordId(value);
const nullableText = (value: unknown) => value === null || typeof value === "string";

export function parseAllocationBillet(value: unknown, expected: { companyId: string; billetId: string }): AllocationBillet {
  if (!object(value) || value.id !== expected.billetId || value.company_id !== expected.companyId || !text(value.billet_code)
    || !text(value.status) || !nullableText(value.alloy) || !nullableText(value.temper)
    || !nullableId(value.order_id) || !nullableId(value.production_job_id)
    || !(value.billet_diameter_inch === null || typeof value.billet_diameter_inch === "number" && Number.isFinite(value.billet_diameter_inch) && value.billet_diameter_inch > 0)) {
    throw new Error("Billet details could not be verified. Refresh and try again.");
  }
  return value as AllocationBillet;
}

export function parseAllocationOptions(value: unknown, expected: { companyId: string; billetId: string; search: string; page: number }): AllocationOptions {
  const fail = () => { throw new Error("Billet allocation options could not be verified. Refresh and try again."); };
  if (!object(value) || value.company_id !== expected.companyId || value.search !== expected.search.trim()
    || value.page_size !== 10 || !integer(value.total_count) || !integer(value.page) || value.page < 1 || !Array.isArray(value.items)) return fail();
  const billet = parseAllocationBillet(value.billet, expected);
  const lastPage = Math.max(1, Math.ceil(value.total_count / 10));
  if (value.page !== Math.min(expected.page, lastPage) || value.items.length !== Math.min(10, Math.max(0, value.total_count - (value.page - 1) * 10))) return fail();
  const ids = new Set<string>();
  for (const row of value.items) {
    if (!object(row) || row.company_id !== expected.companyId || !isAllocationRecordId(row.order_id) || ids.has(row.order_id)
      || !text(row.order_number) || !text(row.priority) || !text(row.current_stage) || ["closed", "cancelled", "delivered", "payment_pending"].includes(row.current_stage)
      || !integer(row.requirement_count) || row.requirement_count < 1 || !integer(row.billets_required) || row.billets_required < 1
      || !integer(row.billets_allocated) || !integer(row.billets_short) || row.billets_short < 1
      || row.billets_allocated + row.billets_short !== row.billets_required) return fail();
    ids.add(row.order_id);
  }
  if ((!["cast", "allocated"].includes(billet.status) || billet.production_job_id !== null) && value.total_count !== 0) return fail();
  return value as AllocationOptions;
}

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

export const reservationStatuses = ["active", "released", "consumed", "cancelled"] as const;
export const reservationSorts = ["created_at", "reserved_weight_kg", "status", "released_at"] as const;

export function getReservationLedgerOptions(params: Record<string, string | string[] | undefined>) {
  const value = (name: string) => typeof params[name] === "string" ? params[name] as string : "";
  const page = Number(value("page") || 1);
  return {
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100000) : 1,
    search: value("q").replace(/\s+/g, " ").trim().slice(0, 100),
    status: (reservationStatuses as readonly string[]).includes(value("status")) ? value("status") : "",
    sort: (reservationSorts as readonly string[]).includes(value("sort")) ? value("sort") : "created_at",
    direction: value("direction") === "asc" ? "asc" : "desc"
  };
}

const amount = z.number().finite().nonnegative();
const pieces = amount.int().safe();
const text = z.string().nullable();
const timestamp = z.string().datetime({ offset: true }).nullable();
const ledgerRow = z.object({
  id: z.string().uuid(), order_id: z.string().uuid(), profile_code: text, profile_name: text,
  order_number: text, customer_name: text, bundle_number: text, location: text,
  status: z.enum(reservationStatuses), created_at: timestamp, released_at: timestamp, notes: text,
  reserved_weight_kg: amount, consumed_weight_kg: amount, open_weight_kg: amount, released_weight_kg: amount,
  reserved_length_m: amount.nullable(), consumed_length_m: amount.nullable(), open_length_m: amount.nullable(), released_length_m: amount.nullable(),
  reserved_pieces: pieces.nullable(), consumed_pieces: pieces.nullable(), open_pieces: pieces.nullable(), released_pieces: pieces.nullable()
}).refine(row => {
  const quantities: [number | null, number | null, number | null, number | null, number][] = [
    [row.reserved_weight_kg, row.consumed_weight_kg, row.open_weight_kg, row.released_weight_kg, 0.001],
    [row.reserved_length_m, row.consumed_length_m, row.open_length_m, row.released_length_m, 0.001],
    [row.reserved_pieces, row.consumed_pieces, row.open_pieces, row.released_pieces, 0]
  ];
  const same = (left: number | null, right: number | null, tolerance: number) =>
    left === null || right === null ? left === right : Math.abs(left - right) <= tolerance + 0.00000001;
  return quantities.every(([reserved, consumed, open, released, tolerance]) => {
    const remaining = reserved === null || consumed === null ? null : Math.max(reserved - consumed, 0);
    return !(reserved !== null && consumed !== null && consumed > reserved + tolerance + 0.00000001)
      && !(row.status === "consumed" && remaining !== null && remaining > tolerance + 0.00000001)
      && same(open, row.status === "active" ? remaining : 0, tolerance)
      && same(released, ["released", "cancelled"].includes(row.status) ? remaining : 0, tolerance);
  });
});
const ledgerPage = z.object({
  page: pieces.min(1).max(100000), page_size: z.literal(10), total_count: pieces, integrity_ok: z.literal(true),
  summary: z.object({ active_count: pieces, open_weight_kg: amount, consumed_weight_kg: amount, released_weight_kg: amount }),
  rows: z.array(ledgerRow).max(10)
}).refine(value => value.page <= Math.max(1, Math.ceil(value.total_count / 10))
  && value.rows.length === Math.min(10, Math.max(value.total_count - (value.page - 1) * 10, 0))
  && value.summary.active_count <= value.total_count
  && value.summary.active_count >= value.rows.filter(row => row.status === "active" && row.open_weight_kg > 0).length
  && value.summary.open_weight_kg + 0.001 >= value.rows.reduce((sum, row) => sum + row.open_weight_kg, 0)
  && value.summary.consumed_weight_kg + 0.001 >= value.rows.reduce((sum, row) => sum + row.consumed_weight_kg, 0)
  && value.summary.released_weight_kg + 0.001 >= value.rows.reduce((sum, row) => sum + row.released_weight_kg, 0)
  && new Set(value.rows.map(row => row.id)).size === value.rows.length
  && (value.total_count > 10 || (
    value.summary.active_count === value.rows.filter(row => row.status === "active" && row.open_weight_kg > 0).length
    && Math.abs(value.summary.open_weight_kg - value.rows.reduce((sum, row) => sum + row.open_weight_kg, 0)) <= 0.00100001
    && Math.abs(value.summary.consumed_weight_kg - value.rows.reduce((sum, row) => sum + row.consumed_weight_kg, 0)) <= 0.00100001
    && Math.abs(value.summary.released_weight_kg - value.rows.reduce((sum, row) => sum + row.released_weight_kg, 0)) <= 0.00100001
  ))
  && (value.total_count > 0 || Object.values(value.summary).every(item => item === 0)));

export type ReservationLedgerPage = z.infer<typeof ledgerPage>;

export async function loadReservationLedgerPage(client: Pick<SupabaseClient, "rpc">, options: ReturnType<typeof getReservationLedgerOptions>) {
  const result = await client.rpc("get_profile_stock_reservation_ledger_page", {
    p_page: options.page, p_search: options.search, p_status: options.status, p_sort: options.sort, p_direction: options.direction
  });
  if (result.error) throw result.error;
  const parsed = ledgerPage.safeParse(result.data);
  if (!parsed.success || parsed.data.page !== Math.min(options.page, Math.max(1, Math.ceil(parsed.data.total_count / 10)))) {
    throw new Error("Reservation ledger is unavailable or incomplete. Refresh before using its totals.");
  }
  return parsed.data;
}

const dispatchLedgerPage = z.object({
  dispatch_id: z.string().uuid(), order_id: z.string().uuid().nullable(), order_number: text,
  ledger: ledgerPage.nullable()
}).refine(value => value.order_id === null
  ? value.ledger === null && value.order_number === null
  : value.ledger !== null && value.ledger.rows.every(row => row.order_id === value.order_id && row.order_number === value.order_number));

export type DispatchReservationLedgerPage = z.infer<typeof dispatchLedgerPage>;

export async function loadDispatchReservationLedgerPage(client: Pick<SupabaseClient, "rpc">, dispatchId: string, page: number) {
  if (!z.string().uuid().safeParse(dispatchId).success || !Number.isSafeInteger(page) || page < 1 || page > 100000) {
    throw new Error("Dispatch reservations are unavailable for this request.");
  }
  const result = await client.rpc("get_dispatch_reservation_ledger_page", { p_dispatch_id: dispatchId, p_page: page });
  if (result.error) throw result.error;
  const parsed = dispatchLedgerPage.safeParse(result.data);
  if (!parsed.success || parsed.data.dispatch_id !== dispatchId
    || (parsed.data.ledger !== null && parsed.data.ledger.page !== Math.min(page, Math.max(1, Math.ceil(parsed.data.ledger.total_count / 10))))) {
    throw new Error("Dispatch reservations are unavailable or incomplete. Refresh before using their totals.");
  }
  return parsed.data;
}

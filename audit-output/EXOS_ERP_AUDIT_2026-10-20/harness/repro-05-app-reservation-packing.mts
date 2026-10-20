// Shows the server action's packing builder emits reservation bundles with no
// order_item_id / quote_item_id / net_rate, which the live GST canonicalizer rejects (see repro-02 P6a).
import { buildVerifiedPackingListItems } from "../../../lib/pcda/dispatch.ts";
// Shape mirrors lib/actions/dispatches.ts reservationSources (select list lines 55-57 + mapping lines 106-117).
const reservationSource = {
  id: "r1", order_id: "o1", profile_id: "p1", profile_stock_batch_id: "b1", reserved_weight_kg: 58, reserved_length_m: 58, reserved_pieces: 10,
  status: "active", created_at: "2026-10-20", reservation_id: "r1", source_kind: "reservation",
  available_weight_kg: 58, available_length_m: 58, available_pieces: 10, actual_quantity_kg: 58
};
const result = buildVerifiedPackingListItems([reservationSource], "c1", [{ source_line_id: "r1", bundle_number: "BND-1", gross_weight_kg: 6.8, tare_weight_kg: 1, number_of_pieces: 1, net_length_m: 5.8 } as any]);
const item = result.items[0];
console.log(JSON.stringify({ source_kind: item.source_kind, order_item_id: item.order_item_id, quote_item_id: item.quote_item_id, net_rate: item.net_rate }));

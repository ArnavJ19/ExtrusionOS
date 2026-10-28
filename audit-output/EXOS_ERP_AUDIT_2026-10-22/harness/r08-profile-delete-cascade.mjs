// R08: deleting a profile master cascades into finished-goods stock and reservations.
import { current, ids } from "./current-db.mjs";
const out = (l, v) => console.log(`${l}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const P2 = "f0000000-0000-4000-8000-000000000002", SB = "fb000000-0000-4000-8000-000000000001", RS = "fb100000-0000-4000-8000-000000000001";
const ctx = await current();
await ctx.replica(`
  insert into public.aluminium_profiles (id, company_id, profile_code, profile_name, section_weight_kg_per_m, alloy, temper, standard_length_m, is_active)
    values ('${P2}', '${ids.company}', 'P-200', 'Casement outer frame', 1.2, '6063', 'T6', 5.8, true);
  insert into public.profile_stock_batches (id, company_id, profile_id, finish, length_m, piece_length_m, quantity_pieces, total_weight_kg, status, origin_type, alloy, temper, qc_status, origin_reference)
    values ('${SB}', '${ids.company}', '${P2}', 'mill_finish', 580, 5.8, 100, 696, 'available', 'opening_balance', '6063', 'T6', 'released', 'Opening count 1-Apr');
  insert into public.profile_stock_reservations (id, company_id, profile_stock_batch_id, profile_id, order_id, reserved_weight_kg, reserved_length_m, reserved_pieces, status, initial_reserved_weight_kg, initial_reserved_pieces, initial_reserved_length_m)
    values ('${RS}', '${ids.company}', '${SB}', '${P2}', '${ids.orderA}', 348, 290, 50, 'active', 348, 50, 290)`);
out("R08 before", await ctx.q(`select (select count(*) from public.profile_stock_batches where profile_id='${P2}') batches, (select count(*) from public.profile_stock_reservations where profile_id='${P2}') reservations`));
const d = await ctx.attempt(() => ctx.asExec(ids.owner, `delete from public.aluminium_profiles where id='${P2}'`));
out("R08 owner deletes profile P-200 (696 kg stock, 348 kg reserved for ORD-A)", d.ok ? "accepted" : d.error);
out("R08 after", await ctx.q(`select (select count(*) from public.profile_stock_batches where id='${SB}') batches, (select count(*) from public.profile_stock_reservations where id='${RS}') reservations,
  (select count(*) from public.audit_logs_enterprise where entity_id in ('${SB}','${RS}','${P2}')) audit_rows`));

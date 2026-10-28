// R02: metal-source status (rejected / returned) is a free-text field any production user can flip.
import { current, ids } from "./current-db.mjs";
const out = (l, v) => console.log(`${l}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const X = "9a000000-0000-4000-8000-000000000001", Y = "9a000000-0000-4000-8000-000000000002";
const charge = (src, n) => `insert into public.foundry_batches (company_id, batch_number, furnace_number, alloy, temper, billet_length_mm, billet_diameter_mm, billet_diameter_inch, billet_count, alloy_density_kg_m3, scrap_percentage, external_aluminium_percentage, status, batch_sequence, production_date, external_source_id, furnace_efficiency_percent)
  values ('${ids.company}', 'FB-R02-${n}', 'F1', '6063', 'T6', 1000, 101.6, 4, ${n}, 2700, 0, 100, 'planned', ${n}, current_date, '${src}', 100)`;

{ // a) quarantined implausible lot (the hosted EAS-2026-0003 shape) released by an operator
  const ctx = await current();
  await ctx.replica(`insert into public.foundry_external_aluminium_sources (id, company_id, source_number, item_type, quantity, weight_kg, available_weight_kg, vendor_id, source_origin, received_date, alloy, status, notes)
    values ('${X}', '${ids.company}', 'EAS-X', 'aluminum_ingot', 1, 100000000, 99994001.119, '${ids.vendor}', 'purchased', current_date, '6063', 'rejected', 'Held: implausible receipt')`);
  const flip = await ctx.attempt(() => ctx.asExec(ids.production, `update public.foundry_external_aluminium_sources set status='available' where id='${X}'`));
  out("R02a operator sets rejected lot to available", flip.ok ? "accepted" : flip.error);
  out("R02a lot now", await ctx.q(`select status, weight_kg, available_weight_kg from public.foundry_external_aluminium_sources where id='${X}'`));
  const c = await ctx.attempt(() => ctx.asExec(ids.production, charge(X, 40)));
  out("R02a operator charges 40 billets from the released lot", c.ok ? "accepted" : c.error);
  out("R02a batch", await ctx.q(`select batch_number, external_aluminium_kg, status from public.foundry_batches where batch_number='FB-R02-40'`));
  out("R02a audit trail of the status flip", await ctx.q(`select action_type, actor_role, change_summary, reason from public.audit_logs_enterprise where entity_id='${X}' order by timestamp`).catch((e) => e.message));
}
{ // b) lot returned to the vendor
  const ctx = await current();
  const ins = await ctx.attempt(() => ctx.asExec(ids.productionManager, `insert into public.foundry_external_aluminium_sources (id, company_id, item_type, quantity, weight_kg, vendor_id, source_origin, received_date, alloy, status, rate, invoice_number, invoice_date)
    values ('${Y}', '${ids.company}', 'aluminum_ingot', 1, 1000, '${ids.vendor}', 'purchased', current_date, '6063', 'available', 200, 'VB-1', current_date)`));
  out("R02b receipt 1000 kg @200", ins.ok ? "accepted" : ins.error);
  const snap = () => ctx.q(`select s.status, s.available_weight_kg avail, i.current_stock inv_stock, e.total_amount expense_total, e.approval_status, e.payment_status, e.balance_amount
    from public.foundry_external_aluminium_sources s left join public.inventory_items i on i.id=s.inventory_item_id left join public.expense_ledger e on e.id=s.expense_ledger_id where s.id='${Y}'`);
  out("R02b after receipt", await snap());
  const ret = await ctx.attempt(() => ctx.asExec(ids.production, `update public.foundry_external_aluminium_sources set status='returned', notes='Returned to vendor, off-grade' where id='${Y}'`));
  out("R02b operator marks lot returned", ret.ok ? "accepted" : ret.error);
  out("R02b after return", await snap());
  const back = await ctx.attempt(() => ctx.asExec(ids.production, `update public.foundry_external_aluminium_sources set status='available' where id='${Y}'`));
  out("R02b operator un-returns the lot", back.ok ? "accepted" : back.error);
  out("R02b after un-return", await snap());
}

{ // c) normal receipt rejected at incoming inspection, then released by an operator and charged
  const ctx = await current();
  const Z = "9a000000-0000-4000-8000-000000000003";
  await ctx.asExec(ids.productionManager, `insert into public.foundry_external_aluminium_sources (id, company_id, item_type, quantity, weight_kg, vendor_id, source_origin, received_date, alloy, status, rate)
    values ('${Z}', '${ids.company}', 'aluminum_ingot', 1, 2000, '${ids.vendor}', 'purchased', current_date, '6063', 'available', 200)`);
  const rej = await ctx.attempt(() => ctx.asExec(ids.productionManager, `update public.foundry_external_aluminium_sources set status='rejected', notes='Spectro: Fe 0.6% out of spec' where id='${Z}'`));
  out("R02c manager rejects lot at incoming inspection", rej.ok ? "accepted" : rej.error);
  const blocked = await ctx.attempt(() => ctx.asExec(ids.production, charge(Z, 41)));
  out("R02c control: charge while rejected", blocked.ok ? "accepted" : blocked.error);
  const flip = await ctx.attempt(() => ctx.asExec(ids.production, `update public.foundry_external_aluminium_sources set status='available' where id='${Z}'`));
  out("R02c operator releases it (no approval, no reason)", flip.ok ? "accepted" : flip.error);
  const c = await ctx.attempt(() => ctx.asExec(ids.production, charge(Z, 42)));
  out("R02c operator charges the off-spec lot", c.ok ? "accepted" : c.error);
  out("R02c result", await ctx.q(`select b.batch_number, b.external_aluminium_kg, s.status src_status, s.available_weight_kg from public.foundry_batches b join public.foundry_external_aluminium_sources s on s.id=b.external_source_id where s.id='${Z}'`));
  out("R02c any audit row for the lot", await ctx.q(`select count(*) n from public.audit_logs_enterprise where entity_id='${Z}'`));
}

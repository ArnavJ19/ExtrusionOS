// R07: packaging material purchases and packaging consumption post to two different stock records.
import { current, ids } from "./current-db.mjs";
const out = (l, v) => console.log(`${l}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
const PM = "f8300000-0000-4000-8000-000000000077";
const ctx = await current();
await ctx.asExec(ids.productionManager, `insert into public.packaging_materials (id, company_id, material_name, material_type, unit, current_stock, consumption_rate, calculation_method) values ('${PM}', '${ids.company}', 'Stretch film 500mm', 'stretch_film', 'roll', 0, 1, 'fixed')`);
const p = await ctx.attempt(() => ctx.asExec(ids.accounts, `insert into public.packaging_material_purchases (company_id, material_id, vendor_id, received_date, quantity, unit, rate, invoice_number, invoice_date) values ('${ids.company}', '${PM}', '${ids.vendor}', current_date, 100, 'roll', 450, 'PF-9', current_date)`));
out("R07 purchase 100 rolls @450", p.ok ? "accepted" : p.error);
const snap = () => ctx.q(`select m.current_stock material_master_stock, (select current_stock from public.inventory_items i where i.company_id=m.company_id and i.item_code like 'PKG-%') inventory_item_stock,
  (select count(*) from public.packaging_material_movements mv where mv.material_id=m.id) material_movements from public.packaging_materials m where m.id='${PM}'`);
out("R07 after purchase", await snap());
const edit = await ctx.attempt(() => ctx.asExec(ids.dispatch, `update public.packaging_materials set current_stock = 5000 where id='${PM}'`));
out("R07 dispatch user types material stock 5000 directly", edit.ok ? "accepted" : edit.error);
out("R07 after direct edit", await snap());

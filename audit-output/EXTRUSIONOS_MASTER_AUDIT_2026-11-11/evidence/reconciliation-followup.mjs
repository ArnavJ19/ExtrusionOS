import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { createCashFixture, cIds: ids, nid, istDay } = await import(pathToFileURL(join(process.cwd(), 'scripts/lib/autopilot-batch3-fixture.mjs')).href);
const fixture = await createCashFixture();
let errors = 0;
async function check(id, run) {
  try { console.log(JSON.stringify({ id, ...await run() })); }
  catch (error) { errors++; console.log(JSON.stringify({ id, fixtureError: error.message, code: error.code })); }
}
await fixture.start();
try {
  await check('MFA-017', async () => {
    const material = nid(8220);
    await fixture.seed("insert into public.packaging_materials(id,company_id,material_code,material_name,material_type,unit,current_stock,consumption_rate) values($1,$2,'AUDIT-FILM','Synthetic film','stretch_film','meter',0,1)", [material, ids.company]);
    await fixture.asOwnerFor("insert into public.packaging_material_purchases(company_id,purchase_number,material_id,vendor_id,quantity,unit,rate,tax_amount,payment_status,total_amount) values($1,'PMP-AUDIT-100',$2,$3,100,'meter',10,180,'unpaid',1180)", [ids.company, material, ids.vendor], ids.productionManager);
    const stock = await fixture.one("select m.current_stock as packaging_metres,i.current_stock as inventory_metres from public.packaging_materials m join public.inventory_items i on i.company_id=m.company_id and i.item_code='PKG-AUDIT-FILM' where m.id=$1", [material]);
    return { expectedPackagingMetres: 100, actual: stock, reproduced: Number(stock.packaging_metres) === 0 && Number(stock.inventory_metres) === 100 };
  });

  await check('quote-extension-fixture-differential', async () => {
    const seedHeader = (quote, suffix) => fixture.seed("insert into public.quotes(id,company_id,quote_number,customer_id,quote_date,valid_until,status,subtotal,total_before_gst,gst_percent,gst_amount,grand_total,revision_number,created_by) values($1,$2,$3,$4,$5,$6,'expired',23000,23000,18,4140,27140,1,$7)", [quote, ids.company, 'Q-AUDIT-' + suffix, ids.customer2, istDay(-16), istDay(-1), ids.sales]);
    const headerOnly = nid(8221), withLine = nid(8222);
    await seedHeader(headerOnly, 'HEADER');
    await seedHeader(withLine, 'LINE');
    await fixture.seed("insert into public.quote_items(id,company_id,quote_id,profile_id,item_description,quantity_pieces,length_per_piece_m,section_weight_kg_per_m,total_weight_kg,billet_rate_per_kg,conversion_charge_per_kg,gst_percent,hsn_code,drawing_approval_status,costing_complete,revision_number,expected_recovery_percent,margin_percent) values($1,$2,$3,$4,'Fixture track',100,6,0.95,570,230,35,18,'7604','Approved',true,1,90,10)", [nid(8223), ids.company, withLine, ids.profile2]);
    async function attempt(quote) {
      const request = await fixture.call('ap_quotes', 'extend', { quote_id: quote, valid_until: istDay(10), reason: 'Customer confirms order after site visit' }, ids.sales);
      let response;
      try {
        response = await fixture.call('ap_quotes', 'decide_extension', { request_id: request.request_id, decision: 'approve' }, ids.salesManager);
      } catch (error) {
        response = { sqlstate: error.code, message: error.message };
      }
      return { response, ...await fixture.one('select status, valid_until::text from public.quotes where id=$1', [quote]) };
    }
    return { headerOnly: await attempt(headerOnly), withLine: await attempt(withLine) };
  });
} finally {
  await fixture.rollback();
  await fixture.close();
}
if (errors) process.exitCode = 1;

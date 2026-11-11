import { createAutopilotFixture, apIds, istDay, nid } from "./autopilot-batch1-fixture.mjs";

export { istDay, nid };
// Order-to-cash fixture: four customers (registered in Maharashtra, registered in Delhi, unregistered with a state, and
// one without any state), three open invoices for the Maharashtra customer with due dates around today, profiles with an
// HSN code and one die each, and an approved billet rate. Seeds run with triggers suspended; scenarios run with them on.
export const cIds = {
  ...apIds,
  customer3: nid(400), customer4: nid(401),
  inv1: nid(410), inv2: nid(411), inv3: nid(412),
  rateBillet: nid(420), rateConversion: nid(421)
};
export const GSTIN = { delhi: "07AAACX1234A1ZZ", maharashtra: "27ABCDE1234F1Z0", gujarat: "24ABCDE1234F1Z6" };

export async function createCashFixture() {
  const f = await createAutopilotFixture();
  const { db } = f, i = cIds;
  const seed = async (sql, params = []) => {
    await db.exec("savepoint ap3_seed; set session_replication_role = replica");
    try { const r = await db.query(sql, params); await db.exec("set session_replication_role = origin; release savepoint ap3_seed"); return r.rows; }
    catch (error) { await db.exec("rollback to savepoint ap3_seed; set session_replication_role = origin; release savepoint ap3_seed"); throw error; }
  };
  await db.exec("set session_replication_role = replica");
  await db.query("update customers set gst_number=$2, gst_registration='registered', state='Delhi', phone='9810000001' where id=$1", [i.customer, GSTIN.delhi]);
  await db.query("update customers set gst_number=$2, gst_registration='registered', state='Maharashtra', whatsapp_number='9820000002', contact_person='Mr Sharma' where id=$1", [i.customer2, GSTIN.maharashtra]);
  await db.query(`insert into customers(id,company_id,customer_name,customer_type,city,state,gst_registration) values
    ($1,$3,'Unregistered Traders','dealer','Delhi','Delhi','unregistered'),($2,$3,'Mystery Buyer','fabricator',null,null,'unregistered')`, [i.customer3, i.customer4, i.company]);
  await db.query("update aluminium_profiles set hsn_code='7604' where company_id=$1", [i.company]);
  await db.query("insert into company_settings(company_id, default_gst_percent, default_quote_validity_days) values($1,18,15) on conflict do nothing", [i.company]);
  const inv = `insert into invoices(id,company_id,customer_id,invoice_number,invoice_date,due_date,status,subtotal,tax_total,grand_total,amount_paid,place_of_supply_state_code,supplier_state_code,igst_amount)
    values($1,$2,$3,$4,$5,$6,'generated',$7,0,$7,0,'27','07',0)`;
  await db.query(inv, [i.inv1, i.company, i.customer2, "OMX/26-27/0101", istDay(-50), istDay(-20), 10000]);
  await db.query(inv, [i.inv2, i.company, i.customer2, "OMX/26-27/0102", istDay(-35), istDay(-5), 20000]);
  await db.query(inv, [i.inv3, i.company, i.customer2, "OMX/26-27/0103", istDay(-27), istDay(3), 5000]);
  await db.query(`insert into costing_rates(id,company_id,rate_type,basis,rate,effective_from,status,created_by,created_by_name,approved_by,approved_by_name,approved_at) values
    ($1,$3,'billet','per_kg',245,current_date - 1,'approved',$4,'Fixture owner',$4,'Fixture owner',now()),($2,$3,'conversion','per_kg',38,current_date - 1,'approved',$4,'Fixture owner',$4,'Fixture owner',now())`,
    [i.rateBillet, i.rateConversion, i.company, i.owner]);
  await db.exec("set session_replication_role = origin");
  await db.query("select set_config('request.jwt.claim.sub','',false)");

  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  /** Run a statement expected to fail without aborting the test transaction. */
  const raw = async (sql, params = []) => {
    await db.exec("savepoint ap3_raw");
    try { const r = await db.query(sql, params); await db.exec("release savepoint ap3_raw"); return r; }
    catch (error) { await db.exec("rollback to savepoint ap3_raw; release savepoint ap3_raw"); throw error; }
  };
  /** Deferred (commit-time) triggers queued so far run now, as they would at commit; later ones stay deferred. */
  const immediate = () => db.exec("set constraints all immediate; set constraints all deferred");
  /** Insert as the database owner with the session's person set (production triggers on, row security bypassed). */
  const asOwnerFor = async (sql, params, actor) => {
    await db.exec("savepoint ap3_owner");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
      const rows = (await db.query(sql, params)).rows;
      await db.query("select set_config('request.jwt.claim.sub','',true)");
      await db.exec("release savepoint ap3_owner");
      return rows;
    } catch (error) {
      await db.exec("rollback to savepoint ap3_owner; release savepoint ap3_owner");
      throw error;
    }
  };
  /** Insert an order as a person (production triggers on) with lines seeded directly, then run the commit-time triggers. */
  async function confirmOrder({ id, customer = i.customer2, value = 50000, lines = [], creator = i.sales, dispatchOn = istDay(10), number, quote = null }) {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [i.owner]);
    await db.query(`insert into orders(id,company_id,order_number,customer_id,order_date,expected_dispatch_date,priority,order_value,current_stage,created_by,manufacturing_weight_kg,requested_weight_kg,quote_id)
      values($1,$2,$3,$4,current_date,$5,'normal',$6,'order_confirmed',$7,$8,$8,$9)`, [id, i.company, number ?? `SO-B3-${id.slice(-4)}`, customer, dispatchOn, value, creator,
      lines.reduce((s, l) => s + (l.kg ?? 0), 0), quote]);
    for (const l of lines) {
      await seed(`insert into order_items(id,company_id,order_id,profile_id,die_id,item_description,quantity_pieces,length_per_piece_m,quantity_kg,manufacturing_weight_kg,section_weight_kg_per_m,gst_percent,technical_spec_snapshot)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,18,$11)`, [l.id, i.company, id, l.profile ?? i.profile2, l.die ?? null, l.description ?? "Sliding track 6 m", l.pieces ?? 100, l.length ?? 6, l.kg, l.kgm ?? 0.95,
        l.spec ?? {}]);
    }
    // Direct orders derive their value from lines (a trigger the seed skips); keep the scenario's value.
    await seed("update orders set order_value=$2 where id=$1", [id, value]);
    await immediate();
    await db.query("select set_config('request.jwt.claim.sub','',true)");
  }
  /** A gated-out dispatch with packed lines (the dispatch workflow's own guards are bypassed; the batch 3 guard is not). */
  async function packDispatch({ id, order, lines, number }) {
    await seed(`insert into dispatches(id,company_id,order_id,dispatch_number,dispatch_date,delivery_status,total_weight_kg,number_of_bundles) values($1,$2,$3,$4,current_date,'pending',$5,$6)`,
      [id, i.company, order, number ?? `DC-B3-${id.slice(-4)}`, lines.reduce((s, l) => s + l.kg, 0), lines.length]);
    for (const l of lines) {
      await seed(`insert into packing_list_items(id,company_id,dispatch_id,profile_id,bundle_number,number_of_pieces,gross_weight_kg,tare_weight_kg,net_length_m,net_rate,gst_percent,order_item_id,source_kind,source_record_id,
          operator_verified_by,operator_verified_at) values($1,$2,$3,$4,$5,$6,$7,0,$8,$9,18,$10,'production',$11,$12,now()-interval '1 hour')`,
        [l.id, i.company, id, l.profile ?? i.profile2, l.bundle ?? `B-${l.id.slice(-5)}`, l.pieces ?? 10, l.kg, l.length ?? 60, l.rate ?? 300, l.item ?? null, order, i.production]);
    }
  }
  const DISPATCH_GUARDS = ["set_actual_dispatch_activation", "validate_dispatch_transition", "validate_dispatch_readiness", "zy_customer_requirements", "a_guard_dispatch_post_activation"];
  async function gateOut(id, actor = nid(22)) {
    for (const t of DISPATCH_GUARDS) await db.exec(`alter table dispatches disable trigger ${t}`);
    try {
      await asOwnerFor("update dispatches set delivery_status='dispatched', actual_dispatched_at=now() where id=$1", [id], actor);
      await immediate();
    } finally {
      for (const t of DISPATCH_GUARDS) await db.exec(`alter table dispatches enable trigger ${t}`);
    }
  }
  return { ...f, ids: i, seed, one, raw, immediate, asOwnerFor, confirmOrder, packDispatch, gateOut };
}

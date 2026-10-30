import { createFactoryUpgradeFixture, cid } from "./factory-upgrade-fixture.mjs";

export { cid };

export async function createFactoryPlanningFixture() {
  const fixture = await createFactoryUpgradeFixture();
  const ids = {
    ...fixture.ids,
    press: cid(840),
    die: cid(841),
    job: cid(842),
    secondJob: cid(843),
    vehicle: cid(844),
    bundleOne: cid(845),
    bundleTwo: cid(846),
    otherCustomer: cid(847),
    otherOrderRequest: cid(848),
    otherBatch: cid(849),
    otherReservation: cid(850)
  };
  const line = (await fixture.db.query("select id from order_items where company_id=$1 and order_id=$2 order by id limit 1", [ids.company, ids.order])).rows[0];
  if (!line) throw new Error("The direct-order fixture has no physical order line");

  await fixture.db.query(`insert into customers(id,company_id,customer_name,customer_type,payment_terms,billing_address,shipping_address,created_by)
    values($1,$2,'Second fabricator','fabricator','30 days','Second billing address','Second site gate',$3)`, [ids.otherCustomer, ids.company, ids.owner]);
  ids.otherOrder = (await fixture.db.query("select create_direct_order_atomic($1,$2,$3) id", [
    { customer_id: ids.otherCustomer, order_date: "2026-10-29", priority: "normal", notes: "Second load fixture order" },
    [{ profile_id: ids.profile, die_id: null, quantity_pieces: 200, length_per_piece_m: 6, expected_section_weight_kg_per_m: 0.8, net_rate: 250, gst_percent: 18, hsn_code: "760421", finishing_type: "mill_finish" }], ids.otherOrderRequest
  ])).rows[0].id;
  await fixture.db.query(`insert into profile_stock_batches(id,company_id,profile_id,finish,piece_length_m,length_m,quantity_pieces,total_weight_kg,location,status,origin_type,qc_status,alloy,temper)
    values($1,$2,$3,'mill_finish',6,1200,200,960,'Rack B','available','legacy_unverified','not_required','6063','T6')`, [ids.otherBatch, ids.company, ids.profile]);
  await fixture.db.query(`insert into profile_stock_reservations(id,company_id,profile_stock_batch_id,profile_id,order_id,reserved_weight_kg,reserved_length_m,reserved_pieces,status,created_by)
    values($1,$2,$3,$4,$5,480,600,100,'active',$6)`, [ids.otherReservation, ids.company, ids.otherBatch, ids.profile, ids.otherOrder, ids.owner]);

  await fixture.db.query(`insert into machines(id,company_id,machine_name,machine_type,status,is_active,press_capacity_ton)
    values($1,$2,'Planning Press','extrusion_press','active',true,12)`, [ids.press, ids.company]);
  await fixture.db.query(`insert into dies(id,company_id,die_number,profile_id,die_status,created_by)
    values($1,$2,'PLAN-DIE',$3,'active',$4)`, [ids.die, ids.company, ids.profile, ids.owner]);
  for (const [id, number] of [[ids.job, "PLAN-0001"], [ids.secondJob, "PLAN-0002"]]) {
    await fixture.db.query(`insert into production_jobs(id,company_id,order_id,die_id,profile_id,source_line_id,job_number,planned_quantity_kg,actual_quantity_kg,status,finishing_type,created_by)
      values($1,$2,$3,$4,$5,$6,$7,200,0,'planned','mill_finish',$8)`, [id, ids.company, ids.order, ids.die, ids.profile, line.id, number, ids.owner]);
  }

  const scheduleSnapshot = async (from, through) => (await fixture.db.query("select public.factory_planning_snapshot($1,$2) data", [from, through])).rows[0].data;
  const saveShift = async ({ machine_id = ids.press, weekday, shift_name = "Day", starts_local = "08:00", ends_local = "20:00", capacity_kg = 500 }) =>
    (await fixture.db.query("select public.save_factory_shift_capacity($1) data", [{ machine_id, weekday, shift_name, starts_local, ends_local, capacity_kg }])).rows[0].data;
  const addBundle = async (number, id = ids.bundleOne) => fixture.recordBundle(number, { id, bundle_number: `PLANNING-${number}` });
  const addSecondOrderBundle = async (number = 846, id = ids.bundleTwo) => fixture.command("physical_bundle_command", "bundle.record", {
    id, order_id: ids.otherOrder, source_line_id: ids.otherReservation, source_kind: "reservation", bundle_number: `PLANNING-${number}`,
    number_of_pieces: 2, net_length_m: 12, gross_weight_kg: 10.6, tare_weight_kg: 1
  });

  return { ...fixture, ids, lineId: line.id, scheduleSnapshot, saveShift, addBundle, addSecondOrderBundle };
}

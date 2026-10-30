import test from "node:test";
import assert from "node:assert/strict";
import { createFactoryPlanningFixture, cid } from "../scripts/lib/factory-planning-fixture.mjs";
import { buildFactoryDeliveryProposal, factoryDeliveryDataSchema } from "../lib/workflow/factory-planning.ts";

let fixture;
test.before(async () => { fixture = await createFactoryPlanningFixture(); });
test.after(async () => fixture?.close());

function addDays(day, count) {
  const value = new Date(`${day}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}
function weekday(day) { return new Date(`${day}T00:00:00.000Z`).getUTCDay() || 7; }

test("31: full-chain schedule snapshot, shift guards and reviewed move reject stale fingerprints", async () => {
  const today = (await fixture.scheduleSnapshot(null, null)).today;
  const day = addDays(today, 1), through = addDays(day, 10), dayNumber = weekday(day);
  await fixture.saveShift({ weekday: dayNumber, capacity_kg: 500 });
  await assert.rejects(fixture.saveShift({ weekday: dayNumber, shift_name: "Overlap", starts_local: "18:00", ends_local: "23:00", capacity_kg: 300 }), /overlaps another configured shift/);
  await fixture.saveShift({ weekday: dayNumber, shift_name: "Night", starts_local: "22:00", ends_local: "06:00", capacity_kg: 250 });
  await assert.rejects(fixture.saveShift({ weekday: weekday(addDays(day, 1)), shift_name: "Early", starts_local: "05:00", ends_local: "12:00", capacity_kg: 250 }), /overlaps another configured shift/);

  const snapshot = await fixture.scheduleSnapshot(day, through);
  const move = {
    request_id: cid(850), production_job_id: fixture.ids.job, slot_id: null, machine_id: fixture.ids.press,
    planned_start_at: `${day}T09:00:00+05:30`, planned_end_at: `${day}T11:00:00+05:30`, shift: "Day", capacity_kg: 200,
    sequence_number: 0, from_date: snapshot.from_date, through_date: snapshot.through_date, fingerprint: snapshot.fingerprint
  };
  const first = (await fixture.db.query("select public.commit_factory_schedule_move($1) data", [move])).rows[0].data;
  assert.equal(first.replayed, false);
  assert.equal((await fixture.db.query("select public.commit_factory_schedule_move($1) data", [move])).rows[0].data.replayed, true);

  await fixture.db.query("select public.create_factory_maintenance_block($1)", [{
    id: cid(851), machine_id: fixture.ids.press, starts_at: `${day}T13:00:00+05:30`, ends_at: `${day}T15:00:00+05:30`, reason: "Die change"
  }]);
  await assert.rejects(fixture.db.query("select public.commit_factory_schedule_move($1)", [{ ...move, request_id: cid(852), planned_start_at: `${day}T14:00:00+05:30`, planned_end_at: `${day}T15:00:00+05:30` }]), /schedule changed while you reviewed/);

  await assert.rejects(fixture.db.query(`insert into production_plan_slots(company_id,production_job_id,machine_id,planned_start_at,planned_end_at,shift,sequence_number,capacity_kg,status,created_by)
    values($1,$2,$3,$4,$5,'Day',1,400,'scheduled',$6)`, [fixture.ids.company, fixture.ids.secondJob, fixture.ids.press, `${day}T12:00:00+05:30`, `${day}T13:00:00+05:30`, fixture.ids.owner]), /shift exceeds its configured kg capacity/);
  await assert.rejects(fixture.db.query(`insert into production_plan_slots(company_id,production_job_id,machine_id,planned_start_at,planned_end_at,shift,sequence_number,capacity_kg,status,created_by)
    values($1,$2,$3,$4,$5,'Day',2,100,'scheduled',$6)`, [fixture.ids.company, fixture.ids.secondJob, fixture.ids.press, `${day}T14:00:00+05:30`, `${day}T15:00:00+05:30`, fixture.ids.owner]), /maintenance window or unresolved breakdown/);
});

test("31: table ACLs are closed and roles are enforced inside the RPC", async () => {
  assert.equal((await fixture.db.query("select has_table_privilege('authenticated','factory_shift_capacities','SELECT') ok")).rows[0].ok, false);
  await fixture.actor(fixture.ids.sales);
  await assert.rejects(fixture.saveShift({ weekday: 1 }), /not permitted/);
  await fixture.actor();
});

test("37: the proposal RPC returns validated order-specific stock, job, capacity and finishing inputs", async () => {
  const raw = (await fixture.db.query("select public.factory_delivery_proposal_data($1) data", [fixture.ids.order])).rows[0].data;
  const data = factoryDeliveryDataSchema.parse(raw);
  const proposal = buildFactoryDeliveryProposal(data);
  assert.equal(data.order.id, fixture.ids.order);
  assert.equal(data.lines[0].order_id, fixture.ids.order);
  assert.equal(proposal.orderNumber, data.order.order_number);
  assert.equal(proposal.proposalDate, null);
  assert.match(proposal.missing.join(" "), /No finishing lead time|no production job yet|billets/);
  assert.match(proposal.assumptions.join(" "), /not an approved customer commitment/);
  await fixture.db.query("update machines set is_active=false where id=$1",[fixture.ids.press]);
  const disabled=factoryDeliveryDataSchema.parse((await fixture.db.query('select factory_delivery_proposal_data($1) data',[fixture.ids.order])).rows[0].data);
  assert.equal(disabled.shift_capacities.length,0);
  await fixture.db.query("update machines set is_active=true where id=$1",[fixture.ids.press]);
});

async function staleSavedBundleRelease(){
  const snapshot=(await fixture.db.query("select factory_vehicle_load_snapshot(null,1,'') data")).rows[0].data;
  const vehicle=snapshot.vehicles.find(v=>v.registration_number==='MH01AB1234');
  const payload={request_id:cid(859),load_id:null,expected_version:0,vehicle_id:vehicle.id,vehicle_fingerprint:vehicle.fingerprint,
    load_date:(await fixture.scheduleSnapshot(null,null)).today,bundles:snapshot.bundles.map(b=>({id:b.id,fingerprint:b.fingerprint}))};
  const saved=(await fixture.db.query('select save_factory_vehicle_load($1) data',[payload])).rows[0].data;
  assert.equal(saved.load.item_count,2);
  await fixture.db.query("update factory_vehicle_loads set load_date=load_date-1 where id=$1",[saved.load.id]);
  await fixture.db.query('update factory_vehicles set is_active=false where id=$1',[vehicle.id]);
  await fixture.db.query("update profile_stock_batches set qc_status='on_hold' where id=$1",[fixture.ids.batch]);
  const release={request_id:cid(860),load_id:saved.load.id,expected_version:saved.load.version,bundle_ids:[fixture.ids.bundleOne],reason:'Bundle held after review; release only its saved assignment'};
  const released=(await fixture.db.query('select release_factory_vehicle_load_bundles($1) data',[release])).rows[0].data;
  assert.equal(released.load.item_count,1);assert.equal(released.load.items[0].id,fixture.ids.bundleTwo);
  assert.equal((await fixture.db.query('select release_factory_vehicle_load_bundles($1) data',[release])).rows[0].data.replayed,true);
  await assert.rejects(fixture.db.query('select release_factory_vehicle_load_bundles($1)',[{...release,reason:'Changed request must not reuse identity'}]),/different load-release details/);
  assert.equal(Number((await fixture.db.query('select total_weight_kg from profile_stock_batches where id=$1',[fixture.ids.batch])).rows[0].total_weight_kg),960);
}

test("30: reviewed multi-order load uses measured bundles only, locks duplicate assignment and consumes no stock", async () => {
  await fixture.addBundle(845, fixture.ids.bundleOne);
  await fixture.addSecondOrderBundle(846, fixture.ids.bundleTwo);
  const vehicle = (await fixture.db.query("select public.save_factory_vehicle($1) data", [{ registration_number: "MH01AB1234", vehicle_label: "12T truck", capacity_kg: 25 }])).rows[0].data;
  let snapshot = (await fixture.db.query("select public.factory_vehicle_load_snapshot(null,1,'') data")).rows[0].data;
  assert.equal(snapshot.bundles.length, 2);
  const firstBundle = snapshot.bundles.find(bundle => bundle.id === fixture.ids.bundleOne);
  const secondBundle = snapshot.bundles.find(bundle => bundle.id === fixture.ids.bundleTwo);
  assert.ok(firstBundle?.destination);
  assert.equal(firstBundle.order_id, fixture.ids.order);
  assert.equal(firstBundle.customer_name, "Window customer");
  assert.equal(secondBundle.order_id, fixture.ids.otherOrder);
  assert.equal(secondBundle.customer_name, "Second fabricator");
  assert.equal(secondBundle.destination, "Second site gate");
  const smallVehicle = (await fixture.db.query("select public.save_factory_vehicle($1) data", [{ registration_number: "MH01XY1111", vehicle_label: "Small truck", capacity_kg: 10 }])).rows[0].data;
  const payload = {
    request_id: cid(855), load_id: null, expected_version: 0, vehicle_id: vehicle.id, vehicle_fingerprint: vehicle.fingerprint,
    load_date: (await fixture.scheduleSnapshot(null, null)).today,
    bundles: [{ id: firstBundle.id, fingerprint: firstBundle.fingerprint }, { id: secondBundle.id, fingerprint: secondBundle.fingerprint }]
  };
  await assert.rejects(fixture.db.query("select public.save_factory_vehicle_load($1)", [{ ...payload, vehicle_id: smallVehicle.id,
    vehicle_fingerprint: smallVehicle.fingerprint, bundles: [
      { id: firstBundle.id, fingerprint: firstBundle.fingerprint }, { id: secondBundle.id, fingerprint: secondBundle.fingerprint }
    ] }]), /above this vehicle capacity/);

  const saved = (await fixture.db.query("select public.save_factory_vehicle_load($1) data", [payload])).rows[0].data;
  assert.equal(saved.load.item_count, 2);
  assert.deepEqual(new Set(saved.load.items.map(item => item.order_id)), new Set([fixture.ids.order, fixture.ids.otherOrder]));
  const persistedFirst = saved.load.items.find(item => item.id === fixture.ids.bundleOne);
  assert.equal(persistedFirst.source_line_id, fixture.ids.reservation);
  assert.equal(persistedFirst.customer_name, "Window customer");
  assert.equal(persistedFirst.net_weight_kg, 9.6);
  assert.equal(Number((await fixture.db.query("select total_weight_kg from profile_stock_batches where id=$1", [fixture.ids.batch])).rows[0].total_weight_kg), 960);

  const changedReplay = { ...payload, load_date: addDays(payload.load_date, 1) };
  await assert.rejects(fixture.db.query("select public.save_factory_vehicle_load($1)", [changedReplay]), /already used for different vehicle-load details/);
  await assert.rejects(fixture.db.query("select public.save_factory_vehicle_load($1)", [{ ...payload, request_id: cid(856) }]), /eligibility or order destination changed/);

  const dispatchPayload = {
    order_id: fixture.ids.order, dispatch_date: payload.load_date, total_weight_kg: 9.6, total_tare_weight_kg: 1
  };
  await assert.rejects(fixture.db.query("select save_ready_dispatch_atomic(null,$1,$2)", [dispatchPayload, [{
    source_kind: "reservation", source_line_id: fixture.ids.reservation, reservation_id: fixture.ids.reservation, source_record_id: fixture.ids.order,
    profile_id: fixture.ids.profile, profile_stock_batch_id: fixture.ids.batch, bundle_number: "PLANNING-845", number_of_pieces: 2,
    net_length_m: 12, gross_weight_kg: 10.6, tare_weight_kg: 1
  }]]), /Remove this measured bundle from its reviewed vehicle load/);
  assert.equal((await fixture.db.query("select dispatch_id from prepared_physical_bundles where id=$1", [fixture.ids.bundleOne])).rows[0].dispatch_id, null);
  assert.equal((await fixture.db.query("select has_table_privilege('authenticated','factory_vehicle_load_items','UPDATE') ok")).rows[0].ok, false);
});

test("30: assignment uniqueness is released only after a reviewed load removes the bundle", async () => {
  const loadId = (await fixture.db.query("select id from factory_vehicle_loads order by created_at limit 1")).rows[0]?.id;
  assert.ok(loadId);
  let snapshot = (await fixture.db.query("select public.factory_vehicle_load_snapshot($1,1,'') data", [loadId])).rows[0].data;
  const savedFirst = snapshot.current_load.items.find(item => item.id === fixture.ids.bundleOne);
  const savedSecond = snapshot.current_load.items.find(item => item.id === fixture.ids.bundleTwo);
  const loadVehicleId = snapshot.current_load.vehicle_id;
  const vehicleFingerprint = snapshot.vehicles.find(row => row.id === loadVehicleId).fingerprint;
  const updated = (await fixture.db.query("select public.save_factory_vehicle_load($1) data", [{
    request_id: cid(857), load_id: loadId, expected_version: snapshot.current_load.version,
    vehicle_id: snapshot.current_load.vehicle_id, vehicle_fingerprint: snapshot.vehicles.find(row => row.id === snapshot.current_load.vehicle_id).fingerprint,
    load_date: snapshot.current_load.load_date, bundles: [{ id: savedSecond.id, fingerprint: savedSecond.fingerprint }]
  }])).rows[0].data;
  assert.equal(updated.load.item_count, 1);
  assert.equal(updated.load.version, 2);
  assert.equal(updated.load.items[0].order_id, fixture.ids.otherOrder);
  snapshot = (await fixture.db.query("select public.factory_vehicle_load_snapshot(null,1,'') data")).rows[0].data;
  assert.ok(snapshot.bundles.some(bundle => bundle.id === savedFirst.id));
  assert.equal(snapshot.bundles.some(bundle => bundle.id === savedSecond.id), false);

  const emptied = (await fixture.db.query("select public.save_factory_vehicle_load($1) data", [{
    request_id: cid(858), load_id: loadId, expected_version: 2, vehicle_id: loadVehicleId,
    vehicle_fingerprint: vehicleFingerprint, load_date: (await fixture.db.query("select load_date from factory_vehicle_loads where id=$1", [loadId])).rows[0].load_date,
    bundles: []
  }])).rows[0].data;
  assert.equal(emptied.load.item_count, 0);
  assert.equal(emptied.load.version, 3);
  snapshot = (await fixture.db.query("select public.factory_vehicle_load_snapshot(null,1,'') data")).rows[0].data;
  assert.ok(snapshot.bundles.some(bundle => bundle.id === savedSecond.id));
});

test('30: a stale saved bundle can be selectively released from a past load with an inactive vehicle',staleSavedBundleRelease);

import test from "node:test";
import assert from "node:assert/strict";
import { createFactoryPlanningBrowser } from "../scripts/lib/factory-planning-browser-fixture.mjs";

const id = number => `bc000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const machine = { id: id(10), machine_name: "Press 1", status: "active", is_active: true };
const job = { id: id(11), job_number: "PJ-11", order_id: id(12), order_number: "SO-12", customer_name: "Fabricator", profile_code: "AL-01", die_number: "D-11", die_status: "active", billet_allocation_status: "complete", billets_short: 0, status: "planned", machine_id: null, planned_quantity_kg: 120, actual_quantity_kg: 0, planned_date: null, finishing_type: "mill_finish", source_line_id: id(13) };
const planning = {
  company_id: id(1), from_date: "2026-10-29", through_date: "2026-11-12", today: "2026-10-29", fingerprint: "a".repeat(32),
  machines: [machine], jobs: [job], slots: [], shift_capacities: [{ id: id(14), machine_id: machine.id, weekday: 5, shift_name: "Day", starts_local: "08:00", ends_local: "20:00", capacity_kg: 500 }],
  maintenance_blocks: [], finishing_lead_times: []
};
const bundle = (n, order, destination, weight = 9.6) => ({
  id: id(n), fingerprint: String(n).padStart(32, "a"), bundle_number: `BUNDLE-${n}`, order_id: id(order), order_number: `SO-${order}`,
  customer_id: id(order + 100), customer_name: `Customer ${order}`, destination, party_basis: "Current customer master", source_line_id: id(200 + order),
  source_kind: "reservation", profile_id: id(300), net_weight_kg: weight, number_of_pieces: 2, net_length_m: 12,
  source_document_quote_id: null, source_document_revision: null
});
const vehicle = { id: id(40), registration_number: "MH01AB1234", vehicle_label: "Truck 12T", capacity_kg: 15, version: 1, fingerprint: "b".repeat(32) };
const vehicleSnapshot = { company_id: id(1), page: 1, page_size: 10, total_bundle_count: 2, search: "", vehicles: [vehicle], bundles: [bundle(41, 51, "Gate A"), bundle(42, 52, "Site B")], loads: [], load_total_count: 0, current_load: null };

test("31: production staff can review an accessible machine move and confirm it once", async () => {
  const f = await createFactoryPlanningBrowser({ component: "FactoryPlanning", props: { initialSnapshot: planning, initialError: null, canMove: true, canConfigure: true, orders: [] }, results: {
    moveFactoryProductionJobAction: { success: true, slotId: id(60), replayed: false },
    getFactoryPlanningSnapshotAction: { success: true, data: planning }
  } });
  try {
    await f.reset();
    const form = f.page.locator("section").filter({ has: f.page.getByRole("heading", { name: "Review a schedule move" }) });
    await form.getByLabel("Production job").selectOption(job.id);
    await form.getByLabel("Extrusion press").selectOption(machine.id);
    await form.getByLabel("Shift name").fill("Day");
    await form.getByLabel("Slot kg capacity").fill("120");
    await form.getByLabel("Start").fill("2026-10-30T09:00");
    await form.getByLabel("End").fill("2026-10-30T11:00");
    await form.getByRole("button", { name: "Review proposal" }).click();
    await f.page.getByText(/Review ready: PJ-11 on Press 1/).waitFor();
    await f.page.getByRole("button", { name: "Confirm reviewed move" }).click();
    await f.page.getByText("Reviewed press move saved.").waitFor();
    const calls = await f.page.evaluate(() => window.__factory.calls.filter(row => row.name === "moveFactoryProductionJobAction"));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input.production_job_id, job.id);
    assert.equal(calls[0].input.fingerprint, planning.fingerprint);
    assert.deepEqual(f.errors, []);
    assert.deepEqual(f.network, []);
  } finally { await f.close(); }
});

test("30: vehicle load UI keeps separate order destinations and blocks over-capacity review", async () => {
  const savedLoad = {
    id: id(70), vehicle_id: vehicle.id, registration_number: vehicle.registration_number, vehicle_label: vehicle.vehicle_label,
    load_date: "2026-10-29", status: "reviewed", capacity_kg: 15, total_weight_kg: 9.6, item_count: 1, version: 1,
    items: [{ ...bundle(41, 51, "Gate A"), status: "active", updated_fingerprint: bundle(41, 51, "Gate A").fingerprint }]
  };
  const refreshed = { ...vehicleSnapshot, bundles: [bundle(42, 52, "Site B")], current_load: savedLoad };
  const f = await createFactoryPlanningBrowser({ component: "VehicleLoads", props: { initialSnapshot: vehicleSnapshot, initialError: null, canConfigure: true }, results: {
    saveFactoryVehicleLoadAction: { success: true, load: savedLoad, replayed: false },
    getFactoryVehicleLoadSnapshotAction: { success: true, data: refreshed }
  } });
  try {
    await f.reset();
    await f.page.getByText("Gate A", { exact: false }).waitFor();
    await f.page.getByText("Site B", { exact: false }).waitFor();
    await f.page.getByLabel("Select bundle BUNDLE-41").check();
    await f.page.getByLabel("Select bundle BUNDLE-42").check();
    await f.page.getByRole("alert").filter({ hasText: "exceed the configured vehicle capacity" }).waitFor();
    assert.equal(await f.page.getByRole("button", { name: "Review and save vehicle load" }).isDisabled(), true);
    assert.equal(await f.page.evaluate(() => window.__factory.calls.some(row => row.name === "saveFactoryVehicleLoadAction")), false);
    await f.page.getByLabel("Select bundle BUNDLE-42").uncheck();
    await f.page.getByRole("button", { name: "Review and save vehicle load" }).click();
    await f.page.getByText("Vehicle load reviewed and saved.").waitFor();
    const call = await f.page.evaluate(() => window.__factory.calls.find(row => row.name === "saveFactoryVehicleLoadAction"));
    assert.equal(call.input.bundles.length, 1);
    assert.equal(call.input.bundles[0].id, id(41));
    assert.equal(call.input.vehicle_fingerprint, vehicle.fingerprint);
    assert.deepEqual(f.errors, []);
    assert.deepEqual(f.network, []);
  } finally { await f.close(); }
});

test("37: order forecast labels the proposal separately from the customer promise", async () => {
  const f = await createFactoryPlanningBrowser({ component: "FactoryDeliveryForecast", props: { orders: [{ id: id(80), order_number: "SO-80", customer_name: "Customer 80" }] }, results: {
    getFactoryDeliveryProposalAction: { success: true, data: {
      orderNumber: "SO-80", proposalDate: "2026-11-04", eligibleStockKg: 80, remainingDispatchKg: 120, productionCapacityKg: 120,
      capacityExplanation: "Press shifts were checked.", assumptions: ["Operational forecast; customer promise unchanged."], missing: ["No finishing lead time is configured."]
    } }
  } });
  try {
    await f.reset();
    await f.page.getByRole("button", { name: "Build forecast" }).click();
    await f.page.getByText("Forecast for SO-80",{exact:true}).waitFor();
    await f.page.getByText("2026-11-04", { exact: true }).waitFor();
    await f.page.getByText(/does not change or approve the customer promise date/).waitFor();
    const call = await f.page.evaluate(() => window.__factory.calls.find(row => row.name === "getFactoryDeliveryProposalAction"));
    assert.equal(call.input, id(80));
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('30: an ineligible saved bundle remains reachable for selective release while another order stays assigned',async()=>{
  const a=bundle(41,51,'Gate A'),b=bundle(42,52,'Site B');
  const saved={id:id(90),vehicle_id:vehicle.id,registration_number:vehicle.registration_number,vehicle_label:vehicle.vehicle_label,
    load_date:'2026-10-20',status:'reviewed',capacity_kg:25,total_weight_kg:19.2,item_count:2,version:1,
    items:[a,b].map(x=>({...x,status:'active',updated_fingerprint:x.fingerprint}))};
  const next={...saved,total_weight_kg:9.6,item_count:1,version:2,items:[{...b,status:'active',updated_fingerprint:b.fingerprint}]};
  const f=await createFactoryPlanningBrowser({component:'VehicleLoads',props:{initialSnapshot:{...vehicleSnapshot,vehicles:[],bundles:[],current_load:saved},initialError:null,canConfigure:true},
    results:{releaseFactoryVehicleLoadBundlesAction:{success:true,load:next,replayed:false},getFactoryVehicleLoadSnapshotAction:{success:true,data:{...vehicleSnapshot,vehicles:[],bundles:[],current_load:next}}}});
  try{await f.reset();await f.page.getByLabel('Reason for releasing a saved bundle').fill('A bundle is held after its physical source changed.');
    await f.page.getByRole('button',{name:'Release saved bundle BUNDLE-41',exact:true}).click();
    await f.page.getByRole('button',{name:'Release saved bundle BUNDLE-42',exact:true}).waitFor();
    assert.equal(await f.page.getByRole('button',{name:'Release saved bundle BUNDLE-41',exact:true}).count(),0);
    const call=await f.page.evaluate(()=>window.__factory.calls.find(x=>x.name==='releaseFactoryVehicleLoadBundlesAction'));
    assert.deepEqual(call.input.bundle_ids,[a.id]);assert.equal(call.input.expected_version,1);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

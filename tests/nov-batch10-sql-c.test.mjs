import test from "node:test";
import assert from "node:assert/strict";
import { createNov10Fixture, nids as i, day } from "../scripts/lib/nov-batch10-fixture.mjs";
import { specialistOutcomeSchema, specialistDetailSchema } from "../lib/workflow/specialist.ts";

let f;
test.before(async () => { f = await createNov10Fixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });

const note = "Reviewed with the responsible department";
const confirmed = result => { specialistOutcomeSchema.parse(result); assert.equal(result.state, "confirmed", JSON.stringify(result.result)); return result; };
const row = async (view, id, actor = i.owner) => specialistDetailSchema.parse(await f.command("detail", { view, id }, actor)).row;
const list = (view, actor = i.owner, patch = {}) => f.command("list", { view, state: "all", ...patch }, actor);
const one = async (sql, params = []) => (await f.db.query(sql, params)).rows[0];
const n = value => Number(value);
const idOf = result => result.result.href.split("/").pop();
const batch = id => one("select status,location,qc_status from profile_stock_batches where id=$1", [id]);

// NOV-067 ---------------------------------------------------------------------------------------
const requestTransfer = (ids = [i.stock1, i.stock2, i.stockHold], actor = i.inventory) => f.apply({ action: "transfer.request", to_location_id: i.locWarehouse, batch_ids: ids, planned_date: day(1), note }, actor);

test("NOV-067: issued bundles are in transit at neither end; receipt and dispositions reconcile every bundle", async () => {
  const preview = await f.prepare({ action: "transfer.request", to_location_id: i.locWarehouse, batch_ids: [i.stock1, i.stock2, i.stockHold], planned_date: day(1), note }, i.inventory);
  assert.match(preview.review.warnings.join(" "), /S-HOLD is on QC on hold\. It moves with that status/);
  const id = idOf(confirmed(await f.commit(preview, i.inventory)));
  assert.equal((await batch(i.stock1)).status, "available", "a request does not move stock");
  await assert.rejects(() => requestTransfer([i.stock1]), /already on another open transfer/);
  await assert.rejects(() => f.prepare({ action: "transfer.receive", id, bundle_label: "S1" }, i.inventory), /Only an issued transfer/);
  confirmed(await f.apply({ action: "transfer.issue", id, transport_ref: "MH12 AB 1234 / LR 55", gate_ref: "GP-77", note }, i.inventory));
  await assert.rejects(() => f.prepare({ action: "transfer.issue", id, transport_ref: "again", note }, i.inventory), /Only a requested transfer/);
  assert.deepEqual(await batch(i.stock1), { status: "in_transit", location: "In transit · " + (await row("transfers", id)).details.transfer_number, qc_status: "released" });
  assert.equal((await f.command("lookup", { kind: "stock_batches", search: "S1" }, i.inventory)).some(x => x.value === i.stock1), false, "in-transit stock is not offered as free stock");
  await assert.rejects(() => f.prepare({ action: "transfer.cancel", id, note }, i.inventory), /Material has left the source/);
  // A bundle that is not on the transfer cannot be received against it.
  await assert.rejects(() => f.prepare({ action: "transfer.receive", id, bundle_label: "S3" }, i.inventory), /S3 is not on this transfer/);
  confirmed(await f.apply({ action: "transfer.receive", id, bundle_label: "s1", condition_note: "Wrapping intact" }, i.inventory));
  assert.deepEqual(await batch(i.stock1), { status: "available", location: "Bhiwandi warehouse", qc_status: "released" });
  assert.equal((await row("transfers", id)).status, "partially_received");
  await assert.rejects(() => f.prepare({ action: "transfer.receive", id, bundle_label: "S1" }, i.inventory), /already resolved on this transfer \(received\)/);
  const hold = await f.prepare({ action: "transfer.receive", id, bundle_label: "S-HOLD" }, i.inventory);
  assert.match(hold.review.warnings.join(" "), /stays on QC on hold at the destination/);
  confirmed(await f.commit(hold, i.inventory));
  assert.equal((await batch(i.stockHold)).qc_status, "on_hold", "receipt never clears a QC hold");
  // The issuer cannot approve the loss of material they issued; another person can.
  const lines = (await row("transfers", id)).details.lines;
  const s2 = lines.find(l => l.bundle_label === "S2");
  await assert.rejects(() => f.prepare({ action: "transfer.dispose", line_id: s2.id, disposition: "lost", note }, i.inventory), /cannot also approve/);
  await assert.rejects(() => f.prepare({ action: "transfer.close", id, note }, i.factory), /every bundle is received or dispositioned/);
  confirmed(await f.apply({ action: "transfer.dispose", line_id: s2.id, disposition: "lost", note }, i.factory));
  assert.equal((await batch(i.stock2)).status, "scrap");
  assert.equal((await row("transfers", id)).status, "received");
  const close = await f.prepare({ action: "transfer.close", id, note }, i.factory);
  assert.deepEqual([close.review.facts.Issued, close.review.facts.Received, close.review.facts.Lost], [3, 2, 1]);
  confirmed(await f.commit(close, i.factory));
  assert.equal((await row("transfers", id)).status, "closed");
});

test("NOV-067: reserved, foreign and repeated bundles, cancellation before issue and returns to source", async () => {
  await assert.rejects(() => requestTransfer([i.stockReserved]), /S-RES is reserved for an order/);
  await assert.rejects(() => requestTransfer([i.stock1, i.stock1]), /listed twice/);
  await assert.rejects(() => f.prepare({ action: "transfer.request", to_location_id: i.locFactory, batch_ids: [i.stock1], planned_date: day(1), note }, i.inventory), /already at Rack 4/);
  await assert.rejects(() => requestTransfer([i.stock1], i.dispatch), /Not permitted/);
  const cancel = idOf(confirmed(await requestTransfer([i.stock3])));
  confirmed(await f.apply({ action: "transfer.cancel", id: cancel, note }, i.inventory));
  assert.equal((await batch(i.stock3)).status, "available");
  const id = idOf(confirmed(await requestTransfer([i.stock3])));
  // Competing work: the bundle is reserved for an order between request and issue.
  await f.db.query("update profile_stock_batches set reserved_for_order_id=$2 where id=$1", [i.stock3, i.order]);
  await assert.rejects(() => f.prepare({ action: "transfer.issue", id, transport_ref: "Van 4", note }, i.inventory), /no longer available/);
  await f.db.query("update profile_stock_batches set reserved_for_order_id=null where id=$1", [i.stock3]);
  confirmed(await f.apply({ action: "transfer.issue", id, transport_ref: "Van 4", note }, i.inventory));
  const line = (await row("transfers", id)).details.lines[0];
  confirmed(await f.apply({ action: "transfer.dispose", line_id: line.id, disposition: "returned_to_source", note }, i.factory));
  assert.deepEqual(await batch(i.stock3), { status: "available", location: "Rack 4", qc_status: "released" });
  await assert.rejects(() => f.prepare({ action: "transfer.dispose", line_id: line.id, disposition: "damaged", note }, i.factory), /still in transit/);
});

// NOV-072 ---------------------------------------------------------------------------------------
const recipe = async (patch = {}) => {
  const id = idOf(confirmed(await f.apply({ action: "recipe.define", recipe_code: "age_6063", name: "6063 ageing to T6", process: "artificial_ageing", alloys: ["6063"], target_temper: "T6", temp_min_c: 175, temp_max_c: 185,
    soak_min_minutes: 1, soak_max_minutes: 480, min_readings: 2, note, ...patch }, i.quality)));
  confirmed(await f.apply({ action: "recipe.approve", id, note }, i.admin)); return id;
};
const load = (recipeId, inputs = [{ job_id: i.job2, kg: 250 }, { job_id: i.job3, kg: 300 }], machine = i.oven) => f.apply({ action: "treat.create", recipe_id: recipeId, machine_id: machine, inputs, load_note: "Two racks, profiles vertical" }, i.productionManager);
const observe = (id, temperature_c) => f.apply({ action: "treat.observe", id, temperature_c, instrument_ref: "TC-04 (cal. due 30 Jan)" }, i.production);

test("NOV-072: compatible inputs only, actual readings, deviations need explicit acceptance, partial release and retreatment", async () => {
  const draft = idOf(confirmed(await f.apply({ action: "recipe.define", recipe_code: "age_6063", name: "6063 ageing to T6", process: "artificial_ageing", alloys: ["6063"], target_temper: "T6", temp_min_c: 175, temp_max_c: 185,
    soak_min_minutes: 1, soak_max_minutes: 480, min_readings: 2, note }, i.quality)));
  await assert.rejects(() => f.prepare({ action: "recipe.approve", id: draft, note }, i.quality), /cannot approve it/);
  await assert.rejects(() => load(draft), /approved recipe revision/);
  confirmed(await f.apply({ action: "recipe.approve", id: draft, note }, i.owner));
  await assert.rejects(() => load(draft, [{ job_id: i.job2, kg: 100 }, { job_id: i.jobAlloy, kg: 100 }]), /alloy 6061; recipe age_6063 allows 6063/);
  await assert.rejects(() => load(draft, [{ job_id: i.job1, kg: 100 }]), /planned and has no extruded output/);
  await assert.rejects(() => load(draft, [{ job_id: i.job2, kg: 401 }]), /Only 400 kg of job J-NOV5-2/);
  await assert.rejects(() => load(draft, undefined, i.ovenDown), /oven is not available \(maintenance\)/);
  const id = idOf(confirmed(await load(draft)));
  await assert.rejects(() => load(draft, [{ job_id: i.job2, kg: 151 }]), /Only 150 kg of job/);
  await assert.rejects(() => observe(id, 180), /while the cycle is running/);
  confirmed(await f.apply({ action: "treat.start", id }, i.production));
  confirmed(await observe(id, 179.5));
  const hot = await f.prepare({ action: "treat.observe", id, temperature_c: 192, instrument_ref: "TC-04" }, i.production);
  assert.match(hot.review.warnings.join(" "), /192 °C is outside the recipe range 175 to 185 °C\. It is recorded as read/);
  confirmed(await f.commit(hot, i.production));
  confirmed(await f.apply({ action: "treat.end", id, interrupted: false, note }, i.production));
  const inputs = (await row("treatment", id)).details.inputs;
  const outcome = (accepted, rejected_, retreat, index) => ({ input_id: inputs[index].id, accepted_kg: accepted, rejected_kg: rejected_, retreat_kg: retreat });
  await assert.rejects(() => f.prepare({ action: "treat.review", id, outcomes: [outcome(250, 0, 0, 0), outcome(300, 0, 0, 1)], accept_deviation: false, note }, i.productionManager), /Not permitted/);
  await assert.rejects(() => f.prepare({ action: "treat.review", id, outcomes: [outcome(250, 0, 0, 0)], accept_deviation: false, note }, i.quality), /one outcome for each of the 2/);
  await assert.rejects(() => f.prepare({ action: "treat.review", id, outcomes: [outcome(200, 0, 0, 0), outcome(300, 0, 0, 1)], accept_deviation: false, note }, i.quality), /must add up to the 250 kg/);
  await assert.rejects(() => f.prepare({ action: "treat.review", id, outcomes: [outcome(250, 0, 0, 0), outcome(300, 0, 0, 1)], accept_deviation: false, note }, i.quality), /needs an explicit deviation acceptance/);
  const review = await f.prepare({ action: "treat.review", id, outcomes: [outcome(250, 0, 0, 0), outcome(100, 50, 150, 1)], accept_deviation: true, note }, i.quality);
  assert.equal(review.review.facts.Result, "partially released");
  assert.match(review.review.warnings.join(" "), /retreatment batch of 150 kg is loaded/);
  const done = confirmed(await f.commit(review, i.quality));
  assert.match(done.result.message, /Retreatment batch HT-/);
  const reviewed = await row("treatment", id);
  assert.equal(reviewed.status, "partially_released"); assert.equal(reviewed.details.review.accept_deviation, true);
  const retreat = await one("select b.id,b.status,b.retreatment_of,ti.quantity_kg,ti.production_job_id from treatment_batches b join treatment_inputs ti on ti.batch_id=b.id where b.retreatment_of=$1", [id]);
  assert.deepEqual([retreat.status, retreat.retreatment_of, n(retreat.quantity_kg), retreat.production_job_id], ["loaded", id, 150, i.job3]);
  assert.equal(n((await one("select count(*) c from treatment_observations where batch_id=$1", [id])).c), 2, "readings are kept");
});

test("NOV-072: missing readings, interrupted cycles, equipment withdrawal and recipe revisions", async () => {
  const r1 = await recipe({ min_readings: 3 });
  const id = idOf(confirmed(await load(r1, [{ job_id: i.job2, kg: 100 }])));
  // The oven is withdrawn before the start.
  await f.seed("update machines set status='breakdown' where id=$1", [i.oven]);
  await assert.rejects(() => f.prepare({ action: "treat.start", id }, i.production), /withdrawn from service/);
  await f.seed("update machines set status='active' where id=$1", [i.oven]);
  confirmed(await f.apply({ action: "treat.start", id }, i.production));
  confirmed(await observe(id, 180));
  const end = await f.prepare({ action: "treat.end", id, interrupted: true, note }, i.production);
  assert.match(end.review.warnings.join(" "), /Only 1 of 3 required readings/);
  confirmed(await f.commit(end, i.production));
  assert.equal((await row("treatment", id)).status, "interrupted");
  const input = (await row("treatment", id)).details.inputs[0].id;
  await assert.rejects(() => f.prepare({ action: "treat.review", id, outcomes: [{ input_id: input, accepted_kg: 100, rejected_kg: 0, retreat_kg: 0 }], accept_deviation: true, note }, i.quality), /1 of 3 required readings/);
  await assert.rejects(() => f.prepare({ action: "treat.review", id, outcomes: [{ input_id: input, accepted_kg: 0, rejected_kg: 100, retreat_kg: 0 }], accept_deviation: true, note }, i.quality), /only when material is accepted/);
  confirmed(await f.apply({ action: "treat.review", id, outcomes: [{ input_id: input, accepted_kg: 0, rejected_kg: 100, retreat_kg: 0 }], accept_deviation: false, note }, i.quality));
  assert.equal((await row("treatment", id)).status, "rejected");
  // A new revision supersedes the old; a batch loaded earlier keeps its revision.
  const rev = idOf(confirmed(await f.apply({ action: "recipe.define", recipe_code: "age_6063", name: "6063 ageing to T6 (revised)", process: "artificial_ageing", alloys: ["6063", "6060"], target_temper: "T6", temp_min_c: 170, temp_max_c: 185,
    soak_min_minutes: 1, soak_max_minutes: 480, min_readings: 2, note }, i.quality)));
  confirmed(await f.apply({ action: "recipe.approve", id: rev, note }, i.owner));
  assert.equal((await row("treatment", r1)).status, "superseded");
  assert.equal((await row("treatment", id)).details.recipe_id, r1);
  await assert.rejects(() => f.prepare({ action: "recipe.define", recipe_code: "bad_temp", name: "Bad", process: "artificial_ageing", alloys: ["6063"], target_temper: "T6", temp_min_c: 185, temp_max_c: 175, soak_min_minutes: 1, soak_max_minutes: 2, min_readings: 1, note }, i.quality), /above the minimum/);
  await assert.rejects(() => f.prepare({ action: "recipe.define", recipe_code: "dup_alloy", name: "Dup", process: "artificial_ageing", alloys: ["6063", " 6063"], target_temper: "T6", temp_min_c: 170, temp_max_c: 175, soak_min_minutes: 1, soak_max_minutes: 2, min_readings: 1, note }, i.quality), /listed twice/);
});

// NOV-032 ---------------------------------------------------------------------------------------
const tollAgreement = async (patch = {}) => {
  const id = idOf(confirmed(await f.apply({ action: "toll.define", customer_id: i.customer3, material_spec: "Customer 6063 billet, 7 inch", alloy: "6063", permitted_mixing: false, allowed_loss_percent: 2, conversion_rate_per_kg: 42,
    billing_basis: "output_kg", note, ...patch }, i.accounts)));
  confirmed(await f.apply({ action: "toll.approve", id, note }, i.owner)); return id;
};
const receive = (kg, challan, patch = {}) => f.apply({ action: "toll.receive", customer_id: i.customer3, received_kg: kg, challan_ref: challan, location: "Customer metal bay", heat_ref: "HT-991", note, ...patch }, i.inventory);
const move = (kind, quantity, patch = {}) => f.apply({ action: "toll.move", customer_id: i.customer3, kind, quantity_kg: quantity, note, ...patch }, i.inventory);
const receiptOf = async challan => (await one("select id from toll_receipts where challan_ref=$1", [challan])).id;

test("NOV-032: customer metal is a separate account; ownership, allowances and differences are enforced", async () => {
  await assert.rejects(() => receive(1000, "CH-1"), /no approved job-work agreement/);
  await tollAgreement();
  const rec = await f.prepare({ action: "toll.receive", customer_id: i.customer3, received_kg: 1000, challan_ref: "CH-1", location: "Customer metal bay", note }, i.inventory);
  assert.match(rec.review.warnings.join(" "), /never added to company billet stock/);
  confirmed(await f.commit(rec, i.inventory));
  const billetsBefore = n((await one("select count(*) c from billet_batches")).c);
  await assert.rejects(() => receive(10, "ch-1"), /already received/);
  const r1 = await receiptOf("CH-1");
  await assert.rejects(() => move("issue", 100, { receipt_id: r1, production_job_id: i.jobToll }), /has not inspected/);
  await assert.rejects(() => f.prepare({ action: "toll.inspect", receipt_id: r1, decision: "accepted", note }, i.inventory), /Not permitted/);
  confirmed(await f.apply({ action: "toll.inspect", receipt_id: r1, decision: "accepted", note }, i.quality));
  // Never another customer's job, even with the same alloy; no mixing unless the agreement authorises it.
  await assert.rejects(() => move("issue", 100, { receipt_id: r1, production_job_id: i.job1 }), /another customer's order\. Never use one customer's material/);
  await assert.rejects(() => move("issue", 100, { receipt_id: r1, production_job_id: i.jobTollMix }), /does not authorise mixing/);
  await assert.rejects(() => move("issue", 1000.001, { receipt_id: r1, production_job_id: i.jobToll }), /Only 1000 kg of receipt/);
  confirmed(await move("issue", 800, { receipt_id: r1, production_job_id: i.jobToll }));
  await assert.rejects(() => move("output", 801, { production_job_id: i.jobToll }), /Only 800 kg issued/);
  confirmed(await move("output", 760, { production_job_id: i.jobToll }));
  confirmed(await move("scrap", 20, { production_job_id: i.jobToll }));
  // The agreed allowance is 2% of 800 = 16 kg; beyond it the difference stays unexplained.
  await assert.rejects(() => move("explained_loss", 17, { production_job_id: i.jobToll }), /allowance for job J-NOV10-TOLL is 16 kg/);
  confirmed(await move("explained_loss", 12, { production_job_id: i.jobToll }));
  await f.seed("update production_jobs set status='completed' where id=$1", [i.jobToll]);
  const account = await row("tolling", i.customer3, i.accounts);
  assert.equal(account.status, "unexplained_difference");
  assert.deepEqual(["usable_kg", "issued_kg", "output_kg", "scrap_kg", "explained_loss_kg", "unexplained_kg", "scrap_on_hand_kg"].map(k => n(account.details.totals[k])), [200, 800, 760, 20, 12, 8, 20]);
  await assert.rejects(() => move("return_scrap", 21), /Only 20 kg of this customer's scrap/);
  confirmed(await move("return_scrap", 20));
  confirmed(await move("return_metal", 150, { receipt_id: r1 }));
  // The statement keeps the difference, applies the agreement revision and drafts the conversion charge.
  const st = await f.prepare({ action: "toll.statement", customer_id: i.customer3, note }, i.accounts);
  assert.match(st.review.warnings.join(" "), /8 kg of completed jobs is unexplained/);
  assert.equal(st.review.facts["Conversion charge draft"], "INR 31,920.00");
  confirmed(await f.commit(st, i.accounts));
  const statement = (await row("tolling", i.customer3, i.accounts)).details.statements[0];
  const settle = await f.prepare({ action: "toll.settle", statement_id: statement.id, decision: "agree", note }, i.accounts);
  assert.match(settle.review.warnings.join(" "), /agree an unexplained difference of 8 kg/);
  confirmed(await f.commit(settle, i.accounts));
  assert.equal(n((await one("select count(*) c from billet_batches")).c), billetsBefore, "company billet stock is untouched");
  // The next statement only charges output recorded after the agreed one.
  const next = await f.prepare({ action: "toll.statement", customer_id: i.customer3, note }, i.accounts);
  assert.equal(next.review.facts["Conversion charge draft"], "INR 0.00");
});

test("NOV-032: rejected receipts, reversals, disputes and authorised mixing", async () => {
  await tollAgreement({ permitted_mixing: true, allowed_loss_percent: undefined });
  confirmed(await receive(500, "CH-R"));
  const bad = await receiptOf("CH-R");
  confirmed(await f.apply({ action: "toll.inspect", receipt_id: bad, decision: "rejected", note }, i.quality));
  await assert.rejects(() => move("issue", 10, { receipt_id: bad, production_job_id: i.jobToll }), /Rejected material can only be returned/);
  confirmed(await move("return_metal", 500, { receipt_id: bad }));
  confirmed(await receive(600, "CH-G"));
  const good = await receiptOf("CH-G");
  confirmed(await f.apply({ action: "toll.inspect", receipt_id: good, decision: "accepted", note }, i.quality));
  const mix = await f.prepare({ action: "toll.move", customer_id: i.customer3, kind: "issue", quantity_kg: 300, receipt_id: good, production_job_id: i.jobTollMix, note }, i.inventory);
  assert.match(mix.review.warnings.join(" "), /authorises mixing/);
  confirmed(await f.commit(mix, i.inventory));
  await assert.rejects(() => move("explained_loss", 1, { production_job_id: i.jobTollMix }), /No loss allowance is agreed/);
  confirmed(await move("output", 250, { production_job_id: i.jobTollMix }));
  const issue = (await row("tolling", i.customer3, i.accounts)).details.movements.find(m => m.kind === "issue");
  await assert.rejects(() => f.prepare({ action: "toll.reverse", movement_id: issue.id, note }, i.inventory), /Reverse those first/);
  const output = (await row("tolling", i.customer3, i.accounts)).details.movements.find(m => m.kind === "output");
  confirmed(await f.apply({ action: "toll.reverse", movement_id: output.id, note }, i.inventory));
  confirmed(await f.apply({ action: "toll.reverse", movement_id: issue.id, note }, i.inventory));
  assert.equal(n((await row("tolling", i.customer3, i.accounts)).details.totals.usable_kg), 600);
  const st = idOf(confirmed(await f.apply({ action: "toll.statement", customer_id: i.customer3, note }, i.accounts)));
  const statement = (await row("tolling", st, i.accounts)).details.statements[0];
  confirmed(await f.apply({ action: "toll.settle", statement_id: statement.id, decision: "dispute", note }, i.accounts));
  assert.equal((await row("tolling", i.customer3, i.accounts)).status, "disputed");
  confirmed(await f.apply({ action: "toll.statement", customer_id: i.customer3, note }, i.accounts));
  await assert.rejects(() => f.prepare({ action: "toll.settle", statement_id: statement.id, decision: "agree", note }, i.accounts), /Only a draft or disputed statement|newer statement/);
  await assert.rejects(() => f.command("detail", { view: "tolling", id: i.customer3 }, i.sales), /Not permitted/);
});

// NOV-074 ---------------------------------------------------------------------------------------
const open = (patch = {}, actor = i.dispatch) => f.apply({ action: "weigh.open", movement_kind: "dispatch", dispatch_id: i.dispatch3, vehicle_registration: "mh12-1000", vehicle_id: i.vehicle1,
  instrument_ref: "WB-1 (60 t, 10 kg division)", calibration_valid_until: day(30), tolerance_kg: 20, note, ...patch }, actor);
const at = minutesAgo => new Date(Date.now() - minutesAgo * 60000).toISOString();
const read = (id, kind, weight_value, minutesAgo, patch = {}, actor = i.dispatch) => f.apply({ action: "weigh.read", id, kind, weight_value, unit: "kg", read_at: at(minutesAgo), source: "manual", stable: true,
  vehicle_registration_read: "MH 12 1000", ...patch }, actor);
const readingId = async (session, kg) => (await one("select id from weighing_readings where session_id=$1 and weight_kg=$2", [session, kg])).id;

test("NOV-074: readings are immutable, paired explicitly and reconciled within tolerance", async () => {
  const id = idOf(confirmed(await open()));
  await assert.rejects(() => open(), /already covers this movement/);
  confirmed(await read(id, "tare", 4.2, 60, { unit: "t" }));
  await assert.rejects(() => read(id, "gross", 4900, 5, { vehicle_registration_read: "MH14 2222" }), /for vehicle MH142222, not MH121000/);
  await assert.rejects(() => read(id, "gross", 4900, -30), /in the future/);
  await assert.rejects(() => read(id, "gross", 4900, 60 * 49), /more than 48 hours old/);
  await assert.rejects(() => f.prepare({ action: "weigh.read", id, kind: "gross", weight_value: 4900, unit: "lb", read_at: at(5), source: "manual", stable: true, vehicle_registration_read: "MH121000" }, i.dispatch), /Use kg or t/);
  confirmed(await read(id, "gross", 4860, 10, { source: "device", provider_ref: "PKT-1001", stable: false }));
  await assert.rejects(() => read(id, "gross", 4860, 9, { source: "device", provider_ref: "PKT-1001" }), /repeated packet/);
  confirmed(await read(id, "gross", 4850, 5, { source: "device", provider_ref: "PKT-1002" }));
  const tare = await readingId(id, 4200), unstable = await readingId(id, 4860), gross = await readingId(id, 4850);
  await assert.rejects(() => f.prepare({ action: "weigh.pair", id, gross_reading_id: unstable, tare_reading_id: tare, note }, i.dispatch), /Only stable readings/);
  await assert.rejects(() => f.prepare({ action: "weigh.pair", id, gross_reading_id: tare, tare_reading_id: gross, note }, i.dispatch), /one gross and one tare/);
  const pair = await f.prepare({ action: "weigh.pair", id, gross_reading_id: gross, tare_reading_id: tare, note }, i.dispatch);
  // Net 650 kg against bundles packed at 654 kg gross: within the 20 kg tolerance.
  assert.deepEqual([pair.review.facts.Net, pair.review.facts.Expected, pair.review.facts.Difference], ["650 kg", "654 kg", "-4 kg"]);
  confirmed(await f.commit(pair, i.dispatch));
  await assert.rejects(() => f.prepare({ action: "weigh.finalize", id, accept_difference: false, note }, i.dispatch), /Not permitted/);
  await assert.rejects(() => f.prepare({ action: "weigh.finalize", id, accept_difference: true, note }, i.dispatchManager), /nothing to accept/);
  const fin = await f.prepare({ action: "weigh.finalize", id, accept_difference: false, note }, i.dispatchManager);
  assert.match(fin.review.warnings.join(" "), /never overwrites measured bundle or receipt weights/);
  const before = (await f.db.query("select gross_weight_kg from packing_list_items where dispatch_id=$1 order by bundle_number", [i.dispatch3])).rows;
  confirmed(await f.commit(fin, i.dispatchManager));
  assert.deepEqual((await f.db.query("select gross_weight_kg from packing_list_items where dispatch_id=$1 order by bundle_number", [i.dispatch3])).rows, before);
  assert.equal((await row("weighing", id)).status, "finalized");
  // A reviewed correction supersedes the session; the first is kept and a new one needs new readings.
  const sup = confirmed(await f.apply({ action: "weigh.supersede", id, note }, i.dispatchManager));
  const fresh = idOf(sup);
  assert.equal((await row("weighing", id)).status, "superseded");
  assert.equal((await row("weighing", fresh)).details.supersedes, (await row("weighing", id)).details.session_number);
  assert.equal(n((await one("select count(*) c from weighing_readings where session_id=$1", [fresh])).c), 0);
});

test("NOV-074: differences beyond tolerance, reversed order, stale tare, expired calibration and receipts", async () => {
  const id = idOf(confirmed(await open({ tolerance_kg: 2 })));
  confirmed(await read(id, "gross", 4850, 70));
  confirmed(await read(id, "tare", 4200, 60));
  const pair = await f.prepare({ action: "weigh.pair", id, gross_reading_id: await readingId(id, 4850), tare_reading_id: await readingId(id, 4200), note }, i.dispatch);
  assert.match(pair.review.warnings.join(" "), /gross reading came before the tare/);
  assert.match(pair.review.warnings.join(" "), /exceeds the tolerance of 2 kg/);
  confirmed(await f.commit(pair, i.dispatch));
  await assert.rejects(() => f.prepare({ action: "weigh.finalize", id, accept_difference: false, note }, i.dispatchManager), /exceeds the tolerance of 2 kg/);
  // The bundles change after pairing: finalising is refused until the vehicle is weighed again.
  await f.seed("update packing_list_items set gross_weight_kg=gross_weight_kg+10 where id=$1", [i.bundleX1]);
  await assert.rejects(() => f.prepare({ action: "weigh.finalize", id, accept_difference: true, note }, i.dispatchManager), /changed after pairing/);
  await f.seed("update packing_list_items set gross_weight_kg=gross_weight_kg-10 where id=$1", [i.bundleX1]);
  confirmed(await f.apply({ action: "weigh.finalize", id, accept_difference: true, note }, i.dispatchManager));
  assert.equal((await row("weighing", id)).details.accepted_difference, true);
  // A purchase receipt reconciles with kilogram lines only; expired calibration blocks finalising.
  const rec = idOf(confirmed(await open({ movement_kind: "purchase_receipt", dispatch_id: undefined, purchase_receipt_id: i.receipt, vehicle_id: undefined, vehicle_registration: "GJ05XY9999", calibration_valid_until: day(-1) }, i.inventory)));
  confirmed(await read(rec, "gross", 9200, 50, { vehicle_registration_read: "GJ05 XY 9999" }, i.inventory));
  confirmed(await read(rec, "tare", 8200, 30, { vehicle_registration_read: "GJ05XY9999" }, i.inventory));
  const recPair = await f.prepare({ action: "weigh.pair", id: rec, gross_reading_id: await readingId(rec, 9200), tare_reading_id: await readingId(rec, 8200), note }, i.inventory);
  assert.deepEqual([recPair.review.facts.Net, recPair.review.facts.Expected, recPair.review.facts.Difference], ["1000 kg", "1000 kg", "0 kg"]);
  confirmed(await f.commit(recPair, i.inventory));
  await assert.rejects(() => f.prepare({ action: "weigh.finalize", id: rec, accept_difference: false, note }, i.inventory), /calibration evidence expired/);
  // A tare more than a day from the gross is not reused; zero or negative net is refused.
  const late = idOf(confirmed(await open({ dispatch_id: i.dispatch4, vehicle_id: undefined, vehicle_registration: "MH12CD7777" })));
  confirmed(await read(late, "tare", 4200, 60 * 30, { vehicle_registration_read: "MH12CD7777" }));
  confirmed(await read(late, "gross", 4100, 5, { vehicle_registration_read: "MH12CD7777" }));
  confirmed(await read(late, "tare", 4150, 4, { vehicle_registration_read: "MH12CD7777" }));
  await assert.rejects(async () => f.prepare({ action: "weigh.pair", id: late, gross_reading_id: await readingId(late, 4100), tare_reading_id: await readingId(late, 4200), note }, i.dispatch), /more than 24 hours apart/);
  await assert.rejects(async () => f.prepare({ action: "weigh.pair", id: late, gross_reading_id: await readingId(late, 4100), tare_reading_id: await readingId(late, 4150), note }, i.dispatch), /net weight would be -50 kg/);
  confirmed(await f.apply({ action: "weigh.cancel", id: late, note }, i.dispatch));
  // A session left open for more than a day is surfaced as interrupted, first in the list.
  const stale = idOf(confirmed(await open({ dispatch_id: i.dispatch4, vehicle_id: undefined, vehicle_registration: "MH12CD7777" })));
  await f.db.query("update weighing_sessions set opened_at=now()-interval '30 hours' where id=$1", [stale]);
  const active = await list("weighing", i.dispatch, { state: "active" });
  assert.deepEqual([active.rows[0].id, active.rows[0].status], [stale, "interrupted"]);
});

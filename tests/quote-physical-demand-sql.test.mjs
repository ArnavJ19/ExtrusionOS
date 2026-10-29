import test from "node:test";
import assert from "node:assert/strict";
import { createCommercialFixture, cid } from "../scripts/lib/commercial-upgrade-fixture.mjs";
let fixture;
test.before(async () => { fixture = await createCommercialFixture(); });
test.after(async () => fixture?.close());
async function acceptedQuote(overrides = {}, dealerId = null) {
  await fixture.actor(); const quote = await fixture.newQuote({ quantity_pieces: 100, minimum_billing_weight_kg: 700, expected_recovery_percent: 75, ...overrides });
  if (dealerId) await fixture.db.query("update quotes set dealer_id=$2 where id=$1", [quote, dealerId]);
  for (const status of ["internal_review", "approved_for_sending", "sent", "customer_approved"]) await fixture.db.query("update quotes set status=$2,approved_by=$3,approved_at=now() where id=$1", [quote, status, fixture.ids.owner]);
  return quote;
}
async function convert(quote, request) {
  const review = await fixture.command("commercial_review_command", "quote.review", { quote_id: quote });
  return fixture.command("commercial_review_command", "quote.convert", { quote_id: quote, fingerprint: review.fingerprint, request_id: cid(request) });
}
test("89: accepted 480 physical kg / 700 billing kg becomes 480 manufacturing kg with the same commercial total", async () => {
  const quote = await acceptedQuote(); const source = (await fixture.db.query("select grand_total from quotes where id=$1", [quote])).rows[0];
  const converted = await convert(quote, 9901);
  const order = (await fixture.db.query("select * from orders where id=$1", [converted.order_id])).rows[0];
  assert.equal(Number(order.manufacturing_weight_kg), 480); assert.equal(Number(order.requested_weight_kg), 480);
  assert.equal(order.quote_physical_planning_version, 1); assert.equal(order.order_value, source.grand_total);
  const lines = (await fixture.db.query("select quantity_kg,manufacturing_weight_kg from order_items where order_id=$1", [order.id])).rows;
  assert.equal(Number(lines[0].quantity_kg), 480); assert.equal(Number(lines[0].manufacturing_weight_kg), 480);
  const requirements = (await fixture.db.query("select required_weight_kg from order_billet_requirements where order_id=$1", [order.id])).rows;
  assert.equal(requirements.reduce((sum,line) => sum + Number(line.required_weight_kg), 0), 480);
  const snapshot = (await fixture.db.query("select line_snapshots from order_quote_snapshots where order_id=$1", [order.id])).rows[0];
  assert.equal(Number(snapshot.line_snapshots[0].billing_weight_kg), 700);
  assert.equal((await fixture.db.query("select status from factory_load_consolidations where order_id=$1", [order.id])).rows[0].status, "pending");
});
test("89: the same demand is enforced through a sales-role conversion and exact replay", async () => {
  const quote = await acceptedQuote(); await fixture.actor(fixture.ids.sales);
  await fixture.db.exec("set role authenticated");
  let first, again;
  try {
    const review = await fixture.command("commercial_review_command", "quote.review", { quote_id: quote });
    const payload = { quote_id: quote, fingerprint: review.fingerprint, request_id: cid(9902) };
    first = await fixture.command("commercial_review_command", "quote.convert", payload);
    again = await fixture.command("commercial_review_command", "quote.convert", payload);
  } finally { await fixture.db.exec("reset role"); }
  assert.equal(first.order_id, again.order_id);
  assert.equal(Number((await fixture.db.query("select manufacturing_weight_kg from orders where id=$1", [first.order_id])).rows[0].manufacturing_weight_kg), 480);
  await fixture.actor();
});
test("89: legacy requirement rebuild retains its recorded planning basis", async () => {
  const quote = await acceptedQuote(); const converted = await convert(quote, 9903);
  await fixture.db.query("update orders set quote_physical_planning_version=0,requested_weight_kg=700,manufacturing_weight_kg=700 where id=$1", [converted.order_id]);
  await fixture.db.query("update order_items set quantity_kg=700,manufacturing_weight_kg=700 where order_id=$1", [converted.order_id]);
  await fixture.db.query("select rebuild_order_billet_requirements($1)", [converted.order_id]);
  assert.equal(Number((await fixture.db.query("select sum(required_weight_kg) kg from order_billet_requirements where order_id=$1", [converted.order_id])).rows[0].kg), 700);
  assert.equal(Number((await fixture.db.query("select quantity_kg from order_items where order_id=$1", [converted.order_id])).rows[0].quantity_kg), 700);
});
test("89: missing and nonfinite physical observations fail closed; private planning helpers have no client grant", async () => {
  for (const weight of [null, 0, -1, "NaN", "Infinity"]) await assert.rejects(fixture.db.query("select private.require_quote_physical_weight($1)", [weight]), /physical profile weight/);
  for (const signature of ["private.require_quote_physical_weight(numeric)", "private.quote_requirement_weight(uuid,uuid,numeric,numeric)", "private.quote_billet_summary_update_valid(public.orders,public.orders)"]) {
    const acl = (await fixture.db.query("select has_function_privilege('authenticated',$1,'EXECUTE') client,has_function_privilege('anon',$1,'EXECUTE') anonymous", [signature])).rows[0];
    assert.equal(acl.client, false); assert.equal(acl.anonymous, false);
    const catalog = (await fixture.db.query("select prosecdef,proconfig from pg_proc where oid=$1::regprocedure", [signature])).rows[0];
    assert.equal(catalog.prosecdef, false); assert.ok(catalog.proconfig.some(value => value.startsWith("search_path=")));
  }
});
test("89: derived-summary permission cannot change financial fields or invent billet counts", async () => {
  const quote = await acceptedQuote(); const converted = await convert(quote, 9904);
  for (const patch of [{ billets_required: 999999 }, { order_value: 1 }, { current_stage: "closed" }]) {
    const result = (await fixture.db.query("select private.quote_billet_summary_update_valid(jsonb_populate_record(null::public.orders,to_jsonb(o)||$2::jsonb),o) ok from orders o where id=$1", [converted.order_id, patch])).rows[0];
    assert.equal(result.ok, false);
  }
  await fixture.actor(fixture.ids.sales); await fixture.db.exec("set role authenticated");
  try { await assert.rejects(fixture.db.query("update orders set billets_required=999999 where id=$1", [converted.order_id]), /permission denied|authorized order workflow|row-level security/); }
  finally { await fixture.db.exec("reset role"); await fixture.actor(); }
});

test("89: mixed-profile requirements use their own physical weights rather than billing-minimum proportions", async () => {
  await fixture.actor(); const secondProfile = cid(9910);
  await fixture.db.query("insert into aluminium_profiles(id,company_id,profile_code,profile_name,section_weight_kg_per_m,drawing_approval_status,alloy,temper,billet_diameter_required_inch) values($1,$2,'AL-PHYSICAL-2','Second physical section',1.2,'approved','6063','T6',7)", [secondProfile, fixture.ids.company]);
  const line = { length_per_piece_m: 6, billet_rate_per_kg: 250, conversion_charge_per_kg: 30, margin_percent: 20, expected_recovery_percent: 75, finishing_type: "mill_finish", finishing_charge_type: "per_kg", finishing_charge: 0, drawing_approval_status: "Approved", gst_percent: 18 };
  const quote = (await fixture.db.query("select save_quote_atomic(null,$1,$2,null,null,'Physical line split') id", [{ customer_id: fixture.ids.customer, quote_date: "2026-10-29", gst_percent: 18 }, [{ ...line, profile_id: fixture.ids.profile, quantity_pieces: 10, section_weight_kg_per_m: 0.8, minimum_billing_weight_kg: 700 }, { ...line, profile_id: secondProfile, quantity_pieces: 20, section_weight_kg_per_m: 1.2, minimum_billing_weight_kg: 1000 }]])).rows[0].id;
  for (const status of ["internal_review", "approved_for_sending", "sent", "customer_approved"]) await fixture.db.query("update quotes set status=$2,approved_by=$3,approved_at=now() where id=$1", [quote, status, fixture.ids.owner]);
  const result = await convert(quote, 9911);
  const rows = (await fixture.db.query("select profile_id,required_weight_kg from order_billet_requirements where order_id=$1", [result.order_id])).rows;
  assert.equal(Number(rows.find(row => row.profile_id === fixture.ids.profile).required_weight_kg), 48);
  assert.equal(Number(rows.find(row => row.profile_id === secondProfile).required_weight_kg), 144);
});

test("89: dealer availability is capped by physical demand and full stock fulfillment leaves no manufacturing requirement", async () => {
  await fixture.actor(); const dealerId = cid(9920), batchId = cid(9921);
  await fixture.db.query("insert into dealers(id,company_id,dealer_code,dealer_name) values($1,$2,'PHYSICAL-DEALER','Physical stock fixture')", [dealerId, fixture.ids.company]);
  await fixture.db.query("insert into profile_stock_batches(id,company_id,dealer_id,profile_id,finish,piece_length_m,length_m,quantity_pieces,total_weight_kg,status,origin_type,qc_status,alloy,temper) values($1,$2,$3,$4,'mill_finish',6,1200,200,960,'available','legacy_unverified','not_required','6063','T6')", [batchId, fixture.ids.company, dealerId, fixture.ids.profile]);
  const quote = await acceptedQuote({}, dealerId);
  assert.equal(Number((await fixture.db.query("select get_dealer_quote_stock_availability($1) kg", [quote])).rows[0].kg), 480);
  const revision = (await fixture.db.query("select revision_number,updated_at from quotes where id=$1", [quote])).rows[0];
  await fixture.actor(fixture.ids.sales);
  const result = (await fixture.db.query("select create_order_from_quote_with_dealer_workflow_atomic($1,null,'2026-10-29',null,'normal',480,null,'queue',null,$2,$3) id", [quote, revision.revision_number, revision.updated_at])).rows[0];
  const order = (await fixture.db.query("select manufacturing_weight_kg,dealer_fulfilled_weight_kg from orders where id=$1", [result.id])).rows[0];
  assert.equal(Number(order.manufacturing_weight_kg), 0); assert.equal(Number(order.dealer_fulfilled_weight_kg), 480);
  assert.equal(Number((await fixture.db.query("select coalesce(sum(required_weight_kg),0) kg from order_billet_requirements where order_id=$1", [result.id])).rows[0].kg), 0);
  assert.equal(Number((await fixture.db.query("select total_weight_kg from profile_stock_batches where id=$1", [batchId])).rows[0].total_weight_kg), 480);
  await fixture.actor();
});

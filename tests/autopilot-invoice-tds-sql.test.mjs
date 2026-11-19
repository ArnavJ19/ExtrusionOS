import test from "node:test";
import assert from "node:assert/strict";
import { createBatch6Fixture, ids as i, istDay } from "../scripts/lib/autopilot-batch6-fixture.mjs";
import { buildInvoiceItems } from "../lib/pcda/invoice.ts";
import { buildEinvoiceExport } from "../lib/compliance/e-invoice.ts";
import { buildTallyExport } from "../lib/integrations/tally-xml.ts";

let f;
test.before(async () => { f = await createBatch6Fixture(); });
test.after(async () => { await f?.close(); });
test.beforeEach(async () => { await f.start(); });
test.afterEach(async () => { await f.rollback(); });
const einvoice = (command, payload = {}, actor = i.accounts) => f.call("ap_einvoice", command, payload, actor);
const tally = (command, payload = {}, actor = i.accounts) => f.call("ap_tally", command, payload, actor);
const sources = async id => (await einvoice("sources", { invoice_ids: [id] })).invoices;
const applicable = () => einvoice("save_settings", { applicable: true, applicable_from: istDay(-90), reason: "Synthetic accounts applicability confirmation" });
const seller = { legal_name: "Omalco Extrusion Pvt Ltd", gst_number: "07AAACX1234A1ZZ", billing_address: "Plot 7 Industrial Area", city: "Delhi", pincode: "110020" };
const buyer = { company_name: "Sharma Fabricators", gst_number: "27ABCDE1234F1Z0", billing_address: "Gate 3 Chakan MIDC" };
async function legacyInvoice(id = i.inv1, snapshot = buyer) {
  await f.seed("update invoices set issued_at=now(), subtotal=10000, tax_total=1800, grand_total=11800, igst_amount=1800, supplier_snapshot=$2, customer_snapshot=$3 where id=$1", [id, seller, snapshot]);
  await f.seed("insert into invoice_items(company_id,invoice_id,item_description,hsn_code,quantity,unit_rate,line_total,gst_percent,line_kind) values($1,$2,'Sliding track','7604',40,250,10000,18,'goods')", [i.company, id]);
}

test("the production invoice writer freezes buyer city/PIN and its sources build a valid e-invoice without master fallback", async () => {
  await f.seed("update customers set billing_address='Gate 3 Chakan MIDC', city='Pune', pincode='411001' where id=$1", [i.customer2]);
  const o = await f.order({ kg: 114, pieces: 20 });
  await f.seed("update order_items set net_rate=300, hsn_code='7604' where id=$1", [o.line]);
  const job = await f.readyJob({ ...o, kg: 114, pieces: 20 });
  await f.asUser("select public.physical_bundle_command('bundle.record',$1)", [{ id: f.next(), order_id: o.order, source_line_id: job, source_kind: "production",
    bundle_number: "SNAPSHOT-BUNDLE", number_of_pieces: 20, net_length_m: 120, gross_weight_kg: 120, tare_weight_kg: 6 }], i.dispatchUser);
  const session = await f.call("ap_dispatch", "start", { order_id: o.order, vehicle_number: "MH12AB1234" }, i.dispatchUser);
  const scan = await f.call("ap_dispatch", "scan", { session_id: session.id, tag: "SNAPSHOT-BUNDLE" }, i.dispatchUser);
  assert.equal(scan.state, "loaded", JSON.stringify(scan));
  const dispatch = await f.writeDispatch(session.id);
  const lines = (await f.db.query("select * from packing_list_items where dispatch_id=$1", [dispatch])).rows;
  const items = buildInvoiceItems(lines, f.next(), i.company);
  const id = (await f.asUser("select public.save_invoice_atomic(null,$1,$2,true) id", [{ order_id: o.order, dispatch_id: dispatch,
    invoice_date: istDay(), status: "generated", place_of_supply_state_code: "27" }, items], i.accounts))[0].id;
  await f.asUser("select public.save_invoice_atomic($1,$2,$3,true)", [id, { order_id: o.order, dispatch_id: dispatch,
    invoice_date: istDay(), status: "sent", place_of_supply_state_code: "27" }, items], i.accounts);
  await f.immediate(); await applicable();
  const before = await f.one("select customer_snapshot from invoices where id=$1", [id]);
  assert.equal(before.customer_snapshot.city, "Pune"); assert.equal(before.customer_snapshot.pincode, "411001");
  const exportFile = buildEinvoiceExport(await sources(id));
  assert.equal(exportFile.included.length, 1, JSON.stringify(exportFile.skipped));
  assert.deepEqual(exportFile.skipped, []); assert.equal(exportFile.file[0].BuyerDtls.Loc, "Pune"); assert.equal(exportFile.file[0].BuyerDtls.Pin, 411001);
  await f.seed("update customers set city='Mumbai',pincode='400001' where id=$1", [i.customer2]);
  assert.deepEqual((await sources(id))[0].customer, before.customer_snapshot);
  await assert.rejects(() => f.asOwnerFor("update invoices set customer_snapshot=customer_snapshot || '{\"city\":\"Mumbai\"}' where id=$1", [id], i.accounts), /immutable/);
});

test("accounts can confirm only missing historical buyer fields; originals, provenance and tenant boundaries stay intact", async () => {
  await legacyInvoice(); await applicable();
  await f.seed("update customers set city='Mumbai',pincode='400001' where id=$1", [i.customer2]);
  const initial = (await sources(i.inv1))[0];
  const skipped = buildEinvoiceExport([initial]).skipped[0];
  assert.deepEqual(skipped.issues.map(issue => issue.field), ["buyer_city", "buyer_pin"]);
  assert.match(skipped.issues[0].message, /Complete buyer city and PIN/);
  const input = { invoice_id: i.inv1, city: "Pune", pincode: "411001", reason: "Verified original signed invoice INV-0101 page 1" };
  await assert.rejects(() => einvoice("confirm_buyer_address", { ...input, pincode: "000000" }), /six-digit/);
  await assert.rejects(() => einvoice("confirm_buyer_address", input, i.sales), error => error.code === "42501");
  await assert.rejects(() => einvoice("confirm_buyer_address", input, i.foreign), /this company/);
  assert.equal((await einvoice("confirm_buyer_address", input)).saved, true);
  assert.equal((await einvoice("confirm_buyer_address", input)).repeated, true);
  await assert.rejects(() => einvoice("confirm_buyer_address", { ...input, city: "Mumbai" }), /immutable/);
  const built = buildEinvoiceExport(await sources(i.inv1));
  assert.deepEqual(built.skipped, []); assert.equal(built.file[0].BuyerDtls.Pin, 411001);
  assert.deepEqual((await f.one("select customer_snapshot from invoices where id=$1", [i.inv1])).customer_snapshot, buyer);
  const confirmation = (await f.asUser("select * from einvoice_buyer_address_confirmations", [], i.accounts))[0];
  assert.equal(confirmation.confirmed_by, i.accounts); assert.equal(confirmation.reason, input.reason); assert.ok(confirmation.confirmed_at);
  for (const actor of [i.foreign, i.sales]) assert.equal((await f.asUser("select * from einvoice_buyer_address_confirmations", [], actor)).length, 0);
  for (const sql of ["update einvoice_buyer_address_confirmations set city='Mumbai'", "delete from einvoice_buyer_address_confirmations",
    "insert into einvoice_buyer_address_confirmations select * from einvoice_buyer_address_confirmations"]) {
    await assert.rejects(() => f.asUser(sql, [], i.accounts), error => error.code === "42501");
  }
  const queued = (await einvoice("queue")).rows.find(row => row.id === i.inv1);
  assert.equal(queued.buyer_address_confirmed, true); assert.equal(queued.buyer_city, "Pune");
});

test("confirmations cannot replace captured buyer values or change a previously exported invoice", async () => {
  await legacyInvoice(i.inv1, { ...buyer, city: "Pune" }); await legacyInvoice(i.inv2); await applicable();
  const input = { invoice_id: i.inv1, city: "Mumbai", pincode: "411001", reason: "Original issued invoice checked by accounts" };
  await assert.rejects(() => einvoice("confirm_buyer_address", input), /cannot replace/);
  await einvoice("confirm_buyer_address", { ...input, city: "Pune" });
  assert.equal((await sources(i.inv1))[0].customer.city, "Pune");
  await einvoice("record_export", { schema_version: "1.1", file_sha256: "c".repeat(64), invoices: [{ invoice_id: i.inv2, doc_no: "OMX/26-27/0102" }] });
  await assert.rejects(() => einvoice("confirm_buyer_address", { ...input, invoice_id: i.inv2 }), /already exported/);
  await f.seed("update invoices set issued_at=null where id=$1", [i.inv3]);
  await assert.rejects(() => einvoice("confirm_buyer_address", { ...input, invoice_id: i.inv3 }), /issued invoice/);
  for (const signature of ["private.ap6_einvoice_without_buyer_address(text,jsonb)", "private.ap6_tally_without_tds_mapping(text,jsonb)", "private.ap6_tally_vouchers_without_tds(uuid,date,date)"]) {
    assert.equal((await f.one("select has_function_privilege('authenticated',$1,'execute') allowed", [signature])).allowed, false);
    assert.equal((await f.one("select has_function_privilege('anon',$1,'execute') allowed", [signature])).allowed, false);
  }
});

test("confirming a missing city accepts a formatted captured PIN without replacing the frozen value", async () => {
  await legacyInvoice(i.inv1, { ...buyer, pincode: "411 001" }); await applicable();
  await einvoice("confirm_buyer_address", { invoice_id: i.inv1, city: "Pune", pincode: "411001", reason: "Original invoice locality verified by accounts" });
  const source = (await sources(i.inv1))[0];
  assert.equal(source.customer.pincode, "411 001"); assert.equal(source.customer.city, "Pune");
  assert.equal(buildEinvoiceExport([source]).file[0].BuyerDtls.Pin, 411001);
  assert.equal((await einvoice("queue")).rows.find(row => row.id === i.inv1).buyer_pincode, "411001");
});

test("a real TDS deduction remains pending without a mapping, then exports once to TDS receivable without a Bank debit", async () => {
  await f.call("ap_tds", "save_settings", { sections: ["194Q"], default_section: "194Q", basis: "taxable", tolerance_inr: 1 }, i.accounts);
  const request = { request_id: f.next(), customer_id: i.customer2, deducted_on: istDay(), section: "194Q", lines: [{ invoice_id: i.inv1, amount: 100 }] };
  const receipt = await f.call("ap_tds", "record", request, i.accounts);
  assert.equal((await f.call("ap_tds", "record", request, i.accounts)).repeated, true);
  await f.seed("update financial_receipt_events set reference_number='Unlabelled receipt' where id=$1", [receipt.receipt_id]);
  await tally("save_mapping", { kind: "bank", ledger_name: "Bank" });
  const period = { from: istDay(), to: istDay(), kinds: ["receipt"] };
  const read = await tally("vouchers_data", period);
  const voucher = read.vouchers.find(row => row.id === receipt.receipt_id);
  assert.equal(voucher.data.settlement_kind, "tds"); assert.equal(voucher.data.method, "other");
  const skipped = buildTallyExport("Factory", [voucher], read.mappings);
  assert.equal(skipped.exported.length, 0); assert.match(skipped.issues[0].message, /TDS receivable/);
  assert.ok((await tally("pending", period)).rows.some(row => row.id === voucher.id));
  await assert.rejects(() => tally("save_mapping", { kind: "tds_receivable", ledger_name: "TDS Receivable" }, i.sales), error => error.code === "42501");
  await tally("save_mapping", { kind: "tds_receivable", ledger_name: "TDS Receivable" });
  const mapped = await tally("vouchers_data", period);
  const built = buildTallyExport("Factory", mapped.vouchers, mapped.mappings);
  assert.deepEqual(built.issues, []); assert.equal(built.exported.length, 1);
  assert.match(built.xml, /VCHTYPE="Journal"/); assert.match(built.xml, /<LEDGERNAME>TDS Receivable<\/LEDGERNAME>/); assert.doesNotMatch(built.xml, /<LEDGERNAME>Bank<\/LEDGERNAME>/);
  await tally("record_export", { ...period, file_sha256: "b".repeat(64), vouchers: built.exported.map(row => ({ kind: row.kind, id: row.id })) });
  assert.equal((await tally("vouchers_data", period)).vouchers.length, 0);
  assert.equal((await f.one("select count(*)::int n from tally_export_vouchers where voucher_id=$1", [voucher.id])).n, 1);
});

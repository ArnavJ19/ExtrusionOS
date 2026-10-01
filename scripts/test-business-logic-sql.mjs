// Isolated PostgreSQL fixture: exercises migration functions without live data.
// Install runtime: npm install --prefix node_modules/.cache/business-logic-sql --no-save --package-lock=false @electric-sql/pglite
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../node_modules/.cache/business-logic-sql/node_modules/@electric-sql/pglite/dist/index.js";
import { calculateQuoteItem, calculateQuoteSummary } from "../lib/calculations/quote.ts";
import { buildQuoteItemPcdaFields } from "../lib/pcda/quote-order.ts";
const db = new PGlite();
const company = "22222222-2222-4222-8222-222222222222";
const profile = "11111111-1111-4111-8111-111111111111";
const quoteId = "33333333-3333-4333-8333-333333333333";
const customer = "44444444-4444-4444-8444-444444444444";
const invoiceId = "55555555-5555-4555-8555-555555555555";
const base = { quantity_pieces: 10, length_per_piece_m: 5, section_weight_kg_per_m: 2, expected_recovery_percent: 85,
  scrap_allowance_percent: 5, minimum_billing_weight_kg: 0, billet_rate_per_kg: 200, conversion_charge_per_kg: 10,
  finishing_charge_type: "per_sqft", finishing_charge: 5, die_charge: 30, packing_charge: 40,
  transport_charge: 50, other_charges: 60, margin_percent: 20, minimum_margin_percent: 20, perimeter_mm: 400 };
const calc = calculateQuoteItem(base);
const pcda = buildQuoteItemPcdaFields({ companyId: company, profile: { id: profile }, item: calc, gstPercent: 18 });
const numeric = new Set([...Object.entries({ ...base, ...calc, ...pcda }).filter(([, v]) => typeof v === "number").map(([k]) => k),
  "sales_price_override", "discount", "margin", "net_rate", "internal_cost", "freight_charge", "die_service_charge", "die_cost", "material_price", "value_added_service_price", "basic_price", "quantity_kg", "gst_percent", "final_line_value"]);
const common = "id uuid primary key default gen_random_uuid(), company_id uuid, created_at timestamptz default now(), updated_at timestamptz default now()";
const fields = { ...base, ...calc, ...pcda, quote_id: quoteId, profile_id: profile, drawing_approval_status: "Approved", finishing_type: "mill_finish" };
const columns = Object.entries(fields).filter(([k]) => !["id", "company_id", "created_at", "updated_at"].includes(k)).map(([k, v]) => `"${k}" ${k.endsWith("_id") ? "uuid" : numeric.has(k) ? "numeric" : typeof v === "boolean" ? "boolean" : "text"}`);
await db.exec(`create role anon; create role authenticated; create schema private; create schema auth;
create function auth.uid() returns uuid language sql as 'select ''${company}''::uuid';
create function private.get_current_user_company_id() returns uuid language sql as 'select ''${company}''::uuid';
create function private.get_current_user_role() returns text language sql as 'select ''owner''::text';
create function private.get_current_user_dealer_id() returns uuid language sql as 'select null::uuid';
create table companies (id uuid primary key, gst_number text);
create table company_settings (company_id uuid, invoice_prefix text);
create table aluminium_profiles (${common}, section_perimeter_mm numeric);
create table quotes (${common}, customer_id uuid, dealer_id uuid, quote_number text, quote_date date, gst_percent numeric,
 status text, subtotal numeric, total_margin_amount numeric, total_before_gst numeric, gst_amount numeric,
 grand_total numeric, low_margin_approval_required boolean, estimated_profit_amount numeric, estimated_profit_percent numeric);
create table quote_items (${common}, ${columns.join(",")});
create table orders (${common}, customer_id uuid, quote_id uuid, order_number text, order_date date, order_value numeric,
 dealer_id uuid, current_stage text, created_by uuid, priority text);
create table order_items (like quote_items including defaults);
alter table order_items add column order_id uuid, add column quote_item_id uuid, add column source_record_id uuid, add column source_line_id uuid;
create table packing_list_items (${common}, dispatch_id uuid, order_item_id uuid, quote_item_id uuid, profile_id uuid, gst_percent numeric);
create table invoice_items (${common}, invoice_id uuid, source_line_id uuid, profile_id uuid, gst_percent numeric, line_total numeric);
create table invoices (${common}, invoice_number text, invoice_date date, customer_id uuid, status text, subtotal numeric default 0,
 tax_total numeric default 0, grand_total numeric default 0, amount_paid numeric default 0, credited_amount numeric default 0, due_date date, paid_date date);
create table payments (${common}, invoice_id uuid, payment_status text, payment_type text, amount numeric, payment_date date);
create table dispatches (${common}, dispatch_number text, dispatch_date date);
create table production_jobs (${common}, job_number text, planned_date date);
create table foundry_batches (${common}, batch_number text, casting_date date);
create table foundry_external_aluminium_sources (${common}, source_number text, received_date date);
create table outsourced_billet_batches (${common}, batch_number text, received_date date);
create table foundry_aluminium_scrap (${common}, scrap_number text, received_date date);
create table packaging_jobs (${common}, packaging_number text, packaging_date date);
create table packaging_materials (${common}, material_code text);
create table packaging_material_purchases (${common}, purchase_number text, purchase_date date);
create table machines (${common}, machine_code text, purchase_date date);`);
function definition(file, name) {
  const text = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
  const start = text.indexOf(`create or replace function ${name}(`);
  assert.ok(start >= 0, name);
  return text.slice(start, text.indexOf("\n$$;", start) + 4);
}
for (const name of ["private.next_business_number_locked", "private.insert_jsonb_row", "private.keep_jsonb_keys"]) {
  await db.exec(definition("20260715000000_atomic_business_workflows.sql", name));
}
await db.exec(readFileSync(new URL("../supabase/migrations/20260929000000_business_logic_fixes.sql", import.meta.url), "utf8"));
await db.exec(`create trigger recalculate_quote_item_financials before insert or update on quote_items for each row execute function public.recalculate_quote_item_financials();
create trigger derive_quote_header_financials before insert or update on quotes for each row execute function private.derive_quote_header_financials();
create trigger derive_order_value_from_quote before insert or update on orders for each row execute function public.derive_order_value_from_quote();
insert into companies(id,gst_number) values ('${company}','08ABCDE1234F1Z5');
insert into aluminium_profiles(id,company_id,section_perimeter_mm,hsn_code) values ('${profile}','${company}',400,'7604');
insert into quotes(id,company_id,customer_id,quote_date,gst_percent,status) values ('${quoteId}','${company}','${customer}','2026-09-29',18,'draft');`);
let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log(`PASS ${name}`); }
async function insertLine(input = base) {
  const result = await db.query("select private.insert_jsonb_row('quote_items'::regclass, $1::jsonb) as id", [JSON.stringify({ ...input, company_id: company, quote_id: quoteId, profile_id: profile, drawing_approval_status: "Approved" })]);
  return (await db.query("select * from quote_items where id = $1", [result.rows[0].id])).rows[0];
}
await check("migration compiles and quote calculation matches TypeScript across 24 variants", async () => {
  for (const finishing_charge_type of ["per_kg", "per_meter", "fixed", "per_sqft"]) {
    for (const expected_recovery_percent of [70, 85, 100]) {
      for (const sales_price_override of [null, 30000]) {
        const input = { ...base, finishing_charge_type, expected_recovery_percent, sales_price_override };
        const expected = calculateQuoteItem(input);
        const row = await insertLine(input);
        for (const key of ["raw_material_cost", "finishing_cost", "line_subtotal", "line_total_before_gst", "estimated_profit_percent", "price_per_kg", "billet_input_kg"]) assert.equal(Number(row[key]), expected[key], key);
        assert.equal(Number(row.internal_cost), expected.line_subtotal);
        assert.equal(Number(row.basic_price), expected.raw_material_cost + expected.conversion_cost + expected.finishing_cost + input.other_charges);
      }
    }
  }
});
await check("missing perimeter yields zero cost and blocks quote sending", async () => {
  await db.exec(`update aluminium_profiles set section_perimeter_mm = null where id = '${profile}'`);
  const row = await insertLine();
  assert.equal(Number(row.finishing_cost), 0);
  assert.equal(row.costing_complete, false);
  await assert.rejects(db.exec(`update quotes set status='sent' where id='${quoteId}'`), /requires a profile perimeter/);
  await db.exec(`delete from quote_items where id='${row.id}'; update aluminium_profiles set section_perimeter_mm=400 where id='${profile}'`);
});
await check("invalid recovery and margin are rejected in the database", async () => {
  await assert.rejects(insertLine({ ...base, expected_recovery_percent: 0 }), /Recovery/);
  await assert.rejects(insertLine({ ...base, margin_percent: 100 }), /Margin/);
});
await check("line GST overrides and paise rounding match quote summary", async () => {
  await db.exec("delete from quote_items");
  const inputs = [{ ...base, gst_percent: 5, sales_price_override: 100 }, { ...base, gst_percent: 18, sales_price_override: 0.03 }, { ...base, gst_percent: 18, sales_price_override: 0.03 }];
  for (const input of inputs) await insertLine(input);
  const row = (await db.query(`update quotes set gst_percent=28 where id='${quoteId}' returning gst_amount,grand_total`)).rows[0];
  const summary = calculateQuoteSummary(inputs.map(calculateQuoteItem), 28);
  assert.equal(Number(row.gst_amount), summary.gst_amount);
  assert.equal(Number(row.grand_total), summary.grand_total);
});
await check("browser-supplied numbers are replaced and allocation rolls back atomically", async () => {
  await db.exec(`insert into machines(company_id,machine_code) values ('${company}','forged'),('${company}','forged');`);
  const rows = (await db.query("select machine_code from machines order by machine_code")).rows;
  assert.equal(new Set(rows.map((r) => r.machine_code)).size, 2);
  assert.ok(rows.every((r) => /^MACH-\d{4}-\d{4}$/.test(r.machine_code)));
  await db.exec(`begin; insert into machines(company_id) values ('${company}'); rollback;`);
  const next = (await db.query(`insert into machines(company_id) values ('${company}') returning machine_code`)).rows[0].machine_code;
  assert.ok(next.endsWith("0003"));
});
await check("conversion preserves exact source line IDs and ignores forged order values", async () => {
  await db.exec(`update quotes set status='customer_approved' where id='${quoteId}'`);
  const orderId = (await db.query("select private.convert_quote_to_order_atomic($1, $2) as id", [quoteId, { order_date: "2026-09-29", order_value: 999999 }])).rows[0].id;
  const lines = (await db.query("select source_line_id,quote_item_id from order_items where order_id=$1", [orderId])).rows;
  assert.equal(lines.length, 3);
  assert.ok(lines.every((r) => r.source_line_id && r.source_line_id === r.quote_item_id));
  assert.equal(Number((await db.query("select order_value from orders where id=$1", [orderId])).rows[0].order_value), 105.08);
});
await check("direct orders ignore client totals and track item edits", async () => {
  const orderId = (await db.query(`insert into orders(company_id,order_value) values ('${company}',999999) returning id,order_value`)).rows[0];
  assert.equal(Number(orderId.order_value), 0);
  await db.exec(`insert into order_items(company_id,order_id,final_line_value,gst_percent) values ('${company}','${orderId.id}',100,18)`);
  assert.equal(Number((await db.query("select order_value from orders where id=$1", [orderId.id])).rows[0].order_value), 118);
});
await check("domestic invoice splits and unknown supply rejection", async () => {
  await assert.rejects(db.exec(`insert into invoices(company_id,status) values ('${company}','draft')`), /place-of-supply/);
  await db.exec(`insert into invoices(id,company_id,status,place_of_supply_state_code,grand_total,tax_total) values ('${invoiceId}','${company}','generated','08',1000,180)`);
  let row = (await db.query("select * from invoices where id=$1", [invoiceId])).rows[0];
  assert.equal(Number(row.cgst_amount), 90); assert.equal(Number(row.sgst_amount), 90); assert.equal(Number(row.igst_amount), 0);
  await db.exec(`update invoices set place_of_supply_state_code='07' where id='${invoiceId}'`);
  row = (await db.query("select * from invoices where id=$1", [invoiceId])).rows[0];
  assert.equal(Number(row.igst_amount), 180); assert.equal(Number(row.cgst_amount), 0);
});
await check("invoice line HSN and GST come from tenant-scoped source, with per-line rounding", async () => {
  const packingId = "66666666-6666-4666-8666-666666666666";
  await db.exec(`insert into packing_list_items(id,company_id,profile_id,gst_percent) values ('${packingId}','${company}','${profile}',18)`);
  const row = (await db.query(`insert into invoice_items(company_id,invoice_id,source_line_id,hsn_code,gst_percent,line_total)
    values ('${company}','${invoiceId}','${packingId}','0000',99,0.03) returning hsn_code,gst_percent`)).rows[0];
  assert.equal(row.hsn_code, "7604"); assert.equal(Number(row.gst_percent), 18);
  await db.exec(`insert into invoice_items(company_id,invoice_id,source_line_id,line_total) values ('${company}','${invoiceId}','${packingId}',0.03)`);
  await db.query("select private.recalculate_invoice_totals($1,$2)", [invoiceId, company]);
  const totals = (await db.query("select subtotal,tax_total,igst_amount from invoices where id=$1", [invoiceId])).rows[0];
  assert.equal(Number(totals.subtotal), 0.06); assert.equal(Number(totals.tax_total), 0.02); assert.equal(Number(totals.igst_amount), 0.02);
  await assert.rejects(db.exec(`insert into invoice_items(company_id,invoice_id,source_line_id,line_total) values ('77777777-7777-4777-8777-777777777777','${invoiceId}','${packingId}',100)`), /HSN/);
  await db.exec(`update invoices set subtotal=820,tax_total=180,grand_total=1000 where id='${invoiceId}'`);
});
await check("new trigger functions cannot be invoked directly by anonymous or authenticated users", async () => {
  for (const name of ["assign_business_number", "canonicalize_invoice_supply", "canonicalize_invoice_tax_line", "require_complete_quote_costing", "refresh_direct_order_value"]) {
    const row = (await db.query("select has_function_privilege('authenticated',$1,'EXECUTE') as authenticated, has_function_privilege('anon',$1,'EXECUTE') as anon", [`private.${name}()`])).rows[0];
    assert.equal(row.authenticated, false, name); assert.equal(row.anon, false, name);
  }
});
await check("allocated numbers cannot be overwritten", async () => {
  await assert.rejects(db.exec("update machines set machine_code='forged'"), /immutable/);
});
await check("payment plus credit settles invoice and later refund reopens it", async () => {
  await db.exec(`update invoices set credited_amount=400 where id='${invoiceId}'; insert into payments(company_id,invoice_id,payment_status,payment_type,amount,payment_date) values ('${company}','${invoiceId}','PAID','RECEIPT',600,'2026-09-29');`);
  await db.query("select private.recalculate_invoice_collection_state($1,$2)", [invoiceId, company]);
  assert.equal((await db.query("select status from invoices where id=$1", [invoiceId])).rows[0].status, "paid");
  await db.exec(`insert into payments(company_id,invoice_id,payment_status,payment_type,amount) values ('${company}','${invoiceId}','PAID','REFUND',100)`);
  await db.query("select private.recalculate_invoice_collection_state($1,$2)", [invoiceId, company]);
  assert.equal((await db.query("select status from invoices where id=$1", [invoiceId])).rows[0].status, "partially_paid");
});
if (process.argv.includes("--astra")) {
  const { runAstraChecks } = await import("./test-astra-sql.mjs");
  await runAstraChecks(db);
}
await db.close();
console.log(`${checks} SQL checks passed. Fixture verification only; no live database was touched.`);

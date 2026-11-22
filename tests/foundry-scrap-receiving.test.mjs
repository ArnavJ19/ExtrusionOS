import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasRouteAccess } from "../lib/auth/route-permissions.ts";
import { EXIT_ATTEMPT_LIMIT, SCRAP_RECEIPT_READS, acceptedKg, billTotal, exitAttemptState, indianMobile, netWeightKg, scrapReceiptCommands } from "../lib/foundry/scrap-receiving.ts";

// Foundry scrap receiving: the TypeScript rules shown before the database re-checks them, the command schemas, route
// access, and the floor forms no longer carrying purchase money.
// Line endings are normalised: a Windows checkout (core.autocrlf) writes CRLF, and the block slicing below matches "\n".
const read = file => readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const checks = { matches_type: true, dry: true, no_iron_steel: true, no_plastic_rubber_wood: true, no_sealed_containers: true, single_alloy: true, clean_surface: true };
const id = "00000000-0000-4000-8000-000000000001";

test("weights: net = gross - tare from the weighbridge; accepted kg drops the portion not of quality", () => {
  assert.equal(netWeightKg(12500, 2500), 10000);
  assert.equal(netWeightKg(1000.1234, 0.1), 1000.023);
  assert.equal(netWeightKg(2500, 2500), null, "gross must be more than tare");
  assert.equal(netWeightKg(null, 100), null);
  assert.equal(acceptedKg(5000, true, null, null), 5000);
  assert.equal(acceptedKg(5000, false, "partial", 750), 4250);
  assert.equal(acceptedKg(5000, false, "all", null), 0);
  assert.equal(acceptedKg(5000, false, "partial", 5000), null, "a 'portion' equal to the load is not a portion");
});

test("bill total: kg x rate rounded to paise, plus GST and freight, less discount", () => {
  assert.deepEqual(billTotal(10000, 182.5, 328500, 4500, 2000), { base: 1825000, total: 2156000 });
  assert.deepEqual(billTotal(1234.567, 181.23), { base: 223740.58, total: 223740.58 });
});

test("exit attempts: refused four times, the fifth press asks for a reason, then the factory manager decides", () => {
  assert.equal(EXIT_ATTEMPT_LIMIT, 5);
  assert.deepEqual(exitAttemptState(0, false), { kind: "refuse", remaining: 4 });
  assert.deepEqual(exitAttemptState(3, false), { kind: "refuse", remaining: 1 });
  assert.equal(exitAttemptState(4, false).kind, "needs_reason");
  assert.equal(exitAttemptState(6, false).kind, "needs_reason", "after a refusal the next press asks again");
  assert.equal(exitAttemptState(5, true).kind, "pending");
});

test("Indian mobile numbers for the person receiving on the manager's behalf", () => {
  for (const ok of ["9822012345", "98220 12345", "098220-12345", "+919822012345", "919822012345"]) assert.equal(indianMobile(ok), "+919822012345", ok);
  for (const bad of ["12345", "5822012345", "+1 415 555 0101", ""]) assert.equal(indianMobile(bad), null, bad);
});

test("command schemas: proxy details all required, money-free inspection, accounts-only finance fields", () => {
  const c = scrapReceiptCommands;
  assert.equal(c.start.safeParse({ present: true }).success, true);
  assert.equal(c.start.safeParse({ present: false, proxy_name: "Ramesh Patil", proxy_phone: "9822012345" }).success, false);
  assert.equal(c.start.safeParse({ present: true, proxy_name: "Ramesh" }).success, false, "no proxy details when present");
  assert.equal(c.start.safeParse({ present: false, proxy_name: "Ramesh Patil", proxy_phone: "9822012345", proxy_reason: "At the furnace during tapping" }).success, true);
  const inspect = { receipt_id: id, vehicle_number: "MH12AB1234", weighbridge_reference: "WB-1", gross_kg: 3000, tare_kg: 1000, quality_ok: true, checklist: checks };
  assert.equal(c.inspect.safeParse(inspect).success, true);
  assert.equal(c.inspect.safeParse({ ...inspect, rate: 180 }).success, false, "no money on the floor");
  assert.equal(c.inspect.safeParse({ ...inspect, gross_kg: 900 }).success, false);
  assert.equal(c.inspect.safeParse({ ...inspect, checklist: { dry: true } }).success, false, "every visual check is answered");
  assert.equal(c.complete.safeParse({ receipt_id: id, scrap_type_id: id, alloy: "6063", readiness: "ready_to_use", total_amount: 5 }).success, false);
  assert.equal(c.finance_save.safeParse({ receipt_id: id, vendor_id: id, invoice_number: "SV/1", invoice_date: "2026-11-18", rate_per_kg: 182.5 }).success, true);
  assert.equal(c.finance_save.safeParse({ receipt_id: id, vendor_id: id, invoice_number: "SV/1", invoice_date: "2026-11-18", rate_per_kg: 0 }).success, false);
  assert.equal(c.add_file.safeParse({ receipt_id: id, external_source_id: id, kind: "bill", storage_path: "x".repeat(20), file_name: "b.pdf", mime_type: "application/pdf" }).success, false, "one parent only");
  assert.deepEqual([...SCRAP_RECEIPT_READS].sort(), ["current", "finance_queue", "receipts", "requests", "source_get", "types"]);
});

test("routes: the floor receives, accounts see receipts, requests and metal bills only", () => {
  assert.equal(hasRouteAccess("/foundry/scrap/receive", "production"), true);
  assert.equal(hasRouteAccess("/foundry/scrap/receive", "accounts"), false);
  assert.equal(hasRouteAccess("/foundry/scrap/receipts/abc", "accounts"), true);
  assert.equal(hasRouteAccess("/foundry/scrap/requests", "accounts"), true);
  assert.equal(hasRouteAccess("/foundry/metal-finance", "accounts"), true);
  assert.equal(hasRouteAccess("/foundry/metal-finance", "production_manager"), false);
  assert.equal(hasRouteAccess("/foundry/scrap", "accounts"), false, "the rest of the foundry stays closed to accounts");
  assert.equal(hasRouteAccess("/foundry/scrap/receipts", "sales"), false);
});

test("floor forms for scrap and external sources carry no vendor, bill, rate or tax, and never write them", () => {
  const config = read("components/modules/operations/module-config.ts");
  for (const key of ["foundry_external_sources", "foundry_scrap"]) {
    const start = config.indexOf(`  ${key}: {`), block = config.slice(start, config.indexOf("\n  },\n", start));
    for (const field of ["rate", "base_amount", "tax_amount", "freight_amount", "discount_amount", "total_amount", "invoice_number", "invoice_date", "due_date", "payment_method", "vendor_id"]) {
      assert.doesNotMatch(block, new RegExp(`name: "${field}"`), `${key} form field ${field}`);
      assert.doesNotMatch(block.slice(block.indexOf("defaultValues")), new RegExp(`\\b${field}:`), `${key} default ${field}`);
    }
  }
  assert.match(config, /primaryAction: "Start receiving scrap",\s+createHref: "\/foundry\/scrap\/receive"/);
  const form = read("components/modules/operations/record-form-client.tsx");
  assert.match(form, /Purchase money and the vendor are owned by accounts; this form never writes them\./);
  assert.match(read("app/(dashboard)/foundry/scrap/new/page.tsx"), /redirect\("\/foundry\/scrap\/receive"\)/);
  const schemas = read("lib/validations/schemas.ts");
  for (const name of ["externalAluminiumSourceSchema", "aluminiumScrapSchema"]) {
    const start = schemas.indexOf(`export const ${name}`), block = schemas.slice(start, schemas.indexOf("});", start));
    assert.doesNotMatch(block, /\b(rate|tax_amount|invoice_number|vendor_id):/, name);
  }
});

test("the migration keeps purchase money with accounts and is additive", () => {
  const sql = read("supabase/migrations/20261119180000_foundry_scrap_receiving.sql");
  assert.match(sql, /create trigger a_guard_metal_source_finance before insert or update on public\.foundry_aluminium_scrap/);
  assert.match(sql, /create trigger a_guard_metal_source_finance before insert or update on public\.foundry_external_aluminium_sources/);
  assert.doesNotMatch(sql, /drop table|drop column|\bcurrent_date\b/i);
  assert.match(sql, /grant execute on function public\.ap_scrap_receipt\(text, jsonb\) to authenticated;/);
  assert.match(sql, /revoke all on function public\.ap_scrap_receipt\(text, jsonb\) from public, anon;/);
});

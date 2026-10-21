import test from "node:test";
import assert from "node:assert/strict";
import { buildRecordDetailHref, buildRecordPreviewModel, recordPreviewScope } from "../lib/workflow/record-preview.ts";

test("record preview exposes only the module allowlist, including no financial or free-text payloads", () => {
  const model = buildRecordPreviewModel("orders", {
    id: "order-17",
    order_number: "ORD-17",
    current_stage: "packing",
    billets_required: 3,
    requested_weight_kg: 1250,
    order_value: 900000,
    gross_margin: 31,
    notes: "Sensitive internal follow-up",
    internal_notes: "Restricted",
    customers: { company_name: "Kaveri Systems", phone: "9999999999" }
  });
  assert.ok(model);
  assert.equal(model.title, "ORD-17");
  assert.equal(model.subtitle, "Kaveri Systems");
  assert.deepEqual(model.fields.map(({ label, value }) => [label, value]), [
    ["Current stage", "packing"],
    ["Billets required", 3]
  ]);
  assert.doesNotMatch(JSON.stringify(model), /900000|margin|Sensitive|Restricted|9999999999/i);
});

test("contact details appear only for module rows explicitly configured to expose them", () => {
  const customer = buildRecordPreviewModel("customers", { id: "c1", company_name: "Kaveri", phone: "+91 90000 00000", email: "office@example.test" });
  const order = buildRecordPreviewModel("orders", { id: "o1", order_number: "ORD-1", phone: "+91 90000 00000" });
  assert.deepEqual(customer?.fields.map((field) => field.label), ["Phone", "Email"]);
  assert.equal(order?.fields.some((field) => field.label === "Phone"), false);
});

test("representative previews use actual list/RPC identifiers, relation aliases, and quantities", () => {
  const dispatch = buildRecordPreviewModel("dispatches", { dispatch_number: "DSP-4", transporter_name: "North Transport", total_weight_kg: 4200 });
  const billet = buildRecordPreviewModel("foundry_billets", { billet_code: "BL-4", billet_diameter_inch: 6, weight_kg: 560, orders: { order_number: "ORD-4" } });
  const stock = buildRecordPreviewModel("inventory", { item_code: "PK-1", current_stock: 12, unit: "pcs" });
  const material = buildRecordPreviewModel("packaging_materials", { material_code: "WRAP-1", current_stock: 20 });
  assert.equal(dispatch?.title, "DSP-4");
  assert.ok(dispatch?.fields.some(({ label, value }) => label === "Transporter" && value === "North Transport"));
  assert.ok(dispatch?.fields.some(({ label, value }) => label === "Weight (kg)" && value === 4200));
  assert.equal(billet?.title, "BL-4");
  assert.ok(billet?.fields.some(({ label, value }) => label === "Order" && value === "ORD-4"));
  assert.ok(billet?.fields.some(({ label, value }) => label === "Weight (kg)" && value === 560));
  assert.ok(stock?.fields.some(({ label, value }) => label === "Stock" && value === 12));
  assert.ok(material?.fields.some(({ label, value }) => label === "Stock" && value === 20));
});

test("missing primary workload quantities are explicit", () => {
  const model = buildRecordPreviewModel("production", { job_number: "JOB-2", status: "planned" });
  assert.ok(model?.fields.some(({ label, value }) => label === "Planned quantity (kg)" && value === "Not recorded"));
});

test("detail links are restricted to the matching internal database path and retain list query state", () => {
  assert.equal(buildRecordDetailHref("/orders", "/orders/database?search=ORD-17&page=4&sort=order_number", "a/b"), "/orders/a%2Fb?returnTo=%2Forders%2Fdatabase%3Fsearch%3DORD-17%26page%3D4%26sort%3Dorder_number");
  assert.equal(buildRecordDetailHref("/orders", "https://evil.example/orders/database", "o1"), null);
  assert.equal(buildRecordDetailHref("/orders", "/quotes/database?search=x", "o1"), null);
  assert.equal(buildRecordDetailHref("/orders", "//evil.example/orders/database", "o1"), null);
  assert.equal(buildRecordDetailHref("/orders", "/orders/database#secret", "o1"), null);
  assert.equal(buildRecordDetailHref("/orders", "/orders/database", "bad\\path"), null);
});

test("row scope binds previews to authenticated company, user, and role", () => {
  assert.equal(recordPreviewScope({ companyId: "c1", userId: "u1", role: "dispatch" }), JSON.stringify(["c1", "u1", "dispatch"]));
  assert.notEqual(recordPreviewScope({ companyId: "c2", userId: "u1", role: "dispatch" }), recordPreviewScope({ companyId: "c1", userId: "u1", role: "dispatch" }));
  assert.notEqual(recordPreviewScope({ companyId: "c1", userId: "u2", role: "dispatch" }), recordPreviewScope({ companyId: "c1", userId: "u1", role: "dispatch" }));
});

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fc from "fast-check";
import { ASSURANCE_VIEWS, assuranceCommandSchema, assuranceMutationSchema, assuranceMutationView, canReadAssurance, canUseAssuranceAction, assuranceStatusLabel } from "../lib/workflow/assurance.ts";
import { createNov5ActionsFixture, nov5Outcome } from "../scripts/lib/nov-batch5-actions-fixture.mjs";
import { nids as i, nid } from "../scripts/lib/nov-batch5-fixture.mjs";

const require = createRequire(import.meta.url); require("tsx/cjs");
const { buildAssuranceMutation } = require("../lib/workflow/assurance-form.ts");
const f = createNov5ActionsFixture();
test.beforeEach(() => f.reset());
const note = "Reviewed with the responsible department";
const open = () => ({ action: "count.open", location: "Rack 4", blind: true, note });
const preview = () => ({ command: "preview", request_id: nid(1000), mutation: open() });
const ok = value => assuranceMutationSchema.safeParse(value).success;

test("input contracts reject injected identity, unknown actions and ambiguous quantities", () => {
  assert.equal(assuranceCommandSchema.safeParse({ ...preview(), company_id: i.foreignCompany }).success, false);
  assert.equal(assuranceCommandSchema.safeParse({ ...preview(), mutation: { ...open(), actor_id: i.foreign } }).success, false);
  assert.equal(ok({ action: "stock.adjust", note }), false);
  const release = { action: "incoming.release", receipt_line_id: i.receiptLine, batch_number: " bb-1 ", alloy: "6063", temper: "f", note };
  for (const quantity_kg of [0, -1, NaN, Infinity, 1.0001, 1000001]) assert.equal(ok({ ...release, quantity_kg }), false, String(quantity_kg));
  assert.equal(assuranceMutationSchema.parse({ ...release, quantity_kg: 500 }).batch_number, "BB-1");
  assert.equal(ok({ action: "incoming.dispose", receipt_line_id: i.receiptLine, disposition: "accept", quantity: 1, evidence: "Visual ok", note }), false, "acceptance needs a certificate");
  assert.equal(ok({ action: "incoming.dispose", receipt_line_id: i.receiptLine, disposition: "concession", quantity: 1, evidence: "Visual ok", note }), true, "a concession may lack one");
  assert.equal(ok({ action: "drawing.customer", revision_id: i.drawing, event: "customer_approved", evidence: "Signed PDF", note }), false, "approval names the customer person");
  assert.equal(ok({ action: "drawing.register", drawing_id: i.drawing, revision_label: "R 2", file_sha256: "a".repeat(64), customer_approval_required: true, note }), false);
  assert.equal(ok({ action: "drawing.register", drawing_id: i.drawing, revision_label: "R2", file_sha256: "A".repeat(64), customer_approval_required: true, note }), false, "checksums are lower-case hex");
  assert.equal(ok({ action: "delivery.resolve", id: i.bundle1, resolution: "redelivery", response: "credit", note }), false);
  assert.equal(ok({ action: "delivery.resolve", id: i.bundle1, resolution: "return_expected", note }), false);
  assert.equal(ok({ action: "change.propose", order_item_id: i.line1, changes: {}, note }), false);
  assert.equal(ok({ action: "change.propose", order_item_id: i.line1, changes: { internal_cost: 5 }, note }), false, "only tracked facts can be proposed");
  assert.equal(ok({ action: "count.record", count_id: i.order, counted_pieces: 1, note }), false, "a count names a line or an unlisted bundle");
  assert.equal(ok({ action: "count.record", count_id: i.order, line_id: i.line1, unlisted_label: "X", counted_pieces: 1, note }), false);
  assert.equal(ok({ action: "return.link", id: i.order, link_type: "credit_note", target_id: i.order, quantity_kg: 5, note }), false, "credit quantity comes from the credit note");
  assert.equal(ok({ action: "return.link", id: i.order, link_type: "replacement_dispatch", target_id: i.order, note }), false);
  assert.equal(ok({ action: "capacity.move", slot_id: i.slot1, unavailability_id: i.block, machine_id: i.press2, start_at: "2026-11-05T10:00:00+05:30", end_at: "2026-11-05T09:00:00+05:30", shift: "Day", note }), false);
  assert.equal(ok({ action: "instrument.register", code: "mic-1", name: "Micrometer", unit: "mm", range_min: 5, range_max: 5, note }), false);
  assert.equal(ok({ action: "instrument.check", instrument_id: i.order, checked_on: "2026-11-03", valid_until: "2026-11-02", result: "pass", certificate_ref: "C-1", note }), false);
  assert.equal(ok({ ...open(), note: "Bad\u0007note" }), false);
});

test("role mirrors cover every view and action, and dealers or unknown roles are refused", () => {
  for (const role of ["dealer_admin", "dealer_staff", "superuser"]) assert.equal(canReadAssurance(role), false, role);
  assert.equal(canReadAssurance("sales", "incoming"), false); assert.equal(canReadAssurance("production", "capability"), false); assert.equal(canReadAssurance("viewer", "packs"), true);
  assert.equal(canUseAssuranceAction("viewer", "change.resolve"), false); assert.equal(canUseAssuranceAction("production", "change.resolve"), true);
  assert.equal(canUseAssuranceAction("quality", "incoming.release"), false); assert.equal(canUseAssuranceAction("inventory_manager", "incoming.release"), true);
  assert.equal(canUseAssuranceAction("sales", "drawing.release"), false); assert.equal(canUseAssuranceAction("accounts", "count.review"), true); assert.equal(canUseAssuranceAction("inventory_manager", "count.review"), false);
  assert.equal(assuranceMutationView("return.link"), "returns"); assert.equal(assuranceMutationView("capacity.review"), "capacity");
  for (const view of Object.keys(ASSURANCE_VIEWS)) assert.equal(canReadAssurance("owner", view), true);
  assert.equal(assuranceStatusLabel("issued_out_of_date"), "Issued pack out of date"); assert.equal(assuranceStatusLabel("some_new_state"), "some new state");
});

test("form building omits blank optional values instead of sending zero, and converts IST times", () => {
  const fields = [{ key: "quantity_kg", label: "Q", type: "number" }, { key: "batch_number", label: "B", upper: true }, { key: "alloy", label: "A", upper: true }, { key: "temper", label: "T", upper: true },
    { key: "diameter_mm", label: "D", type: "number", optional: true }, { key: "heat_number", label: "H", optional: true }, { key: "note", label: "N", type: "note" }];
  const built = buildAssuranceMutation("incoming.release", fields, { quantity_kg: "120.5", batch_number: "bb-9", alloy: "6063", temper: "f", diameter_mm: " ", heat_number: "", note }, { receipt_line_id: i.receiptLine });
  assert.equal(built.success, true); assert.equal("diameter_mm" in built.data, false); assert.equal("heat_number" in built.data, false); assert.equal(built.data.batch_number, "BB-9");
  const missing = buildAssuranceMutation("incoming.release", fields, { batch_number: "bb-9", alloy: "6063", temper: "f", note }, { receipt_line_id: i.receiptLine });
  assert.equal(missing.success, false, "a blank required quantity is not zero");
  const moved = buildAssuranceMutation("capacity.move", [{ key: "machine_id", label: "M" }, { key: "start_at", label: "S", type: "instant" }, { key: "end_at", label: "E", type: "instant" }, { key: "shift", label: "Sh" }, { key: "note", label: "N", type: "note" }],
    { machine_id: i.press2, start_at: "2026-11-05T10:00", end_at: "2026-11-05T14:30", shift: "Day", note }, { slot_id: i.slot1, unavailability_id: i.block });
  assert.equal(moved.success, true); assert.equal(moved.data.start_at, "2026-11-05T04:30:00.000Z");
  const change = buildAssuranceMutation("change.propose", [{ key: "changes", label: "C", type: "changes" }, { key: "note", label: "N", type: "note" }], { "change:cut_length": "5800", "change:drawing_revision": " R2 ", "change:quantity_kg": "", note }, { order_item_id: i.line1 });
  assert.equal(change.success, true); assert.deepEqual(change.data.changes, { cut_length: 5800, drawing_revision: "R2" });
  fc.assert(fc.property(fc.double({ min: 0.001, max: 1e6, noNaN: true }), kg => {
    const result = buildAssuranceMutation("incoming.release", fields, { quantity_kg: String(kg), batch_number: "B1", alloy: "6063", temper: "F", note }, { receipt_line_id: i.receiptLine });
    const threeDecimals = Math.abs(kg * 1000 - Math.round(kg * 1000)) < 1e-6;
    assert.equal(result.success, threeDecimals);
  }), { numRuns: 150 });
});

test("server action: dealers, unpermitted previews and malformed input never reach the database", async () => {
  f.state.context = { ...f.state.context, dealerId: i.customer, role: "dealer_admin" };
  assert.equal((await f.action(preview())).success, false);
  f.reset(); f.state.context = { ...f.state.context, role: "sales" };
  assert.equal((await f.action(preview())).success, false);
  assert.equal((await f.action({ command: "list", view: "incoming" })).success, false);
  f.reset();
  assert.equal((await f.action({ ...preview(), mutation: { ...open(), blind: "yes" } })).success, false);
  assert.equal(f.state.calls.length, 0);
  const result = await f.action(preview());
  assert.equal(result.success, true); assert.deepEqual(f.state.calls[0], { name: "assurance_command", payload: { p_command: "preview", p_payload: { request_id: nid(1000), mutation: open() } } });
});

test("server action: database errors map to safe messages and uncertain finalizing outcomes", async () => {
  f.state.error = { code: "P0001", message: "NOV: Only 350 kg awaits a quality decision on this line." };
  assert.deepEqual(await f.action(preview()), { success: false, error: "Only 350 kg awaits a quality decision on this line." });
  f.state.error = { code: "P0001", message: "internal detail leaked" };
  const hidden = await f.action(preview());
  assert.equal(hidden.success, false); assert.equal(hidden.uncertain, true); assert.doesNotMatch(hidden.error, /internal detail/);
  f.state.error = { code: "PGRST202", message: "missing" };
  assert.equal((await f.action({ command: "list", view: "counts" })).unavailable, true);
  f.state.error = { code: "42501", message: "Not permitted" };
  assert.match((await f.action({ command: "list", view: "counts" })).error, /not available/);
  f.reset(); f.state.throws = true;
  const commit = await f.action({ command: "commit", request_id: nid(1000), fingerprint: "a".repeat(32) });
  assert.equal(commit.success, false); assert.equal(commit.uncertain, true);
  f.reset(); f.state.malformed = true;
  assert.equal((await f.action(preview())).success, false, "an unexpected response shape is not treated as success");
  f.reset(); f.state.revalidateThrows = true; f.state.response = nov5Outcome({ state: "confirmed", result: { label: "Cycle count opened", href: "/tasks/assurance/counts/x", message: "Count each bundle." } });
  assert.equal((await f.action({ command: "commit", request_id: nid(1000), fingerprint: "a".repeat(32) })).success, true, "cache refresh failure does not hide a confirmed outcome");
});

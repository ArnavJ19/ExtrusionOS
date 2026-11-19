import test from "node:test";
import assert from "node:assert/strict";
import { flushEntries, listEntries, newEntry, putEntry, removeEntry } from "../lib/offline/queue.ts";
import { buildTallyExport } from "../lib/integrations/tally-xml.ts";
import { tallyCommands } from "../lib/dispatch-autopilot/commands.ts";
import { einvoiceCommands } from "../lib/autopilot-batch6/commands.ts";

test("a mixed phone queue sends only the active transport's kind and leaves other entries byte-for-byte pending", async () => {
  for (const active of ["ap", "bundle"]) {
    const owner = `mixed:${active}`, otherOwner = `other:${active}`;
    const make = (kind, n, entryOwner = owner) => newEntry({ owner: entryOwner, kind, rpc: kind === "bundle" ? "physical_bundle_command" : "ap_press",
      command: kind === "bundle" ? "bundle.record" : "push", payload: { n }, label: String(n), now: new Date(`2026-11-14T08:0${n}:00Z`) });
    const otherKind = active === "ap" ? "bundle" : "ap";
    const untouched = [make(otherKind, 0), make(otherKind, 2), make(active, 0, otherOwner)];
    const sent = [make(active, 1), make(active, 3)];
    for (const entry of [...untouched, ...sent]) await putEntry(entry);
    const seen = [];
    assert.deepEqual(await flushEntries(owner, active, async entry => { seen.push(entry.payload.n); assert.equal(entry.kind, active); return { kind: "applied" }; }),
      { applied: 2, conflicts: 0, waiting: 0 });
    assert.deepEqual(seen, [1, 3]);
    assert.deepEqual(await listEntries(owner), untouched.slice(0, 2));
    assert.deepEqual(await listEntries(otherOwner), [untouched[2]]);
    for (const entry of untouched) await removeEntry(entry.request_id);
  }
});

test("a connection failure preserves order within a transport without attempting another transport's entries", async () => {
  const owner = "mixed:retry";
  const entries = ["bundle", "ap", "bundle", "ap"].map((kind, n) => newEntry({ owner, kind, rpc: kind === "ap" ? "ap_sampling" : "physical_bundle_command",
    command: kind === "ap" ? "sample_record" : "bundle.record", payload: { n }, label: String(n), now: new Date(`2026-11-14T08:0${n}:00Z`) }));
  for (const entry of entries) await putEntry(entry);
  const seen = [];
  const result = await flushEntries(owner, "ap", async entry => { seen.push(entry.payload.n); return { kind: "retry", message: "No signal" }; });
  assert.deepEqual(seen, [1]); assert.deepEqual(result, { applied: 0, conflicts: 0, waiting: 2 });
  const left = await listEntries(owner);
  assert.deepEqual(left.filter(entry => entry.kind === "bundle"), [entries[0], entries[2]]);
  assert.equal(left[1].attempts, 1); assert.deepEqual(left[3], entries[3]);
  assert.equal((await flushEntries(owner, "bundle", async () => ({ kind: "applied" }))).applied, 2);
  assert.equal((await flushEntries(owner, "ap", async () => ({ kind: "applied" }))).applied, 2);
  assert.deepEqual(await listEntries(owner), []);
});

test("TDS exports as a Journal debit to TDS receivable and a bill-allocated customer credit; a missing ledger stays pending", () => {
  const voucher = { kind: "receipt", id: "tds-1", number: "TDS 194Q 26-27 Q3", date: "2026-11-17", amount: 100, party_id: "customer-1", party: "Sharma Fabricators",
    data: { method: "other", status: "posted", settlement_kind: "tds", allocations: [{ invoice_number: "INV-1", amount: 100 }] } };
  const bank = { kind: "bank", entity_id: null, gst_rate: null, supply: null, ledger_name: "Bank" };
  const missing = buildTallyExport("Factory", [voucher], [bank]);
  assert.equal(missing.exported.length, 0); assert.match(missing.issues[0].message, /Map the TDS receivable ledger in Tally settings/);
  assert.doesNotMatch(missing.xml, /<VOUCHER /);
  const mapped = buildTallyExport("Factory", [voucher], [bank, { ...bank, kind: "tds_receivable", ledger_name: "TDS Receivable" }]);
  assert.deepEqual(mapped.issues, []); assert.equal(mapped.exported.length, 1);
  assert.match(mapped.xml, /VCHTYPE="Journal"/);
  assert.match(mapped.xml, /<LEDGERNAME>TDS Receivable<\/LEDGERNAME><ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE><AMOUNT>-100.00<\/AMOUNT>/);
  assert.match(mapped.xml, /<NAME>INV-1<\/NAME><BILLTYPE>Agst Ref<\/BILLTYPE><AMOUNT>100.00<\/AMOUNT>/);
  assert.doesNotMatch(mapped.xml, /<LEDGERNAME>Bank<\/LEDGERNAME>/);
  const ordinary = buildTallyExport("Factory", [{ ...voucher, data: { ...voucher.data, settlement_kind: "payment" } }], [bank]);
  assert.match(ordinary.xml, /VCHTYPE="Receipt"/); assert.match(ordinary.xml, /<LEDGERNAME>Bank<\/LEDGERNAME>/);
});

test("new finance commands validate the TDS mapping and a document-backed buyer locality confirmation", () => {
  assert.equal(tallyCommands.save_mapping.safeParse({ kind: "tds_receivable", ledger_name: "TDS Receivable" }).success, true);
  const input = { invoice_id: "bd000000-0000-4000-8000-000000000410", city: "Pune", pincode: "411001", reason: "Original invoice INV-1, page 1" };
  assert.equal(einvoiceCommands.confirm_buyer_address.safeParse(input).success, true);
  for (const patch of [{ pincode: "000000" }, { city: "X" }, { reason: "" }, { company_id: input.invoice_id }]) {
    assert.equal(einvoiceCommands.confirm_buyer_address.safeParse({ ...input, ...patch }).success, false);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { createQuoteRevisionFixture, qids } from "../scripts/lib/quote-revision-compare-fixture.mjs";
import { compareQuoteVersions, compareResponseSchema, diffFields, LINE_FIELDS, pairLines, parseCompareParams, isIssuedStatus } from "../lib/workflow/quote-revision-compare.ts";

// ---------- Pure comparison rules ----------

const P = "00000000-0000-4000-8000-000000000030";
const Q = "00000000-0000-4000-8000-000000000031";
const line = (extra) => ({ profile_id: P, quantity_pieces: 100, length_per_piece_m: 6, total_meters: 600, finishing_type: "mill_finish", ...extra });

test("a quantity or finish change is reported with units and a signed delta", () => {
  const result = compareQuoteVersions({ header: {}, items: [line()] }, { header: {}, items: [line({ quantity_pieces: 120, total_meters: 720, finishing_type: "powder_coating" })] });
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].status, "changed");
  const byKey = Object.fromEntries(result.lines[0].changes.map((change) => [change.key, change]));
  assert.deepEqual([byKey.quantity_pieces.unit, byKey.quantity_pieces.before, byKey.quantity_pieces.after, byKey.quantity_pieces.delta], ["pcs", 100, 120, 20]);
  assert.equal(byKey.total_meters.delta, 120);
  assert.deepEqual([byKey.finishing_type.before, byKey.finishing_type.after, byKey.finishing_type.delta], ["mill_finish", "powder_coating", null]);
});

test("rewritten line identities are paired by profile, cut length and finish rather than position", () => {
  const before = [line({ length_per_piece_m: 6 }), line({ length_per_piece_m: 3 })];
  const after = [line({ length_per_piece_m: 3 })];
  const result = compareQuoteVersions({ header: {}, items: before }, { header: {}, items: after });
  assert.deepEqual(result.lines.map((entry) => entry.status), ["removed", "unchanged"]);
  assert.equal(result.lines[0].before.length_per_piece_m, 6);
  assert.deepEqual(result.summary, { added: 0, removed: 1, changed: 0, unchanged: 1, headerChanges: 0 });
});

test("a profile swap is shown as one removal and one addition, never as an edit", () => {
  const result = compareQuoteVersions({ header: {}, items: [line()] }, { header: {}, items: [line({ profile_id: Q })] });
  assert.deepEqual(result.lines.map((entry) => entry.status), ["removed", "added"]);
});

test("same-profile lines without an exact match pair in entry order", () => {
  const pairs = pairLines([line({ quantity_pieces: 1 }), line({ length_per_piece_m: 4 })], [line({ length_per_piece_m: 5 }), line({ quantity_pieces: 2 })]);
  // First line matches exactly on cut length/finish (6 m mill finish) with the second "after" line.
  assert.equal(pairs[0].after.quantity_pieces, 2);
  assert.equal(pairs[1].after.length_per_piece_m, 5);
  assert.equal(pairs.length, 2);
});

test("numeric noise within stored precision is not a change; missing values are not zero", () => {
  assert.deepEqual(diffFields({ total_meters: "600.0001", quantity_pieces: 5 }, { total_meters: 600, quantity_pieces: "5" }, LINE_FIELDS), []);
  const missing = diffFields({ billing_weight_kg: null }, { billing_weight_kg: 0 }, LINE_FIELDS);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].before, null);
  assert.equal(missing[0].delta, null);
});

test("fields projected away from both versions are never reported", () => {
  const result = diffFields({ quantity_pieces: 1 }, { quantity_pieces: 1 }, LINE_FIELDS);
  assert.deepEqual(result, []);
  assert.equal(diffFields({}, { margin_percent: 25 }, LINE_FIELDS)[0].key, "margin_percent");
});

test("compare parameters accept revision numbers and current, and reject identical or malformed pairs", () => {
  assert.deepEqual(parseCompareParams("1", "current"), { from: 1, to: null });
  assert.deepEqual(parseCompareParams("3", "1"), { from: 3, to: 1 });
  for (const [a, b] of [["1", "1"], ["current", "current"], ["-1", "2"], ["1e3", "2"], [undefined, "1"], [["1"], "2"], ["1234567", "1"]]) assert.equal(parseCompareParams(a, b), null);
  assert.equal(isIssuedStatus("sent"), true);
  assert.equal(isIssuedStatus("draft"), false);
});

// ---------- Database boundary (PGlite, hosted-shaped) ----------

let f;
test.before(async () => { f = await createQuoteRevisionFixture(); });
test.beforeEach(async () => { await f.reset(); });
test.after(async () => { await f?.close(); });

test("snapshot contents are no longer directly readable; revision metadata remains readable", async () => {
  for (const actor of [qids.viewer, qids.sales, qids.production, qids.owner]) {
    await assert.rejects(f.asUser("select snapshot_json from quote_revisions", [], actor), /permission denied/);
  }
  const rows = await f.asUser("select revision_number, reason from quote_revisions order by reason", [], qids.sales);
  assert.deepEqual(rows.map((row) => row.reason), ["Customer asked for powder coating", "Dealer revision"]);
});

test("revision metadata follows quotation visibility: dealers see only their own, production sees none", async () => {
  const dealerRows = await f.asUser("select quote_id from quote_revisions", [], qids.dealer);
  assert.deepEqual(dealerRows.map((row) => row.quote_id), [qids.dealerQuote]);
  assert.deepEqual(await f.asUser("select quote_id from quote_revisions", [], qids.otherDealerUser), []);
  assert.deepEqual(await f.asUser("select quote_id from quote_revisions", [], qids.production), []);
  assert.deepEqual((await f.asUser("select quote_id from quote_revisions", [], qids.foreign)).map((row) => row.quote_id), [qids.foreignQuote]);
});

test("owners compare full commercial detail; the result parses and shows the finish and quantity change", async () => {
  const data = await f.compare(qids.owner, qids.quote, 1, null);
  const parsed = compareResponseSchema.parse(data);
  assert.equal(parsed.level, "cost");
  assert.equal(parsed.from.kind, "snapshot");
  assert.equal(parsed.from.superseded_by, "Sales Ravi");
  assert.equal(parsed.from.approved_by_name, "Owner Asha");
  assert.equal(parsed.from.reason, "Customer asked for powder coating");
  assert.equal(parsed.to.kind, "current");
  assert.equal(parsed.to.revision_number, 2);
  const result = compareQuoteVersions(parsed.from, parsed.to);
  const changed = result.lines.find((entry) => entry.status === "changed");
  const keys = changed.changes.map((change) => change.key);
  for (const key of ["quantity_pieces", "finishing_type", "billet_rate_per_kg", "margin_percent", "price_per_kg"]) assert.ok(keys.includes(key), key);
  assert.deepEqual(result.lines.map((entry) => entry.status).sort(), ["changed", "removed"]);
  assert.ok(result.header.some((change) => change.key === "payment_terms" && change.before === "45 days" && change.after === "30 days"));
  assert.ok(result.header.some((change) => change.key === "total_margin_amount"));
  // Internal notes and supplier rates are never part of any comparison projection.
  assert.doesNotMatch(JSON.stringify(data), /supplier ABC|supplier_rate|internal_note/);
});

test("sales see prices but no internal cost or margin; viewers see neither", async () => {
  const sales = await f.compare(qids.sales, qids.quote, 1, null);
  assert.equal(sales.level, "price");
  assert.doesNotMatch(JSON.stringify(sales), /billet_rate_per_kg|margin_percent|total_margin_amount|approval_notes/);
  assert.match(JSON.stringify(sales), /price_per_kg/);
  const viewer = await f.compare(qids.viewer, qids.quote, null, 1);
  assert.equal(viewer.level, "basic");
  assert.doesNotMatch(JSON.stringify(viewer), /price_per_kg|grand_total|billet_rate|margin_percent|total_margin_amount|line_total/);
  assert.match(JSON.stringify(viewer), /quantity_pieces/);
});

test("dealers compare only their own quotations and never see internal notes", async () => {
  const own = await f.compare(qids.dealer, qids.dealerQuote, 1, null);
  assert.equal(own.level, "dealer");
  assert.doesNotMatch(JSON.stringify(own), /Dealer internal|Old note|billet_rate|margin_percent/);
  await assert.rejects(f.compare(qids.otherDealerUser, qids.dealerQuote, 1, null), /Quotation is unavailable/);
  await assert.rejects(f.compare(qids.dealer, qids.quote, 1, null), /Quotation is unavailable/);
});

test("roles without quotation access, foreign companies and invalid version pairs fail closed", async () => {
  await assert.rejects(f.compare(qids.production, qids.quote, 1, null), /Not permitted/);
  await assert.rejects(f.compare(qids.foreign, qids.quote, 1, null), /Quotation is unavailable/);
  await assert.rejects(f.compare(qids.owner, qids.quote, null, null), /two different/);
  await assert.rejects(f.compare(qids.owner, qids.quote, 1, 1), /two different/);
  await assert.rejects(f.compare(qids.owner, qids.quote, 2, null), /two different/);
  await assert.rejects(f.compare(qids.owner, qids.quote, -1, null), /two different/);
  await f.db.query("update quotes set revision_number=5 where id=$1", [qids.quote]);
  await assert.rejects(f.compare(qids.owner, qids.quote, 3, null), /not recorded/);
});

test("malformed or oversized snapshots are refused rather than partially compared", async () => {
  await f.db.query("update quote_revisions set snapshot_json=jsonb_set(snapshot_json,'{items}','{}'::jsonb) where quote_id=$1", [qids.quote]);
  await assert.rejects(f.compare(qids.owner, qids.quote, 1, null), /cannot be compared/);
  await f.db.query("update quote_revisions set snapshot_json=jsonb_build_object('quote','{}'::jsonb,'items',(select jsonb_agg(jsonb_build_object('profile_id',g)) from generate_series(1,501) g)) where quote_id=$1", [qids.quote]);
  await assert.rejects(f.compare(qids.owner, qids.quote, 1, null), /cannot be compared/);
});

test("a linked order identifies the accepted basis and the RPC is not executable anonymously", async () => {
  await f.db.query("insert into orders values($1,$2,$3,'SO-0007',now())", [qids.order, qids.company, qids.quote]);
  const data = await f.compare(qids.owner, qids.quote, 1, null);
  assert.equal(data.linked_order.order_number, "SO-0007");
  const grants = (await f.db.query("select has_function_privilege('anon','public.quote_revision_compare(uuid,integer,integer)','execute') anon, has_function_privilege('authenticated','public.quote_revision_compare(uuid,integer,integer)','execute') auth")).rows[0];
  assert.deepEqual(grants, { anon: false, auth: true });
});

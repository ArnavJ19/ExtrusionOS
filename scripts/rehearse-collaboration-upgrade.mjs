import assert from "node:assert/strict";
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createLiveCatalogDb } from "../audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/live-catalog-db.mjs";
import { ids, seed } from "../audit-output/EXOS_ERP_AUDIT_2026-10-20/harness/seed.mjs";

// Rebuild the captured hosted schema locally, then add this upgrade. No hosted connection is used.
const wave = readdirSync("supabase/migrations").filter(name => name >= "20261021080000" && name < "20261021290000").sort();
const tail = ["20261021290000_foundry_single_source_charge_fix.sql", "20261021300000_reconcile_metal_sources_and_validate.sql", "20261021310000_quote_invoice_rate_basis.sql", "20261021320000_cancelled_batch_phantom_billets.sql", "20261021290100_operation_page_null_projection.sql", "20261021330000_invoice_die_freight_charge_lines.sql", "20261022000000_operator_workflow_helpers.sql"];
const files = [...wave, ...tail].filter(name => !name.includes("collaboration_"));
const { db, failures } = await createLiveCatalogDb({ dir: "live-20261021", migrations: files.map(name => "supabase/migrations/" + name) });
try {
  assert.deepEqual(failures, []);
  await db.exec(readFileSync("supabase/migrations/20261021190916_collaboration_procedure_routines.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20261021201325_collaboration_foreign_key_indexes.sql", "utf8"));
  await seed(db);
  await db.query("update public.aluminium_profiles set section_weight_kg_per_m=$1 where id=$2", [0.8, ids.profile]);
  const command = async (actor, name, payload) => {
    await db.query("select set_config('audit.uid',$1,false)", [actor]); await db.exec("set role authenticated");
    try { return (await db.query("select public.collaboration_workflow_command($1,$2) data", [name, payload])).rows[0].data; }
    finally { await db.exec("reset role"); }
  };
  const procedureId = "b1000000-0000-4000-8000-000000000001", runId = "b1000000-0000-4000-8000-000000000002", commentId = "b1000000-0000-4000-8000-000000000003";
  const created = await command(ids.owner, "procedures.create", { title: "Press opening", purpose: "Review handover and current work", scope_label: "Press A", owner_id: ids.productionManager, backup_id: ids.owner, review_due: "2027-01-01", routine_kind: "opening", prompts: ["Review the physical handover"], request_id: procedureId }); assert.equal(created.id, procedureId);
  const post = { entity_type: "order", entity_id: ids.orderA, body: "Use the approved drawing", reference: "Revision B", mentions: [ids.sales], reply_to: null, request_id: commentId };
  await command(ids.owner, "discussions.post", post); await command(ids.owner, "discussions.post", post);
  assert.equal((await db.query("select count(*)::int n from public.notifications where entity_reference=$1", [commentId])).rows[0].n, 1);
  await command(ids.productionManager, "routines.start", { procedure_id: procedureId, request_id: runId });
  const loaded = await command(ids.productionManager, "routines.load", { run_id: runId }); assert.ok(loaded.sources.jobs); assert.equal(loaded.record.procedure_revision, 1);
  await command(ids.productionManager, "routines.finish", { run_id: runId, source_fingerprint: loaded.source_fingerprint, reviewed: true, answers: [{ index: 0, answer: "follow_up", note: "Supervisor must confirm the rack" }], note: "Review completed; carry the observation forward", request_id: "b1000000-0000-4000-8000-000000000004" });
  assert.equal((await command(ids.owner, "routines.load", { run_id: runId })).record.status, "completed");
  await assert.rejects(command(ids.dealerStaff, "procedures.list", {}), /Not permitted/);
  await db.query("select set_config('audit.uid',$1,false)", [ids.owner]);
  const quoteId = "b1000000-0000-4000-8000-000000000005";
  await db.query("insert into public.quotes(id,company_id,customer_id,quote_number,quote_date,status) values($1,$2,$3,'COLLAB-REHEARSAL',current_date,'draft')", [quoteId, ids.company, ids.customer]);
  await assert.rejects(db.query("update public.quotes set status='internal_review' where id=$1", [quoteId]).then(() => db.query("update public.quotes set status='approved_for_sending' where id=$1", [quoteId])), /Complete quotation item costing/);
  const require = createRequire(import.meta.url); require("tsx/cjs");
  const { parseLengthInput } = require("../lib/calculations/length-units.ts");
  const { calculateQuoteItem } = require("../lib/calculations/quote.ts");
  const adapterErrors = [];
  const client = { from(table) {
    assert.ok(["customers", "aluminium_profiles", "dies", "quotes_authorized", "quote_items_authorized", "quotes"].includes(table));
    const filters = [], parameters = []; let update = null;
    const field = key => { assert.match(key, /^[a-z_]+$/); return '"' + key + '"'; };
    const execute = async (single = false) => {
      try {
        const values = [...parameters];
        const change = update ? "update public." + table + " set " + Object.entries(update).map(([key, value]) => { values.push(value); return field(key) + "=$" + values.length; }).join(",") : "select * from public." + table;
        const rows = (await db.query(change + (filters.length ? " where " + filters.join(" and ") : "") + (update ? " returning id" : ""), values)).rows;
        return { data: single ? rows[0] ?? null : rows, error: null };
      } catch (error) { adapterErrors.push({ table, code: error.code, message: error.message }); return { data: null, error: { code: error.code, message: error.message } }; }
    };
    const q = { select() { return q; }, update(values) { update = values; return q; }, eq(key, value) { parameters.push(value); filters.push(field(key) + "=$" + parameters.length); return q; }, in(key, values) { const slots = values.map(value => { parameters.push(value); return "$" + parameters.length; }); filters.push(field(key) + " in (" + slots.join(",") + ")"); return q; }, maybeSingle() { return execute(true); }, then(resolve, reject) { return execute().then(resolve, reject); } };
    return q;
  }, async rpc(name, args) {
    assert.equal(name, "save_quote_atomic");
    try { return { data: (await db.query("select public.save_quote_atomic($1::uuid,$2::jsonb,$3::jsonb,$4::integer,$5::timestamptz,$6::text) id", [args.p_quote_id, args.p_quote, args.p_items, args.p_expected_revision, args.p_expected_updated_at, args.p_revision_reason])).rows[0].id, error: null }; }
    catch (error) { adapterErrors.push({ name, code: error.code, message: error.message }); return { data: null, error: { code: error.code, message: error.message } }; }
  } };
  const Module = require("node:module"), original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "@/lib/auth") return { getSessionContext: async () => ({ userId: ids.owner, companyId: ids.company, role: "owner", dealerId: null, fullName: "Owner" }) };
    if (request === "@/lib/supabase/server") return { createClient: async () => client };
    if (request === "next/cache") return { revalidatePath() {} };
    return original.call(this, request, parent, isMain);
  };
  let quoteActions;
  try { quoteActions = require("../lib/actions/quotes-orders.ts"); } finally { Module._load = original; }
  await db.exec("set role authenticated");
  const line = { profile_id: ids.profile, die_id: null, quantity_pieces: 100, length_per_piece_m: parseLengthInput("20", "ft").metres, section_weight_kg_per_m: 0.8, billet_rate_per_kg: 200, conversion_charge_per_kg: 30, finishing_type: "mill_finish", finishing_charge_type: "per_kg", finishing_charge: 0, die_charge: 0, packing_charge: 0, transport_charge: 0, other_charges: 0, margin_percent: 10 };
  const input = { customer_id: ids.customer, quote_date: "2026-10-22", status: "draft", gst_percent: 18, items: [line] };
  const saved = await quoteActions.saveQuoteAction(input); assert.equal(saved.success, true, JSON.stringify({ error: saved.error, adapterErrors }));
  const stored = (await db.query("select * from public.quote_items_authorized where quote_id=$1", [saved.quoteId])).rows[0];
  const expected = calculateQuoteItem(line);
  for (const key of ["length_per_piece_m", "total_meters", "total_weight_kg", "line_total_before_gst"]) assert.equal(Number(stored[key]), expected[key], key);
  const incomplete = await quoteActions.saveQuoteAction({ ...input, items: [{ ...line, finishing_charge_type: "per_sqft", finishing_charge: 5 }] }); assert.equal(incomplete.success, true, incomplete.error);
  const review = await quoteActions.updateQuoteStatusAction(incomplete.quoteId, "internal_review"); assert.equal(review.success, true, JSON.stringify({ review, adapterErrors }));
  const denied = await quoteActions.updateQuoteStatusAction(incomplete.quoteId, "approved_for_sending"); assert.equal(denied.success, false); assert.match(denied.error, /Item 1/);
  await assert.rejects(db.query("select subtotal from public.quotes where id=$1", [saved.quoteId]), /permission denied/);
  assert.equal((await quoteActions.updateQuoteStatusAction(saved.quoteId, "internal_review")).success, true);
  assert.equal((await quoteActions.updateQuoteStatusAction(saved.quoteId, "approved_for_sending")).success, true);
  await db.exec("reset role");
  const quote = (await db.query("select * from public.quotes where id=$1", [saved.quoteId])).rows[0];
  const company = (await db.query("select * from public.companies where id=$1", [ids.company])).rows[0];
  quote.customers = (await db.query("select * from public.customers where id=$1", [ids.customer])).rows[0];
  stored.aluminium_profiles = (await db.query("select * from public.aluminium_profiles where id=$1", [ids.profile])).rows[0];
  const { buildQuotePdf } = require("../lib/pdf/quote-pdf.ts");
  const pdf = await buildQuotePdf({ company, settings: {}, quote, items: [stored] });
  const evidence = process.env.COLLABORATION_EVIDENCE_DIR || "docs/evidence/UPGRADE_EOS_COLLABORATION_2026-10-22";
  mkdirSync(evidence, { recursive: true }); writeFileSync(path.join(evidence, "canonical-length-quotation.pdf"), pdf);
  console.log(JSON.stringify({ canonical_quote: { feet: 20, metres: Number(stored.length_per_piece_m), total_metres: Number(stored.total_meters), theoretical_kg: Number(stored.total_weight_kg), actual_server_action: saved.success, incomplete_draft_saved: incomplete.success, incomplete_confirmation_denied: !denied.success, pdf_bytes: pdf.length, pdf: path.join(evidence, "canonical-length-quotation.pdf") } }, null, 2));
  console.log(JSON.stringify({ upgrade_function_hashes: (await db.query("select n.nspname schema,p.proname name,md5(btrim(replace(p.prosrc,chr(13),''))) body_md5 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('customer_has_current_dealer_record','collaboration_can_read','collaboration_record_visible','operating_procedure_projection','daily_routine_projection','daily_routine_sources','collaboration_workflow_command','guard_quote_preparation_stage') order by p.proname")).rows }, null, 2));
  console.log(JSON.stringify({ capture: "live-20261021 plus hosted follow-up migration order", catalog_failures: failures.length, migrations_replayed: files.length, checks: ["DDL with existing quote triggers", "actual notification constraints and one mention on retry", "procedure owner and backup", "routine read and observed completion", "dealer denial", "empty quote confirmation denied"], operator_function_hashes: (await db.query("select proname,md5(btrim(replace(prosrc,chr(13),''))) hash from pg_proc where proname in ('operator_workflow_allowed','capture_operator_location_change','operator_workflow_command') order by proname")).rows }, null, 2));
} finally { await db.close(); }

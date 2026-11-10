import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pushYield, estimatedBilletKg, bundleSplit, recoveryPercent, outputAfterRejects } from "../lib/calculations/press-output.ts";
import { applyKeypadKey, cleanNumericInput, parseKeypadValue } from "../lib/forms/numeric-keypad.ts";
import { enqueueTap, readTapQueue, tapIsStale, tapQueueKey, pressCommands, samplingCommands, scrapCommands, pmCommands, percent, formatMinutes } from "../lib/press/press-floor.ts";
import { proposalHref, proposalWhy, proposalSummary, PROPOSAL_TYPE_KEYS } from "../lib/proposals/proposals.ts";

const standard = { buttLengthMm: 25, frontCropMm: 500, backCropMm: 500, sawKerfMm: 4, densityKgM3: 2700 };
const U = n => `bd000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("AP-012/013 one 60 kg, 178 mm billet yields 10 pieces of 6 m at 0.95 kg/m with butt, crops, saw and cut-off summing to the billet", () => {
  const y = pushYield({ ...standard, billetKg: 60, billetDiameterMm: 178, kgPerM: 0.95, cutM: 6 });
  assert.deepEqual(y, { buttKg: 1.68, cropKg: 0.95, sawKg: 0.038, goodKg: 57, cutoffKg: 0.332, pieces: 10 });
  assert.equal(Math.round((y.buttKg + y.cropKg + y.sawKg + y.goodKg + y.cutoffKg) * 1000) / 1000, 60);
});

test("AP-012 missing inputs stay blank, never zero", () => {
  for (const missing of ["billetKg", "billetDiameterMm", "kgPerM", "cutM", "buttLengthMm", "densityKgM3"]) {
    assert.equal(pushYield({ ...standard, billetKg: 60, billetDiameterMm: 178, kgPerM: 0.95, cutM: 6, [missing]: null }), null, missing);
  }
  assert.equal(pushYield({ ...standard, billetKg: 0, billetDiameterMm: 178, kgPerM: 0.95, cutM: 6 }), null);
  assert.equal(estimatedBilletKg(178, null, 2700), null);
  assert.equal(estimatedBilletKg(178, 900, 2700), 60.469);
  assert.equal(bundleSplit(40, null), null);
  assert.deepEqual(bundleSplit(43, 10), { perBundle: 10, full: 4, loose: 3 });
  assert.equal(recoveryPercent(null, 240), null);
  assert.equal(recoveryPercent(216.6, 240), 90.25);
});

test("AP-012 a billet too short for one piece yields no pieces and everything after the butt is crop and cut-off", () => {
  const y = pushYield({ ...standard, billetKg: 3, billetDiameterMm: 178, kgPerM: 0.95, cutM: 6 });
  assert.equal(y.pieces, 0);
  assert.equal(y.goodKg, 0);
  assert.equal(Math.round((y.buttKg + y.cropKg + y.cutoffKg) * 1000) / 1000, 3);
});

test("AP-012 rejects come off the expected pieces; an explicit good count overrides", () => {
  assert.deepEqual(outputAfterRejects({ expectedPieces: 40, cutM: 6, kgPerM: 0.95, rejectPieces: 2 }), { goodPieces: 38, goodKg: 216.6, rejectKg: 11.4 });
  assert.deepEqual(outputAfterRejects({ expectedPieces: 40, cutM: 6, kgPerM: 0.95, rejectPieces: 0, goodPieces: 37 }), { goodPieces: 37, goodKg: 210.9, rejectKg: 0 });
  assert.equal(outputAfterRejects({ expectedPieces: 4, cutM: 6, kgPerM: 0.95, rejectPieces: 5 }), null);
});

test("AP-087 keypad keys build a number; one decimal point; blank stays null", () => {
  let value = "";
  for (const key of ["0", "1", ".", "2", ".", "5", "5", "5"]) value = applyKeypadKey(value, key, { decimal: true, maxDecimals: 3 });
  assert.equal(value, "1.255");
  assert.equal(applyKeypadKey("12", "back"), "1");
  assert.equal(applyKeypadKey("12", "clear"), "");
  assert.equal(applyKeypadKey("", "."), "0.");
  assert.equal(applyKeypadKey("12", ".", { decimal: false }), "12", "whole-number fields refuse the point");
  assert.equal(applyKeypadKey("123456789012", "3"), "123456789012", "length is capped");
  assert.equal(cleanNumericInput("1,5 kg", true), "1.5");
  assert.equal(cleanNumericInput("12.5", false), "125");
  assert.equal(parseKeypadValue(""), null);
  assert.equal(parseKeypadValue("."), null);
  assert.equal(parseKeypadValue("0"), 0);
});

test("AP-011 the station tap queue keeps unique taps, survives bad storage, and marks old taps", () => {
  const tap = { id: U(1), session_id: U(2), job_id: U(3), client_at: new Date().toISOString() };
  let queue = enqueueTap([], tap);
  queue = enqueueTap(queue, tap);
  assert.equal(queue.length, 1, "a repeated id is not queued twice");
  assert.deepEqual(readTapQueue(JSON.stringify(queue)), queue);
  assert.deepEqual(readTapQueue("not json"), []);
  assert.deepEqual(readTapQueue(JSON.stringify([{ id: "x" }])), []);
  assert.equal(tapIsStale({ ...tap, client_at: new Date(Date.now() - 16 * 60e3).toISOString() }), true);
  assert.equal(tapIsStale(tap), false);
  assert.match(tapQueueKey(U(9), U(8)), /^eos:press-taps:/);
  assert.throws(() => tapQueueKey("company", U(8)));
});

test("Batch 2 command schemas refuse malformed input before the database sees it", () => {
  assert.equal(pressCommands.push.safeParse({ id: U(1), session_id: U(2), job_id: U(3) }).success, true);
  assert.equal(pressCommands.push.safeParse({ id: "1", session_id: U(2), job_id: U(3) }).success, false);
  assert.equal(pressCommands.push.safeParse({ id: U(1), session_id: U(2), job_id: U(3), company_id: U(4) }).success, false, "company never comes from the browser");
  assert.equal(pressCommands.idle_answer.safeParse({ session_id: U(1), reason: "power" }).success, true);
  assert.equal(pressCommands.idle_answer.safeParse({ session_id: U(1), reason: "lunch" }).success, false);
  assert.equal(pressCommands.void.safeParse({ push_id: U(1), reason: "short" }).success, false);
  assert.equal(pressCommands.backfill.safeParse({ job_id: U(1), count: 51, reason: "Station was offline all shift" }).success, false);
  assert.equal(scrapCommands.propose.safeParse({ machine_id: U(1), die_id: U(2), butt_length_mm: 25, front_crop_mm: 0, back_crop_mm: 0, saw_kerf_mm: 4, rationale: "Both scopes" }).success, false);
  assert.equal(samplingCommands.trigger_save.safeParse({ plan_id: U(1), kind: "every_n_pushes", blocks_release: true }).success, false);
  assert.equal(samplingCommands.sample_record.safeParse({ id: U(1), results: [{ item_id: U(2), observed: 1.4, visual_ok: true }] }).success, false);
  assert.equal(pmCommands.save.safeParse({ machine_id: U(1), asset_kind: "saw", task: "Blade change", basis: "pushes", interval_value: 2000, safety_critical: false }).success, true);
});

test("Batch 2 proposals open on their record and explain where every number came from", () => {
  for (const type of ["production.expected_output", "die.service_due", "maintenance.pm_due"]) assert.ok(PROPOSAL_TYPE_KEYS.includes(type));
  const base = { evidence: {}, versions: {}, rule_key: "r", reason: "Reason given.", confidence: 0.75, status: "open", created_at: new Date().toISOString(), expires_at: new Date().toISOString(),
    decided_at: null, decided_by: null, edited_fields: [], decision_note: null, outcome: null, editable: [], can_decide: true, stale_now: false, job_run_id: null, title: "t" };
  const job = { ...base, id: U(5), proposal_type: "production.expected_output", target_key: U(6),
    payload: { good_pieces: 40, good_kg: 228, butt_kg: 6.72, crop_kg: 3.8, saw_kg: 0.152, cutoff_kg: 1.328, recovery_percent: 95, bundles: { full: 4, loose: 0, per_bundle: 10 } },
    evidence: { pushes: 4, billet_kg: 240, input_basis: "linked_billets", linked_billets: 4, estimated_pushes: 0, standard: { version: 1, scope: "company", butt_length_mm: 25, front_crop_mm: 500, back_crop_mm: 500, saw_kerf_mm: 4 }, cut_m: 6, kg_per_m: 0.95 } };
  assert.equal(proposalHref(job), `/production/${U(6)}#proposal-${U(5)}`);
  assert.match(proposalSummary(job), /40 good pieces, 228 kg \(4 bundles of 10\)/);
  assert.ok(proposalWhy(job).some(line => /4 push\(es\) used 240 kg/.test(line)));
  assert.ok(proposalWhy(job).some(line => /share of pushes with a weighed or linked billet/.test(line)));
  const die = { ...base, id: U(7), proposal_type: "die.service_due", target_key: `${U(8)}:nitriding`, payload: { service_event: "nitriding", scheduled_for: "2026-11-12" }, evidence: { basis: "pushes_since_service", value: 3, warn_at: 3 } };
  assert.equal(proposalHref(die), `/dies/${U(8)}#proposal-${U(7)}`);
  const pm = { ...base, id: U(9), proposal_type: "maintenance.pm_due", target_key: U(10), payload: { window_start: new Date().toISOString(), window_end: new Date().toISOString() },
    evidence: { basis: "pushes", interval: 4, counter: { value: 4, percent: 100 }, safety_critical: true, window_source: "next_working_day" } };
  assert.equal(proposalHref(pm), `/production/floor#proposal-${U(9)}`);
  assert.ok(proposalWhy(pm).some(line => /only a supervisor can dismiss/i.test(line)));
});

test("Batch 2 helpers format honestly and the migration stays additive", () => {
  assert.equal(percent(1, 0), null);
  assert.equal(percent(9, 10), 90);
  assert.equal(formatMinutes(null), "—");
  assert.equal(formatMinutes(125), "2 h 5 min");
  const sql = readFileSync(new URL("../supabase/migrations/20261110100000_autopilot_batch_2.sql", import.meta.url), "utf8");
  assert.doesNotMatch(sql, /\bdrop\s+table\b/i);
  assert.doesNotMatch(sql, /\bdrop\s+column\b/i);
  assert.doesNotMatch(sql, /disable\s+row\s+level\s+security/i);
  assert.match(sql, /grant execute on function public\.ap_press\(text, jsonb\) to authenticated/);
  assert.doesNotMatch(sql, /grant (select|insert|update|delete|all) on public\.\w+ to (anon|authenticated)/i, "no direct table grants to clients");
});

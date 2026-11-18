import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanArithmeticInput, evaluateArithmetic, formatArithmeticResult, looksLikeArithmetic, resolveNumericEntry } from "../lib/forms/arithmetic.ts";
import { barsForCuts, buildSystemOrderLines, hardwareNote } from "../lib/systems-configurator/order-lines.ts";
import { combinedPlan, compareCutPlans, piecesByJob, piecesPerPush, separatePlan, usableLengthPerPush } from "../lib/calculations/cut-combination.ts";
import { coatingGroupKey, countShadeChanges, planCoatingRuns } from "../lib/workflow/coating-batches.ts";
import { NEVER_UNDOABLE, UNDOABLE, UNDO_WINDOW_MS, isUndoable, taskUndoTarget } from "../lib/undo/registry.ts";
import { VOICE_NOTICE, appendDictation, parseVoiceLanguage, speechRecognitionCtor } from "../lib/forms/voice-input.ts";
import { BATCH10_READS, UNDO_KINDS, coatingCommands, coatingConfirmSchema, crewCommands, cutCombineCommands, cutPrepareSchema, energyCommands, equivalentCommands, stockRunCommands, systemsOrderCommands, undoCommands } from "../lib/autopilot-batch10/commands.ts";
import { JOBS } from "../lib/jobs/registry.ts";

const code = file => readFileSync(file, "utf8").split(/\r?\n/).filter(line => !/^\s*\/\//.test(line)).join("\n");
const migration = readFileSync("supabase/migrations/20261117100000_autopilot_batch_10.sql", "utf8");
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ---------------------------------------------------------------- AP-088
test("AP-088 a typed calculation gives its result; the catalogue examples work", () => {
  assert.deepEqual(evaluateArithmetic("=12*6.4"), { ok: true, value: 76.80000000000001, expression: "12*6.4" });
  assert.equal(formatArithmeticResult(76.80000000000001), "76.8");
  assert.equal(evaluateArithmetic("250+180").value, 430);
  assert.equal(evaluateArithmetic("= (250 + 180) / 2 - 15").value, 200);
  assert.equal(evaluateArithmetic("2+3*4").value, 14, "multiplication before addition");
  assert.equal(evaluateArithmetic("12 x 6").value, 72, "x as typed on a phone");
  assert.equal(evaluateArithmetic("0x10").value, 0, "x is always multiplication, never a hexadecimal prefix");
  assert.equal(evaluateArithmetic("1,250 + 750").value, 2000, "thousands separator");
  assert.equal(evaluateArithmetic("-5 + 8").value, 3);
});

test("AP-088 nothing but numbers and + - * / is evaluated: no code, no letters, no division by zero", () => {
  for (const bad of ["alert(1)", "1;2", "process.exit()", "2**3", "1e5", "0b10", "Math.max(1,2)", "5 5", "(", "()", "3+", "1/0", "=", "9".repeat(90), "this", "`1`", "1,2"]) {
    const out = evaluateArithmetic(bad);
    assert.equal(out.ok, false, `${bad} is refused`);
    assert.ok(out.error.length > 3);
  }
  assert.doesNotMatch(code("lib/forms/arithmetic.ts"), /\beval\s*\(|new Function|Function\s*\(/, "the parser never evaluates code");
  assert.equal(cleanArithmeticInput("=12*6.4; alert(1)"), "=12*6.4 (1)", "letters and other symbols cannot be typed into the field");
});

test("AP-088 a plain number is left alone; an expression becomes its result with the expression kept as a hint only", () => {
  assert.equal(looksLikeArithmetic("12.5"), false);
  assert.equal(looksLikeArithmetic("-5"), false, "a signed number is a number");
  assert.equal(looksLikeArithmetic("=12"), true);
  assert.deepEqual(resolveNumericEntry("12.5"), { value: "12.5", hint: null, error: null });
  assert.deepEqual(resolveNumericEntry("=12*6.4"), { value: "76.8", hint: "= 12*6.4", error: null });
  assert.deepEqual(resolveNumericEntry("10/3", { maxDecimals: 2 }), { value: "3.33", hint: "= 10/3", error: null });
  assert.deepEqual(resolveNumericEntry("10/4", { decimal: false }), { value: "3", hint: "= 10/4 (rounded to a whole number)", error: null });
  assert.deepEqual(resolveNumericEntry("5-9"), { value: "5-9", hint: null, error: "The result is below zero" }, "a broken or negative result keeps what was typed");
  assert.equal(resolveNumericEntry("12*").error, "Check the calculation");
  // The shared numeric inputs use it on blur.
  assert.match(code("components/ui/numeric-field.tsx"), /resolveNumericEntry\(value/);
  assert.match(code("components/modules/autopilot-batch6/shared.tsx"), /resolveNumericEntry\(value\)/);
});

// ---------------------------------------------------------------- AP-067
test("AP-067 pieces per push count one saw kerf per cut, and the usable length follows billet metal, crops and the run-out table", () => {
  assert.equal(piecesPerPush(44, 6, 5), 7);
  assert.equal(piecesPerPush(12, 6, 0), 2);
  assert.equal(piecesPerPush(12, 6, 5), 1, "two 6 m cuts need 12.005 m with a kerf between them");
  assert.equal(piecesPerPush(5, 6, 5), 0);
  // 178 mm billet, 700 mm long, 25 mm butt at 0.95 kg/m is about 47.7 m of extrusion: capped by a 45 m table, less 1 m crops.
  assert.equal(usableLengthPerPush({ billet_mm: 700, billet_diameter_mm: 178, butt_mm: 25, kg_per_m: 0.95, runout_m: 45, front_crop_m: 0.5, back_crop_m: 0.5 }), 44);
  // A short billet is limited by its metal, not the table.
  const short = usableLengthPerPush({ billet_mm: 400, billet_diameter_mm: 178, butt_mm: 25, kg_per_m: 0.95, runout_m: 45, front_crop_m: 0.5, back_crop_m: 0.5 });
  assert.ok(short > 24 && short < 27);
  assert.equal(usableLengthPerPush({ billet_mm: 700, billet_diameter_mm: null, butt_mm: 25, kg_per_m: 0.95, runout_m: 45 }), null, "a missing input stays unknown, not zero");
});

test("AP-067 combining gives every job exactly its pieces, never needs more pushes, and shows higher recovery when leftovers fit another job", () => {
  const demands = [{ job_id: "A", length_m: 6, pieces: 40 }, { job_id: "B", length_m: 3.2, pieces: 40 }];
  const sep = separatePlan(demands, 44, 5);
  assert.equal(sep.pushes, 6 + 4, "A: 7 per push -> 6 pushes; B: 13 per push -> 4 pushes");
  const cmp = compareCutPlans(demands, 44, 5);
  assert.ok(cmp.ok);
  assert.deepEqual(piecesByJob(cmp.combined), { A: 40, B: 40 }, "order quantities unchanged");
  assert.ok(cmp.combined.pushes < sep.pushes && cmp.improves);
  assert.ok(cmp.combined.recovery_percent > cmp.separate.recovery_percent);
  for (const p of cmp.combined.patterns) {
    assert.ok(p.used_m <= 44 + 1e-9, "no push is longer than the usable length");
    for (const c of p.cuts) assert.ok([6, 3.2].includes(c.length_m), "cut lengths are the jobs' own");
  }
  // One job alone, or lengths that leave nothing to share: no gain, the separate plan stands.
  const alone = compareCutPlans([{ job_id: "A", length_m: 6, pieces: 14 }], 42.03, 5);
  assert.deepEqual([alone.improves, alone.saved_pushes], [false, 0]);
  // Invalid input is refused with a reason.
  assert.match(compareCutPlans([{ job_id: "A", length_m: 50, pieces: 1 }], 44, 5).error, /longer than one push/);
  assert.match(compareCutPlans([{ job_id: "A", length_m: 6, pieces: 2.5 }], 44, 5).error, /whole pieces/);
  assert.match(compareCutPlans(demands, 0, 5).error, /usable length/);
  assert.match(compareCutPlans([demands[0], demands[0]], 44, 5).error, /twice/);
});

test("AP-067 many jobs and awkward lengths still produce an exact plan quickly", () => {
  const demands = Array.from({ length: 12 }, (_, n) => ({ job_id: `J${n}`, length_m: 2.4 + n * 0.37, pieces: 37 + n * 11 }));
  const started = Date.now();
  const cmp = compareCutPlans(demands, 44, 5);
  assert.ok(Date.now() - started < 5000);
  assert.ok(cmp.ok);
  const made = piecesByJob(cmp.combined);
  for (const d of demands) assert.equal(made[d.job_id], d.pieces);
  assert.ok(cmp.combined.pushes <= cmp.separate.pushes);
  assert.ok(combinedPlan(demands, 44, 5).patterns.every(p => p.used_m <= 44 + 1e-9));
});

// ---------------------------------------------------------------- AP-055
const settings = { capacity_kg_per_hour: 100, changeover_minutes: 60, day_start: "08:00", hours_per_day: 8 };
const days = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];
const job = (id, shade, due, kg = 400, extra = {}) => ({ id, order_number: `SO-${id}`, customer: "Sharma", shade_key: shade, shade, brand: null, kg, due, priority: "normal", ...extra });

test("AP-055 jobs are grouped by shade and brand, runs follow the earliest promise, and colour changes fall against due-date order", () => {
  const jobs = [job("1", "RAL 9010", "2026-11-17"), job("2", "RAL 7016", "2026-11-18"), job("3", "RAL 9010", "2026-11-19"), job("4", "RAL 7016", "2026-11-20"), job("5", "RAL 9010", "2026-11-21")];
  assert.equal(countShadeChanges(jobs.map(coatingGroupKey)), 4);
  const plan = planCoatingRuns(jobs, { runDay: "2026-11-16", settings, workingDays: days });
  assert.deepEqual(plan.groups.map(g => [g.shade, g.job_ids.join("")]), [["RAL 9010", "135"], ["RAL 7016", "24"]]);
  assert.deepEqual([plan.shade_changes, plan.baseline_changes, plan.saved_changes], [1, 4, 3]);
  // 1,200 kg at 100 kg/h is 12 h: 8 h on the 16th, 4 h on the 17th. Then 1 h change and 8 h: finishes on the 18th.
  assert.deepEqual(plan.groups.map(g => [g.start_day, g.finish_day]), [["2026-11-16", "2026-11-17"], ["2026-11-17", "2026-11-18"]]);
  assert.deepEqual(plan.breaches, [], "nobody is late in this order");
  // Different brands of the same shade are separate runs; brand case does not split a run.
  assert.notEqual(coatingGroupKey({ id: "x", shade_key: "RAL 9010", brand: "Asian" }), coatingGroupKey({ id: "y", shade_key: "RAL 9010", brand: "Jotun" }));
  assert.equal(coatingGroupKey({ id: "x", shade_key: "RAL 9010", brand: "Asian" }), coatingGroupKey({ id: "y", shade_key: "RAL 9010", brand: "ASIAN " }));
});

test("AP-055 promised dates the batching would miss are shown before confirmation, and the supervisor's own order is used", () => {
  const jobs = [job("1", "RAL 9010", "2026-11-18", 800), job("2", "RAL 7016", "2026-11-16", 800), job("3", "RAL 9010", "2026-11-16", 800)];
  const plan = planCoatingRuns(jobs, { runDay: "2026-11-16", settings, workingDays: days });
  // White (1,600 kg, due earliest 16th) runs first and takes both days; grey due on the 16th then finishes on the 19th.
  assert.equal(plan.groups[0].shade_key, "RAL 7016", "ties on the earliest promise fall back to the shade key");
  const late = plan.breaches.map(b => [b.job_id, b.days_late]);
  assert.ok(late.length >= 1 && late.every(([, d]) => d > 0), "late jobs are listed with the days late");
  const reordered = planCoatingRuns(jobs, { runDay: "2026-11-16", settings, workingDays: days, order: ["RAL 9010|", "RAL 7016|"] });
  assert.deepEqual(reordered.groups.map(g => g.shade_key), ["RAL 9010", "RAL 7016"]);
  assert.ok(reordered.breaches.some(b => b.job_id === "2"), "moving a run later shows who becomes late");
  // An unknown key in the supervisor's order is ignored; groups left out follow in the default order.
  assert.equal(planCoatingRuns(jobs, { runDay: "2026-11-16", settings, workingDays: days, order: ["nope", "RAL 9010|"] }).groups.length, 2);
});

test("AP-055 missing data stays blank: no capacity means no finish days, no weight means no time, no shade means a run of its own", () => {
  const jobs = [job("1", "RAL 9010", "2026-11-18", null), job("2", null, "2026-11-17"), job("3", null, "2026-11-17")];
  const untimed = planCoatingRuns(jobs, { runDay: "2026-11-16", settings: null, workingDays: days });
  assert.equal(untimed.timed, false);
  assert.ok(untimed.groups.every(g => g.finish_day === null) && untimed.breaches.length === 0);
  assert.match(untimed.notes.join(" "), /capacity is not set/);
  const timed = planCoatingRuns(jobs, { runDay: "2026-11-16", settings, workingDays: days });
  assert.equal(timed.groups.length, 3, "jobs without a shade are not batched together");
  assert.equal(timed.groups.find(g => g.shade_key === "RAL 9010").kg, null, "an unweighed job has no weight, not zero");
  assert.equal(timed.unweighed_jobs, 1);
  assert.match(timed.notes.join(" "), /no input weight/);
  assert.equal(planCoatingRuns([], { runDay: "2026-11-16", settings, workingDays: days }).groups.length, 0);
});

// ---------------------------------------------------------------- AP-070
test("AP-070 cuts become whole stock lengths per profile with free stock shown; unlinked or oversize cuts are listed, not ordered", () => {
  assert.equal(barsForCuts([1750, 1750, 1750, 1750, 1450, 1450, 1450, 1450], 6000), 3);
  assert.equal(barsForCuts([3000, 3000], 6000), 2, "two 3 m cuts need 6.005 m with the saw kerf, so two bars");
  assert.equal(barsForCuts([3000, 3000], 6000, 0), 1);
  const P = uuid(1), Q = uuid(2);
  const free = (pieces, length = 6) => ({ pieces, kg: pieces * length * 0.95, lots: [{ finish: "mill_finish", piece_length_m: length, pieces, kg: pieces * length * 0.95 }] });
  const profiles = { [P]: { profile_code: "OM-2045", profile_name: "Track", section_weight_kg_per_m: 0.95, hsn_code: "7604", is_active: true, free: free(2) },
    [Q]: { profile_code: "OM-OLD", profile_name: "Old", section_weight_kg_per_m: 1, hsn_code: null, is_active: false, free: free(0) } };
  const cut = (profile_id, mm, quantity, code = "OM-2045", stock = 6000) => ({ profile_id, profile_code: code, profile_name: "Track", cut_length_mm: mm, quantity, stock_length_mm: stock, kg_per_m: 0.95 });
  const out = buildSystemOrderLines([cut(P, 1750, 4), cut(P, 1450, 4), cut(null, 900, 2, "UNLINKED"), cut(Q, 900, 2, "OM-OLD"), cut(P, 7000, 1), cut(P, 0, 1)], profiles);
  assert.equal(out.lines.length, 1);
  const line = out.lines[0];
  assert.deepEqual([line.profile_code, line.stock_length_m, line.pieces, line.cuts, line.free_pieces, line.short_pieces, line.hsn_code], ["OM-2045", 6, 3, 8, 2, 1, "7604"]);
  assert.equal(line.weight_kg, 17.1);
  assert.equal(line.offcut_m, 5.2);
  assert.deepEqual(out.skipped.map(s => s.profile_code).sort(), ["OM-2045", "OM-2045", "OM-OLD", "UNLINKED"]);
  // Stock of another finish or length is not counted as free for the line.
  const anod = { ...profiles, [P]: { ...profiles[P], free: { pieces: 9, kg: 1, lots: [{ finish: "anodizing", piece_length_m: 6, pieces: 5, kg: 1 }, { finish: "mill_finish", piece_length_m: 4.5, pieces: 4, kg: 1 }] } } };
  assert.equal(buildSystemOrderLines([cut(P, 1750, 4)], anod).lines[0].free_pieces, 0);
  const note = hardwareNote({ number: "SYS-1", project_name: "Villa 12" }, [{ item_code: "H-101", item_name: "Roller", quantity: 4, unit: "pcs" }], [{ material_type: "glass", item_name: "5 mm clear", quantity: 2.5, unit: "sqm" }]);
  assert.match(note, /From configurator project SYS-1 \(Villa 12\)\. Hardware: H-101 Roller x 4 pcs\. Other materials: 5 mm clear x 2\.5 sqm\./);
  assert.ok(note.length <= 2000);
});

// ---------------------------------------------------------------- AP-093
test("AP-093 only low-risk kinds are undoable; nothing that posts stock, money or a quality decision can be registered", () => {
  assert.equal(UNDO_WINDOW_MS, 10000);
  for (const kind of Object.keys(UNDOABLE)) {
    assert.ok(isUndoable(kind));
    assert.ok(!NEVER_UNDOABLE.some(word => kind.includes(word)), `${kind} is not a posting action`);
  }
  for (const kind of ["stock.adjust", "invoice.post", "payment.record", "receipt.allocate", "credit_note.issue", "dispatch.gate_out", "quality.release", "qc.release", "ncr.close", "series.confirm", "period.close", "anything.else"]) {
    assert.equal(isUndoable(kind), false, `${kind} never offers undo`);
  }
  assert.deepEqual([...UNDO_KINDS].sort(), Object.keys(UNDOABLE).sort(), "the gateway accepts exactly the registered kinds");
  for (const kind of UNDO_KINDS) assert.ok(migration.includes(`'${kind}'`), `${kind} is allowed by the database`);
  assert.equal(taskUndoTarget("open", "completed"), "open");
  assert.equal(taskUndoTarget("open", "open"), null);
  assert.equal(taskUndoTarget("weird", "open"), null);
  // The toast helper and the screens that use it bundle no server module.
  for (const file of ["components/ui/undo-toast.ts", "components/modules/autopilot-batch8/saved-views.tsx"]) assert.doesNotMatch(code(file), /from "@\/lib\/actions\//, `${file} imports no server action`);
  assert.match(code("components/modules/tasks-dashboard-client.tsx"), /offerUndo\(\{ kind: "task\.status"/);
  assert.match(code("components/modules/notifications-client.tsx"), /kind: "notification\.read"/);
});

// ---------------------------------------------------------------- AP-023
test("AP-023 dictated text is appended and capped; the microphone is offered only where the browser has speech recognition", () => {
  assert.equal(appendDictation("", "  die mein crack hai  ", 100), "die mein crack hai");
  assert.equal(appendDictation("Billet short", "press ruk gaya", 100), "Billet short press ruk gaya");
  assert.equal(appendDictation("Typed. ", "\u0007spoken\ntext", 100), "Typed. spoken text", "control characters removed");
  assert.equal(appendDictation("kept", "   ", 100), "kept");
  const capped = appendDictation("abc", "one two three four five", 12);
  assert.ok(capped.length <= 12 && capped.startsWith("abc one"));
  assert.equal(parseVoiceLanguage("en-IN"), "en-IN");
  assert.equal(parseVoiceLanguage("fr-FR"), "hi-IN");
  assert.equal(speechRecognitionCtor({}), null);
  assert.equal(speechRecognitionCtor(undefined), null);
  class Fake {}
  assert.equal(speechRecognitionCtor({ webkitSpeechRecognition: Fake }), Fake);
  assert.match(VOICE_NOTICE, /speech service may process the audio/);
  const component = code("components/ui/voice-input.tsx");
  assert.doesNotMatch(component, /MediaRecorder|getUserMedia|fetch\(|upload/i, "the app records and uploads no audio");
  assert.match(component, /supported && !disabled \?/);
  assert.match(code("components/modules/operations/operator-tools.tsx"), /<DictationTextarea id=\{`exception-note-/);
  assert.match(code("components/modules/autopilot-batch6/ncr.tsx"), /<DictationTextarea/);
});

// ---------------------------------------------------------------- schemas and wiring
test("batch 10 command schemas refuse malformed input early", () => {
  const u = uuid(7);
  assert.equal(energyCommands.save.safeParse({ machine_id: u, shift_day: "2026-11-15", shift_name: "A" }).success, false, "a reading is required");
  assert.equal(energyCommands.save.safeParse({ machine_id: u, shift_day: "2026-11-15", shift_name: "A", opening_kwh: 10, closing_kwh: 5 }).success, false);
  assert.equal(energyCommands.save.safeParse({ machine_id: u, shift_day: "2026-11-15", shift_name: "A", closing_kwh: 5 }).success, true);
  assert.equal(crewCommands.sign_in.safeParse({ machine_id: u, crew_role: "manager" }).success, false);
  assert.equal(equivalentCommands.propose.safeParse({ profile_id: u, equivalent_profile_id: u, basis: "same_section" }).success, false, "a profile is not its own equivalent");
  assert.equal(equivalentCommands.propose.safeParse({ profile_id: u, equivalent_profile_id: uuid(8), basis: "customer_approved" }).success, false);
  assert.equal(equivalentCommands.consent.safeParse({ order_item_id: u, equivalence_id: u, consent_by_name: "R", consent_channel: "whatsapp", consented_on: "2026-11-15" }).success, false);
  assert.equal(stockRunCommands.save_target.safeParse({ profile_id: u, piece_length_m: 6, target_kg: 100, max_kg: 50 }).success, false);
  assert.equal(stockRunCommands.dismiss.safeParse({ id: u }).success, false, "dismissing needs a reason");
  assert.equal(coatingCommands.save_settings.safeParse({ capacity_kg_per_hour: 0, changeover_minutes: 30 }).success, false);
  assert.equal(coatingConfirmSchema.safeParse({ run_day: "2026-11-16", fingerprint: "x" }).success, false);
  assert.equal(cutPrepareSchema.safeParse({ die_id: u, job_ids: [u], fingerprint: "a".repeat(32) }).success, false, "one job is not a combination");
  assert.equal(cutCombineCommands.cancel.safeParse({ id: u }).success, false);
  assert.equal(systemsOrderCommands.save_settings.safeParse({ enabled: "yes" }).success, false);
  assert.equal(undoCommands.record.safeParse({ kind: "payment.post", target: "x" }).success, false);
  for (const set of [energyCommands, crewCommands, equivalentCommands, stockRunCommands, coatingCommands, cutCombineCommands, systemsOrderCommands, undoCommands]) {
    for (const [name, schema] of Object.entries(set)) assert.equal(schema.safeParse({ surprise: true }).success, false, `${name} refuses unknown keys`);
  }
});

test("batch 10 is wired: gateways, reads, the nightly job, routes, permissions and server-only writes", () => {
  const gateway = code("lib/actions/autopilot.ts");
  for (const rpc of ["ap_energy", "ap_crew", "ap_equivalents", "ap_stock_runs", "ap_coating", "ap_cut_combine", "ap_systems_order", "ap_undo"]) {
    assert.match(gateway, new RegExp(`${rpc}: `));
    assert.match(migration, new RegExp(`create or replace function public\\.${rpc}\\(p_command text, p_payload jsonb\\)`));
    assert.match(migration, new RegExp(`revoke all on function public\\.${rpc}\\(text, jsonb\\) from public, anon;`));
  }
  // Commands the server computes first are not in the browser allow-list.
  for (const [set, name] of [[coatingCommands, "confirm"], [cutCombineCommands, "record"], [systemsOrderCommands, "draft"], [systemsOrderCommands, "link"]]) assert.equal(name in set, false, `${name} is server-only`);
  // No write command is listed as a read (reads skip revalidation).
  for (const write of ["save", "sign_in", "add", "sign_out", "propose", "approve", "retire", "consent", "withdraw_consent", "save_target", "retire_target", "suggest", "dismiss", "save_settings", "set_brand", "accept", "cancel", "record", "notification_unread"]) {
    assert.ok(!BATCH10_READS.includes(write), `${write} is a write`);
  }
  assert.ok(JOBS.some(j => j.job_key === "stock.make_to_stock" && j.schedule === "nightly"));
  assert.match(migration, /\('stock\.make_to_stock', 'nightly'/);
  const permissions = code("lib/auth/route-permissions.ts");
  for (const route of ["/energy/press-meters", "/production/crew", "/production/finishing/coating-runs", "/production/cutting/combine", "/production/capacity/stock-runs", "/orders/equivalents"]) {
    assert.ok(permissions.includes(`prefix: "${route}"`), `${route} has a role rule`);
    assert.ok(readFileSync(`app/(dashboard)${route}/page.tsx`, "utf8").includes("redirect("), `${route} checks the role on the server`);
  }
  // No new /tasks hub, and the migration is additive.
  assert.doesNotMatch(migration, /drop table|drop column|truncate /i);
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;\s*$/m);
  // The pitfall this batch hit: least() ignores nulls, so the last push's gap is guarded explicitly.
  assert.match(migration, /case when pe\.next_at is not null then least\(/);
});

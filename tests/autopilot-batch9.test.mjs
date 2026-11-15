import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { codeKey, parseEnquiry, parseItem, piecesFromKg, readChatText, resolveLine } from "../lib/quotes/enquiry-parser.ts";
import { chainSegments, geometrySvg, kgPerMetre, loopMeasure, readDxf } from "../lib/geometry/dxf.ts";
import { DEFAULT_SCALE, StabilityTracker, bundleDeviation, parseIndicatorLine, splitStream } from "../lib/devices/scale-protocol.ts";
import { FLOOR_MESSAGES, floorText, parseFloorLanguage } from "../lib/i18n/floor.ts";
import { rateCardValidity, rateCardWhatsApp, sortRateLines } from "../lib/commercial/rate-card.ts";
import { buildRateCardPdf, rateCardRows } from "../lib/pdf/rate-card-pdf.ts";
import { buildScrapInvoicePdf } from "../lib/pdf/scrap-invoice-pdf.ts";
import { BATCH9_READS, enquiryLineSchema, enquirySaveSchema, rateCardCommands, registerCommands, scaleCaptureSchema, scrapSaleCommands, weightNoteCommands, cashForecastCommands } from "../lib/autopilot-batch9/commands.ts";
import { JOBS } from "../lib/jobs/registry.ts";
import { PROPOSAL_TYPES, proposalHref } from "../lib/proposals/proposals.ts";

const code = file => readFileSync(file, "utf8").split(/\r?\n/).filter(line => !/^\s*\/\//.test(line)).join("\n");
const migration = readFileSync("supabase/migrations/20261116100000_autopilot_batch_9.sql", "utf8");

// ---------------------------------------------------------------- AP-008
test("AP-008 the catalogue example is read into two lines with code, length, pieces, finish and shade", () => {
  const e = parseEnquiry("OM-4521 6.4 mtr 200 pcs RAL 9010, 2045 mill 100 pcs");
  assert.equal(e.lines.length, 2);
  assert.deepEqual([e.lines[0].code_key, e.lines[0].length_m, e.lines[0].pieces, e.lines[0].finish, e.lines[0].shade], ["OM4521", 6.4, 200, "powder_coating", "RAL 9010"]);
  assert.deepEqual([e.lines[1].code_key, e.lines[1].length_m, e.lines[1].pieces, e.lines[1].finish], ["2045", null, 100, "mill_finish"]);
  assert.ok(e.lines[1].issues.includes("Length not stated"), "an unread value stays null and is named");
});

test("AP-008 chat exports give the sender and only the customer's messages; greetings are not items", () => {
  const android = readChatText("12/11/26, 10:15 - Ramesh Sharma: Namaste sir\n12/11/26, 10:16 - Ramesh Sharma: SL-3020 21ft 150 nos black anodised\n12/11/26, 10:20 - Omalco Sales: Noted\n12/11/26, 10:21 - Ramesh Sharma: AL2045 500 kg 6.1m mill");
  assert.equal(android.source, "chat_export");
  assert.equal(android.sender_name, "Ramesh Sharma");
  assert.doesNotMatch(android.body, /Noted/, "replies from Omalco staff are left out");
  const iphone = parseEnquiry("[12/11/2026, 10:15:20] +91 98765 43210: Sir pls send rate\n[12/11/2026, 10:16:01] +91 98765 43210: SL-3020 21ft 150 nos black anodised");
  assert.equal(iphone.sender_phone, "919876543210");
  assert.equal(iphone.lines.length, 1, "the greeting line is not an item");
  assert.equal(iphone.lines[0].length_m, 6.4008, "21 ft in metres");
});

test("AP-008 lengths in any unit, kg and tonnes, and confidence: high only when exact and complete; unknown codes are low", () => {
  assert.equal(parseItem("OM 4521 12' 6\" 40 pcs mill", 1).length_m, 3.81);
  assert.equal(parseItem("2 track bottom 6400 mm 300 pcs white powder coated", 1).length_m, 6.4);
  assert.equal(parseItem("AL2045 1.5 ton 6m mill", 1).kg, 1500);
  const exact = resolveLine(parseItem("OM-2045 6 m 100 pcs mill", 1), { code_key: "OM2045", profile_id: "p", profile_code: "OM-2045", basis: "code" });
  assert.equal(exact.confidence, "high");
  assert.equal(resolveLine(parseItem("2045 6 m 100 pcs mill", 1), { code_key: "2045", profile_id: "p", basis: "code_number" }).confidence, "medium", "matched only by its number");
  assert.equal(resolveLine(parseItem("OM-2045 6 m 100 pcs", 1), { code_key: "OM2045", profile_id: "p", basis: "code" }).confidence, "medium", "finish not stated is not assumed");
  const unknown = resolveLine(parseItem("XX-999 6 m 100 pcs mill", 1), { code_key: "XX999", profile_id: null });
  assert.deepEqual([unknown.confidence, unknown.issues.at(-1)], ["low", "Unknown code XX-999"]);
  assert.equal(piecesFromKg(500, 6, 0.95), 88);
  assert.equal(piecesFromKg(500, null, 0.95), null);
  assert.equal(codeKey(" om-2045 "), "OM2045");
});

test("AP-008 on a corpus of typical enquiries at least 80% of lines are read correctly and every wrong line is flagged below high", () => {
  const master = { OM4521: "OM-4521", OM2045: "OM-2045", SL3020: "SL-3020", AL2045: "AL-2045", CW5010: "CW-5010" };
  const resolve = key => (master[key] ? { code_key: key, profile_id: key, profile_code: master[key], basis: "code" } : key === "2045" ? { code_key: key, profile_id: "OM2045", profile_code: "OM-2045", basis: "code_number" } : { code_key: key, profile_id: null });
  const corpus = [
    ["OM-4521 6.4 mtr 200 pcs RAL 9010", { code: "OM4521", m: 6.4, pcs: 200, finish: "powder_coating" }],
    ["2045 mill 6m 100 pcs", { code: "2045", m: 6, pcs: 100, finish: "mill_finish" }],
    ["SL-3020 21ft 150 nos black anodised", { code: "SL3020", m: 6.4008, pcs: 150, finish: "anodizing" }],
    ["AL2045 500 kg 6.1m mill", { code: "AL2045", m: 6.1, kg: 500, finish: "mill_finish" }],
    ["CW-5010 5.8 m 60 lengths powder coated RAL 7016", { code: "CW5010", m: 5.8, pcs: 60, finish: "powder_coating" }],
    ["OM 2045 19 ft 80 pcs champagne anodized", { code: "OM2045", m: 5.7912, pcs: 80, finish: "anodizing" }],
    ["om-4521 6000mm 120 nos ral9016", { code: "OM4521", m: 6, pcs: 120, finish: "powder_coating" }],
    ["SL3020 6.4m 1 ton mill", { code: "SL3020", m: 6.4, kg: 1000, finish: "mill_finish" }],
    ["AL-2045 12 ft 6 in 40 pcs mill", { code: "AL2045", m: 3.81, pcs: 40, finish: "mill_finish" }],
    ["CW5010 6m 250kg wood finish", { code: "CW5010", m: 6, kg: 250, finish: "wood_finish" }]
  ];
  let correct = 0; let flaggedWrong = 0; let wrong = 0;
  for (const [text, expected] of corpus) {
    const [line] = parseEnquiry(text).lines; const r = resolveLine(line, resolve(line.code_key));
    const ok = line.code_key === expected.code && line.length_m === expected.m && (expected.pcs ? line.pieces === expected.pcs : line.kg === expected.kg) && line.finish === expected.finish;
    if (ok) correct += 1; else { wrong += 1; if (r.confidence !== "high") flaggedWrong += 1; }
  }
  assert.ok(correct / corpus.length >= 0.8, `${correct}/${corpus.length} lines correct`);
  assert.equal(flaggedWrong, wrong, "every wrong line is flagged");
});

test("AP-008 the saved draft is strict: unknown keys, fractional pieces and over-long text are refused", () => {
  const line = { seq: 1, text: "x", code: null, code_key: null, profile_id: null, profile_code: null, basis: null, length_m: 6, length_text: "6 m", pieces: 10, kg: null, finish: null, shade: null, alloy: null, confidence: "low", issues: [] };
  assert.equal(enquiryLineSchema.safeParse(line).success, true);
  assert.equal(enquiryLineSchema.safeParse({ ...line, pieces: 2.5 }).success, false);
  assert.equal(enquiryLineSchema.safeParse({ ...line, price: 300 }).success, false, "the parser never carries a price");
  assert.equal(enquirySaveSchema.safeParse({ raw_text: "x".repeat(20001), source: "paste", lines: [], unknown_codes: [] }).success, false);
});

// ---------------------------------------------------------------- AP-048
const pairs = list => list.map(([c, v]) => `${c}\n${v}`).join("\n");
const head = units => [[0, "SECTION"], [2, "HEADER"], [9, "$INSUNITS"], [70, String(units)], [0, "ENDSEC"], [0, "SECTION"], [2, "ENTITIES"]];
const lw = (pts, bulges = []) => [[0, "LWPOLYLINE"], [90, String(pts.length)], [70, "1"], ...pts.flatMap(([x, y], k) => [[10, String(x)], [20, String(y)], ...(bulges[k] ? [[42, String(bulges[k])]] : [])])];

test("AP-048 a hollow section: net area = outer - voids, outer perimeter, kg/m from density; arcs are exact", () => {
  const r = readDxf(pairs([...head(4), ...lw([[0, 0], [40, 0], [40, 40], [0, 40]]), ...lw([[2, 2], [38, 2], [38, 38], [2, 38]]), [0, "ENDSEC"], [0, "EOF"]]));
  assert.equal(r.ok, true);
  assert.deepEqual([r.geometry.outer_area_mm2, r.geometry.void_area_mm2, r.geometry.net_area_mm2, r.geometry.outer_perimeter_mm, r.geometry.void_count], [1600, 1296, 304, 160, 1]);
  assert.equal(kgPerMetre(304, 2700), 0.8208);
  const circle = loopMeasure([{ a: { x: 10, y: 0 }, b: { x: -10, y: 0 }, bulge: 1 }, { a: { x: -10, y: 0 }, b: { x: 10, y: 0 }, bulge: 1 }]);
  assert.ok(Math.abs(circle.area - Math.PI * 100) < 1e-9 && Math.abs(circle.perimeter - 20 * Math.PI) < 1e-9);
});

test("AP-048 loose lines and arcs join into loops; inches are converted; a drawing frame is ignored with a warning; text is not a drawing", () => {
  const arcs = pairs([...head(1), [0, "ARC"], [10, "0"], [20, "0"], [40, "1"], [50, "0"], [51, "180"], [0, "LINE"], [10, "-1"], [20, "0"], [11, "1"], [21, "0"], [0, "ENDSEC"]]);
  const half = readDxf(arcs);
  assert.equal(half.ok, true);
  assert.ok(Math.abs(half.geometry.net_area_mm2 - (Math.PI * 25.4 * 25.4) / 2) < 0.01, "a 1 inch half disc in mm²");
  assert.equal(chainSegments([{ a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, bulge: 0 }, { a: { x: 5, y: 5 }, b: { x: 6, y: 5 }, bulge: 0 }]).open, 2);
  const framed = readDxf(pairs([...head(4), ...lw([[-100, -100], [100, -100], [100, 100], [-100, 100]]), ...lw([[0, 0], [10, 0], [10, 10], [0, 10]]), [0, "ENDSEC"]]));
  assert.equal(framed.ok, true);
  assert.equal(framed.geometry.net_area_mm2, 100);
  assert.ok(framed.geometry.warnings.some(w => /frame/.test(w)));
  const noUnits = readDxf(pairs([[0, "SECTION"], [2, "ENTITIES"], ...lw([[0, 0], [10, 0], [10, 10]]), [0, "ENDSEC"]]));
  assert.ok(noUnits.ok && noUnits.geometry.warnings.some(w => /units/.test(w)));
  assert.equal(readDxf("this is not a drawing").ok, false);
  assert.equal(readDxf(pairs([...head(4), [0, "LINE"], [10, "0"], [20, "0"], [11, "5"], [21, "0"], [0, "ENDSEC"]])).ok, false, "an open outline is not measured");
});

test("AP-048 the preview SVG is exactly the shape the database accepts", () => {
  const r = readDxf(pairs([...head(4), ...lw([[0, 0], [40, 0], [40, 40], [0, 40]]), ...lw([[2, 2], [38, 2], [38, 38], [2, 38]], [0.4]), [0, "ENDSEC"]]));
  const svg = geometrySvg(r.geometry);
  const sqlPattern = /'\^<svg xmlns="http:\/\/www\\\.w3\\\.org\/2000\/svg"[^']+'/.exec(migration)[0].slice(1, -1).replaceAll("\\.", "\\.");
  assert.match(svg, new RegExp(sqlPattern));
  assert.doesNotMatch(svg, /<script|on\w+=/i);
});

// ---------------------------------------------------------------- AP-010
test("AP-010 indicator lines in common formats; motion, overload and unknown lines are never a stable weight", () => {
  assert.deepEqual(parseIndicatorLine("ST,GS,+0012.345kg"), { kg: 12.345, stable: true, overload: false, gross: true, raw: "ST,GS,+0012.345kg" });
  assert.equal(parseIndicatorLine("US,NT,-   0.50 kg").stable, false);
  assert.equal(parseIndicatorLine("G    123.45 kg").kg, 123.45);
  assert.equal(parseIndicatorLine("+0123.4").stable, null);
  assert.equal(parseIndicatorLine("1250 g").kg, 1.25);
  assert.equal(parseIndicatorLine("OL,GS,").overload, true);
  assert.equal(parseIndicatorLine("garbage"), null);
  assert.deepEqual(splitStream("ST,GS,+12.30kg\r\nST,GS,+12.3"), { lines: ["ST,GS,+12.30kg"], rest: "ST,GS,+12.3" });
});

test("AP-010 a weight is stable only after enough agreeing readings over the minimum time; motion resets it", () => {
  const t = new StabilityTracker(DEFAULT_SCALE);
  let s;
  for (let k = 0; k < 6; k++) s = t.push(parseIndicatorLine("ST,GS,+0120.00kg"), 1000 + k * 200);
  assert.deepEqual([s.stable, s.settledKg], [true, 120]);
  s = t.push(parseIndicatorLine("US,GS,+0121.40kg"), 2300);
  assert.equal(s.stable, false);
  const fresh = new StabilityTracker(DEFAULT_SCALE);
  for (let k = 0; k < 3; k++) s = fresh.push(parseIndicatorLine("+0120.00"), k * 100);
  assert.equal(s.stable, false, "too soon and too few readings");
  assert.equal(fresh.push(parseIndicatorLine("+0.00"), 5000).reason, "Place the bundle on the scale");
  assert.deepEqual(bundleDeviation(124, 120, 0.95), { theoreticalKg: 114, deviationPercent: 8.772 });
  assert.deepEqual(bundleDeviation(124, 120, null), { theoreticalKg: null, deviationPercent: null });
  assert.equal(scaleCaptureSchema.safeParse({ source: "scale", raw_reading: "US,GS,+1", stable: false }).success, false);
  assert.equal(scaleCaptureSchema.safeParse({ source: "manual" }).success, true);
});

// ---------------------------------------------------------------- AP-095
test("AP-095 every floor label exists in Hindi with the same placeholders; unknown languages fall back to English", () => {
  const en = FLOOR_MESSAGES.en, hi = FLOOR_MESSAGES.hi;
  assert.deepEqual(Object.keys(hi).sort(), Object.keys(en).sort());
  for (const [key, text] of Object.entries(en)) {
    assert.ok(hi[key].trim().length > 0, key);
    assert.deepEqual((hi[key].match(/\{\w+\}/g) ?? []).sort(), (text.match(/\{\w+\}/g) ?? []).sort(), `${key} placeholders`);
  }
  const devanagari = Object.values(hi).filter(v => /[ऀ-ॿ]/.test(v)).length;
  assert.ok(devanagari / Object.keys(hi).length > 0.95, "the Hindi catalogue is in Devanagari");
  assert.equal(floorText("hi")("ps.undo", { seq: 4, s: 12 }), "पुश 4 वापस लें (12 से.)");
  assert.equal(floorText("fr")("ps.tap"), "Billet loaded");
  assert.equal(floorText("hi")("ps.noJob", { press: null }), "— पर कोई काम नहीं चल रहा है।");
  assert.equal(parseFloorLanguage("HI"), "en");
});

test("AP-095 floor screens take their labels from the catalogue (no hard-coded English for the main actions)", () => {
  for (const [file, gone] of [["components/modules/press/press-station.tsx", ["Billet loaded", "Tap once per billet", "Close job from pushes"]],
    ["components/modules/production/workstation.tsx", ["Lock and switch operator", "Identify operator and open station"]],
    ["components/modules/dispatches/physical-bundles.tsx", ["Record measured bundle", "Generate bundle tag"]], ["app/(dashboard)/mobile/page.tsx", ["Mobile Factory Floor"]]]) {
    const src = code(file);
    for (const text of gone) assert.ok(!src.includes(`>${text}<`) && !src.includes(`"${text}"`), `${file}: ${text}`);
  }
});

// ---------------------------------------------------------------- AP-073
const card = { card_number: "RC-261116-001", customer_name: "Sharma Fabricators", rate_day: "2026-11-16", valid_until: "2026-11-16", gst_percent: 18,
  company: { name: "Omalco Extrusion", gst_number: "07AAACO1234A1Z5", city: "Delhi" },
  lines: [{ families: "Sliding window", alloy: "6063", finish: "powder_coating", finish_label: "Powder coated", rate_per_kg: 317, finish_extra: null },
    { families: "Sliding window", alloy: "6063", finish: "mill_finish", finish_label: "Mill finish", rate_per_kg: 287, finish_extra: null },
    { families: "Sliding window", alloy: "6063", finish: "anodizing", finish_label: "Anodised", rate_per_kg: 287, finish_extra: { rate: 12, basis: "per_sqft" } }] };

test("AP-073 the WhatsApp card shows selling prices, validity and GST; nothing internal", () => {
  const text = rateCardWhatsApp(card);
  assert.match(text, /Valid for 16 Nov 2026 only/);
  assert.match(text, /Mill finish \(6063\): ₹287\.00\/kg/);
  assert.match(text, /\+ ₹12\.00 per sq ft finishing/);
  assert.match(text, /GST 18% extra/);
  assert.doesNotMatch(text, /cost|margin|floor|supplier|billet|conversion/i);
  assert.equal(sortRateLines(card.lines)[0].finish, "mill_finish");
  assert.equal(rateCardValidity({ rate_day: "2026-11-16", valid_until: "2026-11-18" }), "Valid 16 Nov 2026 to 18 Nov 2026");
});

test("AP-073 / AP-074 the rate card and the scrap invoice build as PDFs", async () => {
  const pdf = await buildRateCardPdf(card);
  assert.ok(pdf.byteLength > 1000);
  assert.equal(rateCardRows(card).length, 3);
  const inv = await buildScrapInvoicePdf({ invoice_number: "SCR/26-27/0001", invoice_date: "2026-11-16", sale_number: "SS-00001", grade: { code: "EXT-CLEAN", name: "Clean extrusion scrap" },
    hsn_code: "7602", gst_percent: 18, net_kg: 320, gross_kg: 8320, tare_kg: 8000, weighbridge_ref: "WB-1", vehicle_registration: "MH12AB1234", rate_per_kg: 192.5, taxable_value: 61600,
    cgst_amount: 0, sgst_amount: 0, igst_amount: 11088, invoice_total: 72688, place_of_supply: "27", buyer: { name: "Sharma Fabricators", gst_number: "27ABCDE1234F1Z0", state: "Maharashtra", address: null },
    company: { name: "Omalco Extrusion", gst_number: "07AAACO1234A1Z5", address: null, city: "Delhi", state: "Delhi" } });
  assert.ok(inv.byteLength > 1000);
  assert.doesNotMatch(code("lib/pdf/rate-card-pdf.ts"), /margin|cost_per|floor_per|supplier/i);
});

// ---------------------------------------------------------------- commands and wiring
test("Batch 9 schemas refuse malformed input early", () => {
  assert.equal(scrapSaleCommands.weigh.safeParse({ id: "00000000-0000-4000-8000-000000000001", gross_kg: 100, tare_kg: 100, weighbridge_ref: "WB" }).success, false);
  assert.equal(weightNoteCommands.save_tolerance.safeParse({ reason: "Agreed in contract" }).success, false);
  assert.equal(rateCardCommands.generate_all.safeParse({ customer_type: "everyone" }).success, false);
  assert.equal(registerCommands.save_rows.safeParse({ id: "00000000-0000-4000-8000-000000000001", rows: [{ pushes: -1 }] }).success, false);
  assert.equal(cashForecastCommands.save_fixed.safeParse({ label: "Rent", amount: 0, frequency: "monthly" }).success, false);
  assert.ok(!BATCH9_READS.includes("invoice"), "the scrap invoice command is a write");
});

test("Batch 9 jobs, proposal types and their home records are registered", () => {
  const keys = JOBS.map(j => `${j.job_key}:${j.schedule}`);
  assert.ok(keys.includes("stock.arrival_reservations:hourly") && keys.includes("cash.forecast_snapshot:nightly"));
  for (const job of ["stock.arrival_reservations", "cash.forecast_snapshot"]) assert.match(migration, new RegExp(`'${job.replace(".", "\\.")}', '(hourly|nightly)'`));
  assert.ok(PROPOSAL_TYPES["stock.reservation"] && PROPOSAL_TYPES["profile.geometry"]);
  assert.equal(proposalHref({ proposal_type: "profile.geometry", target_key: "11111111-1111-4111-8111-111111111111", id: "x" }), "/profiles/11111111-1111-4111-8111-111111111111#drawing-geometry");
  assert.match(migration, /'stock\.reservation','profile\.geometry'\)\);/);
});

test("Browser bundles of floor screens and the quotation form carry no server module", () => {
  for (const file of ["components/modules/autopilot-batch9/floor-language.tsx", "components/modules/autopilot-batch9/scale-capture.tsx", "lib/quotes/enquiry-client.ts",
    "components/modules/dispatches/physical-bundles.tsx", "components/modules/offline/offline-core.tsx", "components/modules/production/workstation.tsx"]) {
    assert.doesNotMatch(code(file), /lib\/actions\/(autopilot|autopilot-batch9)"/, file);
  }
  assert.doesNotMatch(code("components/modules/quotes-client.tsx"), /lib\/actions\/autopilot-batch9/);
});

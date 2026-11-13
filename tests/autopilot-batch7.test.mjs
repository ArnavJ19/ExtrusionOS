import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseLengthEntry, parseLengthText } from "../lib/calculations/length-units.ts";
import { canonicalStateName, lookupPin } from "../lib/address/pin-code.ts";
import { activePreset, istDate, presetRange } from "../lib/utils/date-ranges.ts";
import { orderWithRecent, readRecent, recentStorageKey, rememberRecent } from "../lib/preferences/recent-values.ts";
import { emptyWedge, feedWedge, isLabelPrefix, scanTypesForField } from "../lib/qr/wedge.ts";
import { pastedFileName, transferFiles } from "../lib/utils/clipboard-files.ts";
import { delayCommands, priceCommands, qualityCommands, statementCommands } from "../lib/autopilot-batch7/commands.ts";
import { statementRows } from "../lib/pdf/statement-pdf.ts";
import { JOBS } from "../lib/jobs/registry.ts";
import { optionalPincode } from "../lib/validations/common.ts";
import { PIN_PREFIXES } from "../scripts/build-pin-prefixes.mjs";

// ---------------------------------------------------------------- AP-040
test("AP-040 lengths in any unit convert exactly; a bare number is millimetres; unreadable input is refused, never zero", () => {
  const cases = { "21ft": 6400.8, "6.4m": 6400, "6400": 6400, "12' 6\"": 3810, "12ft 6in": 3810, "640cm": 6400, "250 in": 6350, "5.8 M": 5800, "6,400 mm": 6400, "21 feet": 6400.8, ".5m": 500 };
  for (const [text, mm] of Object.entries(cases)) { const r = parseLengthText(text); assert.equal(r.mm, mm, text); assert.equal(r.original, text.trim()); }
  assert.match(parseLengthText("60").warning, /read as 60 mm/);
  for (const bad of ["", "abc", "0", "1001m", "6.4 km", "12 ft 6 cm", "-5m"]) assert.ok("error" in parseLengthText(bad) && parseLengthText(bad).metres === undefined, bad);
  assert.ok("error" in parseLengthText("x".repeat(41)));
});

test("AP-040 the length field follows its unit selector for bare numbers and keeps text naming the unit", () => {
  assert.deepEqual([parseLengthEntry("6", "m").metres, parseLengthEntry("6", "m").original], [6, "6 m"]);
  assert.equal(parseLengthEntry("20", "ft").mm, 6096);
  assert.equal(parseLengthEntry("6400", "m").mm, 6400, "100 or more with metres selected is millimetres");
  assert.equal(parseLengthEntry("21ft", "mm").mm, 6400.8, "a typed unit wins over the selector");
  assert.ok("error" in parseLengthEntry("", "m"));
  // The quotation line schema (lib/validations/schemas.ts) carries length_input_text; the SQL test checks the stored column.
});

// ---------------------------------------------------------------- AP-039
const table = JSON.parse(readFileSync(new URL("../public/data/pin-prefixes.json", import.meta.url), "utf8"));
test("AP-039 the bundled PIN table fills the state, offers a choice for shared prefixes and never guesses", () => {
  assert.deepEqual(table.prefixes, PIN_PREFIXES, "public/data/pin-prefixes.json is generated from scripts/build-pin-prefixes.mjs");
  const state = pin => { const r = lookupPin(table, pin); return r.kind === "state" ? r.state : r.kind; };
  for (const [pin, name] of [["110020", "Delhi"], ["411001", "Maharashtra"], ["400001", "Maharashtra"], ["403001", "Goa"], ["380001", "Gujarat"], ["560001", "Karnataka"],
    ["600001", "Tamil Nadu"], ["700001", "West Bengal"], ["737101", "Sikkim"], ["744101", "Andaman and Nicobar Islands"], ["248001", "Uttarakhand"], ["500001", "Telangana"],
    ["520001", "Andhra Pradesh"], ["682001", "Kerala"], ["682555", "Lakshadweep"], ["834001", "Jharkhand"], ["800001", "Bihar"], ["781001", "Assam"], ["793001", "Meghalaya"],
    ["452001", "Madhya Pradesh"], ["492001", "Chhattisgarh"], ["302001", "Rajasthan"], ["141001", "Punjab"], ["122001", "Haryana"], ["171001", "Himachal Pradesh"], ["180001", "Jammu and Kashmir"]]) assert.equal(state(pin), name, pin);
  const shared = lookupPin(table, "160017");
  assert.equal(shared.kind, "choose"); assert.deepEqual(shared.candidates.map(c => c.state).sort(), ["Chandigarh", "Punjab"]);
  assert.equal(lookupPin(table, "396210").kind, "choose", "Daman shares 396 with Gujarat");
  assert.equal(lookupPin(table, "999001").kind, "no_state", "Army Postal Service");
  assert.equal(lookupPin(table, "012345").kind, "invalid");
  assert.equal(lookupPin(table, "41100").kind, "invalid");
  assert.equal(lookupPin({ ...table, prefixes: {} }, "411001").kind, "unknown");
  for (const codes of Object.values(table.prefixes)) for (const code of codes) assert.match(code, /^(0[1-9]|[12][0-9]|3[0-8])$/);
  const withDistrict = lookupPin({ ...table, districts: true }, "411001", { "411001": "Pune" });
  assert.equal(withDistrict.district, "Pune");
  assert.equal(canonicalStateName("tamil  nadu"), "Tamil Nadu"); assert.equal(canonicalStateName("Atlantis"), "Atlantis");
  assert.equal(optionalPincode.safeParse("411001").success, true);
  assert.equal(optionalPincode.safeParse("41100").success, false);
  assert.equal(optionalPincode.safeParse("").data, null, "blank stays blank");
});

// ---------------------------------------------------------------- AP-086
test("AP-086 date chips use IST days, Monday weeks and the April financial year", () => {
  assert.deepEqual(presetRange("today", "2026-11-14"), { from: "2026-11-14", to: "2026-11-14" });
  assert.deepEqual(presetRange("yesterday", "2026-11-01"), { from: "2026-10-31", to: "2026-10-31" });
  assert.deepEqual(presetRange("this_week", "2026-11-14"), { from: "2026-11-09", to: "2026-11-14" }, "Saturday 14 Nov: week from Monday 9 Nov");
  assert.deepEqual(presetRange("this_week", "2026-11-15"), { from: "2026-11-09", to: "2026-11-15" }, "Sunday belongs to the week that began on Monday");
  assert.deepEqual(presetRange("this_month", "2026-11-14"), { from: "2026-11-01", to: "2026-11-14" });
  assert.deepEqual(presetRange("last_month", "2026-01-10"), { from: "2025-12-01", to: "2025-12-31" });
  assert.deepEqual(presetRange("last_month", "2026-03-31"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(presetRange("this_fy", "2026-11-14"), { from: "2026-04-01", to: "2026-11-14" });
  assert.deepEqual(presetRange("this_fy", "2027-02-01"), { from: "2026-04-01", to: "2027-02-01" });
  assert.deepEqual(presetRange("this_fy", "2026-04-01"), { from: "2026-04-01", to: "2026-04-01" });
  assert.equal(activePreset({ from: "2026-11-01", to: "2026-11-14" }, "2026-11-14"), "this_month");
  assert.equal(activePreset({ from: "", to: "" }, "2026-11-14"), null);
  assert.equal(istDate(new Date("2026-11-14T19:00:00Z")), "2026-11-15", "after 18:30 UTC it is already tomorrow in India");
  assert.doesNotMatch(readFileSync(new URL("../components/modules/operations/module-database-client.tsx", import.meta.url), "utf8"), /type="date"/, "database pages use the shared filter");
});

// ---------------------------------------------------------------- AP-090
test("AP-090 the last five choices per user and field come first, only when still offered; storage failure is harmless", () => {
  const store = new Map(); const s = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const key = recentStorageKey("company:user-1", "Customer");
  assert.equal(recentStorageKey("", "Customer"), null, "no signed-in scope, nothing is stored");
  assert.notEqual(key, recentStorageKey("company:user-2", "Customer"), "each user has their own list");
  for (const v of ["a", "b", "c", "d", "e", "f", "b"]) rememberRecent(key, v, s);
  assert.deepEqual(readRecent(key, s), ["b", "f", "e", "d", "c"]);
  const options = ["a", "b", "c", "d", "e", "f", "g"].map(value => ({ value, label: value.toUpperCase(), disabled: value === "f" }));
  const ordered = orderWithRecent(options.filter(o => o.value !== "e"), readRecent(key, s));
  assert.deepEqual(ordered.recent.map(o => o.value), ["b", "d", "c"], "e is no longer offered and f is disabled");
  assert.deepEqual(ordered.rest.map(o => o.value), ["a", "f", "g"]);
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.deepEqual(readRecent(key, broken), []);
  assert.deepEqual(rememberRecent(key, "x", broken), ["x"], "a blocked store still returns the list for this page; nothing is thrown");
  store.set(key, "{not json"); assert.deepEqual(readRecent(key, s), []);
});

// ---------------------------------------------------------------- AP-025
test("AP-025 a fast EO-prefixed burst ending in Enter is a scan; typing by hand or other text is not", () => {
  const feed = (text, gap, enterGap = gap) => { let st = emptyWedge(), t = 1000, out = null; for (const ch of text) { st = feedWedge(st, ch, (t += gap)).state; } const r = feedWedge(st, "Enter", t + enterGap); out = r.scan; return out; };
  const label = "EO2:dispatch_package:bd000000-0000-4000-8000-000000000001:n1";
  assert.equal(feed(label, 8), label);
  assert.equal(feed(label, 120), null, "a person typing");
  assert.equal(feed("PO-2026-00012-FAST", 5), null, "not an ExtrusionOS label");
  assert.equal(feed("EO2:x", 5), null, "too short");
  assert.equal(isLabelPrefix("EO2:"), true); assert.equal(isLabelPrefix("EX"), false);
  let st = emptyWedge(); for (const ch of "EO2:die") st = feedWedge(st, ch, 0).state;
  assert.equal(feedWedge(st, "Shift", 1).state, st, "modifier keys do not break the burst");
  assert.deepEqual(scanTypesForField("die_id"), ["die"]); assert.deepEqual(scanTypesForField("production_die_id"), ["die"]);
  assert.deepEqual(scanTypesForField("profile_stock_batch_id"), ["inventory_batch", "dispatch_package"]);
  assert.equal(scanTypesForField("customer_id"), undefined);
});

// ---------------------------------------------------------------- AP-099
test("AP-099 pasted screenshots get a dated name; named files keep theirs; items are read before files", () => {
  assert.equal(pastedFileName({ name: "image.png", type: "image/png", size: 10 }, new Date("2026-11-14T06:30:05Z")), "pasted-20261114-120005.png");
  assert.equal(pastedFileName({ name: "", type: "image/jpeg", size: 10 }, new Date("2026-11-14T06:30:05Z")), "pasted-20261114-120005.jpg");
  assert.equal(pastedFileName({ name: "die-drawing.pdf", type: "application/pdf", size: 10 }), "die-drawing.pdf");
  const file = { name: "image.png" };
  assert.deepEqual(transferFiles({ items: [{ kind: "string", type: "text/plain", getAsFile: () => null }, { kind: "file", type: "image/png", getAsFile: () => file }], files: [] }), [file]);
  assert.deepEqual(transferFiles({ items: [], files: [file] }), [file]);
  assert.deepEqual(transferFiles(null), []);
});

// ---------------------------------------------------------------- schemas, registry, statement rows
test("batch 7 command schemas refuse malformed input early; the statement job is registered; statement rows run the balance", () => {
  assert.equal(delayCommands.edit.safeParse({ id: "bd000000-0000-4000-8000-000000000001", message: "Dear Sir,\nThe new date is the 28th.\nRegards" }).success, true, "line breaks are allowed");
  assert.equal(delayCommands.edit.safeParse({ id: "bd000000-0000-4000-8000-000000000001", message: "Dear Sir \u0007 the new date is the 28th." }).success, false);
  assert.equal(delayCommands.send.safeParse({ id: "bd000000-0000-4000-8000-000000000001", via: "sms" }).success, false);
  assert.equal(statementCommands.send.safeParse({ id: "bd000000-0000-4000-8000-000000000001", via: "email_provider" }).success, false, "only the server action records a provider send");
  assert.equal(statementCommands.queue.safeParse({ period: "2026-13" }).success, false);
  assert.equal(qualityCommands.record_change.safeParse({ proposal_type: "quote.reprice", changed_on: "2026-11-10", description: "short" }).success, false);
  assert.equal(qualityCommands.overview.safeParse({ weeks: 8 }).success, false);
  assert.equal(priceCommands.save_settings.safeParse({ variance_percent: 5.555 }).success, false);
  assert.ok(JOBS.some(j => j.job_key === "receivables.statements" && j.schedule === "morning"));
  const rows = statementRows({ opening_balance: 1000, lines: [{ date: "2026-10-05", kind: "invoice", reference: "INV-1", debit: 500, credit: 0, balance: 1500 }, { date: "2026-10-20", kind: "receipt", reference: "UTR1 against INV-1", debit: 0, credit: 1500, balance: 0 }] });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].cells[1], "Opening balance");
  assert.equal(rows[2][1], "Receipt"); assert.equal(rows[2][3], "");
});

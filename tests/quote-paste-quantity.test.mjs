import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildQuotePasteLine, getPieceCalculationState, getQuotePasteFinishOptions, getQuotePasteLengthUnit, parseQuotePaste, validateQuotePasteRows } from "../lib/forms/quote-paste.ts";

const quoteClient = readFileSync("components/modules/quotes-client.tsx", "utf8");
const profiles = [
  { id: "p-1", profile_code: "AL-101", profile_name: "Window section", section_weight_kg_per_m: 0.8 },
  { id: "p-2", profile_code: "AL-202", profile_name: "Door section", section_weight_kg_per_m: 1.2 },
];

test("paste parser requires explicit length units and unambiguous column names", () => {
  assert.match(parseQuotePaste("Profile Code\tQuantity (pcs)\tLength\nAL-101\t2\t6").error, /Required columns/);
  assert.match(parseQuotePaste("Profile Code\tQuantity (pcs)\tLength (m)\tLength (mm)\nAL-101\t2\t6\t6000").error, /unique and unambiguous/);
  assert.equal(getQuotePasteLengthUnit("Profile Code\tQuantity (pcs)\tLength (mm)\n"), "mm");
});

test("parser rejects malformed quotes, embedded multiline values, and unknown or unitless columns", () => {
  assert.match(parseQuotePaste("Profile Code\tQuantity (pcs)\tLength (m)\t\nAL-101\t2\t6\textra").error, /blank header/);
  assert.match(parseQuotePaste('Profile Code,Quantity (pcs),Length (m),Finish\nAL-101,2,6,"Mill finish').error, /Row 2: Unclosed quoted cell/);
  assert.match(parseQuotePaste('Profile Code,Quantity (pcs),Length (m),Finish\nAL-101,2,6,"Mill\nfinish"').error, /Row 2: Unclosed quoted cell/);
  assert.match(parseQuotePaste("Profile Code\tQuantity (pcs)\tLength (m)\tLength (inches)\nAL-101\t2\t6\t236").error, /Unsupported column/);
  assert.match(parseQuotePaste("Profile Code\tQuantity (pcs)\tLength (m)\tSupplier\nAL-101\t2\t6\tA").error, /Unsupported column/);
});

test("preview retains each row and identifies shape errors instead of dropping extra cells", () => {
  const parsed = parseQuotePaste("Profile Code\tQuantity (pcs)\tLength (m)\tFinish\nAL-101\t2\t6\tMill finish\textra\nAL-202\t3\t4\tAnodizing");
  assert.equal(parsed.error, null);
  assert.equal(parsed.rows.length, 2);
  const results = validateQuotePasteRows(parsed.rows, profiles, "m");
  assert.match(results[0].errors[0], /found 1 extra cell/);
  assert.deepEqual(results[1].errors, []);
});

test("row validation blocks unknown and ambiguous profile codes, bad pieces, units, and finish values", () => {
  const parsed = parseQuotePaste("Profile Code\tQuantity (pcs)\tLength (mm)\tFinish\nmissing\t2.5\t-8\tGold\nAL-101\t2\t6000\tMill finish");
  const duplicateProfile = { ...profiles[0], id: "p-duplicate" };
  const results = validateQuotePasteRows(parsed.rows, [...profiles, duplicateProfile], "mm");
  assert.match(results[0].errors.join(" "), /No active company profile/);
  assert.match(results[0].errors.join(" "), /whole number/);
  assert.match(results[0].errors.join(" "), /positive cut length/);
  assert.match(results[0].errors.join(" "), /supported finish/);
  assert.match(results[1].errors.join(" "), /ambiguous/);
  assert.equal(results[1].lengthMeters, 6);
});

test("valid paste rows convert mm to metres and preserve exact profile identity", () => {
  const parsed = parseQuotePaste('Profile Code,Quantity (pcs),Cut Length (mm),Finish\nAL-101,100,6000,"Powder coating"');
  const result = validateQuotePasteRows(parsed.rows, profiles, "mm")[0];
  assert.deepEqual(result.errors, []);
  assert.equal(result.profile.id, "p-1");
  assert.equal(result.lengthMeters, 6);
  assert.equal(result.quantityPieces, 100);
  assert.equal(result.normalizedFinish, "powder_coating");
});

test("piece calculation names profile-master only when its current kg/m exactly matches", () => {
  assert.deepEqual(getPieceCalculationState({ quantityPieces: 100, lengthPerPieceM: 6, sectionWeightKgPerM: 0.8, hasSelectedProfile: true, profileMasterSectionWeightKgPerM: 0.8 }), { source: "profile-master", message: null });
  const override = getPieceCalculationState({ quantityPieces: 100, lengthPerPieceM: 6, sectionWeightKgPerM: 0.9, hasSelectedProfile: true, profileMasterSectionWeightKgPerM: 0.8 });
  assert.equal(override.source, "manual");
  assert.match(override.message, /manual 0.9 kg\/m; the profile master lists 0.8 kg\/m/);
  assert.equal(getPieceCalculationState({ quantityPieces: 100, lengthPerPieceM: 6, sectionWeightKgPerM: 0.8, hasSelectedProfile: false, profileMasterSectionWeightKgPerM: null }).source, "manual");
  assert.equal(getPieceCalculationState({ quantityPieces: 100, lengthPerPieceM: 6, sectionWeightKgPerM: 0, hasSelectedProfile: true, profileMasterSectionWeightKgPerM: null }).source, "missing");
  assert.equal(getPieceCalculationState({ quantityPieces: 0, lengthPerPieceM: 6, sectionWeightKgPerM: 0.8, hasSelectedProfile: true, profileMasterSectionWeightKgPerM: 0.8 }).source, "invalid");
  assert.equal(getPieceCalculationState({ quantityPieces: 1, lengthPerPieceM: 1, sectionWeightKgPerM: -0.1, hasSelectedProfile: false, profileMasterSectionWeightKgPerM: null }).source, "invalid");
});

test("pasted lines keep company defaults but never copy prior row overrides or charges", () => {
  const row = validateQuotePasteRows(parseQuotePaste("Profile Code\tQuantity (pcs)\tLength (m)\tFinish\nAL-101\t3\t4\tAnodizing").rows, profiles, "m")[0];
  const line = buildQuotePasteLine({ conversion_charge_per_kg: 7, packing_charge: 12, transport_charge: 15, margin_percent: 14, minimum_margin_percent: 8, sales_price_override: 5000, die_charge: 900, die_amortization_quantity_kg: 400, minimum_billing_weight_kg: 75, profile_id: "previous", quote_id: "q1" }, row);
  assert.equal(line.profile_id, "p-1");
  assert.equal(line.conversion_charge_per_kg, 7);
  assert.equal(line.packing_charge, 12);
  assert.equal(line.transport_charge, 15);
  assert.equal(line.margin_percent, 14);
  assert.equal(line.sales_price_override, null);
  assert.equal(line.die_charge, 0);
  assert.equal(line.die_amortization_quantity_kg, 0);
  assert.equal(line.minimum_billing_weight_kg, 0);
  assert.equal(line.quote_id, undefined);
});

test("finish preview preserves source values until corrected and recognized finish aliases", () => {
  assert.deepEqual(getQuotePasteFinishOptions("")[0], { value: "", label: "Choose finish" });
  const pvdfOptions = getQuotePasteFinishOptions("pvdf");
  assert.equal(pvdfOptions[0].value, "pvdf");
  assert.match(pvdfOptions[0].label, /as pasted/);
  const unknownOptions = getQuotePasteFinishOptions("Gold");
  assert.equal(unknownOptions[0].value, "Gold");
  assert.equal(unknownOptions.some((option) => option.value === "PVDF"), true);
  assert.equal(validateQuotePasteRows(parseQuotePaste("Profile Code\tQuantity (pcs)\tLength (m)\tFinish\nAL-101\t1\t1\tpvdf").rows, profiles, "m")[0].normalizedFinish, "pvdf");
});

test("quote editor checks profiles in tenant scope, previews before import, and appends atomically", () => {
  assert.match(quoteClient, /\.eq\("company_id", context\.companyId\)[\s\S]*?\.eq\("is_active", true\)[\s\S]*?\.in\("profile_code", codes\.slice\(0, 100\)\)[\s\S]*?\.limit\(100\)/);
  assert.match(quoteClient, /const requestVersion = \+\+quotePasteLookupVersion\.current/);
  assert.match(quoteClient, /requestVersion !== quotePasteLookupVersion\.current/);
  assert.match(quoteClient, /finally \{\s*if \(requestVersion === quotePasteLookupVersion\.current\) setQuotePasteLoading\(false\)/);
  assert.match(quoteClient, /Paste line items from Excel/);
  assert.match(quoteClient, /aria-label=\{`Row \$\{row\.sourceRow\} profile code`\}/);
  assert.match(quoteClient, /disabled=\{!ready\} onClick=\{importQuotePasteRows\}/);
  assert.match(quoteClient, /setItems\(\(current\) => \[\.\.\.current, \.\.\.\(lines as FormItem\[\]\)\]\)/);
  assert.doesNotMatch(quoteClient.slice(quoteClient.indexOf("function parseQuotePasteInput"), quoteClient.indexOf("async function saveQuote")), /saveQuoteAction|\.insert\(|\.upsert\(/);
  assert.match(quoteClient, /Theoretical weight/);
  assert.match(quoteClient, /Measured weight is recorded separately and is not changed here/);
  assert.match(quoteClient, /calculateQuoteItem\(\{ \.\.\.item/);
  assert.match(quoteClient, /const base: FormItem = \{\s*\.\.\.emptyItem,[\s\S]*?settings\?\.default_conversion_charge_per_kg/);
  assert.match(quoteClient, /getQuotePasteFinishOptions\(quotePasteRows\[index\]\.finish\)/);
  assert.doesNotMatch(quoteClient, /actual_weight_kg_per_m\s*=/);
});

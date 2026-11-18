import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractMtc, extractionSummary } from "../lib/quality/mtc-extract.ts";
import { extractPdfText, contentStreamText } from "../lib/pdf/text-extract.ts";
import { checkChemistry, alloyChemistrySpec, alloyNumber } from "../lib/calculations/alloy-composition.ts";
import { evaluateSpc, spcCenter, spcScale } from "../lib/calculations/spc.ts";
import { METRICS, METRIC_KEYS, metricsForRole, recoveryPercentOf } from "../lib/insights/metrics.ts";
import { INSIGHTS_DESTINATIONS, insightsFor } from "../lib/insights/destinations.ts";
import { calculateIssuedBilletRecovery } from "../lib/command-center/metrics.ts";
import { productionPerformance } from "../lib/calculations/production-performance.ts";
import { recoveryPercent } from "../lib/calculations/press-output.ts";
import { buildChallanPdf, challanRows } from "../lib/pdf/challan-pdf.ts";
import { buildJobCardPdf, jobCardCheckRows } from "../lib/pdf/job-card-pdf.ts";
import { mergePdfs, MAX_BATCH_DOCUMENTS } from "../lib/pdf/merge.ts";
import { qrRuns } from "../lib/pdf/qr-modules.ts";
import { SAVED_VIEW_QUERY, mtcDraftSchema, viewCommands, capacityCommands, spcCommands, BATCH8_READS } from "../lib/autopilot-batch8/commands.ts";
import { JOBS } from "../lib/jobs/registry.ts";

/** Source without comments, so a rule about what a document prints is checked against code only. */
const code = file => readFileSync(file, "utf8").split(/\r?\n/).filter(line => !/^\s*\/\//.test(line)).join("\n");

const CERT = ["MILL TEST CERTIFICATE", "Alloy: AA6063 Temper: F", "Cast No: H24-5521 Date: 12.11.2026", "Element Si Fe Cu Mn Mg Zn Ti", "Spec Min 0.20 0.00 0.00 0.00 0.45 0.00 0.00", "Spec Max 0.60 0.35 0.10 0.10 0.90 0.10 0.10", "Actual 0.42 0.18 0.01 0.02 0.52 0.01 0.01"];

async function textPdf(lines) {
  const pdf = await PDFDocument.create(); const page = pdf.addPage(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  lines.forEach((r, n) => page.drawText(r, { x: 40, y: 760 - n * 18, size: 11, font }));
  return pdf.save();
}

// ---------------------------------------------------------------- AP-020
test("AP-020 a certificate table is read from the result row, not the specification rows; values carry confidence and source", () => {
  const x = extractMtc(CERT.join("\n"));
  assert.deepEqual([x.heat_number.value, x.alloy.value, x.si.value, x.mg.value, x.ti.value], ["H24-5521", "6063", 0.42, 0.52, 0.01]);
  assert.equal(x.heat_number.confidence, "high");
  assert.match(x.si.source, /^Actual/);
  assert.equal(extractionSummary(x).read, 9);
});

test("AP-020 labelled pairs, a supplier template's column order and decimal commas; anything unreadable stays blank", () => {
  const pairs = extractMtc("Heat Number - 7781B\nGrade 6082\nSilicon: 0.95 %  Magnesium 0.71\nFe = .30\nCu: 0.05 Mn 0.55 Zn 0.04");
  assert.deepEqual([pairs.heat_number.value, pairs.alloy.value, pairs.si.value, pairs.mg.value, pairs.fe.value, pairs.mn.value], ["7781B", "6082", 0.95, 0.71, 0.3, 0.55]);
  assert.equal(pairs.ti.value, null, "titanium is not on the certificate: blank, not zero");
  assert.equal(pairs.ti.confidence, null);
  const withTemplate = extractMtc("Melt No. MN/2211\nResult 0,41 0,20 0,02 0,03 0,55 0,01 0,02", { heat_labels: ["Melt No"], element_order: ["Si", "Fe", "Cu", "Mn", "Mg", "Zn", "Ti"], decimal_comma: true });
  assert.deepEqual([withTemplate.heat_number.value, withTemplate.si.value, withTemplate.mg.value, withTemplate.ti.value], ["MN/2211", 0.41, 0.55, 0.02]);
  const empty = extractMtc("Photo of a certificate that could not be read");
  assert.equal(extractionSummary(empty).read, 0);
  assert.ok(Object.values(empty).every(v => v.value === null), "nothing is guessed");
  const specOnly = extractMtc("Spec Si 0.20-0.60");
  assert.equal(specOnly.si.confidence, "low", "a value seen only on a specification line is flagged low");
});

test("AP-020 the text layer of a generated PDF is read; a non-PDF or textless PDF gives no text", async () => {
  const text = extractPdfText(await textPdf(CERT));
  assert.equal(text, CERT.join("\n").replace(/ {2,}/g, " "));
  assert.equal(extractPdfText(new TextEncoder().encode("not a pdf")), null);
  const blank = await PDFDocument.create(); blank.addPage();
  assert.equal(extractPdfText(await blank.save()), null);
  assert.deepEqual(contentStreamText("BT /F1 11 Tf 40 760 Td (Heat: H\\(1\\)) Tj 0 -18 Td [(Si) -300 (0.42)] TJ ET"), ["Heat: H(1)", "Si 0.42"]);
});

test("AP-020 the chemistry check: in spec, out of spec with the element, missing values, unknown alloy", () => {
  const ok = { si: 0.42, fe: 0.18, cu: 0.01, mn: 0.02, mg: 0.52, zn: 0.01, ti: 0.01 };
  assert.equal(checkChemistry("AA6063", ok).result, "in_spec");
  assert.deepEqual(checkChemistry("6063-T5", { ...ok, si: 0.95 }).out, [{ element: "Si", value: 0.95, min: 0.2, max: 0.6 }]);
  assert.deepEqual(checkChemistry("6063", { ...ok, ti: null }).missing, ["Ti"]);
  assert.equal(checkChemistry("7075", ok).result, "unknown_alloy");
  assert.equal(alloyNumber("EN AW-6082"), "6082");
  assert.deepEqual(alloyChemistrySpec("6061").Cu, [0.15, 0.4]);
});

test("AP-020 the draft schema accepts only one target, a 64-character hash and known fields", () => {
  const base = { file_name: "mtc.pdf", storage_path: "company/billet-certificates/x/mtc.pdf", mime_type: "application/pdf", file_sha256: "a".repeat(64), source_kind: "pdf_text", extracted: { si: { value: 0.4, confidence: "high", source: "x" } } };
  assert.equal(mtcDraftSchema.safeParse({ ...base, receipt_line_id: "00000000-0000-4000-8000-000000000001" }).success, true);
  assert.equal(mtcDraftSchema.safeParse(base).success, false, "a target is required");
  assert.equal(mtcDraftSchema.safeParse({ ...base, receipt_line_id: "00000000-0000-4000-8000-000000000001", billet_batch_id: "00000000-0000-4000-8000-000000000002" }).success, false);
  assert.equal(mtcDraftSchema.safeParse({ ...base, receipt_line_id: "00000000-0000-4000-8000-000000000001", extracted: { al: { value: 98, confidence: "high" } } }).success, false);
});

test("AP-020 the server action reads the stored file, refuses another company's path, and keeps a photo blank", async () => {
  const require = createRequire(import.meta.url); require("tsx/cjs");
  const Module = require("node:module"), original = Module._load;
  const state = { calls: [], file: null };
  Module._load = function (request, parent, isMain) {
    if (request === "@/lib/auth") return { getSessionContext: async () => ({ companyId: "company-1", userId: "user-1", role: "quality", dealerId: null }) };
    if (request === "next/cache") return { revalidatePath() {} };
    if (request === "@/lib/supabase/server") return { createClient: async () => ({
      rpc: async (name, args) => { state.calls.push([name, args.p_command, args.p_payload]); return args.p_command === "target" ? { data: { template: null }, error: null } : { data: { id: "cert-1" }, error: null }; },
      storage: { from: () => ({ download: async () => ({ data: new Blob([state.file]), error: null }) }) }
    }) };
    return original(request, parent, isMain);
  };
  let action;
  try { action = require("../lib/actions/autopilot-batch8.ts"); } finally { Module._load = original; }
  state.file = await textPdf(CERT);
  const input = { receipt_line_id: "00000000-0000-4000-8000-000000000001", storage_path: "company-1/billet-certificates/x/mtc.pdf", file_name: "mtc.pdf", mime_type: "application/pdf" };
  const out = await action.readCertificateAction(input);
  assert.deepEqual(out, { success: true, data: { id: "cert-1", read: 9, source_kind: "pdf_text" } });
  const draft = state.calls.find(c => c[1] === "draft")[2];
  assert.match(draft.file_sha256, /^[a-f0-9]{64}$/);
  assert.equal(draft.extracted.heat_number.value, "H24-5521");
  assert.deepEqual(await action.readCertificateAction({ ...input, storage_path: "company-2/billet-certificates/x/mtc.pdf" }), { success: false, error: "Upload the certificate again." });
  state.calls.length = 0; state.file = new Uint8Array([137, 80, 78, 71]);
  const photo = await action.readCertificateAction({ ...input, mime_type: "image/png", file_name: "mtc.png" });
  assert.deepEqual(photo.data, { id: "cert-1", read: 0, source_kind: "photo" });
  assert.ok(Object.values(state.calls.find(c => c[1] === "draft")[2].extracted).every(v => v.value === null));
});

// ---------------------------------------------------------------- AP-052
test("AP-052 centre line, outside-limit and run-of-seven rules, Cpk and the drawing scale", () => {
  const limits = { nominal: 1.4, lower: 1.3, upper: 1.5 };
  assert.equal(spcCenter({ nominal: null, lower: 60, upper: 90 }), 75);
  assert.deepEqual(evaluateSpc([1.42, 1.43, 1.44, 1.43, 1.45, 1.46, 1.44], limits).rules, ["run_of_seven"]);
  assert.deepEqual(evaluateSpc([1.4, 1.38, 1.56], limits).rules, ["outside_limits"]);
  assert.deepEqual(evaluateSpc([1.39, 1.41, 1.4, 1.42, 1.38, 1.41, 1.39], limits).rules, []);
  const e = evaluateSpc([1.39, 1.41, 1.4, 1.42, 1.38], limits);
  assert.ok(e.cpk > 1);
  const s = spcScale([], limits); assert.ok(s.min < 1.3 && s.max > 1.5);
});

// ---------------------------------------------------------------- AP-044
test("AP-044 recovery has one definition, used by the command centre, job performance and the press floor", () => {
  assert.equal(recoveryPercentOf(900, 1000), 90);
  assert.equal(recoveryPercentOf(900, 0), null);
  assert.equal(recoveryPercentOf(null, 1000), null);
  assert.equal(recoveryPercentOf(0, 1000), 0, "a recorded zero is a real observation");
  assert.equal(calculateIssuedBilletRecovery([{ id: "j", actual_quantity_kg: 852 }], [{ production_job_id: "j", weight_kg: 1000 }], [{ production_job_id: "j", quantity_checked_kg: 10 }]).percent, recoveryPercentOf(842, 1000));
  assert.equal(productionPerformance({ inputKg: 1000, goodOutputKg: 842.456 }).recoveryPercent, 84.25);
  assert.equal(recoveryPercent(85.125, 100), 85.13);
  for (const file of ["lib/command-center/metrics.ts", "lib/calculations/production-performance.ts", "lib/calculations/press-output.ts"]) {
    assert.match(readFileSync(file, "utf8"), /recoveryPercentOf\(/, `${file} uses the registry formula`);
  }
});

test("AP-044 the KPI dictionary equals the registry; financial KPIs only for finance roles; Insights tabs follow role and flags", () => {
  const doc = readFileSync("docs/KPI_DICTIONARY.md", "utf8");
  for (const key of METRIC_KEYS) {
    const m = METRICS[key];
    assert.ok(doc.includes(`| ${m.label} | ${m.definition} | ${m.excludes} |`), `${m.label} is in the dictionary as defined`);
  }
  assert.equal((doc.match(/^\| (?!KPI|---)/gm) ?? []).length, METRIC_KEYS.length, "no KPI in the dictionary that the registry lacks");
  assert.ok(metricsForRole("sales_manager").every(m => !m.financial));
  assert.ok(metricsForRole("accounts").some(m => m.key === "order_margin"));
  assert.deepEqual(insightsFor("sales_manager", () => true).map(d => d.href), ["/analytics", "/report-builder"]);
  assert.deepEqual(insightsFor("owner", m => m !== "profitability_intelligence").map(d => d.href), ["/command-center", "/analytics", "/report-builder"]);
  assert.equal(INSIGHTS_DESTINATIONS.length, 4);
  const nav = readFileSync("lib/navigation/app-destinations.ts", "utf8");
  assert.doesNotMatch(nav, /href: "\/(analytics|profitability|reports|die-intelligence)"/, "one Insights entry, and Dies covers Die Intelligence");
  assert.match(nav, /href: "\/insights".*aliases: \["\/reports", "\/report-builder", "\/analytics", "\/profitability"\]/);
  assert.match(readFileSync("app/(dashboard)/reports/page.tsx", "utf8"), /redirect\("\/insights"\)/);
  assert.match(readFileSync("app/(dashboard)/die-intelligence/page.tsx", "utf8"), /redirect\("\/dies#die-health"\)/);
});

// ---------------------------------------------------------------- AP-091 / AP-096
test("AP-091 challan rows keep unknown values blank and total only when every bundle is known; the challan has no price", async () => {
  const rows = challanRows([{ bundle_number: "B-1", profile: "SL-40", description: "Sliding track", pieces: 20, length_m: 6, net_kg: 114.5, gross_kg: 116 }, { bundle_number: "B-2", profile: "SL-40", description: null, pieces: 20, length_m: null, net_kg: 110, gross_kg: null }]);
  assert.equal(rows.pieces, 40); assert.equal(rows.netKg, 224.5); assert.equal(rows.grossKg, null);
  assert.equal(rows.rows[1][4], "—");
  const bytes = await buildChallanPdf({ company: { name: "Omalco Extrusion" }, customer: { name: "Sharma Fabricators" }, dispatch: { dispatch_number: "DSP-1", dispatch_date: "2026-11-15", vehicle_number: "DL1LA1234" },
    order: { order_number: "SO-1" }, bundles: [{ bundle_number: "B-1", profile: "SL-40", description: "Sliding track", pieces: 20, length_m: 6, net_kg: 114.5, gross_kg: 116 }] });
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  assert.doesNotMatch(code("lib/pdf/challan-pdf.ts"), /rate|price|amount|margin|cost/i, "no money on a challan");
});

test("AP-091 selected documents merge in the order chosen; at most 50 at a time", async () => {
  const a = await textPdf(["First"]), b = await textPdf(["Second", "page"]);
  const merged = await PDFDocument.load(await mergePdfs([a, b, a], "Challans (3)"));
  assert.equal(merged.getPageCount(), 3);
  assert.equal(merged.getTitle(), "Challans (3)");
  assert.equal(MAX_BATCH_DOCUMENTS, 50);
  await assert.rejects(() => mergePdfs([], "none"));
});

test("AP-091 the batch route checks the role per kind, refuses the whole batch when one record fails, and prints a day's challans", async () => {
  const require = createRequire(import.meta.url); require("tsx/cjs");
  const Module = require("node:module"), original = Module._load;
  const state = { role: "dispatch", loads: [], failId: null, dayRows: [] };
  class NextResponse extends Response { static json(body, init) { return new NextResponse(JSON.stringify(body), { ...init, headers: { "Content-Type": "application/json" } }); } }
  const one = await textPdf(["Doc"]);
  Module._load = function (request, parent, isMain) {
    if (request === "next/server") return { NextResponse };
    if (request === "@/lib/auth") return { getSessionContext: async () => ({ companyId: "company-1", userId: "u", role: state.role, dealerId: null }) };
    if (request === "@/lib/auth/permissions") return { can: (role, _action, resource) => resource === "dispatches" ? ["dispatch", "owner"].includes(role) : role === "owner" };
    if (request === "@/lib/supabase/server") return { createClient: async () => ({ from: () => { const b = { select: () => b, eq: () => b, order: () => b, limit: async () => ({ data: state.dayRows, error: null }) }; return b; } }) };
    if (request === "@/lib/pdf/loaders") return { PDF_KINDS: ["invoice", "quote", "challan", "job_card"], loadPdf: async (kind, _s, _c, id) => { state.loads.push([kind, id]); return id === state.failId ? { ok: false, status: 409, error: "Not printable", label: "DSP-2" } : { ok: true, bytes: one, filename: "x.pdf", label: id }; } };
    return original(request, parent, isMain);
  };
  let route;
  try { route = require("../app/api/pdf/batch/route.ts"); } finally { Module._load = original; }
  const call = body => route.POST(new Request("http://x/api/pdf/batch", { method: "POST", body: JSON.stringify(body) }));
  const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
  let r = await call({ kind: "invoice", ids });
  assert.equal(r.status, 403, "dispatch cannot print invoices");
  r = await call({ kind: "challan", ids });
  assert.equal(r.status, 200);
  assert.equal((await PDFDocument.load(new Uint8Array(await r.arrayBuffer()))).getPageCount(), 2);
  state.failId = ids[1];
  r = await call({ kind: "challan", ids });
  assert.equal(r.status, 409);
  const body = await r.json();
  assert.match(body.error, /1 of 2 could not be printed, so nothing was merged/);
  assert.deepEqual(body.problems, ["DSP-2: Not printable"]);
  state.failId = null; state.dayRows = [{ id: ids[0] }]; state.loads.length = 0;
  r = await call({ kind: "challan", date: "2026-11-15" });
  assert.equal(r.status, 200); assert.deepEqual(state.loads, [["challan", ids[0]]]);
  assert.equal((await call({ kind: "quote", date: "2026-11-15" })).status, 400, "only challans print for a whole day");
  assert.equal((await call({ kind: "challan", ids: Array.from({ length: 51 }, (_, n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`) })).status, 400);
});

test("AP-096 the job card prints checks with an empty reading column and a QR that the scanner opens; unknowns print as a dash", async () => {
  const checks = [{ characteristic: "Wall thickness", unit: "mm", nominal: 1.4, lower_limit: 1.3, upper_limit: 1.5, method: "Micrometer", critical: true }, { characteristic: "Surface", unit: "visual", nominal: null, lower_limit: null, upper_limit: null, method: null, critical: false }];
  assert.deepEqual(jobCardCheckRows(checks), [["Wall thickness *", "mm", "min 1.3 · nom 1.4 · max 1.5", "Micrometer", ""], ["Surface", "visual", "Visual: pass / fail", "—", ""]]);
  const qrText = "EO2:production_job:00000000-0000-4000-8000-000000000001:nonce";
  const bytes = await buildJobCardPdf({ company: { name: "Omalco Extrusion" },
    job: { job_number: "JOB-1", status: "planned", planned_date: "2026-11-16", shift: "A", machine: "Press 1", order_number: "SO-1", customer: "Sharma Fabricators", due_date: "2026-11-20", planned_kg: 600, pieces: 100, planned_meters: null, cut_length_m: 6, finishing_type: "mill_finish", remarks: null },
    profile: { code: "SL-40", name: "Sliding track", kg_per_m: 0.95, alloy: "6063", temper: "T5", special_notes: null }, die: { number: "D-2045-A", cavities: 2, status: "active" },
    billet: { length_mm: null, length_basis: null, diameter: "7 inch", alloy: "6063" }, packing: { instruction: null, pieces_per_bundle: 20, kg_per_bundle: null, customer_requirement: null },
    checks, sampling: "First and every tenth bundle", qr: { runs: qrRuns(qrText, "M"), text: qrText }, printed_at: new Date("2026-11-15T03:00:00Z") });
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1, "one page");
  const { parseScanInput } = await import("../lib/qr/payload.ts");
  assert.equal(parseScanInput(qrText).kind, "v2");
  assert.doesNotMatch(code("lib/pdf/job-card-pdf.ts"), /price|margin|internal_cost|supplier_rate/i);
});

// ---------------------------------------------------------------- AP-092 / wiring
test("AP-092 a saved view stores the list URL's query exactly as the browser writes it", () => {
  const q = new URLSearchParams({ search: "Sharma & Sons", status: "packing", dateFrom: "2026-11-01", customer_id: "00000000-0000-4000-8000-000000000001" }).toString();
  assert.match(q, SAVED_VIEW_QUERY);
  assert.equal(viewCommands.save.safeParse({ page_key: "orders", name: "Packing for Sharma", query: q, make_default: true }).success, true);
  assert.equal(viewCommands.save.safeParse({ page_key: "orders", name: "x", query: "a=<b>" }).success, false);
  assert.equal(viewCommands.save.safeParse({ page_key: "../orders", name: "x", query: "" }).success, false);
  const client = readFileSync("components/modules/operations/module-database-client.tsx", "utf8");
  assert.match(client, /useDefaultView\(moduleKey, searchParams\.size > 0 \|\| Boolean\(initialStatus\)/, "the default view applies only when the page opens without filters");
  assert.doesNotMatch(readFileSync("components/modules/autopilot-batch8/saved-views.tsx", "utf8"), /@\/lib\/actions\//, "the shared database page never bundles a server action module");
  assert.doesNotMatch(readFileSync("components/modules/autopilot-batch8/print-selected.tsx", "utf8"), /@\/lib\/actions\//);
  assert.match(client, /PRINT_KINDS[^\n]*dispatches: "challan", invoices: "invoice", quotes: "quote", production: "job_card"/);
});

test("Batch 8 schemas, reads and jobs are registered", () => {
  assert.equal(capacityCommands.profile.safeParse({ quantity_kg: -1 }).success, false);
  assert.equal(spcCommands.chart.safeParse({ item_id: "00000000-0000-4000-8000-000000000001", subgroup: "die:none" }).success, true);
  assert.equal(spcCommands.chart.safeParse({ item_id: "00000000-0000-4000-8000-000000000001", subgroup: "x';drop" }).success, false);
  for (const read of ["charts", "alarms", "at_risk", "conflicts", "coverage", "target"]) assert.ok(BATCH8_READS.includes(read));
  for (const key of ["crm.customer_health", "quality.spc_check", "dies.availability"]) assert.ok(JOBS.some(j => j.job_key === key));
  const gateway = readFileSync("lib/actions/autopilot.ts", "utf8");
  for (const rpc of ["ap_views", "ap_die_window", "ap_capacity", "ap_customer_health", "ap_spc", "ap_mtc"]) assert.match(gateway, new RegExp(`${rpc}: `));
  assert.doesNotMatch(gateway, /ap_mtc: \{[^}]*draft/, "the draft is written only by the certificate action");
});

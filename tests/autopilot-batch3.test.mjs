import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { autoMapBank, buildStatementRows, findHeaderRow, markerSide, parseBankAmount, parseBankDate, remitterFromNarration, bankMappingSchema } from "../lib/financials/bank-statement.ts";
import { parseCsv, parseSpreadsheetGrid } from "../lib/master-data/import/spreadsheet.ts";
import { billingCommands, cashCommands, creditCommands, dupeCommands, inr, jobDraftCommands, quoteCommands, whatsappLink } from "../lib/order-to-cash/commands.ts";
import { duplicateGate, duplicateMessage } from "../lib/order-to-cash/duplicates.ts";
import { proposalHref, proposalSummary, proposalWhy, PROPOSAL_TYPE_KEYS } from "../lib/proposals/proposals.ts";
import { JOBS } from "../lib/jobs/registry.ts";

const U = n => `bd000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("AP-024 the heading row is found below the bank's account details, and columns are mapped by their words", () => {
  const grid = [["HDFC BANK LTD"], ["Account No : 50200012345678"], ["Statement From : 01/11/2026 To : 10/11/2026"], [],
    ["Date", "Narration", "Chq./Ref.No.", "Value Dt", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"],
    ["03/11/26", "NEFT CR-SBIN0001234-SHARMA FABRICATORS-OMX/26-27/0101", "SBIN123456789", "03/11/26", "", "10,000.00", "1,10,000.00"],
    ["04/11/26", "ATM WDL", "", "04/11/26", "5,000.00", "", "1,05,000.00"],
    ["05/11/26", "IMPS 998877 RAJ ENTERPRISES", "998877", "05/11/26", "", "7,77,777.50", "8,82,777.50"],
    ["31/31/26", "bad date", "", "", "", "100", ""], ["06/11/26", "two amounts", "", "", "10", "10", ""], ["", "Closing balance", "", "", "", "", "8,82,777.50"]];
  const header = findHeaderRow(grid);
  assert.equal(header, 4);
  const mapping = autoMapBank(grid[header]);
  assert.deepEqual(mapping, { date: 0, narration: 1, reference: 2, credit: 5, debit: 4, amount: null, drcr: null });
  assert.ok(bankMappingSchema.safeParse(mapping).success);
  const { rows, errors } = buildStatementRows(grid, header, mapping, "DD/MM/YY");
  assert.deepEqual(rows.map(r => [r.txn_date, r.credit, r.debit]), [["2026-11-03", "10000.00", null], ["2026-11-04", null, "5000.00"], ["2026-11-05", "777777.50", null]]);
  assert.deepEqual(errors.map(e => e.line_no), [4, 5], "unreadable rows are reported, never turned into zero; the closing-balance line is skipped");
});

test("AP-024 dates, Indian amounts and single-amount Dr/Cr statements", () => {
  assert.equal(parseBankDate("03/11/2026", "DD/MM/YYYY"), "2026-11-03");
  assert.equal(parseBankDate("31/02/2026", "DD/MM/YYYY"), null);
  assert.equal(parseBankDate("03-Nov-2026", "DD-MMM-YYYY"), "2026-11-03");
  assert.equal(parseBankDate("2026-11-03 10:30", "YYYY-MM-DD"), "2026-11-03");
  assert.equal(parseBankDate("46329", "DD/MM/YYYY"), "2026-11-03", "Excel serial date");
  assert.equal(parseBankAmount("1,23,456.50"), 123456.5);
  assert.equal(parseBankAmount("₹ 1,000.00 Cr"), 1000);
  assert.equal(parseBankAmount(""), null);
  assert.ok(Number.isNaN(parseBankAmount("12a")));
  const grid = [["Txn Date", "Description", "Amount", "Dr/Cr"], ["03/11/2026", "UPI/CR/123/PARTY", "500.00", "CR"], ["03/11/2026", "CHARGES", "20.00", "DR"]];
  const mapping = autoMapBank(grid[0]);
  assert.equal(mapping.amount, 2);
  assert.equal(mapping.drcr, 3);
  const { rows } = buildStatementRows(grid, 0, mapping, "DD/MM/YYYY");
  assert.deepEqual(rows.map(r => [r.credit, r.debit]), [["500.00", null], [null, "20.00"]]);
});

test("AP-024 the remitter is the narration without transfer words, references, IFSC codes and numbers", () => {
  assert.equal(remitterFromNarration("NEFT CR-SBIN0001234-SHARMA FABRICATORS-OMX/26-27/0101"), "SHARMA FABRICATORS OMX");
  assert.equal(remitterFromNarration("IMPS 998877 RAJ ENTERPRISES"), "RAJ ENTERPRISES");
  assert.equal(remitterFromNarration("UPI/CR/1234567890/PAYMENT"), null);
});

test("AP-084 WhatsApp links only for Indian mobile numbers; amounts use Indian grouping", () => {
  assert.equal(whatsappLink("98200 00002", "Hi"), "https://wa.me/919820000002?text=Hi");
  assert.equal(whatsappLink("+91 98200-00002", "Hi"), "https://wa.me/919820000002?text=Hi");
  assert.equal(whatsappLink("022 2345 6789", "Hi"), null, "a landline gets no link; copy the message instead");
  assert.equal(whatsappLink(null, "Hi"), null);
  assert.equal(inr(1234567.5), "₹12,34,567.50");
  assert.equal(inr(null), "—");
});

test("Batch 3 command schemas refuse malformed input before the database", () => {
  assert.equal(creditCommands.decide.safeParse({ hold_id: U(1), decision: "reject" }).success, false, "refusing credit needs a note");
  assert.equal(creditCommands.set_limit.safeParse({ customer_id: U(1), credit_limit: -1, reason: "Agreed" }).success, false);
  assert.equal(cashCommands.post.safeParse({ key: U(1), customer_id: U(2), amount: 100, payment_date: "2026-11-11", payment_method: "credit_note", allocations: [], on_account: 100 }).success, false,
    "credit notes are not bank receipts");
  assert.equal(cashCommands.reminder_sent.safeParse({ id: U(1), channel: "sms" }).success, false);
  assert.equal(quoteCommands.decide_extension.safeParse({ request_id: U(1), decision: "reject" }).success, false);
  assert.equal(billingCommands.gst_confirm.safeParse({ hsn_profile: "760" }).success, false);
  assert.equal(jobDraftCommands.release.safeParse({ id: U(1), planned_date: "11/11/2026" }).success, false);
  assert.equal(dupeCommands.check.safeParse({ kind: "invoice" }).success, false);
});

test("AP-097 the duplicate gate stops a save only for a confirmed match list, logs 'save anyway', and never blocks when the check cannot run", async () => {
  const match = { id: U(5), kind: "order", label: "SO/26-27/0042", href: `/orders/${U(5)}`, created_at: "2026-11-11T05:00:00Z", why: "Same customer and value INR 50,000.00" };
  const calls = [];
  const client = matches => ({ rpc: async (fn, args) => { calls.push(args.p_command); return args.p_command === "check" ? { data: { matches }, error: null } : { data: { logged: true }, error: null }; } });
  assert.deepEqual(await duplicateGate(client([match]), "order", { customer_id: U(1), order_value: 50000, quote_id: null }, null), { blocked: true, matches: [match] });
  assert.equal((await duplicateGate(client([match]), "order", { customer_id: U(1) }, { confirmed: true, note: "Second load" })).blocked, false);
  assert.ok(calls.includes("acknowledge"));
  assert.equal((await duplicateGate(client([]), "order", { customer_id: U(1) }, null)).blocked, false);
  assert.equal((await duplicateGate({ rpc: async () => ({ data: null, error: { code: "PGRST202" } }) }, "order", {}, null)).blocked, false);
  assert.equal((await duplicateGate({ rpc: async () => { throw new Error("offline"); } }, "order", {}, null)).blocked, false);
  assert.match(duplicateMessage([match]), /SO\/26-27\/0042 \(Same customer/);
});

test("AP-024 bank matches use the shared proposal card and say where the money goes", () => {
  assert.ok(PROPOSAL_TYPE_KEYS.includes("bank.receipt_match"));
  const row = { id: U(9), proposal_type: "bank.receipt_match", target_key: U(8), title: "Receipt", rule_key: "bank.match_exact", reason: "The narration names an open invoice of Sharma Fabricators.",
    confidence: 0.95, status: "open", created_at: "2026-11-11T05:00:00Z", expires_at: "2026-12-01T05:00:00Z", decided_at: null, decided_by: null, edited_fields: [], decision_note: null, outcome: null,
    editable: [], can_decide: true, stale_now: false, job_run_id: null, versions: {},
    payload: { customer: "Sharma Fabricators", amount: 12000, reference: "SBIN123", allocations: [{ invoice_number: "OMX/26-27/0101", amount: 10000, basis: "named" }], on_account: 2000 },
    evidence: { class: "exact", signals: ["invoice_named"], narration: "NEFT CR SHARMA OMX/26-27/0101", open_total: 10000 } };
  assert.match(proposalSummary(row), /₹12,000\.00 from Sharma Fabricators .* and ₹2,000\.00 on account/);
  const why = proposalWhy(row).join(" | ");
  assert.match(why, /named in the narration/);
  assert.match(why, /stays on account/);
  assert.match(why, /exact/);
  assert.equal(proposalHref(row), `/payments/bank#proposal-${U(9)}`);
});

test("Batch 3 jobs and entry points are registered on the client side", () => {
  for (const key of ["quotes.expire", "billing.prepare_drafts", "receivables.reminders", "alerts.reevaluate", "bank.rematch"]) assert.ok(JOBS.some(j => j.job_key === key), key);
  const gateway = readFileSync(new URL("../lib/actions/autopilot.ts", import.meta.url), "utf8");
  for (const rpc of ["ap_credit", "ap_jobdrafts", "ap_billing", "ap_cash", "ap_quotes", "ap_dupes"]) assert.match(gateway, new RegExp(`${rpc}: `), rpc);
  const routes = readFileSync(new URL("../lib/auth/route-permissions.ts", import.meta.url), "utf8");
  for (const route of ["/orders/credit", "/production/drafts", "/invoices/drafts", "/invoices/tax-rules", "/payments/bank", "/payments/reminders", "/settings/data/duplicates"]) assert.ok(routes.includes(`"${route}"`), route);
});

test("AP-024 a Dr/Cr column is read by its words: Deposit is a credit, Withdrawal and Dr are debits, anything else is reported", () => {
  assert.equal(markerSide("Deposit"), "credit");
  assert.equal(markerSide("CR"), "credit");
  assert.equal(markerSide("Cr."), "credit");
  assert.equal(markerSide("Dr."), "debit");
  assert.equal(markerSide("D"), "debit");
  assert.equal(markerSide("Withdrawal"), "debit");
  assert.equal(markerSide("DEBIT"), "debit");
  assert.equal(markerSide(""), null);
  assert.equal(markerSide("Transfer"), "unknown");
  const grid = [["Date", "Narration", "Amount", "Type"], ["03/11/2026", "CASH DEPOSIT BRANCH", "2,500.00", "Deposit"], ["03/11/2026", "ATM", "500.00", "Withdrawal"],
    ["03/11/2026", "SOMETHING", "10.00", "Transfer"], ["03/11/2026", "NO TYPE", "-40.00", ""]];
  const mapping = autoMapBank(grid[0]);
  assert.deepEqual([mapping.amount, mapping.drcr], [2, 3]);
  const { rows, errors } = buildStatementRows(grid, 0, mapping, "DD/MM/YYYY");
  assert.deepEqual(rows.map(r => [r.narration, r.credit, r.debit]), [["CASH DEPOSIT BRANCH", "2500.00", null], ["ATM", null, "500.00"], ["NO TYPE", null, "40.00"]]);
  assert.deepEqual(errors, [{ line_no: 3, error: 'Type "Transfer" is neither credit nor debit' }]);
});

test("AP-024 a statement whose first row is a one-cell bank name keeps every heading column", () => {
  const csv = "HDFC BANK LTD\nAccount No : 50200012345678\n\nDate,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\n03/11/26,NEFT CR SHARMA FABRICATORS,SBIN1,03/11/26,,\"10,000.00\",\"1,10,000.00\"\n";
  assert.equal(parseCsv(csv).headers.length, 1, "the master-data reader still takes the first row as its headings");
  const grid = parseSpreadsheetGrid("hdfc.csv", Buffer.from(csv));
  const header = findHeaderRow(grid);
  assert.equal(header, 2);
  assert.equal(grid[header].length, 7);
  const mapping = autoMapBank(grid[header]);
  assert.deepEqual(mapping, { date: 0, narration: 1, reference: 2, credit: 5, debit: 4, amount: null, drcr: null });
  const { rows } = buildStatementRows(grid, header, mapping, "DD/MM/YY");
  assert.deepEqual(rows.map(r => [r.txn_date, r.credit, r.reference]), [["2026-11-03", "10000.00", "SBIN1"]]);
});

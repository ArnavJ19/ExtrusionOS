// AP-083: Tally import XML from posted vouchers. The database lists vouchers not yet exported
// (private.ap4_tally_vouchers) and the ledger mapping; this module resolves ledger names, checks that every voucher
// balances and has its ledgers, and writes one Tally "Import Data / Vouchers" envelope. In Tally XML a debit is a
// negative amount with ISDEEMEDPOSITIVE=Yes; a credit is positive with ISDEEMEDPOSITIVE=No.

export type TallyVoucherKind = "sales" | "receipt" | "on_account" | "purchase" | "credit_note";
export type TallyVoucher = { kind: TallyVoucherKind; id: string; number: string; date: string; amount: number; party_id: string | null; party: string | null; data: Record<string, any> };
export type TallyMapping = { kind: string; entity_id: string | null; gst_rate: number | null; supply: "local" | "interstate" | null; ledger_name: string };
export type TallyEntry = { ledger: string; amount: number; bills?: { name: string; type: "Agst Ref" | "On Account"; amount: number }[] };
export type TallyIssue = { voucher: string; message: string };

export const TALLY_VOUCHER_LABELS: Record<TallyVoucherKind, string> = { sales: "Sales", receipt: "Receipt", on_account: "Receipt (on account)", purchase: "Purchase", credit_note: "Credit Note" };
const VCHTYPE: Record<TallyVoucherKind, string> = { sales: "Sales", receipt: "Receipt", on_account: "Receipt", purchase: "Purchase", credit_note: "Credit Note" };

const r2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
export function xmlEscape(value: string) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export class LedgerBook {
  private readonly mappings: TallyMapping[];
  constructor(mappings: TallyMapping[]) { this.mappings = mappings; }
  private find(kind: string, test: (m: TallyMapping) => boolean = () => true) { return this.mappings.find(m => m.kind === kind && test(m))?.ledger_name ?? null; }
  party(kind: "customer" | "vendor", id: string | null, fallback: string | null) { return (id && this.find(kind, m => m.entity_id === id)) || (fallback ? fallback.trim() : null); }
  /** Sales/purchase ledger: rate+supply, then rate, then supply, then the general one. */
  trade(kind: "sales" | "purchase", rate: number | null, supply: "local" | "interstate") {
    return this.find(kind, m => m.gst_rate !== null && rate !== null && Number(m.gst_rate) === Number(rate) && m.supply === supply)
      ?? this.find(kind, m => m.gst_rate !== null && rate !== null && Number(m.gst_rate) === Number(rate) && m.supply === null)
      ?? this.find(kind, m => m.gst_rate === null && m.supply === supply)
      ?? this.find(kind, m => m.gst_rate === null && m.supply === null);
  }
  account(kind: string) { return this.find(kind); }
}

function need(issues: TallyIssue[], voucher: TallyVoucher, name: string | null, what: string): string {
  if (!name) issues.push({ voucher: `${TALLY_VOUCHER_LABELS[voucher.kind]} ${voucher.number}`, message: `Map the ${what} ledger in Tally settings.` });
  return name ?? "";
}

/** The ledger entries of one voucher, signed as Tally expects (debit negative). */
export function voucherEntries(voucher: TallyVoucher, book: LedgerBook, issues: TallyIssue[]): TallyEntry[] {
  const d = voucher.data ?? {};
  const local = d.supply !== "interstate";
  const entries: TallyEntry[] = [];
  if (voucher.kind === "sales") {
    const party = need(issues, voucher, book.party("customer", voucher.party_id, voucher.party), "customer");
    entries.push({ ledger: party, amount: -r2(voucher.amount), bills: [{ name: voucher.number, type: "Agst Ref", amount: -r2(voucher.amount) }] });
    // Item lines by GST rate; an invoice whose lines do not add up to its taxable value (or has none) uses one line.
    let lines = (d.lines ?? []) as { rate: number | null; taxable: number }[];
    if (Math.abs(lines.reduce((sum, line) => sum + Number(line.taxable), 0) - Number(d.subtotal ?? 0)) > 1) lines = [{ rate: lines.length === 1 ? lines[0].rate : null, taxable: Number(d.subtotal ?? 0) }];
    for (const line of lines) {
      entries.push({ ledger: need(issues, voucher, book.trade("sales", line.rate, local ? "local" : "interstate"), `sales (${line.rate === null ? "" : `${line.rate}% `}${local ? "local" : "interstate"})`), amount: r2(line.taxable) });
    }
    if (Number(d.cgst) > 0) entries.push({ ledger: need(issues, voucher, book.account("output_cgst"), "output CGST"), amount: r2(d.cgst) });
    if (Number(d.sgst) > 0) entries.push({ ledger: need(issues, voucher, book.account("output_sgst"), "output SGST"), amount: r2(d.sgst) });
    if (Number(d.igst) > 0) entries.push({ ledger: need(issues, voucher, book.account("output_igst"), "output IGST"), amount: r2(d.igst) });
  } else if (voucher.kind === "receipt" || voucher.kind === "on_account") {
    const cash = d.method === "cash";
    const party = need(issues, voucher, book.party("customer", voucher.party_id, voucher.party), "customer");
    const bills = voucher.kind === "on_account"
      ? [{ name: voucher.number, type: "On Account" as const, amount: r2(voucher.amount) }]
      : ((d.allocations ?? []) as { invoice_number: string; amount: number }[]).map(a => ({ name: a.invoice_number, type: "Agst Ref" as const, amount: r2(a.amount) }));
    entries.push({ ledger: need(issues, voucher, book.account(cash ? "cash" : "bank"), cash ? "cash" : "bank"), amount: -r2(voucher.amount) });
    entries.push({ ledger: party, amount: r2(voucher.amount), bills });
    if (d.status === "partially_reversed") issues.push({ voucher: `Receipt ${voucher.number}`, message: "Part of this receipt was reversed; enter it in Tally by hand after review." });
  } else if (voucher.kind === "purchase") {
    const party = need(issues, voucher, book.party("vendor", voucher.party_id, voucher.party), "supplier");
    entries.push({ ledger: party, amount: r2(voucher.amount), bills: [{ name: voucher.number, type: "Agst Ref", amount: r2(voucher.amount) }] });
    entries.push({ ledger: need(issues, voucher, book.trade("purchase", null, local ? "local" : "interstate"), `purchase (${local ? "local" : "interstate"})`), amount: -r2(d.taxable) });
    const tax = r2(d.tax);
    if (tax > 0 && local) {
      const half = r2(tax / 2);
      entries.push({ ledger: need(issues, voucher, book.account("input_cgst"), "input CGST"), amount: -half });
      entries.push({ ledger: need(issues, voucher, book.account("input_sgst"), "input SGST"), amount: -r2(tax - half) });
    } else if (tax > 0) entries.push({ ledger: need(issues, voucher, book.account("input_igst"), "input IGST"), amount: -tax });
    if (Number(d.freight) > 0) entries.push({ ledger: need(issues, voucher, book.account("freight_inward"), "freight inward"), amount: -r2(d.freight) });
    if (Number(d.discount) > 0) entries.push({ ledger: need(issues, voucher, book.account("discount_received"), "discount received"), amount: r2(d.discount) });
  } else if (voucher.kind === "credit_note") {
    const party = need(issues, voucher, book.party("customer", voucher.party_id, voucher.party), "customer");
    entries.push({ ledger: party, amount: r2(voucher.amount), bills: [{ name: String(d.invoice_number ?? voucher.number), type: "Agst Ref", amount: r2(voucher.amount) }] });
    entries.push({ ledger: need(issues, voucher, book.trade("sales", d.rate ?? null, local ? "local" : "interstate"), "sales"), amount: -r2(d.subtotal) });
    const tax = r2(d.tax);
    if (tax > 0 && local) {
      const half = r2(tax / 2);
      entries.push({ ledger: need(issues, voucher, book.account("output_cgst"), "output CGST"), amount: -half });
      entries.push({ ledger: need(issues, voucher, book.account("output_sgst"), "output SGST"), amount: -r2(tax - half) });
    } else if (tax > 0) entries.push({ ledger: need(issues, voucher, book.account("output_igst"), "output IGST"), amount: -tax });
  }
  // Paise rounding on the document goes to round off; anything larger is a data problem.
  const difference = r2(entries.reduce((sum, entry) => sum + entry.amount, 0));
  if (difference !== 0) {
    if (Math.abs(difference) <= 1) entries.push({ ledger: need(issues, voucher, book.account("round_off"), "round off"), amount: -difference });
    else issues.push({ voucher: `${TALLY_VOUCHER_LABELS[voucher.kind]} ${voucher.number}`, message: `Does not balance by ${difference.toFixed(2)}; check the document before exporting.` });
  }
  return entries;
}

const tallyDate = (iso: string) => iso.slice(0, 10).replace(/-/g, "");
const amount = (value: number) => value.toFixed(2);

function voucherXml(voucher: TallyVoucher, entries: TallyEntry[]) {
  const type = VCHTYPE[voucher.kind];
  const party = entries.find(entry => entry.bills)?.ledger ?? "";
  const lines = entries.map(entry => {
    const bills = (entry.bills ?? []).map(bill => `<BILLALLOCATIONS.LIST><NAME>${xmlEscape(bill.name)}</NAME><BILLTYPE>${bill.type}</BILLTYPE><AMOUNT>${amount(bill.amount)}</AMOUNT></BILLALLOCATIONS.LIST>`).join("");
    return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xmlEscape(entry.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${entry.amount < 0 ? "Yes" : "No"}</ISDEEMEDPOSITIVE><AMOUNT>${amount(entry.amount)}</AMOUNT>${bills}</ALLLEDGERENTRIES.LIST>`;
  }).join("");
  return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER REMOTEID="exos-${voucher.kind}-${voucher.id}" VCHTYPE="${type}" ACTION="Create" OBJVIEW="Accounting Voucher View">`
    + `<DATE>${tallyDate(voucher.date)}</DATE><VOUCHERTYPENAME>${type}</VOUCHERTYPENAME><VOUCHERNUMBER>${xmlEscape(voucher.number)}</VOUCHERNUMBER>`
    + `<REFERENCE>${xmlEscape(voucher.number)}</REFERENCE><PARTYLEDGERNAME>${xmlEscape(party)}</PARTYLEDGERNAME><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>`
    + `<NARRATION>${xmlEscape(`ExtrusionOS ${TALLY_VOUCHER_LABELS[voucher.kind]} ${voucher.number}`)}</NARRATION>${lines}</VOUCHER></TALLYMESSAGE>`;
}

export type TallyExport = { xml: string; exported: TallyVoucher[]; issues: TallyIssue[] };

/** Builds the import file. Any voucher with an issue is left out (it stays pending) and its issues are listed. */
export function buildTallyExport(companyName: string, vouchers: TallyVoucher[], mappings: TallyMapping[]): TallyExport {
  const book = new LedgerBook(mappings);
  const issues: TallyIssue[] = [];
  const parts: string[] = [];
  const exported: TallyVoucher[] = [];
  for (const voucher of vouchers) {
    const own: TallyIssue[] = [];
    const entries = voucherEntries(voucher, book, own);
    if (own.length) { issues.push(...own); continue; }
    parts.push(voucherXml(voucher, entries));
    exported.push(voucher);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>`
    + `<STATICVARIABLES><SVCURRENTCOMPANY>${xmlEscape(companyName)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>${parts.join("")}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n`;
  return { xml, exported, issues };
}

export const TALLY_LEDGER_KINDS = {
  customer: "Customer (party)", vendor: "Supplier (party)", sales: "Sales", purchase: "Purchase", output_cgst: "Output CGST", output_sgst: "Output SGST", output_igst: "Output IGST",
  input_cgst: "Input CGST", input_sgst: "Input SGST", input_igst: "Input IGST", round_off: "Round off", bank: "Bank", cash: "Cash", freight_inward: "Freight inward", discount_received: "Discount received"
} as const;
export type TallyLedgerKind = keyof typeof TALLY_LEDGER_KINDS;

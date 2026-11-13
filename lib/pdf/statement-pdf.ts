// AP-079: monthly customer statement of account, on the shared document engine. Everything printed comes from the
// stored statement (prepared from that customer's own invoices, receipts and credit notes); no cost or internal note.
import { type PdfFontLoader } from "./unicode-text.ts";
import { nodeFontLoader } from "./font-loader-node.ts";
import { PdfDocumentWriter, type PdfTableRow } from "./document-kit.ts";
import { pdfAmount, pdfDate, pdfMoney } from "./format.ts";

export type StatementLine = { date: string; kind: "invoice" | "receipt" | "refund" | "credit_note"; reference: string; debit: number; credit: number; balance: number };
export type StatementOpenInvoice = { invoice_number: string; invoice_date: string; due_date: string | null; total: number; balance: number; days_overdue: number };
export type StatementDocument = {
  company: { name: string; legal_name?: string | null; gst_number?: string | null; address?: string | null };
  customer: { name: string; gst_number?: string | null; address?: string | null };
  period_start: string; period_end: string;
  opening_balance: number; invoiced: number; received: number; credited: number; closing_balance: number; on_account: number;
  lines: StatementLine[]; open_invoices: StatementOpenInvoice[];
  logo?: Uint8Array | null;
};

const KIND: Record<StatementLine["kind"], string> = { invoice: "Invoice", receipt: "Receipt", refund: "Refund", credit_note: "Credit note" };
const monthLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** Statement rows with a running balance; used by the PDF and checked in tests. */
export function statementRows(doc: Pick<StatementDocument, "opening_balance" | "lines">): PdfTableRow[] {
  return [
    { cells: ["", "Opening balance", "", "", "", pdfAmount(doc.opening_balance)], kind: "group" },
    ...doc.lines.map(line => [pdfDate(line.date), KIND[line.kind] ?? line.kind, line.reference, line.debit ? pdfAmount(line.debit) : "", line.credit ? pdfAmount(line.credit) : "", pdfAmount(line.balance)] as PdfTableRow)
  ];
}

export async function buildStatementPdf(doc: StatementDocument, loadFont: PdfFontLoader = nodeFontLoader) {
  const writer = await PdfDocumentWriter.create({
    title: "STATEMENT OF ACCOUNT",
    number: `${monthLabel(doc.period_start)}`,
    logo: doc.logo ?? null,
    issuer: { name: doc.company.name || "Company", lines: [doc.company.legal_name, doc.company.address, doc.company.gst_number ? `GSTIN: ${doc.company.gst_number}` : null] },
    meta: [["Period", `${pdfDate(doc.period_start)} to ${pdfDate(doc.period_end)}`], ["Closing balance", pdfMoney(doc.closing_balance)]],
    subject: `Statement of account ${monthLabel(doc.period_start)}`
  }, loadFont, doc);
  writer.panels([{ label: "Customer", title: doc.customer.name || "Customer", lines: [doc.customer.address, doc.customer.gst_number ? `GSTIN: ${doc.customer.gst_number}` : null] }]);
  writer.sectionTitle("Account movements", 30);
  writer.table([
    { header: "Date", width: 13 }, { header: "Type", width: 12 }, { header: "Reference", width: 33 },
    { header: "Debit (INR)", width: 14, align: "right" }, { header: "Credit (INR)", width: 14, align: "right" }, { header: "Balance (INR)", width: 14, align: "right" }
  ], statementRows(doc), { emptyText: "No movements in this period." });
  writer.totals([
    { label: "Opening balance", value: pdfMoney(doc.opening_balance) },
    { label: "Invoiced", value: pdfMoney(doc.invoiced) },
    { label: "Received", value: pdfMoney(doc.received) },
    ...(doc.credited ? [{ label: "Credit notes", value: pdfMoney(doc.credited) }] : []),
    { label: "Closing balance", value: pdfMoney(doc.closing_balance), emphasis: true },
    ...(doc.on_account > 0 ? [{ label: "Received on account, not yet allocated", value: pdfMoney(doc.on_account), muted: true }] : [])
  ], { width: 300 });
  if (doc.open_invoices.length) {
    writer.sectionTitle("Invoices open at the period end", 30);
    writer.table([
      { header: "Invoice", width: 24 }, { header: "Date", width: 16 }, { header: "Due", width: 16 }, { header: "Days overdue", width: 14, align: "right" },
      { header: "Total (INR)", width: 15, align: "right" }, { header: "Balance (INR)", width: 15, align: "right" }
    ], doc.open_invoices.map(x => [x.invoice_number, pdfDate(x.invoice_date), pdfDate(x.due_date), x.days_overdue ? String(x.days_overdue) : "", pdfAmount(x.total), pdfAmount(x.balance)]));
  }
  writer.space(8);
  writer.paragraph("Please check this statement and tell us of any difference within 15 days. Receipts after the period end are not shown.", { size: 8 });
  return writer.finish();
}


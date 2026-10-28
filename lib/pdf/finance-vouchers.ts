import { numberToWordsINR } from "../utils/number-to-words.ts";
import { type PdfFontLoader } from "./unicode-text.ts";
import { nodeFontLoader } from "./font-loader-node.ts";
import { PdfDocumentWriter, type PdfTableRow, type StampTone } from "./document-kit.ts";
import { issuerName, joinParts, legalNameLine, pdfAmount, pdfDate, pdfLabel, pdfMoney, pdfQuantity } from "./format.ts";

// Printable finance vouchers (PDF-05): return credit notes, expense vouchers and supplier
// payment vouchers, laid out on the shared document engine (identity header, ruled line table,
// totals block, amount in words, signatures, document number and page x of y on every page).

export type VoucherLine = { description: string; quantity?: string; amount: number };
export type VoucherDocument = {
  title: string;
  number: string;
  date: string;
  status?: string | null;
  /** Currency of every amount on the voucher; amount in words is printed only for INR. */
  currency?: string;
  issuer: { name: string; legalName?: string | null; gstin?: string | null; address?: string | null };
  party?: { label: string; name: string; gstin?: string | null; address?: string | null } | null;
  details: [string, string][];
  lines?: VoucherLine[];
  linesTitle?: string;
  totals: [string, number, boolean?][];
  amountInWords?: number | null;
  notes?: string | null;
  signatures?: string[];
  /** Company logo bytes (lib/pdf/logo-loader-node.ts). */
  logo?: Uint8Array | null;
};

export const voucherMoney = (value: unknown, currency = "INR") => pdfMoney(value ?? 0, currency);

function statusTone(status: string): StampTone {
  if (/revers|cancel|void|reject/.test(status)) return "void";
  if (/draft|pending|partial|unpaid|overdue/.test(status)) return "warning";
  if (/paid|posted|issued|approved|settled/.test(status)) return "positive";
  return "neutral";
}

export async function buildVoucherPdf(doc: VoucherDocument, loadFont: PdfFontLoader = nodeFontLoader) {
  const currency = doc.currency || "INR";
  const status = String(doc.status ?? "").toLowerCase();
  const reversed = /^revers/.test(status) || /^REVERSED/.test(doc.title);
  const writer = await PdfDocumentWriter.create({
    title: doc.title,
    number: doc.number,
    logo: doc.logo ?? null,
    issuer: { name: doc.issuer.name || "Company", lines: [doc.issuer.legalName, doc.issuer.address, doc.issuer.gstin ? `GSTIN: ${doc.issuer.gstin}` : null] },
    meta: [
      [/CREDIT NOTE/i.test(doc.title) ? "Credit note No." : "Voucher No.", doc.number],
      ["Date", pdfDate(doc.date)],
      ["Status", doc.status ? pdfLabel(doc.status.replace(/\s*\/\s*/g, " / ")) : null],
      ["Currency", currency !== "INR" ? currency : null]
    ],
    stamp: reversed && !/REVERSED/i.test(doc.title) ? { text: "Reversed", tone: "void" } : null,
    subject: `${doc.title} ${doc.number}`
  }, loadFont, doc);

  if (reversed) writer.notice("This document has been reversed. It is retained for the audit trail and has no financial effect.", "void");
  else if (status && statusTone(status) === "void") writer.notice(`Status: ${pdfLabel(doc.status)}.`, "void");

  if (doc.party) {
    writer.panels([{ label: doc.party.label, title: doc.party.name || "Not recorded", lines: [doc.party.address, doc.party.gstin ? `GSTIN: ${doc.party.gstin}` : null] }]);
  }

  if (doc.details.length) {
    writer.sectionTitle("Particulars", 30);
    writer.fields(doc.details.map(([label, value]) => [label, value || null]), { columns: 1, labelRatio: 0.24 });
  }

  if (doc.lines?.length) {
    const showQuantity = doc.lines.some((line) => line.quantity);
    const rows: PdfTableRow[] = doc.lines.map((line, index) => showQuantity
      ? [String(index + 1), line.description, line.quantity ?? "", pdfAmount(line.amount)]
      : [String(index + 1), line.description, pdfAmount(line.amount)]);
    writer.sectionTitle(doc.linesTitle ?? "Lines", 30);
    writer.table(showQuantity
      ? [{ header: "#", width: 4, align: "right" }, { header: "Description", width: 62 }, { header: "Quantity", width: 14, align: "right" }, { header: `Amount (${currency})`, width: 20, align: "right" }]
      : [{ header: "#", width: 4, align: "right" }, { header: "Description", width: 76 }, { header: `Amount (${currency})`, width: 20, align: "right" }], rows);
  }

  const signers = doc.signatures ?? ["Prepared by", "Checked by", "Authorised signatory"];
  writer.closing(signers, { forName: doc.issuer.name || undefined });
  writer.totals(doc.totals.map(([label, value, strong]) => ({ label, value: voucherMoney(value, currency), emphasis: Boolean(strong) })), { width: 270 });
  if (doc.amountInWords != null && currency === "INR") writer.amountInWords(numberToWordsINR(Math.abs(Number(doc.amountInWords))));
  if (doc.notes) {
    writer.sectionTitle("Notes", 20);
    writer.paragraph(doc.notes, { size: 8 });
    writer.space(8);
  }
  writer.space(6);
  writer.signatures(signers, { forName: doc.issuer.name || undefined });
  return writer.finish();
}

type Snapshot = Record<string, any> | null | undefined;
const partyName = (snapshot: Snapshot) => String(snapshot?.legal_name || snapshot?.company_name || snapshot?.name || snapshot?.customer_name || "");
/** Street address followed by city, state and PIN when the record carries them. */
const partyAddress = (snapshot: Snapshot) => joinParts([snapshot?.address ?? snapshot?.billing_address, snapshot?.city, snapshot?.state, snapshot?.pincode]) || null;

export function creditNoteVoucher(input: {
  note: Record<string, any>;
  invoice: Record<string, any>;
  dispatchNumber?: string | null;
}): VoucherDocument {
  const { note, invoice } = input;
  const items = Array.isArray(note.item_snapshot) ? note.item_snapshot : [];
  return {
    title: note.status === "reversed" ? "REVERSED CREDIT NOTE" : "CREDIT NOTE",
    number: String(note.credit_note_number),
    date: String(note.credit_date),
    status: note.status,
    issuer: { name: issuerName(invoice.supplier_snapshot, ""), legalName: legalNameLine(invoice.supplier_snapshot), gstin: invoice.supplier_snapshot?.gst_number, address: partyAddress(invoice.supplier_snapshot) },
    party: { label: "Credit to", name: partyName(invoice.customer_snapshot), gstin: invoice.customer_snapshot?.gst_number, address: invoice.customer_snapshot?.billing_address },
    details: [
      ["Against invoice", `${invoice.invoice_number} dated ${pdfDate(invoice.invoice_date)}`],
      ["Dispatch", input.dispatchNumber ?? ""],
      ["Reason", String(note.reason ?? "")],
      ...(note.status === "reversed" ? [["Reversal reason", String(note.reversal_reason ?? "")] as [string, string]] : [])
    ],
    lines: items.map((item: Record<string, any>) => ({
      description: `${item.item_description ?? "Aluminium profile"}${item.hsn_code ? ` (HSN ${item.hsn_code})` : ""}`,
      quantity: item.quantity != null ? pdfQuantity(item.quantity, 3, "kg") : undefined,
      amount: Number(item.line_total ?? 0)
    })),
    linesTitle: "Returned goods",
    totals: [["Taxable value", Number(note.subtotal ?? 0)], ["GST", Number(note.tax_total ?? 0)], ["Credit note total", Number(note.grand_total ?? 0), true]],
    amountInWords: Number(note.grand_total ?? 0),
    signatures: ["Prepared by", "Accounts", "Authorised signatory"]
  };
}

export function expenseVoucher(input: {
  company: Record<string, any>;
  expense: Record<string, any>;
  payments: Record<string, any>[];
  credits: Record<string, any>[];
}): VoucherDocument {
  const { expense } = input;
  const postedPayments = input.payments.filter((payment) => payment.status === "posted");
  return {
    title: "EXPENSE VOUCHER",
    number: String(expense.expense_number),
    date: String(expense.invoice_date ?? String(expense.created_at ?? "").slice(0, 10)),
    status: `${expense.approval_status} / ${expense.payment_status}`,
    currency: String(expense.currency || "INR"),
    issuer: { name: issuerName(input.company, ""), legalName: legalNameLine(input.company), gstin: input.company.gst_number, address: partyAddress(input.company) },
    party: expense.vendor_name_snapshot ? { label: "Vendor", name: String(expense.vendor_name_snapshot) } : null,
    details: [
      ["Category", `${pdfLabel(expense.expense_category)}${expense.expense_subcategory ? ` / ${expense.expense_subcategory}` : ""}`],
      ["Description", String(expense.description ?? "")],
      ["Vendor bill", [expense.invoice_number, expense.invoice_date ? pdfDate(expense.invoice_date) : null].filter(Boolean).join(" dated ")],
      ["Due date", expense.due_date ? pdfDate(expense.due_date) : ""],
      ["Source", expense.source_table ? `${pdfLabel(expense.source_module)} / ${expense.source_label ?? expense.source_record_id}` : "Manual expense"],
      ["Approval", `${pdfLabel(expense.approval_status)}${expense.approved_at ? ` on ${pdfDate(expense.approved_at)}` : ""}`],
      ["Currency", String(expense.currency ?? "INR")]
    ],
    lines: [
      ...postedPayments.map((payment) => ({
        description: ["Supplier payment", pdfDate(payment.payment_date), payment.payment_method ? pdfLabel(payment.payment_method) : null, payment.reference_number ? `Ref ${payment.reference_number}` : null].filter(Boolean).join("  ·  "),
        amount: Number(payment.amount_paid ?? 0)
      })),
      ...input.credits.filter((credit) => credit.status === "posted").map((credit) => ({
        description: [credit.credit_type === "refund" ? "Supplier refund" : "Supplier credit note", pdfDate(credit.credit_date), credit.reference_number ? `Ref ${credit.reference_number}` : null].filter(Boolean).join("  ·  "),
        amount: Number(credit.amount ?? 0)
      }))
    ],
    linesTitle: "Settlement history",
    totals: [
      ["Base", Number(expense.base_amount ?? 0)], ["Tax", Number(expense.tax_amount ?? 0)], ["Freight", Number(expense.freight_amount ?? 0)],
      ["Discount", -Number(expense.discount_amount ?? 0)], ["Expense total", Number(expense.total_amount ?? 0), true],
      ["Paid to supplier", Number(expense.amount_paid ?? 0)], ["Refunded by supplier", Number(expense.refunded_amount ?? 0)],
      ["Supplier credit notes", Number(expense.credited_amount ?? 0)], ["Balance payable", Number(expense.balance_amount ?? 0), true]
    ],
    amountInWords: Number(expense.total_amount ?? 0),
    notes: expense.notes ?? null
  };
}

export function supplierPaymentVoucher(input: {
  company: Record<string, any>;
  payment: Record<string, any>;
  expense: Record<string, any>;
}): VoucherDocument {
  const { payment, expense } = input;
  return {
    title: payment.status === "reversed" ? "REVERSED PAYMENT VOUCHER" : "PAYMENT VOUCHER",
    number: `PV-${String(payment.id).slice(0, 8).toUpperCase()}`,
    date: String(payment.payment_date),
    status: payment.status,
    issuer: { name: issuerName(input.company, ""), legalName: legalNameLine(input.company), gstin: input.company.gst_number, address: partyAddress(input.company) },
    party: { label: "Paid to", name: String(expense.vendor_name_snapshot ?? "Vendor not recorded") },
    details: [
      ["Expense", [expense.expense_number, expense.description].filter(Boolean).join("  ·  ")],
      ["Vendor bill", [expense.invoice_number, expense.invoice_date ? pdfDate(expense.invoice_date) : null].filter(Boolean).join(" dated ")],
      ["Payment method", payment.payment_method ? pdfLabel(payment.payment_method) : ""],
      ["Reference", String(payment.reference_number ?? "")],
      ["Bank account", String(payment.bank_account ?? "")],
      ...(payment.status === "reversed" ? [["Reversal", `${payment.reversed_at ? pdfDate(payment.reversed_at) : "Date not recorded"}: ${payment.reversal_reason ?? ""}`] as [string, string]] : [])
    ],
    totals: [["Amount paid", Number(payment.amount_paid ?? 0), true], ["Expense balance after posting", Number(expense.balance_amount ?? 0)]],
    amountInWords: Number(payment.amount_paid ?? 0),
    notes: payment.notes ?? null,
    signatures: ["Prepared by", "Approved by", "Receiver's signature"]
  };
}

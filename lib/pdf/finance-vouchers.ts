import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import { numberToWordsINR } from "../utils/number-to-words.ts";
import { PdfTextKit, type PdfFontLoader } from "./unicode-text.ts";
import { nodeFontLoader } from "./font-loader-node.ts";

// Printable finance vouchers (PDF-05): return credit notes, expense vouchers and supplier
// payment vouchers. All use the Unicode text layer and repeat identity on every page.

export type VoucherLine = { description: string; quantity?: string; amount: number };
export type VoucherDocument = {
  title: string;
  number: string;
  date: string;
  status?: string | null;
  issuer: { name: string; gstin?: string | null; address?: string | null };
  party?: { label: string; name: string; gstin?: string | null; address?: string | null } | null;
  details: [string, string][];
  lines?: VoucherLine[];
  totals: [string, number, boolean?][];
  amountInWords?: number | null;
  notes?: string | null;
  signatures?: string[];
};

const PAGE: [number, number] = [595, 842];
const LEFT = 42;
const RIGHT = 553;
const WIDTH = RIGHT - LEFT;
const TOP = 800;
const BOTTOM = 60;
const INK = rgb(0.12, 0.15, 0.18);
const MUTED = rgb(0.4, 0.43, 0.47);
export const voucherMoney = (value: unknown) => `INR ${Number(value ?? 0).toFixed(2)}`;

export async function buildVoucherPdf(doc: VoucherDocument, loadFont: PdfFontLoader = nodeFontLoader) {
  const pdf = await PDFDocument.create();
  const kit = await PdfTextKit.create(pdf, loadFont, [
    doc.title, doc.number, doc.issuer.name, doc.issuer.address, doc.party?.name, doc.party?.address, doc.notes,
    ...doc.details.flat(), ...(doc.lines ?? []).map((line) => line.description), ...doc.totals.map((total) => total[0])
  ]);
  let page!: PDFPage;
  let y = TOP;
  const newPage = (first: boolean) => {
    page = pdf.addPage(PAGE);
    y = TOP;
    if (!first) {
      kit.draw(page, `${doc.title} ${doc.number} | ${doc.date} | ${doc.issuer.name} (continued)`, { x: LEFT, y, size: 9, bold: true, color: MUTED });
      y -= 20;
    }
  };
  const ensure = (height: number) => { if (y - height < BOTTOM) newPage(false); };
  const text = (value: unknown, size = 10, bold = false, indent = 0) => {
    for (const line of kit.wrap(String(value ?? ""), size, WIDTH - indent, bold)) {
      ensure(size + 6);
      kit.draw(page, line, { x: LEFT + indent, y, size, bold, color: INK });
      y -= size + 6;
    }
  };
  const pair = (label: string, value: string, size = 10, bold = false) => {
    const labelWidth = 170;
    const lines = kit.wrap(value, size, WIDTH - labelWidth, bold);
    ensure((size + 6) * lines.length);
    kit.draw(page, label, { x: LEFT, y, size, color: MUTED });
    for (const line of lines) {
      kit.draw(page, line, { x: LEFT + labelWidth, y, size, bold, color: INK });
      y -= size + 6;
    }
  };

  newPage(true);
  text(doc.title, 20, true);
  text(`${doc.number} | Date: ${doc.date}${doc.status ? ` | Status: ${doc.status.replace(/_/g, " ")}` : ""}`, 11, true);
  text(doc.issuer.name, 13, true);
  if (doc.issuer.gstin) text(`GSTIN: ${doc.issuer.gstin}`);
  if (doc.issuer.address) text(doc.issuer.address);
  if (doc.party) {
    y -= 6;
    text(`${doc.party.label}: ${doc.party.name}`, 12, true);
    if (doc.party.gstin) text(`GSTIN: ${doc.party.gstin}`);
    if (doc.party.address) text(doc.party.address);
  }
  y -= 8;
  for (const [label, value] of doc.details) pair(label, value || "-");
  if (doc.lines?.length) {
    y -= 8;
    ensure(30);
    text("Lines", 11, true);
    doc.lines.forEach((line, index) => {
      const description = `${index + 1}. ${line.description}${line.quantity ? ` | ${line.quantity}` : ""}`;
      const lines = kit.wrap(description, 10, WIDTH - 120);
      ensure(16 * lines.length);
      kit.drawRight(page, voucherMoney(line.amount), { right: RIGHT, y, size: 10, color: INK });
      for (const segment of lines) {
        kit.draw(page, segment, { x: LEFT, y, size: 10, color: INK });
        y -= 16;
      }
    });
  }
  y -= 8;
  ensure(24 * doc.totals.length + 30);
  for (const [label, value, strong] of doc.totals) {
    kit.draw(page, label, { x: LEFT, y, size: strong ? 13 : 10, bold: Boolean(strong), color: INK });
    kit.drawRight(page, voucherMoney(value), { right: RIGHT, y, size: strong ? 13 : 10, bold: Boolean(strong), color: INK });
    y -= strong ? 20 : 16;
  }
  if (doc.amountInWords != null) text(numberToWordsINR(Number(doc.amountInWords)));
  if (doc.notes) { y -= 6; text("Notes", 11, true); text(doc.notes); }
  y -= 24;
  ensure(60);
  const signatures = doc.signatures ?? ["Prepared by", "Checked by", "Authorised signatory"];
  signatures.forEach((label, index) => {
    const x = LEFT + (WIDTH / signatures.length) * index;
    page.drawLine({ start: { x, y }, end: { x: x + WIDTH / signatures.length - 20, y }, thickness: 0.5, color: MUTED });
    kit.draw(page, label, { x, y: y - 12, size: 9, color: MUTED });
  });

  const pages = pdf.getPages();
  pages.forEach((current, index) => kit.drawRight(current, `${doc.number} | Page ${index + 1} of ${pages.length}`, { right: RIGHT, y: 30, size: 8, color: MUTED }));
  if (kit.missing.size) kit.draw(pages[pages.length - 1], `Note: ${kit.missing.size} unsupported character(s) are shown as "?".`, { x: LEFT, y: 42, size: 7, color: MUTED });
  return pdf.save();
}

type Snapshot = Record<string, any> | null | undefined;
const partyName = (snapshot: Snapshot) => String(snapshot?.legal_name || snapshot?.company_name || snapshot?.name || snapshot?.customer_name || "");

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
    issuer: { name: partyName(invoice.supplier_snapshot), gstin: invoice.supplier_snapshot?.gst_number, address: invoice.supplier_snapshot?.billing_address },
    party: { label: "Credit to", name: partyName(invoice.customer_snapshot), gstin: invoice.customer_snapshot?.gst_number, address: invoice.customer_snapshot?.billing_address },
    details: [
      ["Against invoice", `${invoice.invoice_number} dated ${invoice.invoice_date}`],
      ["Dispatch", input.dispatchNumber ?? "-"],
      ["Reason", String(note.reason ?? "")],
      ...(note.status === "reversed" ? [["Reversal reason", String(note.reversal_reason ?? "")] as [string, string]] : [])
    ],
    lines: items.map((item: Record<string, any>) => ({
      description: `${item.item_description ?? "Aluminium profile"}${item.hsn_code ? ` (HSN ${item.hsn_code})` : ""}`,
      quantity: item.quantity != null ? `${Number(item.quantity).toFixed(3)} kg` : undefined,
      amount: Number(item.line_total ?? 0)
    })),
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
    issuer: { name: partyName(input.company), gstin: input.company.gst_number, address: input.company.address ?? input.company.billing_address },
    party: expense.vendor_name_snapshot ? { label: "Vendor", name: String(expense.vendor_name_snapshot) } : null,
    details: [
      ["Category", `${String(expense.expense_category).replace(/_/g, " ")}${expense.expense_subcategory ? ` / ${expense.expense_subcategory}` : ""}`],
      ["Description", String(expense.description ?? "")],
      ["Vendor bill", [expense.invoice_number, expense.invoice_date].filter(Boolean).join(" dated ") || "-"],
      ["Due date", String(expense.due_date ?? "-")],
      ["Source", expense.source_table ? `${expense.source_module} / ${expense.source_label ?? expense.source_record_id}` : "Manual expense"],
      ["Approval", `${String(expense.approval_status).replace(/_/g, " ")}${expense.approved_at ? ` on ${String(expense.approved_at).slice(0, 10)}` : ""}`],
      ["Currency", String(expense.currency ?? "INR")]
    ],
    lines: [
      ...postedPayments.map((payment) => ({ description: `Supplier payment ${payment.payment_date} ${payment.payment_method ?? ""} ${payment.reference_number ?? ""}`.trim(), amount: Number(payment.amount_paid ?? 0) })),
      ...input.credits.filter((credit) => credit.status === "posted").map((credit) => ({
        description: `${credit.credit_type === "refund" ? "Supplier refund" : "Supplier credit note"} ${credit.credit_date} ${credit.reference_number ?? ""}`.trim(),
        amount: Number(credit.amount ?? 0)
      }))
    ],
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
    issuer: { name: partyName(input.company), gstin: input.company.gst_number, address: input.company.address ?? input.company.billing_address },
    party: { label: "Paid to", name: String(expense.vendor_name_snapshot ?? "Vendor not recorded") },
    details: [
      ["Expense", `${expense.expense_number} | ${expense.description ?? ""}`],
      ["Vendor bill", [expense.invoice_number, expense.invoice_date].filter(Boolean).join(" dated ") || "-"],
      ["Payment method", String(payment.payment_method ?? "-").replace(/_/g, " ")],
      ["Reference", String(payment.reference_number ?? "-")],
      ["Bank account", String(payment.bank_account ?? "-")],
      ...(payment.status === "reversed" ? [["Reversal", `${String(payment.reversed_at ?? "").slice(0, 10)}: ${payment.reversal_reason ?? ""}`] as [string, string]] : [])
    ],
    totals: [["Amount paid", Number(payment.amount_paid ?? 0), true], ["Expense balance after posting", Number(expense.balance_amount ?? 0)]],
    amountInWords: Number(payment.amount_paid ?? 0),
    notes: payment.notes ?? null,
    signatures: ["Prepared by", "Approved by", "Receiver's signature"]
  };
}

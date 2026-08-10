import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "pdf-lib/cjs";
import { formatCurrency, formatDate, formatMeters, formatWeight } from "@/lib/utils/format";
import { numberToWordsINR } from "@/lib/utils/number-to-words";

// Professional, low-chroma palette: ink + greys, with a single restrained slate accent
// used only for hairline rules (title, table header baseline, grand-total). No heavy
// fills, no full-bleed colour bars — the document should read like a clean letterhead.
const INK = rgb(0.11, 0.13, 0.17);
const MUTED = rgb(0.42, 0.45, 0.5);
const FAINT = rgb(0.6, 0.63, 0.68);
const HAIRLINE = rgb(0.84, 0.86, 0.89);
const PANEL = rgb(0.966, 0.972, 0.98);
const ACCENT = rgb(0.16, 0.23, 0.34);

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 46;
const MARGIN_TOP = 46;
const MARGIN_BOTTOM = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

function sanitizeText(text: string | null | undefined) {
  if (!text) return "";
  return text
    .replace(/₹/g, "Rs. ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[ ​]/g, " ")
    .replace(/[^\x00-\xFF]/g, "");
}

function formatPdfCurrency(value: number | string | null | undefined) {
  return formatCurrency(value).replace(/₹/g, "Rs. ");
}

function splitTextIntoLines(text: string, font: PDFFont, size: number, maxWidth: number) {
  const lines = text.split("\n");
  const result: string[] = [];
  for (const line of lines) {
    if (!line.trim()) {
      result.push("");
      continue;
    }
    const words = line.split(" ");
    let currentLine = words[0] || "";
    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const testLine = currentLine + " " + word;
      const width = font.widthOfTextAtSize(testLine, size);
      if (width > maxWidth) {
        result.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    result.push(currentLine);
  }
  return result;
}

export async function buildQuotePdf(data: { company: any; settings: any; quote: any; items: any[] }) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page!: PDFPage;
  let currentY = 0;
  const pages: PDFPage[] = [];

  const addPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    currentY = PAGE_HEIGHT - MARGIN_TOP;
  };

  addPage();

  const drawText = (text: string, x: number, y: number, font: PDFFont, size: number, color = INK, align: "left" | "right" | "center" = "left", maxWidth?: number) => {
    const sanitized = sanitizeText(text);
    let currentSize = size;
    let textWidth = font.widthOfTextAtSize(sanitized, currentSize);
    if (maxWidth && textWidth > maxWidth) {
      currentSize = Math.max(4, size * (maxWidth / textWidth));
      textWidth = font.widthOfTextAtSize(sanitized, currentSize);
    }
    let drawX = x;
    if (align === "right") drawX = x - textWidth;
    else if (align === "center") drawX = x - textWidth / 2;
    page.drawText(sanitized, { x: drawX, y, font, size: currentSize, color });
  };

  // Letter-spaced caps for section/eyebrow labels — cheap way to get a refined header look.
  const drawLabel = (text: string, x: number, y: number, size: number, color = MUTED, spacing = 1.4, align: "left" | "right" = "left") => {
    const chars = sanitizeText(text.toUpperCase()).split("");
    const widths = chars.map((c) => bold.widthOfTextAtSize(c, size) + spacing);
    const total = widths.reduce((s, w) => s + w, 0) - (chars.length ? spacing : 0);
    let cx = align === "right" ? x - total : x;
    for (let i = 0; i < chars.length; i++) {
      page.drawText(chars[i], { x: cx, y, font: bold, size, color });
      cx += widths[i];
    }
    return total;
  };

  const drawWrappedText = (text: string, x: number, y: number, maxWidth: number, font: PDFFont, size: number, lineHeight: number, color = INK) => {
    const lines = splitTextIntoLines(sanitizeText(text), font, size, maxWidth);
    let tempY = y;
    for (const line of lines) {
      if (line) page.drawText(line, { x, y: tempY, font, size, color });
      tempY -= lineHeight;
    }
    return lines.length * lineHeight;
  };

  const measureWrappedTextHeight = (text: string, maxWidth: number, font: PDFFont, size: number, lineHeight: number) => {
    const lines = splitTextIntoLines(sanitizeText(text), font, size, maxWidth);
    return lines.length * lineHeight;
  };

  const hairline = (y: number, x1 = MARGIN_X, x2 = PAGE_WIDTH - MARGIN_X, color = HAIRLINE, thickness = 0.75) => {
    page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
  };

  const ensureSpace = (requiredHeight: number, repeatingHeaderFn?: () => void) => {
    if (currentY - requiredHeight < MARGIN_BOTTOM + 70) {
      addPage();
      if (repeatingHeaderFn) repeatingHeaderFn();
    }
  };

  const { company, quote, items, settings } = data;
  const customer = quote.customers ?? {};

  // ---------------------------------------------------------------- 1. LETTERHEAD
  const companyName = company.name ?? "Company";
  drawText(companyName, MARGIN_X, currentY, bold, 17, INK);

  const companyLines: string[] = [];
  if (company.legal_name && company.legal_name !== companyName) companyLines.push(company.legal_name);
  const addrLine = `${company.billing_address || ""} ${company.city || ""} ${company.state || ""} ${company.pincode || ""}`.replace(/\s+/g, " ").trim();
  if (addrLine) companyLines.push(addrLine);
  const contactLine = [company.phone, company.email].filter(Boolean).join("   ");
  if (contactLine) companyLines.push(contactLine);
  if (company.gst_number) companyLines.push(`GSTIN  ${company.gst_number}`);

  let leftY = currentY - 16;
  for (const line of companyLines) {
    leftY -= drawWrappedText(line, MARGIN_X, leftY, 300, regular, 8.5, 12, MUTED);
  }

  // Right: document title + meta
  drawLabel("QUOTATION", PAGE_WIDTH - MARGIN_X, currentY, 15, INK, 2.2, "right");
  const metaRows = [
    { label: "Quote No", value: `${quote.quote_number ?? "-"}  ·  Rev ${quote.revision_number ?? 1}` },
    { label: "Date", value: formatDate(quote.quote_date) },
    { label: "Valid Until", value: quote.valid_until ? formatDate(quote.valid_until) : "-" }
  ];
  let rightY = currentY - 22;
  for (const row of metaRows) {
    drawText(row.label, PAGE_WIDTH - MARGIN_X - 150, rightY, regular, 8.5, MUTED);
    drawText(row.value, PAGE_WIDTH - MARGIN_X, rightY, bold, 8.5, INK, "right", 150);
    rightY -= 13;
  }

  currentY = Math.min(leftY, rightY) - 8;
  page.drawLine({ start: { x: MARGIN_X, y: currentY }, end: { x: PAGE_WIDTH - MARGIN_X, y: currentY }, thickness: 1.4, color: ACCENT });
  currentY -= 22;

  // ---------------------------------------------------------------- 2. BILL TO / SHIP TO
  const cardGap = 18;
  const cardWidth = (CONTENT_WIDTH - cardGap) / 2;
  const leftCardX = MARGIN_X;
  const rightCardX = MARGIN_X + cardWidth + cardGap;
  const padX = 12;

  const billToLines: { text: string; font: PDFFont; size: number; color?: any }[] = [];
  billToLines.push({ text: customer.company_name ?? customer.customer_name ?? "Customer", font: bold, size: 10 });
  if (customer.customer_name && customer.customer_name !== customer.company_name) billToLines.push({ text: `Attn: ${customer.customer_name}`, font: regular, size: 8.5, color: MUTED });
  if (customer.billing_address) billToLines.push({ text: customer.billing_address, font: regular, size: 8.5, color: MUTED });
  if (customer.gst_number) billToLines.push({ text: `GSTIN  ${customer.gst_number}`, font: regular, size: 8.5, color: MUTED });

  const shipToLines: { text: string; font: PDFFont; size: number; color?: any }[] = [];
  const shipAddr = customer.shipping_address ?? customer.billing_address;
  if (shipAddr) shipToLines.push({ text: shipAddr, font: regular, size: 8.5, color: MUTED });
  else shipToLines.push({ text: "Same as billing address", font: regular, size: 8.5, color: FAINT });

  const contentHeight = (lines: { text: string; font: PDFFont; size: number }[]) =>
    lines.reduce((h, l) => h + measureWrappedTextHeight(l.text, cardWidth - padX * 2, l.font, l.size, l.size + 4), 0);
  const cardHeight = Math.max(78, contentHeight(billToLines) + 34, contentHeight(shipToLines) + 34);

  ensureSpace(cardHeight + 20);

  for (const [x, title, lines] of [[leftCardX, "Bill To", billToLines], [rightCardX, "Ship To", shipToLines]] as const) {
    page.drawRectangle({ x, y: currentY - cardHeight, width: cardWidth, height: cardHeight, color: PANEL, borderColor: HAIRLINE, borderWidth: 0.75 });
    drawLabel(title, x + padX, currentY - 16, 8, ACCENT, 1.4);
    let cy = currentY - 30;
    for (const l of lines) cy -= drawWrappedText(l.text, x + padX, cy, cardWidth - padX * 2, l.font, l.size, l.size + 4, l.color ?? INK);
  }
  currentY -= cardHeight + 20;

  // ---------------------------------------------------------------- 3. SUMMARY STRIP
  ensureSpace(34);
  const totalMeters = items.reduce((sum, item) => sum + Number(item.total_meters ?? 0), 0);
  const totalWeightKg = items.reduce((sum, item) => sum + Number(item.total_weight_kg ?? 0), 0);
  const totalBillingWeightKg = items.reduce((sum, item) => sum + Number(item.billing_weight_kg ?? item.total_weight_kg ?? 0), 0);

  const summaryCells = [
    { label: "Total length", value: formatMeters(totalMeters) },
    { label: "Physical weight", value: formatWeight(totalWeightKg) },
    { label: "Billing weight", value: formatWeight(totalBillingWeightKg) },
    { label: "Line items", value: String(items.length) }
  ];
  const stripH = 30;
  page.drawRectangle({ x: MARGIN_X, y: currentY - stripH, width: CONTENT_WIDTH, height: stripH, color: PANEL });
  const cellW = CONTENT_WIDTH / summaryCells.length;
  summaryCells.forEach((cell, i) => {
    const cx = MARGIN_X + cellW * i + 12;
    if (i > 0) page.drawLine({ start: { x: MARGIN_X + cellW * i, y: currentY - 6 }, end: { x: MARGIN_X + cellW * i, y: currentY - stripH + 6 }, thickness: 0.75, color: HAIRLINE });
    drawText(cell.label, cx, currentY - 12, regular, 7, MUTED);
    drawText(cell.value, cx, currentY - 23, bold, 9.5, INK);
  });
  currentY -= stripH + 18;

  // ---------------------------------------------------------------- 4. ITEM TABLE
  const cols: { title: string; width: number; align: "left" | "right"; x?: number }[] = [
    { title: "#", width: 22, align: "left" },
    { title: "Profile", width: 62, align: "left" },
    { title: "Description", width: 132, align: "left" },
    { title: "Qty", width: 32, align: "right" },
    { title: "Length", width: 46, align: "right" },
    { title: "Total m", width: 52, align: "right" },
    { title: "Bill kg", width: 48, align: "right" },
    { title: "Rate/kg", width: 48, align: "right" },
    { title: "Amount", width: 61, align: "right" }
  ];
  let cx = MARGIN_X;
  for (const col of cols) {
    col.x = cx;
    cx += col.width;
  }

  const drawTableHeader = () => {
    page.drawRectangle({ x: MARGIN_X, y: currentY - 18, width: CONTENT_WIDTH, height: 18, color: PANEL });
    for (const col of cols) {
      const xPos = col.align === "right" ? col.x! + col.width - 5 : col.x! + 5;
      drawText(col.title, xPos, currentY - 12, bold, 7.5, INK, col.align);
    }
    page.drawLine({ start: { x: MARGIN_X, y: currentY - 18 }, end: { x: PAGE_WIDTH - MARGIN_X, y: currentY - 18 }, thickness: 1, color: ACCENT });
    currentY -= 18;
  };

  ensureSpace(40);
  drawTableHeader();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const profile = item.aluminium_profiles ?? {};
    const desc = sanitizeText(item.item_description ?? profile.profile_name ?? "-");
    const finish = item.finishing_type ? sanitizeText(String(item.finishing_type).replace(/_/g, " ")) : "";
    const descHeight = measureWrappedTextHeight(desc, cols[2].width - 10, regular, 8, 11);
    const rowHeight = Math.max(22, descHeight + (finish ? 20 : 12));

    ensureSpace(rowHeight, () => {
      drawText(`${companyName} — Quotation ${quote.quote_number ?? ""} (continued)`, MARGIN_X, currentY - 12, bold, 9, MUTED);
      currentY -= 26;
      drawTableHeader();
    });

    const textY = currentY - 13;
    drawText(String(i + 1), cols[0].x! + 5, textY, regular, 8, MUTED, "left", cols[0].width - 8);
    drawText(sanitizeText(profile.profile_code ?? "-"), cols[1].x! + 5, textY, bold, 8, INK, "left", cols[1].width - 8);
    drawWrappedText(desc, cols[2].x! + 5, textY, cols[2].width - 10, regular, 8, 11, INK);
    if (finish) drawText(finish, cols[2].x! + 5, textY - descHeight - 1, regular, 7, FAINT, "left", cols[2].width - 10);
    drawText(String(item.quantity_pieces ?? "-"), cols[3].x! + cols[3].width - 5, textY, regular, 8, INK, "right", cols[3].width - 8);
    drawText(`${Number(item.length_per_piece_m ?? 0).toFixed(2)} m`, cols[4].x! + cols[4].width - 5, textY, regular, 8, INK, "right", cols[4].width - 8);
    drawText(formatMeters(item.total_meters), cols[5].x! + cols[5].width - 5, textY, regular, 8, INK, "right", cols[5].width - 8);
    drawText(formatWeight(item.billing_weight_kg ?? item.total_weight_kg), cols[6].x! + cols[6].width - 5, textY, regular, 8, INK, "right", cols[6].width - 8);
    drawText(formatPdfCurrency(item.price_per_kg), cols[7].x! + cols[7].width - 5, textY, regular, 8, MUTED, "right", cols[7].width - 8);
    drawText(formatPdfCurrency(item.line_total_before_gst), cols[8].x! + cols[8].width - 5, textY, bold, 8, INK, "right", cols[8].width - 8);

    currentY -= rowHeight;
    hairline(currentY);
  }

  currentY -= 18;

  // ---------------------------------------------------------------- 5. TOTALS
  // Keep the printed document internally consistent: if the stored aggregate is missing or
  // drifts from the sum of the printed lines, fall back to the line sum and re-derive GST so
  // the lines always add up to the totals shown.
  const lineSum = Math.round(items.reduce((sum, it) => sum + Number(it.line_total_before_gst ?? 0), 0) * 100) / 100;
  const storedSubtotal = Number(quote.subtotal || 0);
  const usesStored = storedSubtotal > 0 && Math.abs(storedSubtotal - lineSum) <= 0.5;
  const subtotal = usesStored ? storedSubtotal : lineSum;
  const gstPercentNum = Number(quote.gst_percent || 0);
  const gstAmount = usesStored ? Number(quote.gst_amount || 0) : Math.round(subtotal * gstPercentNum) / 100;
  const grandTotal = usesStored ? Number(quote.grand_total || 0) : Math.round((subtotal + gstAmount) * 100) / 100;
  const totals = [
    { label: "Subtotal", value: subtotal, grand: false },
    { label: `GST @ ${quote.gst_percent ?? 0}%`, value: gstAmount, grand: false },
    { label: "Grand Total", value: grandTotal, grand: true }
  ];

  ensureSpace(totals.length * 22 + 10);
  const summaryWidth = 220;
  const summaryX = PAGE_WIDTH - MARGIN_X - summaryWidth;
  for (const t of totals) {
    const h = t.grand ? 26 : 20;
    if (t.grand) {
      page.drawRectangle({ x: summaryX, y: currentY - h, width: summaryWidth, height: h, color: PANEL });
      page.drawLine({ start: { x: summaryX, y: currentY }, end: { x: summaryX + summaryWidth, y: currentY }, thickness: 1.2, color: ACCENT });
    }
    drawText(t.label, summaryX + 12, currentY - (t.grand ? 17 : 14), t.grand ? bold : regular, t.grand ? 10.5 : 9, t.grand ? INK : MUTED);
    drawText(formatPdfCurrency(t.value), summaryX + summaryWidth - 12, currentY - (t.grand ? 17 : 14), bold, t.grand ? 10.5 : 9, INK, "right");
    currentY -= h;
  }
  currentY -= 16;

  // ---------------------------------------------------------------- 6. AMOUNT IN WORDS
  ensureSpace(28);
  drawLabel("Amount in words", MARGIN_X, currentY, 7.5, MUTED, 1.2);
  currentY -= 13;
  currentY -= drawWrappedText(numberToWordsINR(grandTotal), MARGIN_X, currentY, CONTENT_WIDTH, bold, 9, 13, INK) + 18;

  // ---------------------------------------------------------------- 7. TERMS
  const sectionHeader = (title: string) => {
    drawLabel(title, MARGIN_X, currentY, 8, ACCENT, 1.3);
    currentY -= 14;
  };

  const commercialLines = [
    `Delivery timeline:  ${quote.delivery_timeline || settings?.default_delivery_terms || "As mutually agreed"}`,
    `Payment terms:  ${quote.payment_terms || settings?.default_payment_terms || "As mutually agreed"}`
  ];
  const rawTerms = quote.terms_and_conditions || settings?.default_terms_and_conditions || settings?.default_quote_terms ||
    "1. Prices are valid until the validity date mentioned above.\n2. GST extra / as mentioned.\n3. Delivery timeline depends on die, billet, and finishing readiness.\n4. Payment terms as mutually agreed.\n5. Transport charges as applicable unless included.";
  const termLines = rawTerms.split("\n").slice(0, 6);

  ensureSpace(30 + commercialLines.length * 13 + 30 + termLines.length * 12);
  sectionHeader("Commercial Terms");
  for (const line of commercialLines) currentY -= drawWrappedText(line, MARGIN_X, currentY, CONTENT_WIDTH, regular, 8.5, 13, INK);
  currentY -= 12;
  sectionHeader("Terms & Conditions");
  for (const line of termLines) currentY -= drawWrappedText(line, MARGIN_X, currentY, CONTENT_WIDTH, regular, 8, 12, MUTED);
  currentY -= 22;

  // ---------------------------------------------------------------- 8. BANK + SIGNATURE
  const bankDetailsRaw = settings?.default_bank_details ?? settings?.bank_details ?? "Configure bank details in Settings.";
  const bankHeight = measureWrappedTextHeight(bankDetailsRaw, cardWidth - 4, regular, 8, 12);
  const bottomHeight = Math.max(bankHeight + 26, 64);
  ensureSpace(bottomHeight);

  const sigY = currentY;
  drawLabel("Bank Details", MARGIN_X, sigY, 8, ACCENT, 1.3);
  drawWrappedText(bankDetailsRaw, MARGIN_X, sigY - 15, cardWidth - 4, regular, 8, 12, MUTED);

  const sigX = PAGE_WIDTH - MARGIN_X - 190;
  drawText(`For ${companyName}`, PAGE_WIDTH - MARGIN_X, sigY, bold, 9, INK, "right", 190);
  page.drawLine({ start: { x: sigX, y: sigY - 44 }, end: { x: PAGE_WIDTH - MARGIN_X, y: sigY - 44 }, thickness: 0.75, color: HAIRLINE });
  drawText("Authorized Signatory", PAGE_WIDTH - MARGIN_X, sigY - 54, regular, 8, MUTED, "right");
  currentY -= bottomHeight;

  // ---------------------------------------------------------------- FOOTER (every page)
  const totalPages = pages.length;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    p.drawLine({ start: { x: MARGIN_X, y: 36 }, end: { x: PAGE_WIDTH - MARGIN_X, y: 36 }, thickness: 0.75, color: HAIRLINE });
    p.drawText(sanitizeText(`${companyName}  ·  Quotation ${quote.quote_number ?? ""}`), { x: MARGIN_X, y: 24, size: 7, font: regular, color: FAINT });
    const pageLabel = `Page ${i + 1} of ${totalPages}`;
    p.drawText(pageLabel, { x: PAGE_WIDTH - MARGIN_X - regular.widthOfTextAtSize(pageLabel, 7), y: 24, size: 7, font: regular, color: FAINT });
  }

  return pdf.save();
}

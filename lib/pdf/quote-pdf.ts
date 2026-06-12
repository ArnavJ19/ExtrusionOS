import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "pdf-lib/cjs";
import { formatCurrency, formatDate, formatMeters, formatWeight } from "@/lib/utils/format";
import { numberToWordsINR } from "@/lib/utils/number-to-words";

const ORANGE = rgb(0.98, 0.45, 0.09);
const DARK = rgb(0.07, 0.09, 0.13);
const LIGHT_GRAY = rgb(0.96, 0.97, 0.98);
const BORDER = rgb(0.90, 0.91, 0.93);
const TEXT = rgb(0.07, 0.09, 0.13);
const WHITE = rgb(1, 1, 1);

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 40;
const MARGIN_TOP = 36;
const MARGIN_BOTTOM = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

function sanitizeText(text: string | null | undefined) {
  if (!text) return "";
  return text
    .replace(/\u20B9/g, "Rs. ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u202F\u200B]/g, " ")
    .replace(/[^\x00-\xFF]/g, ""); 
}

function formatPdfCurrency(value: number | string | null | undefined) {
  return formatCurrency(value).replace(/\u20B9/g, "Rs. ");
}

function splitTextIntoLines(text: string, font: PDFFont, size: number, maxWidth: number) {
  const lines = text.split('\n');
  const result: string[] = [];
  for (const line of lines) {
    if (!line.trim()) {
      result.push('');
      continue;
    }
    const words = line.split(' ');
    let currentLine = words[0] || '';
    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const testLine = currentLine + ' ' + word;
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
    
    // Draw orange sidebar
    page.drawRectangle({ x: 0, y: 0, width: 16, height: PAGE_HEIGHT, color: ORANGE });
  };

  addPage(); // First page

  // Drawing helpers
  const drawText = (text: string, x: number, y: number, font: PDFFont, size: number, color = TEXT, align: 'left'|'right'|'center' = 'left', maxWidth?: number) => {
    const sanitized = sanitizeText(text);
    
    let currentSize = size;
    let textWidth = font.widthOfTextAtSize(sanitized, currentSize);
    
    if (maxWidth && textWidth > maxWidth) {
      currentSize = Math.max(4, size * (maxWidth / textWidth));
      textWidth = font.widthOfTextAtSize(sanitized, currentSize);
    }
    
    let drawX = x;
    if (align === 'right') {
      drawX = x - textWidth;
    } else if (align === 'center') {
      drawX = x - textWidth / 2;
    }
    page.drawText(sanitized, { x: drawX, y, font, size: currentSize, color });
  };

  const drawWrappedText = (text: string, x: number, y: number, maxWidth: number, font: PDFFont, size: number, lineHeight: number, color = TEXT) => {
    const lines = splitTextIntoLines(sanitizeText(text), font, size, maxWidth);
    let tempY = y;
    for (const line of lines) {
      if (line) {
        page.drawText(line, { x, y: tempY, font, size, color });
      }
      tempY -= lineHeight;
    }
    return lines.length * lineHeight; // returns total height used
  };

  const measureWrappedTextHeight = (text: string, maxWidth: number, font: PDFFont, size: number, lineHeight: number) => {
    const lines = splitTextIntoLines(sanitizeText(text), font, size, maxWidth);
    return lines.length * lineHeight;
  };

  const ensureSpace = (requiredHeight: number, repeatingHeaderFn?: () => void) => {
    // 60 is for the footer and bottom margin
    if (currentY - requiredHeight < MARGIN_BOTTOM + 80) {
      addPage();
      if (repeatingHeaderFn) {
        repeatingHeaderFn();
      }
    }
  };

  // --- BEGIN DOCUMENT RENDER ---
  
  // 1. TOP DARK BANNER
  const bannerHeight = 76;
  page.drawRectangle({ x: 32, y: currentY - bannerHeight, width: PAGE_WIDTH - 32, height: bannerHeight, color: DARK });
  page.drawRectangle({ x: 44, y: currentY - 56, width: 32, height: 32, color: ORANGE });
  drawText("EO", 60, currentY - 35, bold, 11, WHITE, 'center');
  drawText("Premium Aluminium Quotation", 88, currentY - 45, bold, 17, WHITE);
  drawText("QUOTATION", PAGE_WIDTH - MARGIN_X, currentY - 45, bold, 20, ORANGE, 'right');
  
  currentY -= (bannerHeight + 20);

  // 2. HEADER DETAILS
  const { company, quote, items, settings } = data;
  const customer = quote.customers ?? {};

  // Company details
  const companyLines = [];
  if (company.legal_name) companyLines.push(company.legal_name);
  if (company.gst_number) companyLines.push(`GSTIN: ${company.gst_number}`);
  
  const addrLine = `${company.billing_address || ""} ${company.city || ""} ${company.state || ""} ${company.pincode || ""}`.trim();
  if (addrLine) companyLines.push(addrLine);
  
  const contactLine = `${company.phone || ""} ${company.email || ""}`.trim();
  if (contactLine) companyLines.push(contactLine);

  // Quote details
  const quoteLines = [
    { label: "Quote No:", value: `${quote.quote_number} Rev ${quote.revision_number ?? 1}` },
    { label: "Date:", value: formatDate(quote.quote_date) },
    { label: "Valid Until:", value: formatDate(quote.valid_until) }
  ];

  drawText(company.name ?? "Company", MARGIN_X, currentY, bold, 18, TEXT);
  currentY -= 20;

  let leftHeaderY = currentY;
  for (const line of companyLines) {
    const h = drawWrappedText(line, MARGIN_X, leftHeaderY, 300, regular, 9, 13, TEXT);
    leftHeaderY -= h;
  }

  let rightHeaderY = currentY;
  for (const item of quoteLines) {
    drawText(item.label, PAGE_WIDTH - 160, rightHeaderY, regular, 9, TEXT);
    drawText(item.value, PAGE_WIDTH - MARGIN_X, rightHeaderY, bold, 9, TEXT, 'right');
    rightHeaderY -= 13;
  }

  currentY = Math.min(leftHeaderY, rightHeaderY) - 15;
  
  // Divider
  page.drawLine({ start: { x: MARGIN_X, y: currentY }, end: { x: PAGE_WIDTH - MARGIN_X, y: currentY }, thickness: 1, color: BORDER });
  currentY -= 20;

  // 3. BILL TO / SHIP TO
  ensureSpace(120);

  const cardWidth = 248; // (PAGE_WIDTH - 80 - 19) / 2
  const cardGap = 19;
  const leftCardX = MARGIN_X;
  const rightCardX = MARGIN_X + cardWidth + cardGap;

  const billToLines = [];
  billToLines.push({ text: customer.company_name ?? customer.customer_name ?? "Customer", font: bold, size: 10 });
  if (customer.customer_name && customer.customer_name !== customer.company_name) {
    billToLines.push({ text: `Contact: ${customer.customer_name}`, font: regular, size: 9 });
  }
  if (customer.gst_number) {
    billToLines.push({ text: `GSTIN: ${customer.gst_number}`, font: regular, size: 9 });
  }
  if (customer.billing_address) {
    billToLines.push({ text: customer.billing_address, font: regular, size: 9 });
  }

  const shipToLines = [];
  const shipAddr = customer.shipping_address ?? customer.billing_address;
  if (shipAddr) {
    shipToLines.push({ text: shipAddr, font: regular, size: 9 });
  }

  // Calculate card heights
  let leftCardContentHeight = 25; // 15 for title + padding
  for (const item of billToLines) {
    leftCardContentHeight += measureWrappedTextHeight(item.text, cardWidth - 20, item.font, item.size, item.size + 4);
  }
  
  let rightCardContentHeight = 25;
  for (const item of shipToLines) {
    rightCardContentHeight += measureWrappedTextHeight(item.text, cardWidth - 20, item.font, item.size, item.size + 4);
  }

  const cardHeight = Math.max(90, leftCardContentHeight, rightCardContentHeight) + 15;

  page.drawRectangle({ x: leftCardX, y: currentY - cardHeight, width: cardWidth, height: cardHeight, color: LIGHT_GRAY });
  page.drawRectangle({ x: rightCardX, y: currentY - cardHeight, width: cardWidth, height: cardHeight, color: LIGHT_GRAY });

  // Bill To Content
  let billToY = currentY - 15;
  drawText("Bill To", leftCardX + 10, billToY, bold, 11, ORANGE);
  billToY -= 16;
  for (const item of billToLines) {
    const h = drawWrappedText(item.text, leftCardX + 10, billToY, cardWidth - 20, item.font, item.size, item.size + 4, TEXT);
    billToY -= h;
  }

  // Ship To Content
  let shipToY = currentY - 15;
  drawText("Ship To", rightCardX + 10, shipToY, bold, 11, ORANGE);
  shipToY -= 16;
  for (const item of shipToLines) {
    const h = drawWrappedText(item.text, rightCardX + 10, shipToY, cardWidth - 20, item.font, item.size, item.size + 4, TEXT);
    shipToY -= h;
  }

  currentY -= (cardHeight + 20);

  // 4. SUMMARY STRIP
  ensureSpace(40);
  const totalMeters = items.reduce((sum, item) => sum + Number(item.total_meters ?? 0), 0);
  const totalWeightKg = items.reduce((sum, item) => sum + Number(item.total_weight_kg ?? 0), 0);
  const totalBillingWeightKg = items.reduce((sum, item) => sum + Number(item.billing_weight_kg ?? item.total_weight_kg ?? 0), 0);

  page.drawRectangle({ x: MARGIN_X, y: currentY - 30, width: CONTENT_WIDTH, height: 30, color: LIGHT_GRAY });
  drawText(`Total meters: ${formatMeters(totalMeters)}`, MARGIN_X + 10, currentY - 12, bold, 9, TEXT);
  drawText(`Physical weight: ${formatWeight(totalWeightKg)}`, MARGIN_X + 180, currentY - 12, bold, 9, TEXT);
  drawText(`Billing weight: ${formatWeight(totalBillingWeightKg)}`, MARGIN_X + 350, currentY - 12, bold, 9, TEXT);
  currentY -= 45;

  // 5. ITEM TABLE
  const cols = [
    { title: "Sr", width: 25, align: 'left' },
    { title: "Profile", width: 65, align: 'left' },
    { title: "Description", width: 135, align: 'left' },
    { title: "Qty", width: 35, align: 'right' },
    { title: "Length", width: 45, align: 'right' },
    { title: "Total Mtr", width: 55, align: 'right' },
    { title: "Bill Kg", width: 50, align: 'right' },
    { title: "Rate", width: 45, align: 'right' },
    { title: "Amount", width: 60, align: 'right' },
  ];

  let currentX = MARGIN_X;
  for (let i = 0; i < cols.length; i++) {
    (cols as any)[i].x = currentX;
    currentX += cols[i].width;
  }

  const drawTableHeader = () => {
    page.drawRectangle({ x: MARGIN_X, y: currentY - 15, width: CONTENT_WIDTH, height: 20, color: LIGHT_GRAY });
    page.drawRectangle({ x: MARGIN_X, y: currentY - 15, width: CONTENT_WIDTH, height: 2, color: ORANGE });
    for (const col of cols) {
      let xPos = (col as any).x;
      if (col.align === 'right') xPos += col.width - 5;
      else if (col.align === 'left') xPos += 5;
      drawText(col.title, xPos, currentY - 4, bold, 8, TEXT, col.align as 'left'|'right');
    }
    currentY -= 20;
  };

  drawTableHeader();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const profile = item.aluminium_profiles ?? {};
    const desc = sanitizeText(item.item_description ?? profile.profile_name ?? "-");
    
    const descHeight = measureWrappedTextHeight(desc, cols[2].width - 10, regular, 8, 11);
    const rowHeight = Math.max(20, descHeight + 10);

    ensureSpace(rowHeight, () => {
      drawText(`${company.name ?? "Company"} - Quotation ${quote.quote_number} continued`, MARGIN_X, currentY - 10, bold, 10, ORANGE);
      currentY -= 30;
      drawTableHeader();
    });

    if (i % 2 === 0) {
      page.drawRectangle({ x: MARGIN_X, y: currentY - rowHeight, width: CONTENT_WIDTH, height: rowHeight, color: rgb(0.985, 0.986, 0.988) });
    }
    page.drawLine({ start: { x: MARGIN_X, y: currentY - rowHeight }, end: { x: PAGE_WIDTH - MARGIN_X, y: currentY - rowHeight }, thickness: 0.5, color: BORDER });

    const textY = currentY - 12;

    drawText(String(i + 1), (cols as any)[0].x + 5, textY, regular, 8, TEXT, 'left', cols[0].width - 10);
    drawText(sanitizeText(profile.profile_code ?? ""), (cols as any)[1].x + 5, textY, regular, 8, TEXT, 'left', cols[1].width - 10);
    drawWrappedText(desc, (cols as any)[2].x + 5, textY, cols[2].width - 10, regular, 8, 11, TEXT);

    drawText(String(item.quantity_pieces), (cols as any)[3].x + cols[3].width - 5, textY, regular, 8, TEXT, 'right', cols[3].width - 10);
    drawText(`${Number(item.length_per_piece_m).toFixed(2)} m`, (cols as any)[4].x + cols[4].width - 5, textY, regular, 8, TEXT, 'right', cols[4].width - 10);
    drawText(formatMeters(item.total_meters), (cols as any)[5].x + cols[5].width - 5, textY, regular, 8, TEXT, 'right', cols[5].width - 10);
    drawText(formatWeight(item.billing_weight_kg ?? item.total_weight_kg), (cols as any)[6].x + cols[6].width - 5, textY, regular, 8, TEXT, 'right', cols[6].width - 10);
    drawText(formatPdfCurrency(item.price_per_kg), (cols as any)[7].x + cols[7].width - 5, textY, regular, 8, TEXT, 'right', cols[7].width - 10);
    drawText(formatPdfCurrency(item.line_total_before_gst), (cols as any)[8].x + cols[8].width - 5, textY, regular, 8, TEXT, 'right', cols[8].width - 10);

    currentY -= rowHeight;
  }

  currentY -= 15;

  // 6. TOTALS BLOCK
  const subtotal = Number(quote.subtotal || 0);
  const gstAmount = Number(quote.gst_amount || 0);
  const grandTotal = Number(quote.grand_total || 0);

  const totals = [
    { label: "Subtotal", value: subtotal, isGrand: false },
    { label: `GST @ ${quote.gst_percent}%`, value: gstAmount, isGrand: false },
    { label: "Grand Total", value: grandTotal, isGrand: true }
  ];

  ensureSpace( totals.length * 22 + 20 );

  const summaryWidth = 200;
  const summaryX = PAGE_WIDTH - MARGIN_X - summaryWidth;

  for (const t of totals) {
    const h = 22;
    page.drawRectangle({ x: summaryX, y: currentY - h, width: summaryWidth, height: h, color: t.isGrand ? DARK : LIGHT_GRAY });
    if (t.isGrand) {
      page.drawRectangle({ x: summaryX, y: currentY - h, width: 6, height: h, color: ORANGE });
    }
    
    drawText(t.label, summaryX + 12, currentY - 14, bold, 9, t.isGrand ? WHITE : TEXT);
    drawText(formatPdfCurrency(t.value), summaryX + summaryWidth - 10, currentY - 14, bold, 9, t.isGrand ? WHITE : TEXT, 'right');
    
    currentY -= h;
  }

  currentY -= 15;

  // 7. AMOUNT IN WORDS
  ensureSpace(30);
  const amountWords = `Amount in words: ${numberToWordsINR(grandTotal)}`;
  const wordsHeight = drawWrappedText(amountWords, MARGIN_X, currentY, CONTENT_WIDTH, bold, 9, 13, TEXT);
  currentY -= (wordsHeight + 20);

  // 8. TERMS
  const termsTitle1 = "Commercial Terms";
  const commercialLines = [
    `Delivery timeline: ${quote.delivery_timeline || settings?.default_delivery_terms || "As mutually agreed"}`,
    `Payment terms: ${quote.payment_terms || settings?.default_payment_terms || "As mutually agreed"}`
  ];
  
  const termsTitle2 = "Terms and Conditions";
  const rawTerms = quote.terms_and_conditions || settings?.default_terms_and_conditions || settings?.default_quote_terms || "1. Prices are valid until the validity date mentioned above.\n2. GST extra/as mentioned.\n3. Delivery timeline depends on die availability, billet availability, and finishing requirements.\n4. Payment terms as mutually agreed.\n5. Transport charges as applicable unless included.";
  const termLines = rawTerms.split("\n").slice(0, 5);

  const termsNeededHeight = 25 + commercialLines.length * 13 + 25 + termLines.length * 13;
  ensureSpace(termsNeededHeight);

  drawText(termsTitle1, MARGIN_X, currentY, bold, 11, ORANGE);
  currentY -= 16;
  for (const line of commercialLines) {
    const h = drawWrappedText(line, MARGIN_X, currentY, CONTENT_WIDTH, bold, 8, 12, TEXT);
    currentY -= h;
  }
  currentY -= 10;

  drawText(termsTitle2, MARGIN_X, currentY, bold, 11, ORANGE);
  currentY -= 16;
  for (const line of termLines) {
    const h = drawWrappedText(line, MARGIN_X, currentY, CONTENT_WIDTH, regular, 8, 12, TEXT);
    currentY -= h;
  }
  currentY -= 25;

  // 9. BANK DETAILS AND SIGNATURE
  const bankDetailsRaw = settings?.default_bank_details ?? settings?.bank_details ?? "Configure bank details in Settings";
  const bankDetailsHeight = measureWrappedTextHeight(bankDetailsRaw, 250, regular, 8, 12);
  const signatureHeight = 60;
  const bottomSectionHeight = Math.max(bankDetailsHeight + 25, signatureHeight + 25);
  
  ensureSpace(bottomSectionHeight);

  const sigY = currentY;
  drawText(`For ${company.name ?? "Company"}`, MARGIN_X, sigY, bold, 9, TEXT);
  drawText("Authorized Signatory", MARGIN_X, sigY - 45, regular, 8, TEXT);

  const bankX = PAGE_WIDTH - MARGIN_X - 250;
  drawText("Bank Details", bankX, sigY, bold, 10, ORANGE);
  drawWrappedText(bankDetailsRaw, bankX, sigY - 15, 250, regular, 8, 12, TEXT);

  currentY -= bottomSectionHeight;

  // FOOTER
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    p.drawLine({ start: { x: MARGIN_X, y: 34 }, end: { x: PAGE_WIDTH - MARGIN_X, y: 34 }, thickness: 1.2, color: ORANGE });
    p.drawText("Thank you for your business. Generated by ExtrusionOS Pro.", { x: MARGIN_X, y: 20, size: 7, font: regular, color: rgb(0.5, 0.5, 0.5) });
    p.drawText(`Page ${i + 1} of ${pages.length}`, { x: PAGE_WIDTH - MARGIN_X - 40, y: 20, size: 7, font: regular, color: rgb(0.5, 0.5, 0.5) });
  }

  return pdf.save();
}

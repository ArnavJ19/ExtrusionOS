export type SystemQuoteSummaryInput = {
  configurationNumber?: string | null;
  projectName?: string | null;
  designReference?: string | null;
  systemType?: string | null;
  widthMm: number;
  heightMm: number;
  quantity: number;
  finishName?: string | null;
  glassName?: string | null;
  grandTotal: number;
  gstAmount: number;
  customerName?: string | null;
};

function money(value: number) {
  return `Rs. ${Number(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function labelize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function buildSystemQuoteDescription(input: SystemQuoteSummaryInput) {
  const system = labelize(input.systemType ?? "custom system");
  const finish = input.finishName || "Finish as selected";
  const glass = input.glassName || "Glass as selected";
  return `${system}, ${input.widthMm}mm x ${input.heightMm}mm, ${finish}, ${glass}. Ref: ${input.designReference || input.configurationNumber || "System"}.`;
}

export function buildSystemWhatsAppSummary(input: SystemQuoteSummaryInput) {
  return [
    `Hello ${input.customerName || "Customer"},`,
    `Quotation for ${input.projectName || "your project"}:`,
    `${buildSystemQuoteDescription(input)}`,
    `Quantity: ${input.quantity}`,
    `GST: ${money(input.gstAmount)}`,
    `Grand Total: ${money(input.grandTotal)}`,
    "Please review and confirm. Regards."
  ].join("\n");
}

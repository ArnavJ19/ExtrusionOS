// AP-005: document numbering by Indian financial year (1 April to 31 March). Mirrors private.ap_fy_label,
// private.ap_series_stem and the activation checks in private.ap_series_activate.
import { z } from "zod";

export const DOCUMENT_SERIES = {
  invoices: { label: "Tax invoices", gapFree: true, suggested: "OMX/{FY}/" },
  credit_notes: { label: "Credit notes", gapFree: true, suggested: "CN/{FY}/" },
  quotes: { label: "Quotations", gapFree: false, suggested: "Q/{FY}/" },
  orders: { label: "Sales orders", gapFree: false, suggested: "SO/{FY}/" },
  dispatches: { label: "Delivery challans", gapFree: false, suggested: "DC/{FY}/" }
} as const;
export type DocumentSeriesKey = keyof typeof DOCUMENT_SERIES;
/** CGST Rule 46(b): a tax invoice serial number may not exceed sixteen characters. */
export const GST_SERIAL_LIMIT = 16;
export const TEMPLATE_PATTERN = /^[A-Z0-9/-]{0,10}\{FY4?\}[A-Z0-9/-]{0,6}$/;

export function financialYearStart(date: string) {
  const [year, month] = date.split("-").map(Number);
  return month >= 4 ? year : year - 1;
}

export function financialYearLabel(date: string, long = false) {
  const start = financialYearStart(date);
  const next = String((start + 1) % 100).padStart(2, "0");
  return `${long ? start : String(start % 100).padStart(2, "0")}-${next}`;
}

export function renderSeriesStem(template: string, date: string) {
  return template.replace("{FY4}", financialYearLabel(date, true)).replace("{FY}", financialYearLabel(date, false));
}

export function renderSeriesNumber(template: string, padWidth: number, date: string, sequence: number) {
  return renderSeriesStem(template, date) + String(sequence).padStart(padWidth, "0");
}

export type SeriesCheck = { ok: true; example: string; longest: string } | { ok: false; message: string };

export function checkSeriesTemplate(doc: DocumentSeriesKey, template: string, padWidth: number, today: string): SeriesCheck {
  const value = template.trim().toUpperCase();
  if (!TEMPLATE_PATTERN.test(value)) return { ok: false, message: "Use {FY} or {FY4} once, with only capital letters, digits, / and - around it (up to 10 before and 6 after)." };
  if (!Number.isInteger(padWidth) || padWidth < 3 || padWidth > 6) return { ok: false, message: "The running number must have 3 to 6 digits." };
  const longest = renderSeriesStem(value, today) + "9".repeat(padWidth);
  if (DOCUMENT_SERIES[doc].gapFree && longest.length > GST_SERIAL_LIMIT) {
    return { ok: false, message: `${DOCUMENT_SERIES[doc].label} would have ${longest.length} characters; GST allows at most ${GST_SERIAL_LIMIT}.` };
  }
  return { ok: true, example: renderSeriesNumber(value, padWidth, today, 1), longest };
}

export const seriesConfirmSchema = z.object({
  doc_key: z.enum(["invoices", "credit_notes", "quotes", "orders", "dispatches"]),
  prefix_template: z.string().trim().min(4).max(20).transform(value => value.toUpperCase()).refine(value => TEMPLATE_PATTERN.test(value), "Use {FY} or {FY4} with capital letters, digits, / and -"),
  pad_width: z.number().int().min(3).max(6)
}).strict();

export const seriesListSchema = z.object({
  fy: z.string(), can_confirm: z.boolean(),
  series: z.array(z.object({
    id: z.string().uuid(), doc_key: z.enum(["invoices", "credit_notes", "quotes", "orders", "dispatches"]), prefix_template: z.string(), pad_width: z.number().int(),
    gap_free: z.boolean(), status: z.enum(["active", "retired"]), confirmed_at: z.string(), confirmed_by: z.string().nullable(), next_example: z.string(), issued_this_year: z.number()
  }))
});
export type SeriesList = z.infer<typeof seriesListSchema>;

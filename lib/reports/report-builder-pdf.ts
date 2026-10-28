import { PdfDocumentWriter, type PdfTableColumn, type PdfTableRow } from "../pdf/document-kit.ts";
import { pdfAmount, pdfDate, pdfLabel, pdfQuantity } from "../pdf/format.ts";
import type { PdfFontLoader } from "../pdf/unicode-text.ts";
import { planColumnBands, reportAmountFields, type ReportTotals } from "./report-builder.ts";

// Report Builder statement PDF (landscape). Every selected column is printed: wide reports
// continue in column bands that repeat the row number. Groups get a heading row and a
// subtotal row; amounts are right-aligned with two decimals and totals never mix currencies.

export type ReportBuilderPdfInput = {
  reportName: string;
  companyName: string;
  preparedBy?: string | null;
  source: string;
  visibility: string;
  grouping: string | null;
  dateRange?: { from?: string | null; to?: string | null } | null;
  filters: string[];
  rules: string[];
  /** Output fields in print order (the grouping field is excluded). */
  fields: string[];
  /** Rows prepared for display (linked IDs resolved to names). */
  rows: Record<string, unknown>[];
  totals: { fields: string[]; groups: ReportTotals[]; grand: ReportTotals };
  prettyFieldLabel: (field: string) => string;
  prettyValue: (value: unknown) => string;
  loadFont: PdfFontLoader;
  /** Company logo bytes (lib/pdf/logo.ts). */
  logo?: Uint8Array | null;
};

const COLUMNS_PER_BAND = 7;
const short = (value: string, limit = 80) => (value.length > limit ? `${value.slice(0, limit - 1)}…` : value);
/** Linked records print by name; the internal UUID suffix added for CSV is dropped. */
/** Amount columns print with two decimals; weight columns (…_kg) with three. */
const figure = (field: string, value: unknown) => (/_kg$/.test(field) ? pdfQuantity(value ?? 0, 3) : pdfAmount(value ?? 0));
const withoutId = (value: string) => value.replace(/\s*\((?:ID: [^)]*|[0-9a-f-]{36} \(unmapped\))\)$/i, "").replace(/^([0-9a-f-]{36}) \(unmapped\)$/i, "Unlinked ($1)");
/** Workflow enums ("partially_paid") print as labels; free text in the same fields is left alone. */
const ENUM_FIELD = /(?:^|_)(?:status|stage|type|method|category)$/;
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}(?:$|T)/;

export async function buildReportBuilderPdf(input: ReportBuilderPdfInput) {
  const { prettyFieldLabel, prettyValue, grouping, rows, totals } = input;
  const amountFields = new Set(reportAmountFields[input.source] ?? []);
  const numericFields = new Set(input.fields.filter((field) => amountFields.has(field)
    || (rows.some((row) => row[field] !== null && row[field] !== undefined && row[field] !== "")
      && rows.every((row) => row[field] === null || row[field] === undefined || row[field] === "" || typeof row[field] === "number"))));
  // Dates print as stored ("20 Oct 2026"; timestamps in IST) rather than in the browser's locale
  // and time zone, matching every other ExtrusionOS document.
  const display = (field: string, value: unknown) => {
    if (typeof value === "string" && DATE_VALUE.test(value)) return pdfDate(value);
    if (typeof value === "string" && ENUM_FIELD.test(field) && /^[a-z0-9_]+$/.test(value)) return pdfLabel(value);
    return withoutId(prettyValue(value));
  };
  const cell = (field: string, value: unknown) => {
    if (amountFields.has(field) && typeof value === "number") return figure(field, value);
    return display(field, value);
  };
  // Group totals are keyed by prettyValue(raw value); this maps each key to its printed label.
  const groupLabels = new Map<string, string>();
  const range = input.dateRange?.from || input.dateRange?.to ? `${input.dateRange?.from ? pdfDate(input.dateRange.from) : "Start"} to ${input.dateRange?.to ? pdfDate(input.dateRange.to) : "Today"}` : null;

  const doc = await PdfDocumentWriter.create({
    title: input.reportName,
    logo: input.logo ?? null,
    issuer: { name: input.companyName, lines: [`Source: ${prettyFieldLabel(input.source)}`] },
    meta: [
      ["Rows", rows.length.toLocaleString("en-IN")],
      ["Period", range],
      ["Grouped by", grouping ? prettyFieldLabel(grouping) : null],
      ["Visibility", prettyFieldLabel(input.visibility)],
      ["Prepared by", input.preparedBy ?? null]
    ],
    orientation: "landscape",
    footerNote: "Report Builder export. Figures reflect the filters and rules listed on page 1.",
    subject: `${input.reportName} (${prettyFieldLabel(input.source)})`
  }, input.loadFont, [input.reportName, input.companyName, input.filters, input.rules, rows.map((row) => Object.values(row).map((value) => prettyValue(value)))]);

  const criteria: [string, string][] = [
    ...input.filters.map((filter, index) => [index === 0 ? "Filters" : "", filter] as [string, string]),
    ...input.rules.map((rule, index) => [index === 0 ? "Applied rules" : "", rule] as [string, string])
  ];
  if (criteria.length) {
    doc.sectionTitle("Report criteria", 30);
    doc.fields(criteria.map(([label, value]) => [label || " ", value]), { columns: 1, labelRatio: 0.14 });
  }

  const bands = planColumnBands(input.fields, COLUMNS_PER_BAND);
  const subtotalRows = (band: string[], group: ReportTotals, kind: "subtotal" | "total"): PdfTableRow[] => {
    const currencies = Object.keys(group.byCurrency);
    return (currencies.length ? currencies : ["INR"]).map((currency) => {
      const values = group.byCurrency[currency] ?? {};
      const count = group.countByCurrency?.[currency] ?? group.count;
      const label = `${kind === "total" ? "Grand total" : "Subtotal"} (${count.toLocaleString("en-IN")} ${count === 1 ? "row" : "rows"})${currencies.length > 1 || currency !== "INR" ? ` · ${currency}` : ""}`;
      // The label sits in the first text column of the band; a band of figures only uses the # column.
      const labelIndex = band.findIndex((field) => !totals.fields.includes(field));
      const cells = band.map((field, index) => (totals.fields.includes(field) ? figure(field, values[field]) : index === labelIndex ? label : ""));
      return { kind, cells: [labelIndex === -1 ? (kind === "total" ? "Total" : "Sub.") : "", ...cells] };
    });
  };

  bands.forEach((band, bandIndex) => {
    if (bands.length > 1) {
      const first = bandIndex * COLUMNS_PER_BAND + 1;
      doc.sectionTitle(`Columns ${first}–${first + band.length - 1} of ${input.fields.length}`, 60);
    } else {
      doc.sectionTitle("Records", 60);
    }
    const columns: PdfTableColumn[] = [
      { header: "#", width: 4, align: "right" },
      ...band.map((field) => ({ header: prettyFieldLabel(field), width: numericFields.has(field) ? 12 : 16, align: numericFields.has(field) ? "right" as const : "left" as const }))
    ];
    const tableRows: PdfTableRow[] = [];
    const showTotals = totals.fields.some((field) => band.includes(field));
    let activeGroupValue: string | null = null;
    let activeGroup: ReportTotals | undefined;
    rows.forEach((row, rowIndex) => {
      if (grouping) {
        const groupValue = prettyValue(row[grouping]);
        if (groupValue !== activeGroupValue) {
          if (activeGroup && showTotals) tableRows.push(...subtotalRows(band, activeGroup, "subtotal"));
          const printed = display(grouping, row[grouping]);
          groupLabels.set(groupValue, printed);
          tableRows.push({ kind: "group", cells: [`${prettyFieldLabel(grouping)}: ${short(printed)}`] });
          activeGroupValue = groupValue;
          activeGroup = totals.groups.find((group) => group.label === groupValue);
        }
      }
      tableRows.push([String(rowIndex + 1), ...band.map((field) => cell(field, row[field]))]);
    });
    if (activeGroup && showTotals) tableRows.push(...subtotalRows(band, activeGroup, "subtotal"));
    if (showTotals && rows.length) tableRows.push(...subtotalRows(band, totals.grand, "total"));
    doc.table(columns, tableRows, { size: 7.8, emptyText: "No rows matched this report configuration." });
  });

  // Statement totals per group and overall; currencies are never mixed (PDF-04, EXP-23).
  if (totals.fields.length && rows.length && (grouping || bands.length > 1)) {
    doc.sectionTitle("Statement totals", 60);
    const multiCurrency = [totals.grand, ...totals.groups].some((group) => Object.keys(group.byCurrency).some((currency) => currency !== "INR"));
    const summary: PdfTableRow[] = [];
    const push = (group: ReportTotals, kind: "body" | "total") => {
      for (const [currency, values] of Object.entries(group.byCurrency)) {
        const cells = [kind === "total" ? "Grand total" : groupLabels.get(group.label) ?? withoutId(group.label),
          (group.countByCurrency?.[currency] ?? group.count).toLocaleString("en-IN"), ...(multiCurrency ? [currency] : []),
          ...totals.fields.map((field) => figure(field, values[field]))];
        summary.push(kind === "total" ? { kind: "total", cells } : cells);
      }
    };
    for (const group of totals.groups) push(group, "body");
    push(totals.grand, "total");
    doc.table([
      { header: grouping ? prettyFieldLabel(grouping) : "Statement", width: 22 },
      { header: "Rows", width: 7, align: "right" },
      ...(multiCurrency ? [{ header: "Currency", width: 8 }] : []),
      ...totals.fields.map((field) => ({ header: prettyFieldLabel(field), width: 13, align: "right" as const }))
    ], summary);
  }

  return doc.finish();
}

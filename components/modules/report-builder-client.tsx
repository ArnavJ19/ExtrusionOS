"use client";

import { useMemo, useState } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { toast } from "sonner";
import { BarChart3, CalendarRange, Database, Eye, Filter, Save, Shield } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/browser";
import { savedReportSchema } from "@/lib/validations/schemas";
import { formatDate } from "@/lib/utils/format";
import { recordsToCsv } from "@/lib/utils/csv";

type SavedReportRow = {
  id: string;
  report_name: string;
  data_source: string;
  visibility: string;
  created_at: string;
  config_json: Record<string, any>;
};

const fieldMap: Record<string, string[]> = {
  customers: ["customer_name", "company_name", "customer_type", "city", "state", "created_at"],
  quotes: ["quote_number", "quote_date", "status", "grand_total", "customer_id", "created_at"],
  orders: ["order_number", "order_date", "current_stage", "order_value", "customer_id", "created_at"],
  dispatches: ["dispatch_date", "delivery_status", "vehicle_number", "total_weight_kg", "created_at"],
  invoices: ["invoice_number", "invoice_date", "status", "grand_total", "amount_paid", "created_at"],
  payments: ["payment_date", "payment_method", "amount", "invoice_id", "created_at"],
  expenses: ["expense_number", "expense_category", "expense_subcategory", "invoice_date", "total_amount", "amount_paid", "balance_amount", "payment_status", "approval_status", "invoice_number", "created_at"],
  expense_payments: ["payment_date", "amount_paid", "payment_method", "reference_number", "expense_ledger_id", "created_at"],
  inventory: ["item_code", "item_name", "item_category", "current_stock", "reorder_level", "created_at"],
  production_jobs: ["job_number", "planned_quantity_kg", "actual_quantity_kg", "status", "planned_date", "created_at"],
  scrap_records: ["scrap_type", "weight_kg", "reason", "recorded_date", "production_job_id", "created_at"],
  dies: ["die_number", "die_status", "total_production_kg", "total_runs", "last_used_date", "created_at"],
  quality_tests: ["inspection_date", "status", "batch_number", "quantity_checked_kg", "inspector_name", "created_at"],
  vendors: ["vendor_name", "vendor_type", "city", "state", "is_active", "created_at"],
  packaging_material_purchases: ["purchase_number", "received_date", "material_id", "vendor_id", "quantity", "rate", "total_amount", "payment_status", "invoice_number", "created_at"]
};

const dataSources = Object.keys(fieldMap);

const sourceTableMap: Record<string, string> = {
  customers: "customers",
  quotes: "quotes",
  orders: "orders",
  dispatches: "dispatches",
  invoices: "invoices",
  payments: "payments",
  expenses: "expense_ledger",
  expense_payments: "expense_payments",
  inventory: "inventory_items",
  production_jobs: "production_jobs",
  scrap_records: "scrap_records",
  dies: "dies",
  quality_tests: "quality_inspections",
  vendors: "vendors",
  packaging_material_purchases: "packaging_material_purchases"
};
const sourceDateFieldMap: Record<string, string> = {
  customers: "created_at",
  quotes: "quote_date",
  orders: "order_date",
  dispatches: "dispatch_date",
  invoices: "invoice_date",
  payments: "payment_date",
  expenses: "invoice_date",
  expense_payments: "payment_date",
  inventory: "created_at",
  production_jobs: "planned_date",
  scrap_records: "recorded_date",
  dies: "last_used_date",
  quality_tests: "inspection_date",
  vendors: "created_at",
  packaging_material_purchases: "received_date"
};

function filterOperatorsFor(field: string) {
  const numeric = /(amount|weight|quantity|stock|level|rate|count|percent|pieces|total)/.test(field);
  const dated = field.endsWith("_date") || field.endsWith("_at");
  return numeric || dated ? ["equals", "gt", "lt", "between"] : ["equals", "contains"];
}

function nextIsoDate(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateValue;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}


const REPORT_EXPORT_MAX_ROWS = 5000;

const idDisplayFieldMap: Record<string, { table: string; select: string; build: (row: Record<string, unknown>) => string }> = {
  customer_id: {
    table: "customers",
    select: "id, customer_name, company_name",
    build: (row) => `${String(row.company_name || row.customer_name || "Customer")} (ID: ${String(row.id || "-")})`
  },
  vendor_id: {
    table: "vendors",
    select: "id, vendor_name",
    build: (row) => `${String(row.vendor_name || "Vendor")} (ID: ${String(row.id || "-")})`
  },
  invoice_id: {
    table: "invoices",
    select: "id, invoice_number",
    build: (row) => `${String(row.invoice_number || "Invoice")} (ID: ${String(row.id || "-")})`
  },
  order_id: {
    table: "orders",
    select: "id, order_number",
    build: (row) => `${String(row.order_number || "Order")} (ID: ${String(row.id || "-")})`
  },
  profile_id: {
    table: "aluminium_profiles",
    select: "id, profile_code, profile_name",
    build: (row) => `${String(row.profile_code || "PR")} - ${String(row.profile_name || "Profile")} (ID: ${String(row.id || "-")})`
  },
  die_id: {
    table: "dies",
    select: "id, die_number",
    build: (row) => `${String(row.die_number || "Die")} (ID: ${String(row.id || "-")})`
  },
  production_job_id: {
    table: "production_jobs",
    select: "id, job_number",
    build: (row) => `${String(row.job_number || "Job")} (ID: ${String(row.id || "-")})`
  },
  expense_ledger_id: {
    table: "expense_ledger",
    select: "id, expense_number",
    build: (row) => `${String(row.expense_number || "Expense")} (ID: ${String(row.id || "-")})`
  },
  material_id: {
    table: "packaging_materials",
    select: "id, material_code, material_name",
    build: (row) => `${String(row.material_code || "MAT")} - ${String(row.material_name || "Material")} (ID: ${String(row.id || "-")})`
  }
};

type Props = {
  companyId: string;
  role: string;
  initialReports: SavedReportRow[];
};

export function ReportBuilderClient({ companyId, role, initialReports }: Props) {
  const [source, setSource] = useState("quotes");
  const [selectedFields, setSelectedFields] = useState<string[]>(["quote_number", "quote_date", "status", "grand_total"]);
  const [filters, setFilters] = useState([{ field: "status", operator: "equals", value: "sent" }]);
  const [grouping, setGrouping] = useState("");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [visibility, setVisibility] = useState<"private" | "company" | "owner_only">("private");
  const [reportName, setReportName] = useState("Monthly Quote Conversion");
  const [reports, setReports] = useState(initialReports);
  const [saving, setSaving] = useState(false);

  const supabase = createClient();
  const sourceFields = useMemo(() => fieldMap[source] ?? [], [source]);

  function toggleField(field: string) {
    setSelectedFields((current) => current.includes(field) ? current.filter((item) => item !== field) : [...current, field]);
  }

  function addFilter() {
    setFilters((current) => [...current, { field: sourceFields[0] ?? "created_at", operator: "equals", value: "" }]);
  }

  function updateFilter(index: number, key: "field" | "operator" | "value", value: string) {
    setFilters((current) => current.map((item, i) => i === index ? { ...item, [key]: value } : item));
  }

  function removeFilter(index: number) {
    setFilters((current) => current.filter((_, i) => i !== index));
  }

  async function saveReport() {
    const payload = {
      report_name: reportName,
      data_source: source,
      selected_fields: selectedFields,
      filters,
      grouping: grouping || null,
      date_range: { from: rangeFrom || null, to: rangeTo || null },
      visibility
    };
    const parsed = savedReportSchema.safeParse(payload);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Invalid report configuration");
    const allowedFields = new Set(fieldMap[parsed.data.data_source] ?? []);
    if (parsed.data.selected_fields.some((field) => !allowedFields.has(field))) {
      return toast.error("One or more selected fields do not belong to this data source.");
    }
    if (parsed.data.grouping && !allowedFields.has(parsed.data.grouping)) {
      return toast.error("The grouping field does not belong to this data source.");
    }
    for (const filter of parsed.data.filters) {
      if (!allowedFields.has(filter.field)) return toast.error("A filter field does not belong to this data source.");
      if (!filterOperatorsFor(filter.field).includes(filter.operator)) return toast.error(`The ${filter.operator} operator is not valid for ${filter.field}.`);
      if (filter.operator === "between" && filter.value.split("|").filter(Boolean).length !== 2) {
        return toast.error("Between filters require two values separated by |, for example 2026-07-01|2026-07-31.");
      }
    }
    if (parsed.data.visibility === "owner_only" && !["owner", "admin"].includes(role)) {
      return toast.error("Only owners and administrators can create owner-only reports.");
    }

    setSaving(true);
    const result = await supabase.from("saved_reports").insert({
      company_id: companyId,
      created_by: (await supabase.auth.getUser()).data.user?.id,
      report_name: parsed.data.report_name,
      data_source: parsed.data.data_source,
      visibility: parsed.data.visibility,
      config_json: {
        selected_fields: parsed.data.selected_fields,
        filters: parsed.data.filters,
        grouping: parsed.data.grouping,
        date_range: parsed.data.date_range
      }
    }).select().single();
    setSaving(false);

    if (result.error) return toast.error(result.error.message || "Could not save report");
    setReports((current) => [result.data as SavedReportRow, ...current]);
    toast.success("Report saved");
  }

  async function fetchReportRows(report: SavedReportRow) {
    const config = report.config_json ?? {};
    const effectiveSource = report.data_source === "purchases" ? "packaging_material_purchases" : report.data_source;
    const allowedFields = new Set(fieldMap[effectiveSource] ?? []);
    const selected: string[] = Array.isArray(config.selected_fields) && config.selected_fields.length
      ? config.selected_fields.filter((item: unknown): item is string => typeof item === "string" && allowedFields.has(item))
      : fieldMap[effectiveSource] ?? ["created_at"];
    const filters = Array.isArray(config.filters) ? config.filters : [];
    const grouping = typeof config.grouping === "string" && allowedFields.has(config.grouping) ? config.grouping : null;
    const dateRange = (config.date_range ?? {}) as { from?: string | null; to?: string | null };
    const tableName = sourceTableMap[effectiveSource] ?? effectiveSource;
    const dateField = sourceDateFieldMap[effectiveSource] ?? "created_at";
    const selectedFields = grouping && !selected.includes(grouping) ? [grouping, ...selected] : selected;
    if (!selectedFields.length) throw new Error("This saved report has no valid fields. Edit it and select at least one field.");

    const selectClause = selectedFields.join(",");
    let query: any = supabase.from(tableName).select(selectClause, { count: "exact" }).eq("company_id", companyId).limit(REPORT_EXPORT_MAX_ROWS);

    for (const filter of filters) {
      if (!filter || typeof filter !== "object") throw new Error("This saved report contains an invalid filter. Edit and save it again.");
      const field = typeof filter.field === "string" ? filter.field : "";
      const operator = typeof filter.operator === "string" ? filter.operator : "equals";
      const value = typeof filter.value === "string" ? filter.value : "";
      if (!field || !value || !allowedFields.has(field)) throw new Error("This saved report contains a filter for an unavailable field. Edit and save it again.");
      if (!filterOperatorsFor(field).includes(operator)) throw new Error(`The saved ${operator} filter is not valid for ${field}.`);

      if (operator === "equals") query = query.eq(field, value);
      else if (operator === "contains") query = query.ilike(field, `%${value}%`);
      else if (operator === "gt") query = query.gt(field, value);
      else if (operator === "lt") query = query.lt(field, value);
      else if (operator === "between") {
        const [a, b] = value.split("|").map((item: string) => item.trim()).filter(Boolean);
        if (!a || !b) throw new Error("A saved between filter is missing its start or end value.");
        query = query.gte(field, a).lte(field, b);
      }
    }

    if (dateRange.from) query = query.gte(dateField, dateRange.from);
    if (dateRange.to) query = query.lt(dateField, nextIsoDate(dateRange.to));
    if (grouping) query = query.order(grouping, { ascending: true, nullsFirst: false });
    if (grouping !== dateField) query = query.order(dateField, { ascending: true, nullsFirst: false });

    const result = await query;
    if (result.error) throw new Error(result.error.message || "Could not fetch report rows");
    const rows = (result.data ?? []) as unknown as Record<string, unknown>[];
    const rowCount = typeof result.count === "number" ? result.count : rows.length;
    if (rowCount > rows.length) {
      throw new Error(`This report matches ${rowCount.toLocaleString("en-IN")} rows, but only ${rows.length.toLocaleString("en-IN")} can be exported safely. Add a date range or filters and try again.`);
    }
    return { rows, selectedFields, grouping };
  }

  function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function sanitizeFileName(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "report";
  }

  function prettyFieldLabel(field: string) {
    const common: Record<string, string> = {
      customer_id: "Customer",
      vendor_id: "Vendor",
      invoice_id: "Invoice",
      order_id: "Order",
      profile_id: "Profile",
      die_id: "Die",
      production_job_id: "Production Job",
      grand_total: "Grand Total",
      total_amount: "Total Amount",
      created_at: "Created At"
    };
    return common[field] ?? field.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function prettyValue(value: unknown) {
    if (value === null || value === undefined || value === "") return "-";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("en-IN") : String(value);
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
      const date = new Date(text);
      if (!Number.isNaN(date.getTime())) return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    }
    return text;
  }

  async function enrichRowsForStakeholders(rows: Record<string, unknown>[], selectedFields: string[]) {
    const enriched = rows.map((row) => ({ ...row }));
    const idFields = selectedFields.filter((field) => field in idDisplayFieldMap);
    if (!idFields.length || !rows.length) return enriched;

    const lookups = new Map<string, Record<string, string>>();

    for (const field of idFields) {
      const cfg = idDisplayFieldMap[field];
      const ids = Array.from(new Set(rows.map((row) => row[field]).filter((value): value is string => typeof value === "string" && value.length > 0)));
      if (!ids.length) continue;
      const result = await supabase.from(cfg.table).select(cfg.select).in("id", ids);
      if (result.error || !result.data) continue;
      const map: Record<string, string> = {};
      for (const item of (result.data as unknown as Record<string, unknown>[])) {
        if (!item.id) continue;
        map[String(item.id)] = cfg.build(item);
      }
      lookups.set(field, map);
    }

    for (const row of enriched) {
      for (const field of idFields) {
        const idValue = row[field];
        if (typeof idValue !== "string") continue;
        const lookup = lookups.get(field);
        if (!lookup) continue;
        row[field] = lookup[idValue] ?? `${idValue} (unmapped)`;
      }
    }

    return enriched;
  }

  async function exportCsv(report: SavedReportRow) {
    try {
      const { rows, selectedFields } = await fetchReportRows(report);
      const displayRows = await enrichRowsForStakeholders(rows, selectedFields);
      const csv = recordsToCsv(selectedFields, displayRows);
      downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${sanitizeFileName(report.report_name)}.csv`);
      toast.success("CSV export downloaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "CSV export failed");
    }
  }

  async function exportPdf(report: SavedReportRow) {
    try {
      const { rows, selectedFields, grouping } = await fetchReportRows(report);
      const displayRows = await enrichRowsForStakeholders(rows, selectedFields);
      const config = report.config_json ?? {};
      const fieldsForPdf = selectedFields.slice(0, 6);
      const pdf = await PDFDocument.create();
      let page = pdf.addPage([842, 595]);
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      const width = page.getWidth();
      const height = page.getHeight();
      const margin = 36;
      let y = height - margin;

      const colCount = Math.max(1, fieldsForPdf.length);
      const colGap = 8;
      const tableWidth = width - margin * 2;
      const colWidth = (tableWidth - colGap * (colCount - 1)) / colCount;

      const short = (value: string, limit = 32) => value.length > limit ? `${value.slice(0, limit - 1)}...` : value;

      const writeLine = (text: string, size = 10, useBold = false) => {
        const activeFont = useBold ? bold : font;
        if (y < margin + 18) {
          page = pdf.addPage([842, 595]);
          y = height - margin;
        }
        page.drawText(text.slice(0, 140), { x: margin, y, size, font: activeFont, color: rgb(0.1, 0.16, 0.26), maxWidth: width - margin * 2 });
        y -= size + 5;
      };

      writeLine(report.report_name, 16, true);
      writeLine(`Source: ${prettyFieldLabel(report.data_source)}`);
      writeLine(`Visibility: ${report.visibility}`);
      if (grouping) writeLine(`Grouped by: ${prettyFieldLabel(grouping)}`);
      writeLine(`Generated: ${new Date().toLocaleString("en-IN")}`);
      const dateRange = config.date_range as { from?: string | null; to?: string | null } | undefined;
      if (dateRange?.from || dateRange?.to) writeLine(`Date range: ${dateRange?.from || "-"} to ${dateRange?.to || "-"}`);
      if (Array.isArray(config.filters) && config.filters.length) {
        const filterSummary = config.filters
          .slice(0, 3)
          .map((item: { field?: string; operator?: string; value?: string }) => `${prettyFieldLabel(item.field || "field")} ${item.operator || "equals"} ${item.value || "-"}`)
          .join("; ");
        writeLine(`Filters: ${short(filterSummary, 120)}`);
      }

      y -= 6;

      const drawTableHeader = () => {
        page.drawRectangle({ x: margin, y: y - 14, width: tableWidth, height: 16, color: rgb(0.94, 0.96, 0.98) });
        let x = margin;
        for (const field of fieldsForPdf) {
          page.drawText(short(prettyFieldLabel(field), 18), { x: x + 3, y: y - 10, size: 9, font: bold, color: rgb(0.15, 0.2, 0.3), maxWidth: colWidth - 6 });
          x += colWidth + colGap;
        }
        y -= 20;
      };

      drawTableHeader();

      if (!displayRows.length) {
        writeLine("No rows matched this report configuration.", 10);
      } else {
        let activeGroupValue: string | null = null;
        for (const row of displayRows) {
          if (grouping) {
            const groupValue = prettyValue(row[grouping]);
            if (groupValue !== activeGroupValue) {
              if (y < margin + 36) {
                page = pdf.addPage([842, 595]);
                y = height - margin;
                drawTableHeader();
              }
              page.drawRectangle({ x: margin, y: y - 13, width: tableWidth, height: 17, color: rgb(0.9, 0.94, 0.98) });
              page.drawText(`${prettyFieldLabel(grouping)}: ${short(groupValue, 70)}`, { x: margin + 4, y: y - 9, size: 9, font: bold, color: rgb(0.1, 0.24, 0.4), maxWidth: tableWidth - 8 });
              y -= 20;
              activeGroupValue = groupValue;
            }
          }
          if (y < margin + 18) {
            page = pdf.addPage([842, 595]);
            y = height - margin;
            drawTableHeader();
          }

          let x = margin;
          for (const field of fieldsForPdf) {
            const text = short(prettyValue(row[field]), 36);
            page.drawText(text, { x: x + 3, y: y, size: 8.5, font, color: rgb(0.12, 0.17, 0.26), maxWidth: colWidth - 6 });
            x += colWidth + colGap;
          }
          y -= 14;

          page.drawLine({ start: { x: margin, y: y + 3 }, end: { x: width - margin, y: y + 3 }, thickness: 0.35, color: rgb(0.89, 0.91, 0.94) });
        }

        if (selectedFields.length > fieldsForPdf.length) {
          y -= 6;
          writeLine(`Note: Showing first ${fieldsForPdf.length} columns for readability.`, 9);
        }
      }

      const bytes = await pdf.save();
      const pdfBuffer = Uint8Array.from(bytes).buffer;
      downloadBlob(new Blob([pdfBuffer], { type: "application/pdf" }), `${sanitizeFileName(report.report_name)}.pdf`);
      toast.success("PDF export downloaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "PDF export failed");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Advanced Report Builder" description="Build custom operational reports without bypassing tenant RLS. Configure source, fields, filters, grouping, visibility, and export templates." actions={<Button onClick={saveReport} disabled={saving}><Save className="h-4 w-4" /> {saving ? "Saving..." : "Save report"}</Button>} />

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader><h2 className="section-title">Report Configuration</h2></CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block space-y-1.5"><span className="form-label inline-flex items-center gap-2"><BarChart3 className="h-4 w-4 text-orange" /> Report name</span><input className="form-input" value={reportName} onChange={(event) => setReportName(event.target.value)} /></label>
              <label className="block space-y-1.5"><span className="form-label inline-flex items-center gap-2"><Database className="h-4 w-4 text-orange" /> Data source</span><select className="form-input" value={source} onChange={(event) => { setSource(event.target.value); setSelectedFields([]); setFilters([]); setGrouping(""); }}>{dataSources.map((item) => <option key={item} value={item}>{item.replace(/_/g, " ")}</option>)}</select></label>
            </div>

            <div>
              <p className="form-label">Select fields</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {sourceFields.map((field) => <button key={field} type="button" onClick={() => toggleField(field)} className={`rounded-xl border px-3 py-2 text-left text-sm font-bold transition ${selectedFields.includes(field) ? "border-orange bg-orange/10 text-orange" : "border-slate-200 bg-white text-slate-700 hover:border-orange/60"}`}>{field}</button>)}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between"><p className="form-label inline-flex items-center gap-2"><Filter className="h-4 w-4 text-orange" /> Filters</p><Button variant="secondary" onClick={addFilter}>Add filter</Button></div>
              <div className="space-y-2">
                {filters.map((item, index) => (
                  <div key={`filter-${index}`} className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1fr_140px_1fr_auto]">
                    <select className="form-input" value={item.field} onChange={(event) => updateFilter(index, "field", event.target.value)}>{sourceFields.map((field) => <option key={field} value={field}>{field}</option>)}</select>
                    <select className="form-input" value={item.operator} onChange={(event) => updateFilter(index, "operator", event.target.value)}>{filterOperatorsFor(item.field).map((operator) => <option key={operator} value={operator}>{operator}</option>)}</select>
                    <input className="form-input" value={item.value} onChange={(event) => updateFilter(index, "value", event.target.value)} placeholder={item.operator === "between" ? "start|end" : "value"} />
                    <Button variant="ghost" onClick={() => removeFilter(index)}>Remove</Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block space-y-1.5"><span className="form-label">Grouping</span><select className="form-input" value={grouping} onChange={(event) => setGrouping(event.target.value)}><option value="">No grouping</option>{sourceFields.map((field) => <option key={field} value={field}>{field}</option>)}</select></label>
              <label className="block space-y-1.5"><span className="form-label inline-flex items-center gap-2"><Eye className="h-4 w-4 text-orange" /> Visibility</span><select className="form-input" value={visibility} onChange={(event) => setVisibility(event.target.value as "private" | "company" | "owner_only")}><option value="private">private</option><option value="company">company</option>{["owner", "admin"].includes(role) ? <option value="owner_only">owner_only</option> : null}</select></label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block space-y-1.5"><span className="form-label inline-flex items-center gap-2"><CalendarRange className="h-4 w-4 text-orange" /> Date from</span><input type="date" className="form-input" value={rangeFrom} onChange={(event) => setRangeFrom(event.target.value)} /></label>
              <label className="block space-y-1.5"><span className="form-label">Date to</span><input type="date" className="form-input" value={rangeTo} onChange={(event) => setRangeTo(event.target.value)} /></label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h2 className="section-title">Preview and Governance</h2></CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-black text-slate-950">Query Preview</p>
              <p className="mt-2 text-sm font-medium text-slate-700">Source: <span className="font-black">{source}</span></p>
              <p className="text-sm font-medium text-slate-700">Fields: <span className="font-black">{selectedFields.join(", ") || "none"}</span></p>
              <p className="text-sm font-medium text-slate-700">Grouping: <span className="font-black">{grouping || "none"}</span></p>
              <p className="text-sm font-medium text-slate-700">Filters: <span className="font-black">{filters.length}</span></p>
            </div>
            <div className="rounded-2xl border border-orange/20 bg-orange/5 p-4 text-sm font-medium leading-6 text-slate-700">
              <p className="font-black text-slate-900">Security</p>
              <p className="mt-1">All report queries remain tenant-scoped by Postgres RLS and company_id policies.</p>
              {role !== "owner" ? <p className="mt-1 inline-flex items-center gap-1 font-bold text-orange"><Shield className="h-4 w-4" /> `owner_only` reports should be created by owner.</p> : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><h2 className="section-title">Saved Reports</h2></CardHeader>
        <CardContent className="space-y-3">
          {reports.length ? reports.map((report) => (
            <div key={report.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-black text-slate-950">{report.report_name}</p>
                  <p className="text-sm font-medium text-slate-500">{report.data_source.replace(/_/g, " ")} · {formatDate(report.created_at)}</p>
                </div>
                <div className="flex gap-2"><Badge value={report.visibility} /><Button variant="secondary" onClick={() => exportCsv(report)}>Export CSV</Button><Button variant="secondary" onClick={() => exportPdf(report)}>Export PDF</Button></div>
              </div>
            </div>
          )) : <div className="empty-mini">No saved reports yet.</div>}
        </CardContent>
      </Card>
    </div>
  );
}

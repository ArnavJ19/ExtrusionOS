// AP-044: the one place each management KPI is defined. Command centre, analytics, profitability, production
// performance, the press floor and the Insights catalogue read their definitions (and, where the number is computed in
// TypeScript, the formula) from here; docs/KPI_DICTIONARY.md is the readable copy and a test keeps the two equal.
// SQL sources compute the same definition server-side; when a definition changes, change it here, in the SQL source and
// in the dictionary in the same commit.

export type MetricArea = "production" | "sales" | "dispatch" | "quality" | "finance";
export type MetricKey = (typeof METRIC_KEYS)[number];
export type MetricDefinition = {
  key: string; label: string; unit: "kg" | "%" | "INR" | "count" | "days" | "kWh/t" | "INR/t"; area: MetricArea;
  definition: string; excludes: string;
  /** Financial metrics are shown only to roles that may read money (see FINANCIAL_ROLES). */
  financial: boolean;
  /** Where the number is computed. */
  source: string;
  /** The screens that show it. */
  shownOn: string[];
  /** FS-77: the key in public.fs_kpi (private.kpi_values) that returns this number, when the database computes it. */
  kpiKey?: string;
};

export const FINANCIAL_ROLES = ["owner", "admin", "accounts"] as const;

export const METRICS = {
  shipped_kg: {
    key: "shipped_kg", label: "Shipped kg (MTD, monthly trend)", unit: "kg", area: "dispatch", financial: false,
    definition: "Net aluminium kg on the packing rows of activated shipments dispatched in the period",
    excludes: "Pending, returned and damaged shipments",
    source: "public.fs_kpi (private.kpi_values); the same rule in public.get_advanced_analytics_snapshot", shownOn: ["/analytics", "/command-center"], kpiKey: "shipped_kg"
  },
  on_time_dispatch: {
    key: "on_time_dispatch", label: "On-time dispatch rate", unit: "%", area: "dispatch", financial: false,
    definition: "Activated shipments dispatched on or before the order's expected dispatch date ÷ activated shipments with an expected date",
    excludes: "Shipments without an expected date",
    source: "public.fs_kpi (private.kpi_values); the same rule in public.get_advanced_analytics_snapshot", shownOn: ["/analytics"], kpiKey: "on_time_dispatch"
  },
  production_planned_kg: {
    key: "production_planned_kg", label: "Production planned kg (MTD)", unit: "kg", area: "production", financial: false,
    definition: "Planned kg of jobs whose planned date is in the month", excludes: "Cancelled jobs",
    source: "public.fs_kpi (private.kpi_values); the same rule in public.get_advanced_analytics_snapshot", shownOn: ["/analytics"], kpiKey: "production_planned_kg"
  },
  production_completed_kg: {
    key: "production_completed_kg", label: "Production completed kg (MTD)", unit: "kg", area: "production", financial: false,
    definition: "Actual kg of jobs completed in the month (throughput)", excludes: "—",
    source: "public.fs_kpi (private.kpi_values); the same rule in public.get_advanced_analytics_snapshot", shownOn: ["/analytics", "/command-center"], kpiKey: "production_completed_kg"
  },
  production_attainment: {
    key: "production_attainment", label: "Production attainment %", unit: "%", area: "production", financial: false,
    definition: "Month to date: actual kg of jobs completed in the month ÷ planned kg of jobs planned in the month. On a job page: that job's actual ÷ planned kg", excludes: "Cancelled jobs",
    source: "public.get_advanced_analytics_snapshot; planAttainmentPercent in lib/calculations/production-performance.ts", shownOn: ["/analytics", "/production/[id]"]
  },
  recovery: {
    key: "recovery", label: "Recovery %", unit: "%", area: "production", financial: false,
    definition: "(Actual output − QC-rejected kg) ÷ billet input kg, over completed jobs. Billet input uses the measured billet weight when recorded, else the theoretical weight",
    excludes: "Shown as \"not captured\" if any job in scope has no linked billet input (input-exception jobs, EXOS-AUD-014)",
    source: "public.fs_kpi (private.kpi_values) for periods; recoveryPercentOf in lib/insights/metrics.ts for one job", shownOn: ["/command-center", "/production/[id]", "/production/floor", "/dies"], kpiKey: "recovery"
  },
  scrap_kg: {
    key: "scrap_kg", label: "Scrap kg (month)", unit: "kg", area: "production", financial: false,
    definition: "Weight of scrap postings in the month", excludes: "Reversed postings (`scrap_record_reversals`)",
    source: "public.fs_kpi (private.kpi_values)", shownOn: ["/command-center"], kpiKey: "scrap_kg"
  },
  recoverable_scrap_kg: {
    key: "recoverable_scrap_kg", label: "Recoverable scrap kg", unit: "kg", area: "production", financial: false,
    definition: "Weight of `production_scrap_lines` with `recoverable = true` (butt end, front/back end, saw cut, rejects)", excludes: "Unrecoverable loss and unclassified scrap",
    source: "public.get_advanced_analytics_snapshot", shownOn: ["/analytics"]
  },
  die_usage: {
    key: "die_usage", label: "Die usage", unit: "kg", area: "production", financial: false,
    definition: "`dies.total_production_kg` = opening (pre-system) kg + completed actual kg of the die's jobs; runs and last-used date likewise",
    excludes: "Manual edits (only owner/admin can change the opening balance)",
    source: "database trigger on completed production jobs", shownOn: ["/dies", "/dies/[id]"]
  },
  melt_loss_kg: {
    key: "melt_loss_kg", label: "Melt loss kg", unit: "kg", area: "production", financial: false,
    definition: "Furnace charge kg − measured good billet kg − rejected billet kg, per cast result", excludes: "Batches without a cast result",
    source: "foundry cast results", shownOn: ["/foundry"]
  },
  order_intake: {
    key: "order_intake", label: "Order intake (MTD)", unit: "INR", area: "sales", financial: true,
    definition: "Value of orders dated in the month", excludes: "Cancelled orders",
    source: "public.fs_kpi (private.kpi_values); the same rule in public.get_advanced_analytics_snapshot", shownOn: ["/analytics"], kpiKey: "order_intake"
  },
  collections: {
    key: "collections", label: "Collections (MTD)", unit: "INR", area: "finance", financial: true,
    definition: "Customer receipts in the month, from the canonical collection events", excludes: "Reversed receipts",
    source: "public.fs_kpi (private.kpi_values); the same rule in public.get_financial_collection_events", shownOn: ["/command-center", "/analytics"], kpiKey: "collections"
  },
  receivables_overdue: {
    key: "receivables_overdue", label: "Overdue receivables", unit: "INR", area: "finance", financial: true,
    definition: "Balance due on issued invoices past their due date", excludes: "Cancelled and draft invoices",
    source: "public.fs_kpi (private.kpi_values); lib/financials/receivables.ts for invoice lists", shownOn: ["/command-center", "/payments"], kpiKey: "receivables_overdue"
  },
  order_margin: {
    key: "order_margin", label: "Order margin %", unit: "%", area: "finance", financial: true,
    definition: "Gross margin of records whose cost components are all known ÷ revenue of the same records", excludes: "Records with an unknown cost component (their revenue is shown separately)",
    source: "marginPercent in app/(dashboard)/profitability/data.ts", shownOn: ["/profitability"]
  },
  process_scrap_percent: {
    key: "process_scrap_percent", label: "Process scrap %", unit: "%", area: "production", financial: false,
    definition: "Process scrap kg recorded on completed jobs (`production_scrap_lines`) ÷ billet input kg of the same jobs", excludes: "Jobs without billet input",
    source: "public.fs_kpi (private.kpi_values)", shownOn: ["/insights/kpis"], kpiKey: "process_scrap_percent"
  },
  qc_rejected_kg: {
    key: "qc_rejected_kg", label: "QC-rejected kg", unit: "kg", area: "quality", financial: false,
    definition: "Kg on rejected quality inspections of jobs completed in the period", excludes: "Rework that was accepted",
    source: "public.fs_kpi (private.kpi_values)", shownOn: ["/insights/kpis"], kpiKey: "qc_rejected_kg"
  },
  oee_quality: {
    key: "oee_quality", label: "OEE quality %", unit: "%", area: "production", financial: false,
    definition: "Good kg (output − QC-rejected kg) ÷ output kg of jobs completed in the period", excludes: "—",
    source: "public.fs_kpi (private.kpi_values)", shownOn: ["/insights/kpis"], kpiKey: "oee_quality"
  },
  oee_availability: {
    key: "oee_availability", label: "OEE availability %", unit: "%", area: "production", financial: false,
    definition: "Run time ÷ planned production time per press. Not measurable until press run and stop time is captured (FS-15)", excludes: "—",
    source: "public.fs_kpi (private.kpi_values)", shownOn: ["/insights/kpis"], kpiKey: "oee_availability"
  },
  oee_performance: {
    key: "oee_performance", label: "OEE performance %", unit: "%", area: "production", financial: false,
    definition: "Actual output rate ÷ approved ideal rate per press and profile. Not measurable until ideal rates are approved", excludes: "—",
    source: "public.fs_kpi (private.kpi_values)", shownOn: ["/insights/kpis"], kpiKey: "oee_performance"
  },
  oee: {
    key: "oee", label: "OEE %", unit: "%", area: "production", financial: false,
    definition: "Availability × performance × quality. Not measurable while availability and performance are not", excludes: "—",
    source: "public.fs_kpi (private.kpi_values)", shownOn: ["/insights/kpis"], kpiKey: "oee"
  },
  kwh_per_tonne: {
    key: "kwh_per_tonne", label: "kWh per tonne", unit: "kWh/t", area: "production", financial: false,
    definition: "Electricity consumption readings dated in the period ÷ tonnes completed in the period", excludes: "Non-electric energy (gas, diesel)",
    source: "public.fs_kpi (private.kpi_values)", shownOn: ["/insights/kpis"], kpiKey: "kwh_per_tonne"
  },
  conversion_cost_per_tonne: {
    key: "conversion_cost_per_tonne", label: "Conversion cost per tonne", unit: "INR/t", area: "finance", financial: false,
    definition: "Actual conversion cost ÷ tonnes produced. Not measurable until actual job costing exists (FS-12)", excludes: "—",
    source: "public.fs_kpi (private.kpi_values)", shownOn: ["/insights/kpis"], kpiKey: "conversion_cost_per_tonne"
  },
  die_life_kg: {
    key: "die_life_kg", label: "Die life kg", unit: "kg", area: "production", financial: false,
    definition: "Median kg produced by the dies retired (status dead), with the number of dies stated", excludes: "Dies without recorded production",
    source: "public.fs_kpi (private.kpi_values)", shownOn: ["/insights/kpis", "/dies/life"], kpiKey: "die_life_kg"
  },
  otif: {
    key: "otif", label: "OTIF %", unit: "%", area: "dispatch", financial: false,
    definition: "Order lines dispatched in full (less the owner's in-full tolerance) on or before their first promised date ÷ lines whose first promise fell due in the period", excludes: "Lines with no quantity; cancelled orders",
    source: "public.fs_kpi (private.fs4_otif_summary)", shownOn: ["/insights/kpis", "/insights/otif"], kpiKey: "otif"
  },
  quote_win_rate: {
    key: "quote_win_rate", label: "Quote win rate %", unit: "%", area: "sales", financial: false,
    definition: "Quotations converted to an order ÷ quotations past internal review, dated in the period", excludes: "Drafts and quotations in internal review",
    source: "public.fs_kpi (private.kpi_values); the same rule in public.get_advanced_analytics_snapshot", shownOn: ["/insights/kpis", "/command-center", "/analytics"], kpiKey: "quote_win_rate"
  },
  receivables_outstanding: {
    key: "receivables_outstanding", label: "Receivables outstanding", unit: "INR", area: "finance", financial: true,
    definition: "Balance due on generated, sent, partly paid and overdue invoices", excludes: "Draft, paid and cancelled invoices",
    source: "public.fs_kpi (private.kpi_values); the same rule in public.get_advanced_analytics_snapshot", shownOn: ["/insights/kpis", "/command-center", "/analytics"], kpiKey: "receivables_outstanding"
  },
  dso_days: {
    key: "dso_days", label: "DSO (days)", unit: "days", area: "finance", financial: true,
    definition: "Receivables outstanding ÷ average daily net invoicing (invoices less credit notes) over the 90 days to the period end", excludes: "Cancelled invoices",
    source: "public.fs_kpi (private.kpi_values)", shownOn: ["/insights/kpis"], kpiKey: "dso_days"
  }
} as const satisfies Record<string, MetricDefinition>;

export const METRIC_KEYS = Object.keys(METRICS) as (keyof typeof METRICS)[];

/** The metrics a role may see: financial ones only for owner, admin and accounts. */
export function metricsForRole(role: string): MetricDefinition[] {
  return METRIC_KEYS.map(key => METRICS[key] as MetricDefinition).filter(metric => !metric.financial || (FINANCIAL_ROLES as readonly string[]).includes(role));
}

/**
 * Recovery % (METRICS.recovery): good output kg ÷ billet input kg × 100. Null when the input is missing or not positive,
 * or the output is missing or negative: "not captured" is never shown as 0%. Callers round for their screen.
 */
export function recoveryPercentOf(goodOutputKg: number | null | undefined, inputKg: number | null | undefined): number | null {
  if (inputKg === null || inputKg === undefined || !Number.isFinite(inputKg) || inputKg <= 0) return null;
  if (goodOutputKg === null || goodOutputKg === undefined || !Number.isFinite(goodOutputKg) || goodOutputKg < 0) return null;
  return goodOutputKg * 100 / inputKg;
}

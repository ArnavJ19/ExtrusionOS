// AP-044: the one place each management KPI is defined. Command centre, analytics, profitability, production
// performance, the press floor and the Insights catalogue read their definitions (and, where the number is computed in
// TypeScript, the formula) from here; docs/KPI_DICTIONARY.md is the readable copy and a test keeps the two equal.
// SQL sources compute the same definition server-side; when a definition changes, change it here, in the SQL source and
// in the dictionary in the same commit.

export type MetricArea = "production" | "sales" | "dispatch" | "quality" | "finance";
export type MetricKey = (typeof METRIC_KEYS)[number];
export type MetricDefinition = {
  key: string; label: string; unit: "kg" | "%" | "INR" | "count" | "days"; area: MetricArea;
  definition: string; excludes: string;
  /** Financial metrics are shown only to roles that may read money (see FINANCIAL_ROLES). */
  financial: boolean;
  /** Where the number is computed. */
  source: string;
  /** The screens that show it. */
  shownOn: string[];
};

export const FINANCIAL_ROLES = ["owner", "admin", "accounts"] as const;

export const METRICS = {
  shipped_kg: {
    key: "shipped_kg", label: "Shipped kg (MTD, monthly trend)", unit: "kg", area: "dispatch", financial: false,
    definition: "Net aluminium kg on the packing rows of activated shipments dispatched in the period",
    excludes: "Pending, returned and damaged shipments",
    source: "public.get_advanced_analytics_snapshot", shownOn: ["/analytics", "/command-center"]
  },
  on_time_dispatch: {
    key: "on_time_dispatch", label: "On-time dispatch rate", unit: "%", area: "dispatch", financial: false,
    definition: "Activated shipments dispatched on or before the order's expected dispatch date ÷ activated shipments with an expected date",
    excludes: "Shipments without an expected date",
    source: "public.get_advanced_analytics_snapshot", shownOn: ["/analytics"]
  },
  production_planned_kg: {
    key: "production_planned_kg", label: "Production planned kg (MTD)", unit: "kg", area: "production", financial: false,
    definition: "Planned kg of jobs whose planned date is in the month", excludes: "Cancelled jobs",
    source: "public.get_advanced_analytics_snapshot", shownOn: ["/analytics"]
  },
  production_completed_kg: {
    key: "production_completed_kg", label: "Production completed kg (MTD)", unit: "kg", area: "production", financial: false,
    definition: "Actual kg of jobs completed in the month (throughput)", excludes: "—",
    source: "public.get_advanced_analytics_snapshot", shownOn: ["/analytics", "/command-center"]
  },
  production_attainment: {
    key: "production_attainment", label: "Production attainment %", unit: "%", area: "production", financial: false,
    definition: "Actual kg of the jobs planned this month that are completed ÷ planned kg of the same jobs", excludes: "Jobs planned in other months",
    source: "public.get_advanced_analytics_snapshot; planAttainmentPercent in lib/calculations/production-performance.ts", shownOn: ["/analytics", "/production/[id]"]
  },
  recovery: {
    key: "recovery", label: "Recovery %", unit: "%", area: "production", financial: false,
    definition: "(Actual output − QC-rejected kg) ÷ billet input kg, over completed jobs. Billet input uses the measured billet weight when recorded, else the theoretical weight",
    excludes: "Shown as \"not captured\" if any job in scope has no linked billet input (input-exception jobs, EXOS-AUD-014)",
    source: "recoveryPercentOf in lib/insights/metrics.ts", shownOn: ["/command-center", "/production/[id]", "/production/floor", "/dies"]
  },
  scrap_kg: {
    key: "scrap_kg", label: "Scrap kg (month)", unit: "kg", area: "production", financial: false,
    definition: "Weight of scrap postings in the month", excludes: "Reversed postings (`scrap_record_reversals`)",
    source: "app/(dashboard)/command-center/page.tsx", shownOn: ["/command-center"]
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
    source: "public.get_advanced_analytics_snapshot", shownOn: ["/analytics"]
  },
  collections: {
    key: "collections", label: "Collections (MTD)", unit: "INR", area: "finance", financial: true,
    definition: "Customer receipts in the month, from the canonical collection events", excludes: "Reversed receipts",
    source: "public.get_financial_collection_events", shownOn: ["/command-center", "/analytics"]
  },
  receivables_overdue: {
    key: "receivables_overdue", label: "Overdue receivables", unit: "INR", area: "finance", financial: true,
    definition: "Balance due on issued invoices past their due date", excludes: "Cancelled and draft invoices",
    source: "lib/financials/receivables.ts", shownOn: ["/command-center", "/payments"]
  },
  order_margin: {
    key: "order_margin", label: "Order margin %", unit: "%", area: "finance", financial: true,
    definition: "Gross margin of records whose cost components are all known ÷ revenue of the same records", excludes: "Records with an unknown cost component (their revenue is shown separately)",
    source: "marginPercent in app/(dashboard)/profitability/data.ts", shownOn: ["/profitability"]
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

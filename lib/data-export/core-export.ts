export type CoreExportPlanItem = {
  table: string;
  skipReason?: string;
};

export type CoreExportManifest = {
  successful: { table: string; rows: number }[];
  skipped: { table: string; reason: string }[];
  errors: { table: string; error: string }[];
};

export const coreExportPlan: CoreExportPlanItem[] = [
  { table: "customers" },
  { table: "aluminium_profiles" },
  { table: "dies" },
  { table: "quotes" },
  { table: "orders" },
  { table: "dispatches" },
  { table: "invoices" },
  { table: "payments" },
  { table: "inventory_items" },
  { table: "production_jobs" },
  { table: "quality_inspections" },
  { table: "vendors" },
  { table: "purchase_orders", skipReason: "Purchase orders are not supported by the current data model." },
  { table: "documents" },
  // Material flow (foundry / billets / scrap)
  { table: "foundry_batches" },
  { table: "foundry_billets" },
  { table: "foundry_aluminium_scrap" },
  { table: "foundry_external_aluminium_sources" },
  { table: "outsourced_billets" },
  { table: "scrap_records" },
  // Machines & packaging
  { table: "machines" },
  { table: "packaging_jobs" },
  { table: "packaging_materials" },
  { table: "packaging_material_purchases" },
  // Finance ledgers
  { table: "expense_ledger" },
  { table: "expense_payments" },
  // Dealer network & pipeline
  { table: "dealer_orders" },
  { table: "tenders" },
  // Operations & utilities
  { table: "energy_readings" },
  { table: "breakdown_logs" },
  { table: "tasks" },
];

export async function exportCoreTables(
  plan: CoreExportPlanItem[],
  fetchRows: (table: string) => Promise<Record<string, unknown>[]>,
) {
  const data: Record<string, Record<string, unknown>[]> = {};
  const manifest: CoreExportManifest = { successful: [], skipped: [], errors: [] };

  for (const item of plan) {
    if (item.skipReason) {
      manifest.skipped.push({ table: item.table, reason: item.skipReason });
      continue;
    }
    try {
      const rows = await fetchRows(item.table);
      data[item.table] = rows;
      manifest.successful.push({ table: item.table, rows: rows.length });
    } catch (error) {
      manifest.errors.push({
        table: item.table,
        error: error instanceof Error ? error.message : "Export query failed",
      });
    }
  }

  return { data, manifest };
}

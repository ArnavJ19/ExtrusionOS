import type { QrEntityType } from "./payload";

export const QR_ENTITY_TYPES = [
  "profile",
  "die",
  "billet_batch",
  "inventory_batch",
  "inventory_item",
  "order",
  "quote",
  "production_job",
  "dispatch_package",
  "dispatch",
  "certificate",
  "machine",
  "maintenance",
  "document",
] as const satisfies readonly QrEntityType[];

export const QR_ENTITY_TABLES: Record<QrEntityType, string> = {
  profile: "aluminium_profiles",
  die: "dies",
  billet_batch: "billet_batches",
  inventory_batch: "profile_stock_batches",
  inventory_item: "inventory_items",
  order: "orders",
  quote: "quotes",
  production_job: "production_jobs",
  dispatch_package: "packing_list_items",
  dispatch: "dispatches",
  certificate: "technical_documents",
  machine: "machines",
  maintenance: "maintenance_schedules",
  document: "technical_documents",
};

export const QR_ENTITY_SELECT: Record<QrEntityType, string> = {
  profile: "id, profile_code, profile_name, section_weight_kg_per_m",
  die: "id, die_number, die_status, die_manufacturer, rack_location",
  billet_batch: "id, batch_number, alloy, temper, status",
  inventory_batch: "id, bundle_number, status, quantity_pieces, total_weight_kg",
  inventory_item: "id, item_code, item_name, item_category, current_stock, unit, location",
  order: "id, order_number, current_stage, expected_dispatch_date",
  quote: "id, quote_number, status, quote_date, grand_total",
  production_job: "id, job_number, status, machine_id, profile_id, die_id",
  dispatch_package: "id, bundle_number, number_of_pieces, gross_weight_kg, net_weight_kg",
  dispatch: "id, dispatch_number, delivery_status, transporter_name, vehicle_number, total_weight_kg",
  certificate: "id, file_name, document_type, approval_status, expiry_date",
  machine: "id, machine_code, machine_name, status",
  maintenance: "id, machine_id, machine_type, maintenance_type, status, next_due_date",
  document: "id, file_name, document_type, approval_status",
};

export const QR_ENTITY_LABELS: Record<QrEntityType, string> = {
  profile: "Profile",
  die: "Die",
  billet_batch: "Billet Batch",
  inventory_batch: "Inventory Batch",
  inventory_item: "Inventory Item",
  order: "Order",
  quote: "Quote",
  production_job: "Production Job",
  dispatch_package: "Dispatch Package",
  dispatch: "Dispatch",
  certificate: "Certificate",
  machine: "Machine",
  maintenance: "Maintenance",
  document: "Document",
};

export async function fetchQrEntityDetails(supabase: any, entityType: QrEntityType, entityId: string, companyId: string) {
  const table = QR_ENTITY_TABLES[entityType];
  const select = QR_ENTITY_SELECT[entityType];
  const { data, error } = await supabase.from(table).select(select).eq("id", entityId).eq("company_id", companyId).maybeSingle();
  if (error || !data) return null;

  const row = data as Record<string, unknown>;
  const displayLabel =
    (row.die_number as string | undefined) ??
    (row.profile_code as string | undefined) ??
    (row.batch_number as string | undefined) ??
    (row.bundle_number as string | undefined) ??
    (row.item_code as string | undefined) ??
    (row.order_number as string | undefined) ??
    (row.quote_number as string | undefined) ??
    (row.job_number as string | undefined) ??
    (row.dispatch_number as string | undefined) ??
    (row.machine_code as string | undefined) ??
    (row.machine_id as string | undefined) ??
    (row.file_name as string | undefined) ??
    entityId;
  return { ...row, display_label: displayLabel };
}

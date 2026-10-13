export const REQUIRED_API_FUNCTIONS = [
  "save_system_configuration_atomic",
  "submit_dealer_receipt_atomic",
  "save_order_atomic",
  "save_ready_dispatch_atomic",
  "generate_system_quote_atomic",
  "handoff_system_configuration_to_production_atomic",
  "complete_production_job_atomic",
  "correct_completed_production_output_atomic",
  "resolve_quality_rework_atomic",
  "list_open_quality_rework_inspections",
  "get_profile_stock_consumption_totals",
  "issue_dispatch_return_credit_note_atomic",
  "reverse_credit_note_atomic",
  "get_dashboard_snapshot",
  "get_advanced_analytics_snapshot",
  "get_operation_database_page"
] as const;

export const REQUIRED_INVOICE_COLUMNS = ["supplier_snapshot", "customer_snapshot"] as const;
export const REQUIRED_COLUMN_CHECKS = [
  ...REQUIRED_INVOICE_COLUMNS.map((column) => ({ table: "invoices", column })),
  { table: "quotes", column: "system_configuration_id" },
  { table: "quote_items", column: "configuration_cut_snapshot" },
  { table: "order_items", column: "configuration_cut_snapshot" },
  { table: "dispatches", column: "actual_dispatched_at" },
  { table: "packing_list_items", column: "net_length_m" },
  { table: "profile_stock_reservations", column: "reserved_pieces" },
  { table: "profile_stock_reservations", column: "initial_reserved_weight_kg" },
  { table: "profile_stock_reservations", column: "initial_reserved_length_m" },
  { table: "profile_stock_reservations", column: "initial_reserved_pieces" },
  { table: "profile_stock_consumptions", column: "consumed_pieces" }
] as const;

export type SchemaContractCheck = {
  check: string;
  status: "verified" | "missing" | "unavailable";
  detail: string;
};

type ReadResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
type SchemaReader = (url: URL, headers: Record<string, string>) => Promise<ReadResponse>;

export async function checkHostedSchemaContract(
  baseUrl: string,
  apiKey: string,
  read: SchemaReader
): Promise<SchemaContractCheck[]> {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) {
    throw new Error("The database URL must use HTTPS unless it is a local instance.");
  }
  const headers: Record<string, string> = { apikey: apiKey, Accept: "application/openapi+json" };
  // Legacy JWT keys can be bearer tokens; newer publishable/secret keys cannot.
  if (apiKey.startsWith("eyJ")) headers.Authorization = `Bearer ${apiKey}`;
  let schema: Record<string, unknown> | null = null;
  try {
    const response = await read(new URL("/rest/v1/", base), headers);
    const body = response.ok ? await response.json() : null;
    if (body && typeof body === "object" && !Array.isArray(body)) schema = body as Record<string, unknown>;
  } catch {
    // An unavailable schema cannot be interpreted as an empty database contract.
  }
  const paths = schema?.paths;
  const advertised = paths && typeof paths === "object" && !Array.isArray(paths)
    ? paths as Record<string, unknown>
    : null;
  const checks: SchemaContractCheck[] = REQUIRED_API_FUNCTIONS.map((name) => ({
    check: `rpc:${name}`,
    status: advertised ? (Object.hasOwn(advertised, `/rpc/${name}`) ? "verified" : "missing") : "unavailable",
    detail: advertised
      ? (Object.hasOwn(advertised, `/rpc/${name}`) ? "Advertised in REST schema; execution and caller authorization still require testing." : "Not advertised for this API credential; catalog and privileges need inspection.")
      : "REST schema could not be verified."
  }));
  for (const { table, column } of REQUIRED_COLUMN_CHECKS) {
    const url = new URL(`/rest/v1/${table}`, base);
    url.searchParams.set("select", column);
    url.searchParams.set("limit", "0");
    try {
      const response = await read(url, { ...headers, Accept: "application/json" });
      if (response.ok) {
        checks.push({ check: `${table}:${column}`, status: "verified", detail: "Zero-row column query accepted; historical values were not read." });
        continue;
      }
      const body = await response.json().catch(() => null) as { code?: string } | null;
      const missing = body?.code === "42703" || body?.code === "PGRST204";
      checks.push({ check: `${table}:${column}`, status: missing ? "missing" : "unavailable", detail: missing ? "Required column is absent from the exposed schema." : `Zero-row column query unavailable (HTTP ${response.status}).` });
    } catch {
      checks.push({ check: `${table}:${column}`, status: "unavailable", detail: "Zero-row column query could not be verified." });
    }
  }
  return checks;
}

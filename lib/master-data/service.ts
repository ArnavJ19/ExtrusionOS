/**
 * PCDA Master Data Service
 *
 * Server-side CRUD + search over PCDA master catalog tables.
 * Provides: search, deactivate, reference validation, deletion guard, duplicate rejection.
 *
 * Architecture:
 * - Pure logic functions (filterMasterRecords, isDuplicateValue, validateReferences)
 *   are exported for property-based testing without DB access.
 * - DB-backed functions (searchMaster, deactivateMaster, deleteMaster, createMaster,
 *   assertReferencesExist) use Supabase and call the pure logic where applicable.
 *
 * Requirements: 6.3, 6.4, 6.6, 6.7, 6.8, 6.9
 */

async function createMasterDataClient() {
  const { createClient } = await import("../supabase/server.ts");
  return createClient();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MasterTable =
  | "pcda_master_alloy_standards"
  | "pcda_master_alloys"
  | "pcda_master_tempers"
  | "pcda_master_uoms"
  | "pcda_master_packing_modes"
  | "pcda_master_qty_methods"
  | "pcda_master_profile_categories"
  | "pcda_master_die_types"
  | "pcda_master_finish_types"
  | "pcda_master_surface_treatments"
  | "pcda_master_defect_types"
  | "pcda_master_quality_parameters"
  | "pcda_master_cost_components"
  | "pcda_master_document_types"
  | "pcda_master_compliance_types"
  | "pcda_master_machine_types"
  | "pcda_master_production_stages";

export type MasterRecord = {
  id: string;
  company_id: string;
  value: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
};

/** Tables that may hold FK references to master records */
const REFERENCING_TABLES: Record<
  string,
  { table: string; column: string }[]
> = {
  pcda_master_alloy_standards: [
    { table: "aluminium_profiles", column: "alloy_standard_id" },
    { table: "quote_items", column: "alloy_standard_id" },
    { table: "order_items", column: "alloy_standard_id" },
  ],
  pcda_master_alloys: [
    { table: "aluminium_profiles", column: "alloy_id" },
    { table: "quote_items", column: "alloy_id" },
    { table: "order_items", column: "alloy_id" },
  ],
  pcda_master_tempers: [
    { table: "aluminium_profiles", column: "temper_id" },
    { table: "quote_items", column: "temper_id" },
    { table: "order_items", column: "temper_id" },
  ],
  pcda_master_packing_modes: [
    { table: "quote_items", column: "packing_mode_id" },
    { table: "order_items", column: "packing_mode_id" },
  ],
};

// ---------------------------------------------------------------------------
// Pure Logic Functions (testable without DB access)
// ---------------------------------------------------------------------------

/**
 * Normalize a value for duplicate comparison: trim whitespace, collapse internal
 * whitespace to single spaces, and lowercase.
 */
export function normalizeValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Pure filter: given a list of master records, return only those that are:
 * - active (is_active === true)
 * - scoped to the given company (company_id matches)
 * - whose value contains the query text (case-insensitive)
 *
 * Results are limited to maxResults (default 50).
 *
 * Property 15 target: master search returns only active, company-scoped, matching records.
 */
export function filterMasterRecords(
  records: MasterRecord[],
  query: string,
  companyId: string,
  maxResults: number = 50
): MasterRecord[] {
  const lowerQuery = query.toLowerCase();
  const filtered = records.filter(
    (r) =>
      r.is_active === true &&
      r.company_id === companyId &&
      r.value.toLowerCase().includes(lowerQuery)
  );
  return filtered.slice(0, maxResults);
}

/**
 * Pure duplicate check: returns true if a value (after normalization) matches
 * any existing active record within the same company.
 *
 * Property 16 target: duplicate active values are rejected.
 */
export function isDuplicateValue(
  existingRecords: MasterRecord[],
  newValue: string,
  companyId: string
): boolean {
  const normalized = normalizeValue(newValue);
  return existingRecords.some(
    (r) =>
      r.is_active === true &&
      r.company_id === companyId &&
      normalizeValue(r.value) === normalized
  );
}

/**
 * Pure reference validation: given a set of master records per table,
 * checks that each referenced ID exists as an active record for the company.
 * Returns an array of field names that failed validation.
 *
 * Property 16 target: references must exist as active company-scoped masters.
 */
export function validateReferences(
  refs: { id: string | null; fieldName: string; records: MasterRecord[] }[],
  companyId: string
): string[] {
  const invalid: string[] = [];
  for (const ref of refs) {
    if (!ref.id) continue;
    const found = ref.records.some(
      (r) =>
        r.id === ref.id &&
        r.company_id === companyId &&
        r.is_active === true
    );
    if (!found) {
      invalid.push(ref.fieldName);
    }
  }
  return invalid;
}

// ---------------------------------------------------------------------------
// DB-Backed Functions
// ---------------------------------------------------------------------------

/**
 * Search active, company-scoped master records.
 * Returns ≤50 results where value contains query text (case-insensitive).
 *
 * Req 6.6: searchable dropdown, active + company-scoped + value-contains
 * Req 6.8: ≤50 results, empty result if no match
 */
export async function searchMaster(
  table: MasterTable,
  query: string,
  companyId: string
): Promise<MasterRecord[]> {
  const supabase = await createMasterDataClient();
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .ilike("value", `%${query}%`)
    .order("value")
    .limit(50);

  if (error) throw error;
  return (data ?? []) as MasterRecord[];
}

/**
 * Deactivate a master record (soft delete).
 * Retains the record so existing references remain resolvable.
 * Excludes from new-entry selection lists.
 *
 * Req 6.4: set inactive, retain record, exclude from selection lists
 */
export async function deactivateMaster(
  table: MasterTable,
  id: string,
  companyId: string
): Promise<void> {
  const supabase = await createMasterDataClient();
  const { error } = await supabase
    .from(table)
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("company_id", companyId);

  if (error) throw error;
}

/**
 * Delete a master record, but only if no references to it exist.
 * Returns a reference-conflict error if references are found.
 *
 * Req 6.3: rejection on conflict, retain all records unchanged
 */
export async function deleteMaster(
  table: MasterTable,
  id: string,
  companyId: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createMasterDataClient();

  // Check for existing references in known tables
  const referencingTables = REFERENCING_TABLES[table] ?? [];

  for (const ref of referencingTables) {
    const { count, error: refError } = await supabase
      .from(ref.table)
      .select("id", { count: "exact", head: true })
      .eq(ref.column, id);

    if (refError) {
      // If the referencing table doesn't exist or column doesn't exist, skip
      continue;
    }

    if ((count ?? 0) > 0) {
      return {
        success: false,
        error: `Cannot delete: ${count} record(s) in "${ref.table}" reference this master record. Deactivate it instead.`,
      };
    }
  }

  // No references found, proceed with deletion
  const { error } = await supabase
    .from(table)
    .delete()
    .eq("id", id)
    .eq("company_id", companyId);

  if (error) throw error;
  return { success: true };
}

/**
 * Create a master record. Rejects if a duplicate active value exists
 * (after case/whitespace normalization).
 *
 * Req 6.9: duplicate active values rejected
 */
export async function createMaster(
  table: MasterTable,
  companyId: string,
  value: string,
  description: string | null,
  createdBy: string
): Promise<MasterRecord> {
  const supabase = await createMasterDataClient();
  const normalizedValue = normalizeValue(value);

  // Check for duplicate active value (case/whitespace normalized)
  // We fetch active records and compare normalized values
  const { data: existing, error: fetchError } = await supabase
    .from(table)
    .select("id, value")
    .eq("company_id", companyId)
    .eq("is_active", true);

  if (fetchError) throw fetchError;

  const hasDuplicate = (existing ?? []).some(
    (r: { id: string; value: string }) => normalizeValue(r.value) === normalizedValue
  );

  if (hasDuplicate) {
    throw new Error(
      `Duplicate value: "${value.trim()}" already exists as an active record (after normalization).`
    );
  }

  const { data, error } = await supabase
    .from(table)
    .insert({
      company_id: companyId,
      value: value.trim(),
      description,
      created_by: createdBy,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as MasterRecord;
}

/**
 * Validate that referenced Alloy, Temper, and Alloy Standard IDs exist
 * and are active for the given company.
 *
 * Convenience wrapper matching the design doc signature for the common
 * alloy/temper/alloy_standard triple validation.
 *
 * Req 6.7: reject save if referenced master not active
 */
export async function assertReferencesExist(
  alloyId: string | null,
  temperId: string | null,
  alloyStandardId: string | null,
  companyId: string
): Promise<string[]> {
  const refs: { table: MasterTable; id: string | null; fieldName: string }[] = [
    { table: "pcda_master_alloys", id: alloyId, fieldName: "alloy_id" },
    { table: "pcda_master_tempers", id: temperId, fieldName: "temper_id" },
    {
      table: "pcda_master_alloy_standards",
      id: alloyStandardId,
      fieldName: "alloy_standard_id",
    },
  ];

  return assertReferencesExistGeneric(companyId, refs);
}

/**
 * Generic reference validation against active masters.
 * Returns an array of field names that failed validation (empty = all valid).
 *
 * Req 6.7: referenced values must exist as active company-scoped records
 */
export async function assertReferencesExistGeneric(
  companyId: string,
  refs: { table: MasterTable; id: string | null; fieldName: string }[]
): Promise<string[]> {
  const invalid: string[] = [];
  const supabase = await createMasterDataClient();

  for (const ref of refs) {
    if (!ref.id) continue;
    const { count, error } = await supabase
      .from(ref.table)
      .select("id", { count: "exact", head: true })
      .eq("id", ref.id)
      .eq("company_id", companyId)
      .eq("is_active", true);

    if (error || (count ?? 0) === 0) {
      invalid.push(ref.fieldName);
    }
  }

  return invalid;
}

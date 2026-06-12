"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DataPageLayout, DataTable, DataTablePagination, DataTableToolbar, DateRangeFilter, StatusFilter, type DataTableColumn, type SortDirection } from "@/components/data";
import { createClient } from "@/lib/supabase/browser";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { getErrorMessage } from "@/lib/utils/errors";
import { labelize, type SessionContext } from "@/types/app";
import { displayValue } from "./value";
import { getModuleConfig, type ModuleKey } from "./module-config";

const pageSize = 10;
const relationFilterFields = ["customer_id", "profile_id", "order_id", "quote_id", "production_job_id", "inventory_item_id", "expense_ledger_id", "source_record_id", "material_id"];

function cleanSearch(value: string) {
  return value.replace(/[%*_,()]/g, " ").replace(/\s+/g, " ").trim();
}

function mergeRows(rows: Record<string, any>[], fallbackRows: Record<string, any>[]) {
  const seen = new Set(rows.map((row) => row.id));
  return [...fallbackRows.filter((row) => !seen.has(row.id)), ...rows];
}

export function ModuleDatabaseClient({ moduleKey, context, canCreate, initialStatus = "" }: { moduleKey: ModuleKey; context: SessionContext; canCreate: boolean; initialStatus?: string }) {
  const config = getModuleConfig(moduleKey);
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 350);
  const [status, setStatus] = useState(initialStatus);
  const [secondary, setSecondary] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [sortColumn, setSortColumn] = useState(config.defaultSort.column);
  const [sortDirection, setSortDirection] = useState<SortDirection>(config.defaultSort.direction);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const relationFilters = useMemo(() => relationFilterFields.map((field) => ({ field, value: searchParams.get(field) ?? "" })).filter((item) => item.value), [searchParams]);

  async function resolveIds(query: string) {
    const result: { customerIds: string[]; profileIds: string[]; orderIds: string[] } = { customerIds: [], profileIds: [], orderIds: [] };
    if (!query) return result;
    const like = `*${query}*`;
    const lookups = [];
    if (config.customerIdField) lookups.push(supabase.from("customers").select("id").eq("company_id", context.companyId).or(`customer_name.ilike.${like},company_name.ilike.${like}`).limit(50).then(({ data, error }) => { if (error) throw error; result.customerIds = (data ?? []).map((row: any) => row.id); }));
    if (config.profileIdField) lookups.push(supabase.from("aluminium_profiles").select("id").eq("company_id", context.companyId).or(`profile_code.ilike.${like},profile_name.ilike.${like}`).limit(50).then(({ data, error }) => { if (error) throw error; result.profileIds = (data ?? []).map((row: any) => row.id); }));
    if (config.orderIdField) lookups.push(supabase.from("orders").select("id").eq("company_id", context.companyId).ilike("order_number", like).limit(50).then(({ data, error }) => { if (error) throw error; result.orderIds = (data ?? []).map((row: any) => row.id); }));
    await Promise.all(lookups);
    return result;
  }

  async function loadRows() {
    setLoading(true);
    setError(null);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const query = cleanSearch(debouncedSearch);
    const ids = await resolveIds(query);
    let request = supabase.from(config.table as any).select(config.select, { count: "exact" }).eq("company_id", context.companyId);
    for (const filter of relationFilters) request = request.eq(filter.field, filter.value);
    if (status && config.groupField) request = request.eq(config.groupField, status);
    if (secondary && config.secondaryFilter) request = request.eq(config.secondaryFilter.field, secondary === "true" ? true : secondary === "false" ? false : secondary);
    if (dateFrom && config.dateFilterField) request = request.gte(config.dateFilterField, dateFrom);
    if (dateTo && config.dateFilterField) request = request.lte(config.dateFilterField, dateTo);
    if (query) {
      const like = `*${query}*`;
      const orParts = config.searchFields.map((field) => `${field}.ilike.${like}`);
      if (config.customerIdField && ids.customerIds.length) orParts.push(`${config.customerIdField}.in.(${ids.customerIds.join(",")})`);
      if (config.profileIdField && ids.profileIds.length) orParts.push(`${config.profileIdField}.in.(${ids.profileIds.join(",")})`);
      if (config.orderIdField && ids.orderIds.length) orParts.push(`${config.orderIdField}.in.(${ids.orderIds.join(",")})`);
      if (orParts.length) request = request.or(orParts.join(","));
    }
    const { data, error: queryError, count } = await request.order(sortColumn, { ascending: sortDirection === "asc", nullsFirst: false }).range(from, to);
    if (queryError) throw queryError;
    let finalRows: Record<string, any>[] = (data ?? []) as Record<string, any>[];
    let finalCount = count ?? null;
    if (moduleKey === "customers" && query) {
      let gstRequest = supabase.from(config.table as any).select(config.select).eq("company_id", context.companyId).ilike("gst_number", `%${query}%`);
      if (status && config.groupField) gstRequest = gstRequest.eq(config.groupField, status);
      if (secondary && config.secondaryFilter) gstRequest = gstRequest.eq(config.secondaryFilter.field, secondary === "true" ? true : secondary === "false" ? false : secondary);
      if (dateFrom && config.dateFilterField) gstRequest = gstRequest.gte(config.dateFilterField, dateFrom);
      if (dateTo && config.dateFilterField) gstRequest = gstRequest.lte(config.dateFilterField, dateTo);
      const { data: gstRows, error: gstError } = await gstRequest.limit(pageSize);
      if (gstError) throw gstError;
      finalRows = mergeRows(finalRows, (gstRows ?? []) as Record<string, any>[]);
      finalCount = finalCount === null ? finalRows.length : Math.max(finalCount, finalRows.length);
    }
    setRows(finalRows);
    setTotalCount(finalCount);
  }

  useEffect(() => {
    loadRows().catch((err) => {
      const message = getErrorMessage(err, `Could not load ${config.databaseTitle.toLowerCase()}`);
      setError(message);
      toast.error(message);
    }).finally(() => setLoading(false));
  }, [moduleKey, page, debouncedSearch, status, secondary, dateFrom, dateTo, sortColumn, sortDirection, relationFilters]);
  useEffect(() => setPage(1), [debouncedSearch, status, secondary, dateFrom, dateTo, relationFilters]);

  const sortable = new Set(config.columns.filter((column) => column.sortable).map((column) => column.id));
  const columns: DataTableColumn<Record<string, any>>[] = config.columns.map((column) => ({
    id: column.id,
    header: column.header,
    sortable: column.sortable,
    accessor: (row) => displayValue(row, column.path, column.type)
  }));

  return (
    <DataPageLayout title={config.databaseTitle} description={`Search, filter, sort, and paginate ${config.title.toLowerCase()} records. The overview remains focused on what needs attention now.`} backHref={config.basePath} backLabel={`Back to ${config.title}`} actions={canCreate && config.fields ? <Link href={`${config.basePath}/new`} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800"><Plus className="h-4 w-4" /> {config.primaryAction}</Link> : null}>
      <DataTableToolbar
        search={search}
        searchPlaceholder={config.searchPlaceholder}
        onSearchChange={setSearch}
        filters={(
          <>
            {config.groupField && config.groups ? <StatusFilter label={labelize(config.groupField)} value={status} onChange={setStatus} options={config.groups.map((value) => ({ value, label: labelize(value) }))} /> : null}
            {config.secondaryFilter ? <StatusFilter label={config.secondaryFilter.label} value={secondary} onChange={setSecondary} options={config.secondaryFilter.options} /> : null}
            {config.dateFilterField ? <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} /> : null}
            {(status || secondary || dateFrom || dateTo || search || relationFilters.length) ? <Button type="button" variant="ghost" onClick={() => { setStatus(""); setSecondary(""); setDateFrom(""); setDateTo(""); setSearch(""); window.history.replaceState(null, "", config.basePath + "/database"); }}>Clear</Button> : null}
          </>
        )}
      />
      {relationFilters.length ? <div className="mx-4 mb-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-semibold text-neutral-700">Filtered by connected record. Clear filters to view the full database.</div> : null}
      <DataTable rows={rows} columns={columns} getRowId={(row) => row.id} getRowHref={(row) => `${config.basePath}/${row.id}`} sortColumn={sortColumn} sortDirection={sortDirection} onSort={(column, direction) => { if (sortable.has(column)) { setSortColumn(column); setSortDirection(direction); } }} isLoading={loading} error={error} onRetry={() => void loadRows()} emptyTitle={`No ${config.title.toLowerCase()} found`} emptyDescription="No records match the current search or filter." emptyAction={canCreate && config.fields ? <Link href={`${config.basePath}/new`} className="inline-flex items-center justify-center rounded-2xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white">{config.primaryAction}</Link> : null} />
      <DataTablePagination page={page} pageSize={pageSize} totalCount={totalCount} isLoading={loading} onPrevious={() => setPage((current) => Math.max(1, current - 1))} onNext={() => setPage((current) => current + 1)} />
    </DataPageLayout>
  );
}

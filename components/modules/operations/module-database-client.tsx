"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
const relationFilterFields = ["customer_id", "profile_id", "order_id", "quote_id", "production_job_id", "inventory_item_id", "expense_ledger_id", "source_record_id", "material_id", "job_id"];

function cleanSearch(value: string) {
  return value.replace(/[%*_,()]/g, " ").replace(/\s+/g, " ").trim();
}

export function ModuleDatabaseClient({ moduleKey, canCreate, initialStatus = "" }: { moduleKey: ModuleKey; context: SessionContext; canCreate: boolean; initialStatus?: string }) {
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
  const requestVersion = useRef(0);
  const relationFilters = useMemo(() => relationFilterFields.map((field) => ({ field, value: searchParams.get(field) ?? "" })).filter((item) => item.value), [searchParams]);

  async function loadRows() {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
    const query = cleanSearch(debouncedSearch);
    const filters = Object.fromEntries(relationFilters.map((filter) => [filter.field, filter.value]));
    if (status && config.groupField) filters.status = status;
    if (secondary && config.secondaryFilter) filters.secondary = secondary;
    const { data, error: queryError } = await supabase.rpc("get_operation_database_page" as any, {
      p_module: moduleKey, p_search: query, p_filters: filters, p_sort: sortColumn,
      p_direction: sortDirection, p_page: page, p_date_from: dateFrom || null, p_date_to: dateTo || null
    });
    if (version !== requestVersion.current) return;
    if (queryError) throw queryError;
    if (!data || !Array.isArray(data.rows) || data.rows.length > pageSize || !Number.isSafeInteger(data.count) || data.count < 0) throw new Error("The database returned an invalid page.");
    setRows(data.rows);
    setTotalCount(data.count);
    } catch (err) {
      if (version !== requestVersion.current) return;
      const message = getErrorMessage(err, `Could not load ${config.databaseTitle.toLowerCase()}`);
      setRows([]);
      setTotalCount(null);
      setError(message);
      toast.error(message);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
    return () => { requestVersion.current++; };
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

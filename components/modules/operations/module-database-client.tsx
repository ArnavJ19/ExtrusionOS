"use client";

import { StageWaiting } from "@/components/modules/orders/stage-waiting";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Bookmark, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DataPageLayout, DataTable, DataTablePagination, DataTableToolbar, DateRangeFilter, StatusFilter, type DataTableColumn, type SortDirection } from "@/components/data";
import { createClient } from "@/lib/supabase/browser";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { labelize, type SessionContext } from "@/types/app";
import { displayValue, getPath } from "./value";
import { getModuleConfig, type ColumnConfig, type ModuleKey } from "./module-config";
import { TableColumnPreferences } from "@/components/ui/table-column-preferences";
import { DataFreshness, DataFreshnessSummary } from "@/components/ui/data-freshness";
import { getRoleColumnOrder, resolveColumnLayout, type ColumnLayout } from "@/lib/preferences/table-columns";
import { getWorkspaceStorage, mergeWorkspacePreferenceChanges, readWorkspacePreferences, upsertNamedWorkspaceView, upsertWorkspaceLink, viewStateParams, workspaceListUrl, workspacePreferenceKey, writeWorkspacePreferences, type WorkspacePreferences, type WorkspaceViewState } from "@/lib/preferences/workspace-preferences";
import { dataFreshnessQueryKey } from "@/lib/workflow/data-freshness";
import { RecordPreview } from "./record-preview";
import { ActiveFilters } from "@/components/data/active-filters";
import { databaseFilterChips, parseDatabaseView, type DatabaseViewRules } from "@/lib/ui/database-view";
import { classifyReadFailure, readStateMessage, type ReadFailure } from "@/lib/ui/read-state";

const pageSize = 10;
const relationFilterFields = ["customer_id", "profile_id", "order_id", "quote_id", "production_job_id", "inventory_item_id", "expense_ledger_id", "source_record_id", "material_id", "job_id"];

function cleanSearch(value: string) {
  return value.replace(/[%*_,()]/g, " ").replace(/\s+/g, " ").trim();
}

export function ModuleDatabaseClient({ moduleKey, context, canCreate, initialStatus = "" }: { moduleKey: ModuleKey; context: SessionContext; canCreate: boolean; initialStatus?: string }) {
  return <ModuleDatabaseWorkspace key={`${context.companyId}:${context.userId}:${context.role}:${moduleKey}`} moduleKey={moduleKey} context={context} canCreate={canCreate} initialStatus={initialStatus} />;
}

function ModuleDatabaseWorkspace({ moduleKey, context, canCreate, initialStatus = "" }: { moduleKey: ModuleKey; context: SessionContext; canCreate: boolean; initialStatus?: string }) {
  const config = getModuleConfig(moduleKey);
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const preferenceKey = workspacePreferenceKey(context);
  const requestScope = JSON.stringify([context.companyId, context.userId, context.role]);
  const viewRules: DatabaseViewRules = { statuses: config.groups, secondary: config.secondaryFilter?.options, sortable: resolveColumnLayout(moduleKey, context.role, config.columns, undefined).permittedColumns.filter((column) => column.sortable).map((column) => column.id), defaultSort: config.defaultSort, dates: Boolean(config.dateFilterField) };
  const firstState = parseDatabaseView(new URLSearchParams(searchParams.toString()), viewRules, initialStatus);
  const [openedViewHref, setOpenedViewHref] = useState(() => `${config.basePath}/database${searchParams.size ? `?${searchParams.toString()}` : ""}`);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [loadedRowsScope, setLoadedRowsScope] = useState<string | null>(null);
  const [loadedQueryKey, setLoadedQueryKey] = useState<string | null>(null);
  const [lastSuccessfulRefresh, setLastSuccessfulRefresh] = useState<{ queryKey: string; at: string } | null>(null);
  const [search, setSearch] = useState(firstState.search);
  const debouncedSearch = useDebounce(search, 350);
  const [status, setStatus] = useState(firstState.status);
  const [secondary, setSecondary] = useState(firstState.secondary);
  const [dateFrom, setDateFrom] = useState(firstState.dateFrom);
  const [dateTo, setDateTo] = useState(firstState.dateTo);
  const [page, setPage] = useState(firstState.page);
  const [sortColumn, setSortColumn] = useState(firstState.sort);
  const [sortDirection, setSortDirection] = useState<SortDirection>(firstState.direction);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failureKind, setFailureKind] = useState<ReadFailure>("failed");
  const [workspaceState, setWorkspace] = useState<WorkspacePreferences | null>(null);
  const [loadedPreferenceKey, setLoadedPreferenceKey] = useState<string | null>(null);
  const workspace = loadedPreferenceKey === preferenceKey ? workspaceState : null;
  const [viewName, setViewName] = useState("");
  const requestVersion = useRef(0);
  const previewTriggerRef = useRef<HTMLElement | null>(null);
  const [previewSelection, setPreviewSelection] = useState<{ id: string; scope: string; queryKey: string } | null>(null);
  const historyRestoreSearch = useRef<string | null>(null);
  const [relationFilters, setRelationFilters] = useState(() => Object.entries(firstState.relationFilters).map(([field, value]) => ({ field, value })));

  useEffect(() => {
    const refresh = () => {
      setWorkspace(readWorkspacePreferences(getWorkspaceStorage(), preferenceKey));
      setLoadedPreferenceKey(preferenceKey);
    };
    refresh();
    window.addEventListener("extrusionos:workspace-preferences", refresh);
    return () => window.removeEventListener("extrusionos:workspace-preferences", refresh);
  }, [preferenceKey]);

  const resolvedColumns = resolveColumnLayout(moduleKey, context.role, config.columns, workspace?.columns[moduleKey]);
  const visibleColumns = resolvedColumns.columns;
  const permittedColumns = resolvedColumns.permittedColumns;
  const viewState: WorkspaceViewState = { search, status, secondary, dateFrom, dateTo, page, sort: sortColumn, direction: sortDirection, relationFilters: Object.fromEntries(relationFilters.map(({ field, value }) => [field, value])) };
  const stateParams = viewStateParams(viewState);
  const listHref = `${config.basePath}/database${stateParams.size ? `?${stateParams.toString()}` : ""}`;
  const dataQueryKey = dataFreshnessQueryKey(requestScope, moduleKey, { search: debouncedSearch, status, secondary, dateFrom, dateTo, page, sortColumn, sortDirection, relationFilters });
  const refreshedAt = lastSuccessfulRefresh?.queryKey === dataQueryKey ? lastSuccessfulRefresh.at : null;
  const loadedForView = loadedRowsScope === requestScope && loadedQueryKey === dataQueryKey && search === debouncedSearch;
  const previewOpen = previewSelection?.scope === requestScope && previewSelection.queryKey === dataQueryKey;
  const previewRow = previewOpen && loadedForView ? rows.find((row) => row.id === previewSelection?.id) ?? null : null;

  useEffect(() => { setPreviewSelection(null); }, [dataQueryKey]);

  useEffect(() => {
    function restoreFromLocation() {
      setOpenedViewHref(`${window.location.pathname}${window.location.search}`);
      const next = parseDatabaseView(new URLSearchParams(window.location.search), viewRules, initialStatus);
      historyRestoreSearch.current = next.search;
      setSearch(next.search);
      setStatus(next.status);
      setSecondary(next.secondary);
      setDateFrom(next.dateFrom);
      setDateTo(next.dateTo);
      setPage(next.page);
      setSortColumn(next.sort);
      setSortDirection(next.direction);
      setRelationFilters(Object.entries(next.relationFilters).map(([field, value]) => ({ field, value })));
    }
    window.addEventListener("popstate", restoreFromLocation);
    return () => window.removeEventListener("popstate", restoreFromLocation);
  }, [initialStatus, config.columns, config.defaultSort.column]);

  useEffect(() => {
    if (historyRestoreSearch.current !== null) {
      if (debouncedSearch !== historyRestoreSearch.current) return;
      historyRestoreSearch.current = null;
    }
    const next = workspaceListUrl(window.location.pathname, window.location.search, viewState, relationFilterFields);
    if (`${window.location.pathname}${window.location.search}` !== next) {
      window.history.replaceState(null, "", next);
    }
  }, [search, status, secondary, dateFrom, dateTo, page, sortColumn, sortDirection, relationFilters]);

  useEffect(() => {
    const restoreKey = `extrusionos:list-scroll:${preferenceKey}:${config.basePath}`;
    try {
      const saved = window.sessionStorage.getItem(restoreKey);
      if (saved && !loading) {
        window.sessionStorage.removeItem(restoreKey);
        requestAnimationFrame(() => window.scrollTo({ top: Math.max(0, Number(saved) || 0), behavior: "instant" }));
      }
    } catch { /* Browser storage can be disabled. */ }
  }, [loading, rows.length, preferenceKey, config.basePath]);

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
    setLoadedRowsScope(requestScope);
    setLoadedQueryKey(dataQueryKey);
    setLastSuccessfulRefresh({ queryKey: dataQueryKey, at: new Date().toISOString() });
    } catch (err) {
      if (version !== requestVersion.current) return;
      const kind = classifyReadFailure(err);
      const message = readStateMessage(kind).description;
      if (!loadedForView || kind === "denied") { setRows([]); setTotalCount(null); }
      setFailureKind(kind);
      setError(message);
      setLoadedRowsScope(requestScope);
      setLoadedQueryKey(dataQueryKey);
      toast.error(message);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
    return () => { requestVersion.current++; };
  }, [moduleKey, requestScope, page, debouncedSearch, status, secondary, dateFrom, dateTo, sortColumn, sortDirection, relationFilters]);
  const sortable = new Set(config.columns.filter((column) => column.sortable).map((column) => column.id));
  const criticalMobileColumns = permittedColumns.filter((column) => column.path === config.groupField || column.path === config.card.badgePath || /(?:allocation|quality|qc)_status$/.test(column.path));
  const toColumn = (column: ColumnConfig): DataTableColumn<Record<string, any>> => ({
    id: column.id,
    header: column.header,
    sortable: column.sortable,
    accessor: (row) => displayValue(row, column.path, column.type),
    width: resolvedColumns.widths[column.id],
    sticky: column.id === resolvedColumns.identifier,
    numeric: ["currency", "weight", "number"].includes(column.type ?? ""),
    mobile: column.id === resolvedColumns.identifier ? "identity" : criticalMobileColumns.some((critical) => critical.id === column.id) || column.path === config.card.subtitlePath || column.path === config.dateFilterField || config.card.meta.slice(0, 2).some((meta) => meta.path === column.path) ? "primary" : "secondary",
    mobileWhen: column.path === "priority" ? (row) => ["urgent", "high"].includes(String(getPath(row, column.path))) : undefined
  });
  const columns: DataTableColumn<Record<string, any>>[] = visibleColumns.map(toColumn);
  columns.push({ id: "data_freshness", header: "Data source & age", mobile: "secondary", accessor: (row) => <DataFreshness row={row} fetchedAt={refreshedAt} /> });
  columns.push({ id: "record_preview", header: "Quick view", mobile: "secondary", accessor: (row) => <button type="button" className="min-h-10 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange" aria-label={`Preview ${String(displayValue(row, config.card.titlePath, "text") || "record")}`} onClick={(event) => { event.stopPropagation(); previewTriggerRef.current = event.currentTarget; setPreviewSelection({ id: String(row.id), scope: requestScope, queryKey: dataQueryKey }); }}>Preview</button> });
  const mobileColumns = [...columns, ...criticalMobileColumns.filter((column) => !visibleColumns.some((visible) => visible.id === column.id)).map(toColumn)];

  const activeFilters = databaseFilterChips(viewState, { status: labelize(config.groupField ?? "status"), secondary: config.secondaryFilter?.label, secondaryOptions: config.secondaryFilter?.options, date: config.dateFilterField ? labelize(config.dateFilterField) : undefined });
  const savedView = workspace?.views.find((view) => view.moduleKey === moduleKey && view.href === openedViewHref);

  function applyView(next: WorkspaceViewState) {
    setSearch(next.search); setStatus(next.status); setSecondary(next.secondary); setDateFrom(next.dateFrom); setDateTo(next.dateTo);
    setPage(next.page); setSortColumn(next.sort); setSortDirection(next.direction);
    setRelationFilters(Object.entries(next.relationFilters).map(([field, value]) => ({ field, value })));
  }

  function clearFilters() {
    applyView({ ...viewState, search: "", status: "", secondary: "", dateFrom: "", dateTo: "", relationFilters: {}, page: 1 });
  }

  function removeFilter(key: string) {
    if (["search", "status", "secondary", "dateFrom", "dateTo"].includes(key)) applyView({ ...viewState, [key]: "", page: 1 });
    else { setRelationFilters((current) => current.filter((filter) => filter.field !== key)); setPage(1); }
  }

  function persistWorkspace(next: WorkspacePreferences) {
    const storage = getWorkspaceStorage();
    const current = workspace ?? readWorkspacePreferences(storage, preferenceKey);
    const merged = mergeWorkspacePreferenceChanges(current, next, readWorkspacePreferences(storage, preferenceKey));
    setWorkspace(merged);
    writeWorkspacePreferences(storage, preferenceKey, merged);
  }

  function openRecord(row: Record<string, any>) {
    const label = String(displayValue(row, config.card.titlePath, "text") || row.id).slice(0, 100);
    const returnTo = listHref;
    const href = `${config.basePath}/${encodeURIComponent(String(row.id))}?returnTo=${encodeURIComponent(returnTo)}`;
    try { window.sessionStorage.setItem(`extrusionos:list-scroll:${preferenceKey}:${config.basePath}`, String(window.scrollY)); } catch { /* Browser storage can be disabled. */ }
    if (workspace) persistWorkspace({ ...workspace, recent: upsertWorkspaceLink(workspace.recent, { href: `${config.basePath}/${encodeURIComponent(String(row.id))}`, label, moduleKey, recordId: String(row.id), updatedAt: Date.now() }, 20) });
    window.location.assign(href);
  }

  function pinCurrentView() {
    if (!workspace) return;
    const link = { href: listHref, label: config.databaseTitle, moduleKey, updatedAt: Date.now() };
    const pinned = workspace.pinned.some((item) => item.href === link.href) ? workspace.pinned.filter((item) => item.href !== link.href) : upsertWorkspaceLink(workspace.pinned, link, 24);
    persistWorkspace({ ...workspace, pinned });
  }

  function saveNamedView() {
    if (!workspace || !viewName.trim()) return;
    const view = { href: listHref, label: viewName.trim().slice(0, 100), moduleKey, updatedAt: Date.now(), state: viewState };
    persistWorkspace({ ...workspace, views: upsertNamedWorkspaceView(workspace.views, view) });
    setViewName("");
    toast.success("Saved view added to Workspace shortcuts.");
  }

  function saveColumns(layout: ColumnLayout) {
    if (!workspace) return;
    persistWorkspace({ ...workspace, columns: { ...workspace.columns, [moduleKey]: layout } });
  }

  return (
    <DataPageLayout title={config.databaseTitle} description={`Search, filter, sort, and paginate ${config.title.toLowerCase()} records. The overview remains focused on what needs attention now.`} backHref={config.basePath} backLabel={`Back to ${config.title}`} actions={<>
      {workspace ? <Button type="button" variant="secondary" onClick={pinCurrentView}><Bookmark className="mr-2 h-4 w-4" />{workspace.pinned.some((item) => item.href === listHref) ? "Unpin view" : "Pin view"}</Button> : null}
      {workspace ? <div className="flex items-center gap-1"><input aria-label="Saved view name" value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="Name this view" maxLength={100} className="w-36 rounded-xl border border-neutral-200 px-3 py-2 text-sm" /><Button type="button" variant="secondary" onClick={saveNamedView} disabled={!viewName.trim()}>Save view</Button></div> : null}
      {canCreate && (config.fields || config.createHref) ? <Link href={config.createHref ?? `${config.basePath}/new`} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800"><Plus className="h-4 w-4" /> {config.primaryAction}</Link> : null}
    </>}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4"><DataFreshnessSummary refreshedAt={refreshedAt} refreshing={loading} onRefresh={() => void loadRows()} /><TableColumnPreferences columns={permittedColumns} identifier={resolvedColumns.identifier} layout={workspace?.columns[moduleKey] ?? { order: getRoleColumnOrder(moduleKey, context.role, permittedColumns), hidden: [], widths: {} }} onChange={saveColumns} /></div>
      <DataTableToolbar
        search={search}
        searchPlaceholder={config.searchPlaceholder}
        onSearchChange={(value) => { setSearch(value); setPage(1); }}
        filters={(
          <>
            {config.groupField && config.groups ? <StatusFilter label={labelize(config.groupField)} value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={config.groups.map((value) => ({ value, label: labelize(value) }))} /> : null}
            {config.secondaryFilter ? <StatusFilter label={config.secondaryFilter.label} value={secondary} onChange={(value) => { setSecondary(value); setPage(1); }} options={config.secondaryFilter.options} /> : null}
            {config.dateFilterField ? <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={(value) => { setDateFrom(value); setPage(1); }} onToChange={(value) => { setDateTo(value); setPage(1); }} /> : null}
          </>
        )}
      />
      <ActiveFilters filters={activeFilters} count={loadedForView && !error ? totalCount : null} loading={loading || search !== debouncedSearch} onRemove={removeFilter} onClear={clearFilters} onResetSavedView={savedView ? () => applyView(parseDatabaseView(viewStateParams(savedView.state), viewRules)) : undefined} />
      {moduleKey === "orders" && loadedForView && rows.length ? <StageWaiting key={`${requestScope}:${dataQueryKey}:${rows.map((row) => row.id).join(",")}`} orderIds={rows.map((row) => String(row.id))} /> : null}
      <DataTable
        rows={loadedForView ? rows : []} columns={columns} mobileColumns={mobileColumns} getRowId={(row) => row.id} onRowClick={openRecord}
        sortColumn={sortColumn} sortDirection={sortDirection}
        onSort={(column, direction) => { if (sortable.has(column)) { setSortColumn(column); setSortDirection(direction); setPage(1); } }}
        isLoading={!loadedForView} refreshing={loading && loadedForView} stale={Boolean(error && loadedForView && rows.length)}
        failureKind={failureKind} error={loadedForView ? error : null} onRetry={() => void loadRows()}
        emptyTitle={activeFilters.length ? "No matching records" : `No ${config.title.toLowerCase()} yet`}
        emptyDescription={readStateMessage(activeFilters.length ? "filtered" : "empty").description}
        emptyAction={activeFilters.length ? <Button type="button" variant="secondary" onClick={clearFilters}>Clear all filters</Button> : canCreate && (config.fields || config.createHref) ? <Link href={config.createHref ?? `${config.basePath}/new`} className="inline-flex items-center justify-center rounded-2xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white">{config.primaryAction}</Link> : null}
      />
      <DataTablePagination page={page} pageSize={pageSize} totalCount={loadedForView ? totalCount : null} isLoading={loading || !loadedForView} onPrevious={() => setPage((current) => Math.max(1, current - 1))} onNext={() => setPage((current) => current + 1)} />
      <RecordPreview open={Boolean(previewOpen)} moduleKey={moduleKey} context={context} row={previewRow} returnTo={listHref} onClose={() => setPreviewSelection(null)} triggerRef={previewTriggerRef} loading={loading} error={error} rowScope={loadedRowsScope ?? ""} />
    </DataPageLayout>
  );
}

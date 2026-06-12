"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataPageLayout, DataTable, DataTablePagination, DataTableToolbar, StatusFilter, type DataTableColumn, type SortDirection } from "@/components/data";
import { createClient } from "@/lib/supabase/browser";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { getErrorMessage } from "@/lib/utils/errors";
import { formatDate, formatWeight } from "@/lib/utils/format";
import { dieStatuses, labelize, type SessionContext } from "@/types/app";
import type { DieRow } from "./types";
import { customerName, profileLabel } from "./types";

const pageSize = 10;
const sortableColumns = new Set(["die_number", "die_status", "ownership_type", "billet_diameter_required_inch", "last_used_date", "total_production_kg", "created_at"]);

function escapeSearch(value: string) {
  return value.replace(/[%_]/g, "").replace(/,/g, " ").trim();
}

export function DiesDatabaseClient({ context, canCreate, initialStatus = "" }: { context: SessionContext; canCreate: boolean; initialStatus?: string }) {
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<DieRow[]>([]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 350);
  const [status, setStatus] = useState(initialStatus);
  const [ownership, setOwnership] = useState("");
  const [page, setPage] = useState(1);
  const [sortColumn, setSortColumn] = useState("created_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const profileId = searchParams.get("profile_id") ?? "";
  const customerId = searchParams.get("customer_id") ?? "";

  async function findSearchIds(query: string) {
    if (!query) return { profileIds: [], customerIds: [] };
    const like = `%${query}%`;
    const [profileResult, customerResult] = await Promise.all([
      supabase.from("aluminium_profiles").select("id").eq("company_id", context.companyId).or(`profile_code.ilike.${like},profile_name.ilike.${like}`).limit(50),
      supabase.from("customers").select("id").eq("company_id", context.companyId).or(`customer_name.ilike.${like},company_name.ilike.${like}`).limit(50)
    ]);
    if (profileResult.error) throw profileResult.error;
    if (customerResult.error) throw customerResult.error;
    return { profileIds: (profileResult.data ?? []).map((row: any) => row.id), customerIds: (customerResult.data ?? []).map((row: any) => row.id) };
  }

  async function loadRows() {
    setLoading(true);
    setError(null);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const query = escapeSearch(debouncedSearch);
    const { profileIds, customerIds } = await findSearchIds(query);

    let request = supabase
      .from("dies")
      .select("*, aluminium_profiles!dies_profile_id_fkey(profile_code, profile_name), customers(customer_name, company_name)", { count: "exact" })
      .eq("company_id", context.companyId);

    if (status) request = request.eq("die_status", status);
    if (ownership) request = request.eq("ownership_type", ownership);
    if (profileId) request = request.eq("profile_id", profileId);
    if (customerId) request = request.eq("customer_id", customerId);
    if (query) {
      const like = `%${query}%`;
      const orParts = [`die_number.ilike.${like}`, `die_status.ilike.${like}`, `rack_location.ilike.${like}`];
      if (profileIds.length) orParts.push(`profile_id.in.(${profileIds.join(",")})`);
      if (customerIds.length) orParts.push(`customer_id.in.(${customerIds.join(",")})`);
      request = request.or(orParts.join(","));
    }

    const { data, error: queryError, count } = await request
      .order(sortableColumns.has(sortColumn) ? sortColumn : "created_at", { ascending: sortDirection === "asc", nullsFirst: false })
      .range(from, to);

    if (queryError) throw queryError;
    setRows((data ?? []) as DieRow[]);
    setTotalCount(count ?? null);
  }

  useEffect(() => {
    loadRows().catch((err) => {
      const message = getErrorMessage(err, "Could not load die database");
      setError(message);
      toast.error(message);
    }).finally(() => setLoading(false));
  }, [page, debouncedSearch, status, ownership, sortColumn, sortDirection, profileId, customerId]);

  useEffect(() => { setPage(1); }, [debouncedSearch, status, ownership, profileId, customerId]);

  const columns: DataTableColumn<DieRow>[] = [
    { id: "die_number", header: "Die Number", sortable: true, accessor: (die) => <span className="font-black text-slate-950">{die.die_number}</span> },
    { id: "profile", header: "Profile", accessor: (die) => profileLabel(die) },
    { id: "customer", header: "Customer", accessor: (die) => customerName(die) },
    { id: "die_status", header: "Status", sortable: true, accessor: (die) => <Badge value={die.die_status} /> },
    { id: "ownership_type", header: "Ownership", sortable: true, accessor: (die) => <Badge value={die.ownership_type} /> },
    { id: "billet_diameter_required_inch", header: "Billet Dia", sortable: true, accessor: (die) => die.billet_diameter_required_inch ? `${die.billet_diameter_required_inch} in` : "-" },
    { id: "rack_location", header: "Rack", accessor: (die) => die.rack_location || "-" },
    { id: "last_used_date", header: "Last Used", sortable: true, accessor: (die) => formatDate(die.last_used_date) },
    { id: "total_production_kg", header: "Production", sortable: true, accessor: (die) => <span className="font-bold text-slate-950">{formatWeight(die.total_production_kg)}</span> },
    { id: "created_at", header: "Created", sortable: true, accessor: (die) => formatDate(die.created_at) }
  ];

  return (
    <DataPageLayout
      title="Die Database"
      description="Search, filter, sort, and paginate all die records without crowding the main Dies overview."
      backHref="/dies"
      backLabel="Back to Dies"
      actions={canCreate ? <Link href="/dies/new" className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange/20 transition hover:bg-orange/90"><Plus className="h-4 w-4" /> Add Die</Link> : null}
    >
      <DataTableToolbar
        search={search}
        searchPlaceholder="Search die number, profile code, customer, rack..."
        onSearchChange={setSearch}
        filters={(
          <>
            <StatusFilter label="Status" value={status} onChange={setStatus} options={dieStatuses.map((value) => ({ value, label: labelize(value) }))} />
            <StatusFilter label="Ownership" value={ownership} onChange={setOwnership} options={[{ value: "company_owned", label: "Company Owned" }, { value: "customer_owned", label: "Customer Owned" }]} />
            {(status || ownership || search || profileId || customerId) ? <Button type="button" variant="ghost" onClick={() => { setSearch(""); setStatus(""); setOwnership(""); window.history.replaceState(null, "", "/dies/database"); }}>Clear</Button> : null}
          </>
        )}
      />
      {(profileId || customerId) ? <div className="mx-4 mb-3 rounded-2xl border border-orange/20 bg-orange/5 px-4 py-3 text-sm font-bold text-slate-700">Filtered by connected profile/customer. Clear filters to view all dies.</div> : null}
      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(die) => die.id}
        getRowHref={(die) => `/dies/${die.id}`}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSort={(column, direction) => { setSortColumn(column); setSortDirection(direction); }}
        isLoading={loading}
        error={error}
        onRetry={() => void loadRows()}
        emptyTitle="No dies found"
        emptyDescription="No die records match this search or filter. Clear filters or add a new die."
        emptyAction={canCreate ? <Link href="/dies/new" className="inline-flex items-center justify-center rounded-xl bg-orange px-4 py-2.5 text-sm font-bold text-white">Add Die</Link> : null}
      />
      <DataTablePagination page={page} pageSize={pageSize} totalCount={totalCount} isLoading={loading} onPrevious={() => setPage((current) => Math.max(1, current - 1))} onNext={() => setPage((current) => current + 1)} />
    </DataPageLayout>
  );
}

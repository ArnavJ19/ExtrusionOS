"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Table2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { StatusBoard, StatusCard } from "@/components/status-board";
import { createClient } from "@/lib/supabase/browser";
import { getErrorMessage } from "@/lib/utils/errors";
import { getDieRisks } from "@/lib/calculations/operations";
import { formatDate, formatWeight } from "@/lib/utils/format";
import { dieStatuses, labelize, type SessionContext } from "@/types/app";
import type { DieRow } from "./types";
import { customerName, profileLabel } from "./types";

type StatusGroup = { status: string; count: number; rows: DieRow[] };
type Metric = { label: string; value: number; hint: string };

const attentionStatusOrder = ["correction", "trial", "active", "nitriding", "inactive", "dead"];

export function DiesOverviewClient({ context, canCreate }: { context: SessionContext; canCreate: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [groups, setGroups] = useState<StatusGroup[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadOverview() {
    setLoading(true);
    setError(null);
    const statusResults = await Promise.all(attentionStatusOrder.map(async (status) => {
      const { data, error: statusError, count } = await supabase
        .from("dies")
        .select("*, aluminium_profiles!dies_profile_id_fkey(profile_code, profile_name), customers(customer_name, company_name)", { count: "exact" })
        .eq("company_id", context.companyId)
        .eq("die_status", status)
        .order("last_used_date", { ascending: false, nullsFirst: false })
        .order("total_production_kg", { ascending: false })
        .limit(50);

      if (statusError) throw statusError;
      return { status, count: count ?? 0, rows: (data ?? []) as DieRow[] };
    }));

    const [totalResult, customerOwnedResult, nitridingDueResult] = await Promise.all([
      supabase.from("dies").select("id", { count: "exact", head: true }).eq("company_id", context.companyId),
      supabase.from("dies").select("id", { count: "exact", head: true }).eq("company_id", context.companyId).eq("ownership_type", "customer_owned"),
      Promise.resolve(supabase.from("die_nitriding_history").select("die_id", { count: "exact", head: true }).eq("company_id", context.companyId).lte("next_nitriding_due_date", new Date().toISOString().slice(0, 10)).not("next_nitriding_due_date", "is", null)).catch(() => ({ count: 0, error: null, data: null }))
    ]);

    if (totalResult.error) throw totalResult.error;
    if (customerOwnedResult.error) throw customerOwnedResult.error;

    const nitridingCount = typeof nitridingDueResult.count === "number" ? nitridingDueResult.count : 0;

    setGroups(statusResults);
    setMetrics([
      { label: "Total Dies", value: totalResult.count ?? 0, hint: "All dies in this workspace" },
      { label: "Active Dies", value: statusResults.find((group) => group.status === "active")?.count ?? 0, hint: "Ready for production" },
      { label: "In Correction", value: statusResults.find((group) => group.status === "correction")?.count ?? 0, hint: "Needs production attention" },
      { label: "Nitriding Due", value: nitridingCount, hint: "Overdue for nitriding cycle" },
      { label: "Customer-Owned", value: customerOwnedResult.count ?? 0, hint: "Linked to customer assets" }
    ]);
  }

  useEffect(() => {
    loadOverview().catch((err) => {
      const message = getErrorMessage(err, "Could not load dies overview");
      setError(message);
      toast.error(message);
    }).finally(() => setLoading(false));
  }, []);

  const boardRecords = groups.flatMap((group) => group.rows);
  const totalCount = metrics[0]?.value ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dies"
        description="Track die status, ownership, correction, usage, rack location, and performance without showing the full database by default."
        actions={(
          <div className="flex flex-wrap gap-2">
            {canCreate ? <Link href="/dies/new" className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange/20 transition hover:bg-orange/90"><Plus className="h-4 w-4" /> Add Die</Link> : null}
            <Link href="/dies/database" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-950 shadow-sm transition hover:border-orange hover:text-orange"><Table2 className="h-4 w-4" /> View Die Database</Link>
          </div>
        )}
      />

      {loading ? <LoadingState title="Loading die overview" description="Preparing die status counts and attention cards." /> : error ? <ErrorState description={error} onRetry={() => void loadOverview()} /> : totalCount === 0 ? (
        <div>
          <EmptyState title="No dies found" description="Add your first die to start tracking die status, ownership, rack location, correction history, and production performance." />
          {canCreate ? <div className="mt-4 flex justify-center"><Link href="/dies/new" className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange/20 transition hover:bg-orange/90"><Plus className="h-4 w-4" /> Add Die</Link></div> : null}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {metrics.map((metric) => (
              <div key={metric.label} className="metric-card">
                <p className="relative z-[1] text-xs font-black uppercase tracking-[0.14em] text-slate-500">{metric.label}</p>
                <p className="relative z-[1] mt-3 text-3xl font-black tracking-tight text-slate-950">{metric.value}</p>
                <p className="relative z-[1] mt-1 text-xs font-semibold text-slate-500">{metric.hint}</p>
              </div>
            ))}
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Needs attention</p>
                  <h2 className="section-title mt-1">Die Status Board</h2>
                </div>
                <p className="text-sm font-medium text-slate-500">Showing up to 5 dies per status. Use View More for the complete filtered database.</p>
              </div>
            </CardHeader>
            <CardContent>
              <StatusBoard
                statuses={attentionStatusOrder}
                records={boardRecords}
                getStatus={(die) => die.die_status}
                getCount={(status) => groups.find((group) => group.status === status)?.count ?? 0}
                emptyText="No dies in this status."
                getViewMoreHref={(status) => `/dies/database?status=${status}`}
                renderCard={(die) => (
                  <StatusCard
                    key={die.id}
                    href={`/dies/${die.id}`}
                    title={die.die_number}
                    subtitle={profileLabel(die)}
                    badges={<><Badge value={die.ownership_type} />{getDieRisks(die).slice(0, 1).map((risk) => <Badge key={risk.label} value={risk.label} className="ml-1" />)}</>}
                    meta={(
                      <>
                        <div className="flex justify-between gap-3"><span>Customer</span><b className="text-slate-950">{customerName(die)}</b></div>
                        <div className="flex justify-between gap-3"><span>Rack</span><b className="text-slate-950">{die.rack_location || "-"}</b></div>
                        <div className="flex justify-between gap-3"><span>Last used</span><b className="text-slate-950">{formatDate(die.last_used_date)}</b></div>
                        <div className="flex justify-between gap-3"><span>Production</span><b className="text-slate-950">{formatWeight(die.total_production_kg)}</b></div>
                      </>
                    )}
                  />
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><h2 className="section-title">Status Summary</h2></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {dieStatuses.map((status) => {
                const count = groups.find((group) => group.status === status)?.count ?? 0;
                return <Link key={status} href={`/dies/database?status=${status}`} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-orange/60 hover:bg-orange/5"><span className="font-black text-slate-950">{labelize(status)}</span><span className="rounded-full bg-aluminium px-3 py-1 text-xs font-black text-slate-600">{count}</span></Link>;
              })}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

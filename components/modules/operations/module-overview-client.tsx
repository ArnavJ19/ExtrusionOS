"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Table2 } from "lucide-react";
import { toast } from "sonner";
import { CardContent, CardHeader, CollapsibleCard } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { StatusBoard, StatusCard, StatusDistributionChart, PriorityBreakdownChart, ValueDistributionChart } from "@/components/status-board";
import { NumberTicker } from "@/components/ui/number-ticker";
import { createClient } from "@/lib/supabase/browser";
import { getErrorMessage } from "@/lib/utils/errors";
import { getOperationalRisks } from "@/lib/calculations/operations";
import { labelize, type SessionContext } from "@/types/app";
import { displayValue, getPath, titleValue } from "./value";
import { getModuleConfig, type ModuleKey } from "./module-config";

type Group = { status: string; count: number; rows: Record<string, any>[] };

const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function dateValue(value: unknown) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const time = new Date(String(value)).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

function moduleSort(moduleKey: ModuleKey, a: Record<string, any>, b: Record<string, any>) {
  if (moduleKey === "orders") return (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9) || dateValue(a.expected_dispatch_date) - dateValue(b.expected_dispatch_date);
  if (moduleKey === "quotes") return dateValue(a.valid_until) - dateValue(b.valid_until) || Number(b.grand_total ?? 0) - Number(a.grand_total ?? 0) || dateValue(b.created_at) - dateValue(a.created_at);
  if (moduleKey === "dispatches") return dateValue(b.dispatch_date) - dateValue(a.dispatch_date);
  if (moduleKey === "production") return dateValue(a.planned_date) - dateValue(b.planned_date) || Number(b.planned_quantity_kg ?? 0) - Number(a.planned_quantity_kg ?? 0);
  if (moduleKey === "inventory") {
    const stockA = Number(a.current_stock ?? 0);
    const stockB = Number(b.current_stock ?? 0);
    const reorderA = Number(a.reorder_level ?? 0);
    const reorderB = Number(b.reorder_level ?? 0);
    const riskA = stockA <= 0 ? 0 : stockA <= reorderA ? 1 : 2;
    const riskB = stockB <= 0 ? 0 : stockB <= reorderB ? 1 : 2;
    return riskA - riskB || dateValue(b.updated_at) - dateValue(a.updated_at);
  }
  if (moduleKey === "invoices") return Number(b.balance_due ?? 0) - Number(a.balance_due ?? 0) || dateValue(a.due_date) - dateValue(b.due_date);
  return dateValue(b.created_at) - dateValue(a.created_at);
}

function extraBadges(moduleKey: ModuleKey, row: Record<string, any>) {
  const risks = getOperationalRisks(moduleKey, row).slice(0, 2);
  return risks.length ? <>{risks.map((risk) => <Badge key={risk.label} value={risk.label} className="ml-1" />)}</> : null;
}

export function ModuleOverviewClient({
  moduleKey,
  context,
  canCreate,
  canUpdate = false,
  hideMetricsAndCharts = false,
  children,
}: {
  moduleKey: ModuleKey;
  context: SessionContext;
  canCreate: boolean;
  canUpdate?: boolean;
  hideMetricsAndCharts?: boolean;
  children?: React.ReactNode;
}) {
  const config = getModuleConfig(moduleKey);
  const supabase = useMemo(() => createClient(), []);
  const [groups, setGroups] = useState<Group[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadOverview() {
    setLoading(true);
    setError(null);
    const groupValues = config.groups ?? [];
    const grouped = await Promise.all(groupValues.map(async (status) => {
      let request = supabase.from(config.table as any).select(config.select, { count: "exact" }).eq("company_id", context.companyId);
      if (config.groupField) request = request.eq(config.groupField, status);
      const { data, error: groupError, count } = await request.order(config.defaultSort.column, { ascending: config.defaultSort.direction === "asc", nullsFirst: false }).limit(50);
      if (groupError) throw groupError;
      return { status, count: count ?? 0, rows: data ?? [] };
    }));
    const { count, error: countError } = await supabase.from(config.table as any).select("id", { count: "exact", head: true }).eq("company_id", context.companyId);
    if (countError) throw countError;
    setGroups(grouped);
    setTotalCount(count ?? 0);
  }

  useEffect(() => {
    loadOverview().catch((err) => {
      const message = getErrorMessage(err, `Could not load ${config.title.toLowerCase()}`);
      setError(message);
      toast.error(message);
    }).finally(() => setLoading(false));
  }, [moduleKey]);

  const records = groups.flatMap((group) => group.rows);

  /** Drag-and-drop status change handler */
  const handleStatusChange = useCallback(async (recordId: string, newStatus: string) => {
    if (!config.groupField) return;

    // Optimistic local update
    setGroups((prev) => {
      const updated = prev.map((g) => ({
        ...g,
        rows: g.status === newStatus
          ? [...g.rows, ...prev.flatMap((pg) => pg.rows.filter((r) => r.id === recordId)).map((r) => ({ ...r, [config.groupField!]: newStatus }))]
          : g.rows.filter((r) => r.id !== recordId),
        count: g.status === newStatus
          ? g.count + 1
          : g.rows.some((r) => r.id === recordId) ? g.count - 1 : g.count,
      }));
      return updated;
    });

    // Server update
    const { error: updateError } = await supabase
      .from(config.table as any)
      .update({ [config.groupField]: newStatus })
      .eq("id", recordId)
      .eq("company_id", context.companyId);

    if (updateError) {
      toast.error(getErrorMessage(updateError, "Could not update status"));
      // Revert optimistic update
      loadOverview().catch(() => {});
      return;
    }

    // For orders, log stage history
    if (moduleKey === "orders") {
      await supabase.from("order_stage_history").insert({
        company_id: context.companyId,
        order_id: recordId,
        stage: newStatus,
        changed_by: context.userId,
        remarks: "Stage updated via drag-and-drop",
      });
    }

    toast.success(`Moved to ${labelize(newStatus)}`);
  }, [config, supabase, context, moduleKey]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={config.title}
        description={config.description}
        actions={(
          <div className="flex flex-wrap gap-2">
            {canCreate && config.fields ? <Link href={`${config.basePath}/new`} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800 hover:shadow-md"><Plus className="h-4 w-4" /> {config.primaryAction}</Link> : null}
            <Link href={`${config.basePath}/database`} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-950 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50"><Table2 className="h-4 w-4" /> {config.databaseAction}</Link>
          </div>
        )}
      />

      {children}

      {loading ? <LoadingState title={`Loading ${config.title.toLowerCase()}`} description="Preparing status cards and recent records." /> : error ? <ErrorState description={error} onRetry={() => void loadOverview()} /> : totalCount === 0 ? (
        <div>
          <EmptyState title={config.emptyState?.title ?? `No ${config.title.toLowerCase()} found`} description={config.emptyState?.description ?? `Create your first record to start using ${config.title}.`} />
          {canCreate && config.fields ? <div className="mt-4 flex justify-center"><Link href={`${config.basePath}/new`} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800"><Plus className="h-4 w-4" /> {config.primaryAction}</Link></div> : null}
        </div>
      ) : (
        <>
          {!hideMetricsAndCharts && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="metric-card"><p className="relative z-[1] text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">Total Records</p><p className="relative z-[1] mt-3 text-3xl font-bold text-neutral-950"><NumberTicker value={totalCount} /></p></div>
              {groups.slice(0, 3).map((group, i) => <div key={group.status} className="metric-card"><p className="relative z-[1] text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">{labelize(group.status)}</p><p className="relative z-[1] mt-3 text-3xl font-bold text-neutral-950"><NumberTicker value={group.count} delay={100 * (i + 1)} /></p></div>)}
            </div>
          )}

          {/* Visualizations */}
          {!hideMetricsAndCharts && (
            <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
              <CollapsibleCard>
                <CardHeader><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">Distribution</p><h2 className="section-title mt-1">{config.groupField ? labelize(config.groupField) : "Status"} Breakdown</h2></div></CardHeader>
                <CardContent>
                  <StatusDistributionChart data={groups.map((g) => ({ status: g.status, count: g.count }))} total={totalCount} />
                </CardContent>
              </CollapsibleCard>
              {moduleKey === "orders" || moduleKey === "production" ? (
                <CollapsibleCard>
                  <CardHeader><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">Priority</p><h2 className="section-title mt-1">Priority Mix</h2></div></CardHeader>
                  <CardContent>
                    <PriorityBreakdownChart records={records} />
                  </CardContent>
                </CollapsibleCard>
              ) : null}
              {moduleKey === "orders" || moduleKey === "quotes" || moduleKey === "invoices" ? (
                <CollapsibleCard>
                  <CardHeader><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">Value</p><h2 className="section-title mt-1">Value Distribution</h2></div></CardHeader>
                  <CardContent>
                    <ValueDistributionChart records={records} valueField={moduleKey === "quotes" ? "grand_total" : moduleKey === "invoices" ? "grand_total" : "order_value"} />
                  </CardContent>
                </CollapsibleCard>
              ) : null}
            </div>
          )}

          <CollapsibleCard>
            <CardHeader>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">Overview</p><h2 className="section-title mt-1">{config.groupField ? `${config.title} by ${labelize(config.groupField)}` : `Recent ${config.title}`}</h2></div>
                <p className="text-sm font-medium text-neutral-500">Showing up to 10 records per group. Use the database for complete search and sorting.</p>
              </div>
            </CardHeader>
            <CardContent>
              <StatusBoard
                statuses={config.groups ?? ["recent"]}
                records={records}
                getStatus={(row) => config.groupField ? String(getPath(row, config.groupField) ?? "") : "recent"}
                getCount={(status) => groups.find((group) => group.status === status)?.count ?? 0}
                emptyText="No records in this group."
                sortRecords={(a, b) => moduleSort(moduleKey, a, b)}
                getViewMoreHref={(status) => `${config.basePath}/database${config.groupField ? `?status=${status}` : ""}`}
                onStatusChange={canUpdate && config.groupField ? handleStatusChange : undefined}
                renderCard={(row) => (
                  <StatusCard
                    key={row.id}
                    href={`${config.basePath}/${row.id}`}
                    title={titleValue(row, config.card.titlePath)}
                    subtitle={config.card.subtitlePath ? displayValue(row, config.card.subtitlePath) : undefined}
                    badges={<>{config.card.badgePath ? <Badge value={String(getPath(row, config.card.badgePath) || "active")} /> : null}{extraBadges(moduleKey, row)}</>}
                    meta={<>{config.card.meta.map((item) => <div key={item.label} className="flex justify-between gap-3 overflow-hidden"><span>{item.label}</span><b className="text-neutral-950 truncate max-w-[60%] text-right">{displayValue(row, item.path, item.type)}</b></div>)}</>}
                  />
                )}
              />
            </CardContent>
          </CollapsibleCard>
        </>
      )}
    </div>
  );
}

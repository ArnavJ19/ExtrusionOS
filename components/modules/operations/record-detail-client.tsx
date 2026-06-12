"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading";
import { createClient } from "@/lib/supabase/browser";
import { getOperationalRisks } from "@/lib/calculations/operations";
import { getErrorMessage } from "@/lib/utils/errors";
import type { SessionContext } from "@/types/app";
import { displayValue, getPath, titleValue } from "./value";
import { getModuleConfig, type ModuleKey } from "./module-config";

export function RecordDetailClient({ moduleKey, context, recordId, canEdit }: { moduleKey: ModuleKey; context: SessionContext; recordId: string; canEdit: boolean }) {
  const config = getModuleConfig(moduleKey);
  const supabase = useMemo(() => createClient(), []);
  const [row, setRow] = useState<Record<string, any> | null>(null);
  const [relatedCounts, setRelatedCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadRecord() {
    setLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase.from(config.table as any).select(config.select).eq("id", recordId).eq("company_id", context.companyId).single();
    if (queryError) throw queryError;
    setRow(data);
    if (config.relatedRecords?.length) {
      const related = await Promise.all(config.relatedRecords.map(async (item) => {
        const { count, error } = await supabase.from(item.table as any).select("id", { count: "exact", head: true }).eq("company_id", context.companyId).eq(item.field, recordId);
        if (error) throw error;
        return [item.label, count ?? 0] as const;
      }));
      setRelatedCounts(Object.fromEntries(related));
    } else {
      setRelatedCounts({});
    }
  }

  useEffect(() => {
    loadRecord().catch((err) => {
      const message = getErrorMessage(err, "Could not load record");
      setError(message);
      toast.error(message);
    }).finally(() => setLoading(false));
  }, [moduleKey, recordId]);

  if (loading) return <LoadingState title={`Loading ${config.title.toLowerCase()} record`} description="Fetching the selected record." />;
  if (error || !row) return <ErrorState description={error ?? "Record not found."} onRetry={() => void loadRecord()} />;
  const risks = getOperationalRisks(moduleKey, row);
  const sourceLink = moduleKey === "expenses"
    ? (() => {
      const sourceId = row.source_record_id ? String(row.source_record_id) : "";
      if (!sourceId) return null;
      const sourceTable = String(row.source_table || "");
      if (sourceTable === "foundry_external_aluminium_sources") return `/foundry/external-sources/${sourceId}`;
      if (sourceTable === "foundry_aluminium_scrap") return `/foundry/scrap/${sourceId}`;
      if (sourceTable === "outsourced_billet_batches") return `/foundry/outsourced-billets/${sourceId}`;
      if (sourceTable === "packaging_material_purchases") return `/packaging/purchases/${sourceId}`;
      if (sourceTable === "energy_readings") return `/energy`;
      if (sourceTable === "breakdown_logs") return `/maintenance`;
      return null;
    })()
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href={config.basePath} className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-neutral-500 transition hover:text-neutral-950"><ArrowLeft className="h-4 w-4" /> Back to {config.title}</Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-neutral-950">{titleValue(row, config.card.titlePath)}</h1>
            {config.card.badgePath ? <Badge value={String(getPath(row, config.card.badgePath) || "active")} /> : null}
          </div>
          <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-neutral-500">{config.detailIntro ?? "Focused detail page for one record. Use the database only when you need to search across all records."}</p>
        </div>
        {canEdit && config.fields && !(moduleKey === "expenses" && String(row.approval_status || "").toLowerCase() === "approved") ? <Link href={`${config.basePath}/${recordId}/edit`} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800"><Pencil className="h-4 w-4" /> Edit</Link> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {config.card.meta.slice(0, 4).map((item) => <div key={item.label} className="metric-card"><p className="relative z-[1] text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">{item.label}</p><p className="relative z-[1] mt-3 text-xl font-bold text-neutral-950">{displayValue(row, item.path, item.type)}</p></div>)}
      </div>

      {risks.length ? (
        <Card className="border-violet-200 bg-violet-50/60">
          <CardHeader><h2 className="section-title">Attention Required</h2></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {risks.map((risk) => (
              <div key={risk.label} className="rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3"><p className="font-bold text-neutral-950">{risk.label}</p><Badge value={risk.severity} /></div>
                <p className="mt-2 text-sm font-medium leading-6 text-neutral-600">{risk.detail}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {(config.detailSections?.length ? config.detailSections : [{ title: "Details", fields: config.columns.map((column) => ({ label: column.header, path: column.path, type: column.type })) }]).map((section) => (
        <Card key={section.title}>
          <CardHeader><h2 className="section-title">{section.title}</h2></CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {section.fields.map((field) => <div key={`${section.title}-${field.label}`}><p className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">{field.label}</p><div className="mt-1 text-sm font-semibold text-neutral-950">{displayValue(row, field.path, field.type)}</div></div>)}
          </CardContent>
        </Card>
      ))}

      {sourceLink ? (
        <Card>
          <CardHeader><h2 className="section-title">Source Record</h2></CardHeader>
          <CardContent>
            <Link href={sourceLink} className="inline-flex items-center justify-center rounded-2xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-800">
              Open Source Transaction
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {config.relatedRecords?.length ? (
        <Card>
          <CardHeader><h2 className="section-title">Connected Records</h2></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            {config.relatedRecords.map((item) => (
                <Link key={item.label} href={`${item.href}?${item.field}=${recordId}`} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50">
                <div className="flex items-center justify-between gap-3"><p className="font-bold text-neutral-950">{item.label}</p><span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-bold text-neutral-700">{relatedCounts[item.label] ?? 0}</span></div>
                <p className="mt-2 text-xs font-semibold leading-5 text-neutral-500">{item.hint}</p>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

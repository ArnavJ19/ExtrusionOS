"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { getReportDownloadUrl } from "@/app/actions/pcda-reports";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/browser";
import { formatDate } from "@/lib/utils/format";
import type { SessionContext } from "@/types/app";

type ReportRow = {
  id: string;
  template_key: string;
  record_number: string | null;
  generated_at: string;
};

export function ReportDownloadList({ context, entityType, entityId }: { context: SessionContext; entityType: string; entityId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadReports() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("technical_reports")
        .select("id, template_key, record_number, generated_at")
        .eq("company_id", context.companyId)
        .eq("record_type", entityType)
        .eq("record_id", entityId)
        .order("generated_at", { ascending: false })
        .limit(20);
      if (error) { console.warn("technical_reports query failed:", error.message); setLoading(false); return; }
      setReports((data ?? []) as ReportRow[]);
    } catch {
      // Table may not exist if migrations haven't been applied
    }
    setLoading(false);
  }

  useEffect(() => { void loadReports(); }, [entityId]);

  async function download(reportId: string) {
    const result = await getReportDownloadUrl(reportId);
    if (!result.success || !result.downloadUrl) {
      toast.error(result.error ?? "Could not generate download link");
      return;
    }
    window.open(result.downloadUrl, "_blank", "noopener,noreferrer");
  }

  if (loading) return null;
  if (!reports.length) return null;

  return (
    <Card>
      <CardHeader><h2 className="section-title">Generated Reports</h2></CardHeader>
      <CardContent>
        <div className="space-y-2">
          {reports.map((report) => (
            <button key={report.id} type="button" onClick={() => download(report.id)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-orange/60 hover:bg-orange/5">
              <div className="flex items-center gap-3">
                <FileText className="h-4 w-4 text-orange" />
                <div>
                  <p className="text-sm font-bold text-slate-950">{report.template_key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</p>
                  <p className="text-xs text-slate-500">{formatDate(report.generated_at)}</p>
                </div>
              </div>
              <Download className="h-4 w-4 text-slate-400" />
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

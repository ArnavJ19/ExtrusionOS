"use client";

import { useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getReportDownloadUrl, generateReport } from "@/app/actions/pcda-reports";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils/format";

export type PcdaReportHistoryItem = {
  id: string;
  generatedAt: string;
};

type Props = {
  templateKey: "quote_line" | "order_line";
  lineId: string;
  canGenerate: boolean;
  readiness: {
    ready: boolean;
    missingFields: string[];
  };
  reports: PcdaReportHistoryItem[];
};

export function PcdaLineReportControls({
  templateKey,
  lineId,
  canGenerate,
  readiness,
  reports,
}: Props) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const result = await generateReport(templateKey, lineId, "pdf");
      if (!result.success || !result.downloadUrl) {
        const missing = result.missingFields?.length
          ? ` Missing: ${result.missingFields.join(", ")}.`
          : "";
        toast.error(`${result.error ?? "Report generation failed."}${missing}`);
        return;
      }
      window.open(result.downloadUrl, "_blank", "noopener,noreferrer");
      toast.success("Customer-safe PCDA report generated.");
      router.refresh();
    } catch {
      toast.error("Could not generate the PCDA report.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDownload(reportId: string) {
    setDownloadingId(reportId);
    try {
      const result = await getReportDownloadUrl(reportId);
      if (!result.success || !result.downloadUrl) {
        toast.error(result.error ?? "Could not create the download link.");
        return;
      }
      window.open(result.downloadUrl, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Could not download the PCDA report.");
    } finally {
      setDownloadingId(null);
    }
  }

  const disabledReason = !readiness.ready
    ? `Missing: ${readiness.missingFields.join(", ")}`
    : !canGenerate
      ? "Your role cannot generate this report"
      : undefined;

  return (
    <div className="flex min-w-[220px] flex-wrap items-center justify-end gap-2">
      {canGenerate ? (
        <Button
          type="button"
          variant="secondary"
          className="rounded-xl px-3 py-2 text-xs"
          disabled={generating || !readiness.ready}
          title={disabledReason}
          onClick={handleGenerate}
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          {reports.length ? "Regenerate PCDA" : "Generate PCDA"}
        </Button>
      ) : null}

      {reports.slice(0, 3).map((report, index) => (
        <button
          key={report.id}
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-orange/60 hover:text-orange disabled:cursor-not-allowed disabled:opacity-60"
          disabled={downloadingId === report.id}
          title={`${index === 0 ? "Download latest PCDA report" : "Download earlier PCDA report"} (${formatDate(report.generatedAt)})`}
          onClick={() => handleDownload(report.id)}
        >
          {downloadingId === report.id
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Download className="h-4 w-4" />}
        </button>
      ))}

      {!readiness.ready ? (
        <p className="w-full text-right text-[11px] font-semibold leading-4 text-amber-700">
          Missing: {readiness.missingFields.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

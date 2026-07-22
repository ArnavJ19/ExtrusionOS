"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { getSignedFileUrl } from "@/lib/utils/files";
import { getErrorMessage } from "@/lib/utils/errors";

type DieDetailTabsProps = {
  trials: Record<string, any>[];
  corrections: Record<string, any>[];
  nitridings: Record<string, any>[];
  documents: Record<string, any>[];
};

const TABS = ["Trials", "Corrections", "Nitriding", "Documents"] as const;
type Tab = typeof TABS[number];

export function DieDetailTabs({ trials, corrections, nitridings, documents }: DieDetailTabsProps) {
  const [tab, setTab] = useState<Tab>("Trials");

  async function openDocument(document: Record<string, any>) {
    try {
      const signedUrl = await getSignedFileUrl(
        document.storage_bucket ?? "documents",
        document.storage_path ?? document.file_url
      );
      window.open(signedUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not open document"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-aluminium/50 p-1">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition ${tab === t ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            {t} ({t === "Trials" ? trials.length : t === "Corrections" ? corrections.length : t === "Nitriding" ? nitridings.length : documents.length})
          </button>
        ))}
      </div>

      {tab === "Trials" && (
        <Card>
          <CardHeader><h2 className="section-title">Die Trial History</h2></CardHeader>
          <CardContent>
            {!trials.length ? <EmptyState title="No trials recorded" description="Die trials will appear here when logged from production." /> : (
              <div className="overflow-x-auto">
                <table className="industrial-table min-w-[700px]">
                  <thead><tr><th>Date</th><th>Result</th><th>Press</th><th>Alloy</th><th>Recovery</th><th>Surface</th><th>Remarks</th></tr></thead>
                  <tbody>
                    {trials.map((t) => (
                      <tr key={t.id}>
                        <td className="font-bold">{formatDate(t.trial_date)}</td>
                        <td><Badge value={t.trial_result} /></td>
                        <td>{t.trial_press || "-"}</td>
                        <td>{t.trial_billet_alloy || "-"}</td>
                        <td>{t.trial_recovery_percent ? `${t.trial_recovery_percent}%` : "-"}</td>
                        <td>{t.surface_status || t.surface_finish_result || "-"}</td>
                        <td className="max-w-48 truncate">{t.remarks || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "Corrections" && (
        <Card>
          <CardHeader><h2 className="section-title">Correction History</h2></CardHeader>
          <CardContent>
            {!corrections.length ? <EmptyState title="No corrections recorded" description="Die correction entries will appear here." /> : (
              <div className="overflow-x-auto">
                <table className="industrial-table min-w-[700px]">
                  <thead><tr><th>Date</th><th>Reason</th><th>Type</th><th>Result</th><th>Vendor</th><th>Cost</th><th>Notes</th></tr></thead>
                  <tbody>
                    {corrections.map((c) => (
                      <tr key={c.id}>
                        <td className="font-bold">{formatDate(c.correction_date)}</td>
                        <td><Badge value={c.correction_reason} /></td>
                        <td>{c.correction_type || "-"}</td>
                        <td><Badge value={c.result_status} /></td>
                        <td>{c.correction_vendor || "-"}</td>
                        <td>{c.cost ? formatCurrency(c.cost) : "-"}</td>
                        <td className="max-w-48 truncate">{c.notes || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "Nitriding" && (
        <Card>
          <CardHeader><h2 className="section-title">Nitriding History</h2></CardHeader>
          <CardContent>
            {!nitridings.length ? <EmptyState title="No nitriding records" description="Nitriding cycle records will appear here when logged." /> : (
              <div className="overflow-x-auto">
                <table className="industrial-table min-w-[700px]">
                  <thead><tr><th>Date</th><th>Cycle #</th><th>Vendor</th><th>Process</th><th>Duration</th><th>Surface HV</th><th>Status</th></tr></thead>
                  <tbody>
                    {nitridings.map((n) => (
                      <tr key={n.id}>
                        <td className="font-bold">{formatDate(n.nitriding_date)}</td>
                        <td>{n.nitriding_cycle_number}</td>
                        <td>{n.nitriding_vendor || "-"}</td>
                        <td>{n.nitriding_process_type || "-"}</td>
                        <td>{n.nitriding_duration_hours ? `${n.nitriding_duration_hours} hrs` : "-"}</td>
                        <td>{n.surface_hardness || "-"}</td>
                        <td><Badge value={n.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "Documents" && (
        <Card>
          <CardHeader><h2 className="section-title">Technical Documents</h2></CardHeader>
          <CardContent>
            {!documents.length ? <EmptyState title="No documents linked" description="Technical documents (drawings, certificates, reports) will appear here." /> : (
              <div className="space-y-2">
                {documents.map((doc) => (
                  <button key={doc.id} type="button" onClick={() => void openDocument(doc)} className="flex w-full items-center justify-between rounded-xl border border-slate-200 p-3 text-left transition hover:border-orange/60">
                    <div>
                      <p className="font-bold text-slate-950">{doc.file_name}</p>
                      <p className="text-xs text-slate-500">{doc.document_type} · v{doc.version_number ?? 1} · {formatDate(doc.created_at)}</p>
                    </div>
                    <Badge value={doc.approval_status ?? "pending"} />
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

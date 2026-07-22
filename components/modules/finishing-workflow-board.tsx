"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, CheckCircle2, Factory, PackageX, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { retryRejectedFinishingJobAction, transitionFinishingJobAction } from "@/lib/actions/finishing";
import { formatDate, formatWeight } from "@/lib/utils/format";
import { labelize } from "@/types/app";

type FinishingJob = {
  id: string;
  finishing_type: string;
  color_code: string | null;
  shade_name: string | null;
  vendor_id: string | null;
  planned_date: string | null;
  sent_date: string | null;
  received_date: string | null;
  input_weight_kg: number | null;
  output_weight_kg: number | null;
  rejection_weight_kg: number | null;
  status: string;
  remarks: string | null;
  retry_of_finishing_job_id: string | null;
  orders?: {
    order_number?: string | null;
    customers?: { customer_name?: string | null; company_name?: string | null } | null;
  } | null;
  production_jobs?: { job_number?: string | null } | null;
  vendors?: { vendor_name?: string | null } | null;
};

type Vendor = {
  id: string;
  vendor_name: string;
  vendor_type: string;
};

type NextStatus = "sent_to_vendor" | "in_process" | "received" | "rejected" | "completed";

const transitions: Record<string, NextStatus[]> = {
  planned: ["sent_to_vendor", "in_process", "rejected"],
  sent_to_vendor: ["in_process", "received", "rejected"],
  in_process: ["received", "completed", "rejected"],
  received: ["completed", "rejected"]
};

const statusLabels: Record<NextStatus, string> = {
  sent_to_vendor: "Send to Vendor",
  in_process: "Start Processing",
  received: "Record Receipt",
  rejected: "Reject Output",
  completed: "Complete Finishing"
};

function localToday() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return [now.getFullYear(), month, day].join("-");
}

export function FinishingWorkflowBoard({
  jobs,
  vendors,
  canUpdate
}: {
  jobs: FinishingJob[];
  vendors: Vendor[];
  canUpdate: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const visibleJobs = jobs.filter((job) => !["completed", "not_required"].includes(job.status));
  const initial = visibleJobs.find((job) => transitions[job.status]?.length) ?? visibleJobs[0] ?? null;
  const [selectedId, setSelectedId] = useState(initial?.id ?? "");
  const selected = jobs.find((job) => job.id === selectedId) ?? null;
  const retryJob = selected ? jobs.find((job) => job.retry_of_finishing_job_id === selected.id) ?? null : null;
  const [vendorId, setVendorId] = useState(initial?.vendor_id ?? "");
  const [sentDate, setSentDate] = useState(initial?.sent_date ?? localToday());
  const [receivedDate, setReceivedDate] = useState(initial?.received_date ?? localToday());
  const [outputWeight, setOutputWeight] = useState(initial?.output_weight_kg ? String(initial.output_weight_kg) : "");
  const [rejectionWeight, setRejectionWeight] = useState(initial?.rejection_weight_kg ? String(initial.rejection_weight_kg) : "0");
  const [remarks, setRemarks] = useState(initial?.remarks ?? "");
  const [retryDate, setRetryDate] = useState(localToday());
  const [retryRemarks, setRetryRemarks] = useState("");

  function selectJob(job: FinishingJob) {
    setSelectedId(job.id);
    setVendorId(job.vendor_id ?? "");
    setSentDate(job.sent_date ?? localToday());
    setReceivedDate(job.received_date ?? localToday());
    setOutputWeight(job.output_weight_kg ? String(job.output_weight_kg) : "");
    setRejectionWeight(job.rejection_weight_kg ? String(job.rejection_weight_kg) : "0");
    setRemarks(job.remarks ?? "");
    setRetryDate(localToday());
    setRetryRemarks("");
  }

  function move(nextStatus: NextStatus) {
    if (!selected) return;
    if (nextStatus === "sent_to_vendor" && !vendorId) {
      toast.error("Select the finishing vendor before recording the outward movement.");
      return;
    }
    if (nextStatus === "completed" && Number(outputWeight || 0) <= 0) {
      toast.error("Enter accepted output weight before completing finishing.");
      return;
    }
    if (nextStatus === "rejected" && Number(rejectionWeight || 0) <= 0) {
      toast.error("Enter the rejected weight before rejecting finishing output.");
      return;
    }
    if (nextStatus === "rejected" && !remarks.trim()) {
      toast.error("Record the rejection reason before rejecting finishing output.");
      return;
    }
    if (nextStatus === "rejected" && !window.confirm("Reject this finishing job? Rejected jobs cannot be reopened.")) {
      return;
    }
    if (nextStatus === "completed" && !window.confirm("Complete finishing with the entered accepted and rejected weights?")) {
      return;
    }

    startTransition(async () => {
      const result = await transitionFinishingJobAction({
        job_id: selected.id,
        status: nextStatus,
        vendor_id: vendorId || null,
        sent_date: sentDate || null,
        received_date: receivedDate || null,
        output_weight_kg: outputWeight ? Number(outputWeight) : null,
        rejection_weight_kg: Number(rejectionWeight || 0),
        remarks: remarks || null
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(statusLabels[nextStatus]);
      router.refresh();
    });
  }

  function retryRejectedJob() {
    if (!selected || selected.status !== "rejected" || retryJob) return;
    if (!window.confirm("Create one corrective finishing retry for the recoverable rejected weight?")) return;
    startTransition(async () => {
      const result = await retryRejectedFinishingJobAction({
        rejected_job_id: selected.id,
        planned_date: retryDate,
        remarks: retryRemarks || null
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Corrective finishing retry planned");
      router.refresh();
    });
  }

  if (!visibleJobs.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm font-semibold text-slate-500">
        No finishing jobs found. Non-mill-finish production output will appear here automatically after the press job is completed.
      </div>
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[0.9fr_1.5fr]">
      <div className="space-y-3">
        {visibleJobs.map((job) => (
          <button
            key={job.id}
            type="button"
            onClick={() => selectJob(job)}
            className={"w-full rounded-2xl border p-4 text-left transition " + (job.id === selectedId ? "border-orange bg-orange/5 shadow-sm" : "border-slate-200 bg-white hover:border-orange/40")}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-black text-slate-950">{job.orders?.order_number ?? "Order"} / {job.production_jobs?.job_number ?? "Production job"}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">{labelize(job.finishing_type)} {job.color_code || job.shade_name ? "- " + (job.color_code || job.shade_name) : ""}</p>
              </div>
              <Badge value={job.status} />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs font-semibold text-slate-600">
              <span>{job.vendors?.vendor_name ?? "In-house / vendor not assigned"}</span>
              <b className="text-slate-950">{formatWeight(job.input_weight_kg ?? 0)}</b>
            </div>
          </button>
        ))}
      </div>

      {selected ? (
        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-orange">Finishing Movement</p>
              <h3 className="mt-1 text-lg font-black text-slate-950">{selected.orders?.order_number ?? "Order"} / {selected.production_jobs?.job_number ?? "Production job"}</h3>
              <p className="mt-1 text-sm font-semibold text-slate-500">{labelize(selected.finishing_type)} with {formatWeight(selected.input_weight_kg ?? 0)} input.</p>
            </div>
            <Badge value={selected.status} />
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <label className="block space-y-1.5">
              <span className="form-label">Finishing vendor</span>
              <select className="form-input" value={vendorId} onChange={(event) => setVendorId(event.target.value)} disabled={!canUpdate || isPending || !transitions[selected.status]?.length}>
                <option value="">In-house / not assigned</option>
                {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.vendor_name} - {labelize(vendor.vendor_type)}</option>)}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="form-label">Sent date</span>
              <input className="form-input" type="date" value={sentDate} onChange={(event) => setSentDate(event.target.value)} disabled={!canUpdate || isPending || !transitions[selected.status]?.length} />
            </label>
            <label className="block space-y-1.5">
              <span className="form-label">Received date</span>
              <input className="form-input" type="date" value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} disabled={!canUpdate || isPending || !transitions[selected.status]?.length} />
            </label>
            <label className="block space-y-1.5">
              <span className="form-label">Accepted output kg</span>
              <input className="form-input" type="number" min="0" step="0.001" value={outputWeight} onChange={(event) => setOutputWeight(event.target.value)} disabled={!canUpdate || isPending || !transitions[selected.status]?.length} />
            </label>
            <label className="block space-y-1.5">
              <span className="form-label">Rejected kg</span>
              <input className="form-input" type="number" min="0" step="0.001" value={rejectionWeight} onChange={(event) => setRejectionWeight(event.target.value)} disabled={!canUpdate || isPending || !transitions[selected.status]?.length} />
            </label>
            <label className="block space-y-1.5 sm:col-span-2 xl:col-span-1">
              <span className="form-label">Movement remarks</span>
              <input className="form-input" value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Challan, batch, shade, or exception" disabled={!canUpdate || isPending || !transitions[selected.status]?.length} />
            </label>
          </div>

          {selected.status === "rejected" ? (
            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="font-black text-amber-950">Corrective finishing retry</p>
              {retryJob ? (
                <p className="mt-1 text-sm font-semibold text-amber-800">A retry already exists with status {labelize(retryJob.status)}. The rejected source remains locked as evidence.</p>
              ) : (
                <>
                  <p className="mt-1 text-sm font-semibold text-amber-800">Create one new planned job for the recoverable rejected weight. The original rejection will not be edited or reopened.</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[180px_1fr_auto] sm:items-end">
                    <label className="block space-y-1.5">
                      <span className="form-label">Retry planned date</span>
                      <input className="form-input" type="date" value={retryDate} onChange={(event) => setRetryDate(event.target.value)} disabled={!canUpdate || isPending} />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="form-label">Corrective instruction</span>
                      <input className="form-input" value={retryRemarks} onChange={(event) => setRetryRemarks(event.target.value)} placeholder="Reprocess route, shade correction, vendor instruction" disabled={!canUpdate || isPending} />
                    </label>
                    <Button type="button" variant="secondary" onClick={retryRejectedJob} disabled={!canUpdate || isPending || !retryDate}>
                      <RotateCcw className="h-4 w-4" /> {isPending ? "Planning..." : "Plan One Retry"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-3">
            {(transitions[selected.status] ?? []).map((status) => (
              <Button
                key={status}
                type="button"
                variant={status === "rejected" ? "danger" : status === "completed" ? "primary" : "secondary"}
                onClick={() => move(status)}
                disabled={!canUpdate || isPending}
              >
                {status === "sent_to_vendor" ? <Send className="h-4 w-4" /> : null}
                {status === "in_process" ? <Factory className="h-4 w-4" /> : null}
                {status === "received" ? <ArrowDownToLine className="h-4 w-4" /> : null}
                {status === "completed" ? <CheckCircle2 className="h-4 w-4" /> : null}
                {status === "rejected" ? <PackageX className="h-4 w-4" /> : null}
                {isPending ? "Saving..." : statusLabels[status]}
              </Button>
            ))}
            {!transitions[selected.status]?.length ? (
              <p className="text-sm font-semibold text-slate-500">
                This job is locked at {labelize(selected.status)}. Sent {formatDate(selected.sent_date)}; received {formatDate(selected.received_date)}; accepted {formatWeight(selected.output_weight_kg ?? 0)}.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

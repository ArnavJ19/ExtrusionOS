"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ExternalLink, RotateCcw, Truck, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { updateDeliveryStatusAction } from "@/lib/actions/dispatches";
import { createClient } from "@/lib/supabase/browser";
import { getSignedFileUrl, removeTenantFile, uploadTenantFile } from "@/lib/utils/files";
import { getErrorMessage } from "@/lib/utils/errors";
import { formatDate } from "@/lib/utils/format";
import { labelize } from "@/types/app";

type DeliveryStatus = "pending" | "dispatched" | "in_transit" | "delivered" | "delayed" | "damaged" | "returned";

type StatusHistory = {
  id: string;
  from_status: string | null;
  to_status: string;
  changed_at: string;
  remarks: string | null;
};

const nextStatuses: Record<DeliveryStatus, DeliveryStatus[]> = {
  pending: ["dispatched"],
  dispatched: ["in_transit", "delivered", "delayed", "damaged", "returned"],
  in_transit: ["delivered", "delayed", "damaged", "returned"],
  delayed: ["dispatched", "in_transit", "delivered", "damaged", "returned"],
  damaged: ["dispatched", "in_transit", "returned"],
  returned: ["dispatched"],
  delivered: ["returned"]
};

const actionLabels: Record<DeliveryStatus, string> = {
  pending: "Pending",
  dispatched: "Record Dispatch",
  in_transit: "Mark In Transit",
  delivered: "Confirm Delivery",
  delayed: "Record Delay",
  damaged: "Record Damage",
  returned: "Record Return"
};

export function DispatchDeliveryWorkflow({
  dispatch,
  history,
  canUpdate,
  companyId,
  userId
}: {
  dispatch: {
    id: string;
    dispatch_number: string;
    delivery_status: DeliveryStatus;
    proof_of_delivery_url: string | null;
    remarks: string | null;
    last_status_changed_at: string | null;
    delivered_at: string | null;
  };
  history: StatusHistory[];
  canUpdate: boolean;
  companyId: string;
  userId: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [isPending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [proofUrl, setProofUrl] = useState(dispatch.proof_of_delivery_url ?? "");
  const [remarks, setRemarks] = useState(dispatch.remarks ?? "");

  async function uploadProof(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    let storagePath: string | null = null;

    try {
      storagePath = await uploadTenantFile("documents", companyId, `dispatches/${dispatch.id}/proof-of-delivery`, file);
      const { error } = await supabase.from("technical_documents").insert({
        company_id: companyId,
        document_type: "proof_of_delivery",
        linked_entity_type: "dispatch",
        linked_entity_id: dispatch.id,
        file_name: file.name,
        file_url: storagePath,
        storage_bucket: "documents",
        storage_path: storagePath,
        mime_type: file.type || null,
        uploaded_by: userId,
        approval_status: "pending",
        version_number: 1,
        notes: remarks.trim() || null
      });
      if (error) throw error;

      setProofUrl(storagePath);
      toast.success("Proof of delivery uploaded. Confirm delivery when the receipt details are correct.");
    } catch (error) {
      if (storagePath) {
        try {
          await removeTenantFile("documents", storagePath);
        } catch (cleanupError) {
          console.error("Could not remove orphaned proof-of-delivery upload", cleanupError);
        }
      }
      toast.error(getErrorMessage(error, "Proof-of-delivery upload failed"));
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function openProof() {
    if (!proofUrl.trim()) return;
    try {
      const url = await getSignedFileUrl("documents", proofUrl.trim());
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not open proof of delivery"));
    }
  }

  function transition(status: DeliveryStatus) {
    if (status === "delivered" && !proofUrl.trim()) {
      toast.error("Upload or link the signed proof of delivery before confirming delivery.");
      return;
    }
    if (["delivered", "damaged", "returned"].includes(status)) {
      const question = status === "delivered"
        ? "Confirm customer delivery with this proof of delivery?"
        : "Record this shipment as " + labelize(status).toLowerCase() + "?";
      if (!window.confirm(question)) return;
    }

    startTransition(async () => {
      const result = await updateDeliveryStatusAction(dispatch.id, status, proofUrl, remarks);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(actionLabels[status]);
      router.refresh();
    });
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Delivery Control</p>
          <h2 className="section-title mt-1">Move Shipment by Real Events</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">Update transport events here. Delivered status requires proof and every change is retained in dispatch history.</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge value={dispatch.delivery_status} />
          <span className="text-xs font-semibold text-slate-500">Changed {formatDate(dispatch.last_status_changed_at)}</span>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-2">
          <span className="form-label">Proof of delivery {nextStatuses[dispatch.delivery_status].includes("delivered") ? "(required for delivery)" : ""}</span>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-navy px-4 py-2 text-sm font-black text-white transition hover:bg-navy/90 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
              <Upload className="h-4 w-4" />
              {uploading ? "Uploading..." : "Take photo or upload POD"}
              <input className="hidden" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" onChange={uploadProof} disabled={!canUpdate || isPending || uploading} />
            </label>
            {proofUrl ? <Button type="button" variant="secondary" onClick={openProof} disabled={uploading}><ExternalLink className="h-4 w-4" />View proof</Button> : null}
          </div>
          <input className="form-input" value={proofUrl} onChange={(event) => setProofUrl(event.target.value)} placeholder="Or paste an existing signed POD link" disabled={!canUpdate || isPending || uploading} />
          <p className="text-xs font-semibold text-slate-500">Photos and PDFs are stored privately under this company and dispatch.</p>
        </div>
        <label className="block space-y-1.5">
          <span className="form-label">Transport event remarks</span>
          <input className="form-input" value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="LR update, delay reason, damage, or receipt note" disabled={!canUpdate || isPending} />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        {nextStatuses[dispatch.delivery_status].map((status) => (
          <Button
            key={status}
            type="button"
            variant={["damaged", "returned"].includes(status) ? "danger" : status === "delivered" ? "primary" : "secondary"}
            onClick={() => transition(status)}
            disabled={!canUpdate || isPending || uploading}
          >
            {status === "delivered" ? <CheckCircle2 className="h-4 w-4" /> : null}
            {status === "damaged" || status === "delayed" ? <AlertTriangle className="h-4 w-4" /> : null}
            {status === "returned" ? <RotateCcw className="h-4 w-4" /> : null}
            {["dispatched", "in_transit"].includes(status) ? <Truck className="h-4 w-4" /> : null}
            {isPending ? "Saving..." : actionLabels[status]}
          </Button>
        ))}
      </div>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <h3 className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Recent movement history</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {history.slice(0, 6).map((item) => (
            <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-black text-slate-950">{item.from_status ? labelize(item.from_status) + " to " : ""}{labelize(item.to_status)}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">{formatDate(item.changed_at)}{item.remarks ? " - " + item.remarks : ""}</p>
            </div>
          ))}
          {!history.length ? <p className="text-sm font-semibold text-slate-500">No delivery movements have been logged yet.</p> : null}
        </div>
      </div>
    </section>
  );
}

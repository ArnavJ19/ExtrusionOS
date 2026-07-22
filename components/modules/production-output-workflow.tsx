"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CirclePause, Play, Scale } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  completeProductionJobAction,
  updateProductionJobStatusAction
} from "@/lib/actions/production";
import { formatWeight } from "@/lib/utils/format";

type ProductionFloorJob = {
  id: string;
  job_number: string;
  status: string;
  planned_quantity_kg: number | null;
  pieces: number | null;
  length_per_piece_m: number | null;
  actual_quantity_kg: number | null;
  actual_pieces: number | null;
  actual_meters: number | null;
  finishing_type: string | null;
  linked_billet_count: number;
  linked_billet_input_kg: number;
};

function routeLabel(finishingType: string | null) {
  if (!finishingType || finishingType === "mill_finish") return "QC release and packaging";
  return finishingType.replaceAll("_", " ") + " finishing, QC release, and packaging";
}

export function ProductionOutputWorkflow({
  job,
  canUpdate
}: {
  job: ProductionFloorJob;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actualWeight, setActualWeight] = useState("");
  const [actualPieces, setActualPieces] = useState("");
  const [actualMeters, setActualMeters] = useState("");
  const [scrapWeight, setScrapWeight] = useState("0");
  const [remarks, setRemarks] = useState("");

  const derivedMeters = Number(actualPieces || 0) * Number(job.length_per_piece_m || 0);
  const isTerminal = ["completed", "cancelled"].includes(job.status);

  function moveStatus(status: "ready" | "in_progress" | "on_hold") {
    startTransition(async () => {
      const result = await updateProductionJobStatusAction(job.id, status);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        status === "in_progress"
          ? "Production is now running"
          : status === "on_hold"
            ? "Production placed on hold"
            : "Production job marked ready"
      );
      router.refresh();
    });
  }

  function completeJob() {
    if (!window.confirm("Complete this production job with the entered actual output? A completed job cannot be reopened.")) {
      return;
    }
    startTransition(async () => {
      const result = await completeProductionJobAction({
        job_id: job.id,
        actual_weight_kg: Number(actualWeight),
        actual_pieces: Number(actualPieces || 0),
        actual_meters: actualMeters ? Number(actualMeters) : null,
        scrap_weight_kg: Number(scrapWeight || 0),
        remarks: remarks || null
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Production completed and routed to " + routeLabel(job.finishing_type));
      router.refresh();
    });
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Floor Actuals</p>
          <h2 className="section-title mt-1">Run and Complete Production</h2>
          <p className="mt-1 max-w-3xl text-sm font-medium text-slate-500">
            Capture real press output here. Completion consumes linked billets and creates the correct next queue for {routeLabel(job.finishing_type)}.
          </p>
        </div>
        <div className="grid min-w-52 gap-3 rounded-2xl bg-slate-100 px-4 py-3 text-right sm:grid-cols-2">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Planned output</p>
            <p className="mt-1 font-black text-slate-950">{formatWeight(job.planned_quantity_kg ?? 0)}</p>
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Linked billet input</p>
            <p className="mt-1 font-black text-slate-950">{formatWeight(job.linked_billet_input_kg)}</p>
            <p className="text-xs font-semibold text-slate-500">{job.linked_billet_count} billet{job.linked_billet_count === 1 ? "" : "s"}</p>
          </div>
        </div>
      </div>

      {isTerminal ? (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="inline-flex items-center gap-2 font-black text-slate-950">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            {job.status === "completed" ? "Production completed" : "Production cancelled"}
          </p>
          {job.status === "completed" ? (
            <div className="mt-3 grid gap-2 text-sm font-semibold text-slate-600 sm:grid-cols-3">
              <span>Actual weight: <b className="text-slate-950">{formatWeight(job.actual_quantity_kg ?? 0)}</b></span>
              <span>Actual pieces: <b className="text-slate-950">{job.actual_pieces ?? 0}</b></span>
              <span>Actual metres: <b className="text-slate-950">{Number(job.actual_meters ?? 0).toFixed(2)} m</b></span>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap gap-3">
            {job.status === "planned" ? (
              <Button type="button" onClick={() => moveStatus("ready")} disabled={!canUpdate || isPending}>
                Mark Ready
              </Button>
            ) : null}
            {["ready", "on_hold"].includes(job.status) ? (
              <Button type="button" onClick={() => moveStatus("in_progress")} disabled={!canUpdate || isPending}>
                <Play className="h-4 w-4" /> {job.status === "on_hold" ? "Resume Run" : "Start Run"}
              </Button>
            ) : null}
            {job.status === "in_progress" ? (
              <Button type="button" variant="secondary" onClick={() => moveStatus("on_hold")} disabled={!canUpdate || isPending}>
                <CirclePause className="h-4 w-4" /> Put On Hold
              </Button>
            ) : null}
          </div>

          {job.status === "planned" ? (
            <p className="mt-3 text-sm font-semibold text-amber-700">Assign an extrusion press before marking the job ready.</p>
          ) : null}

          {job.status === "in_progress" ? (
            <div className="mt-5 border-t border-slate-100 pt-5">
              <div className="flex items-center gap-2">
                <Scale className="h-5 w-5 text-orange" />
                <h3 className="font-black text-slate-950">Final output</h3>
              </div>
              {job.linked_billet_count > 0 ? (
                <p className="mt-2 text-sm font-semibold text-slate-600">
                  Good output plus process scrap must reconcile to {formatWeight(job.linked_billet_input_kg)} linked billet input within the production tolerance.
                </p>
              ) : (
                <p className="mt-2 text-sm font-semibold text-amber-700">No billets are linked. Jobs with a billet requirement cannot be completed until allocation is resolved.</p>
              )}
              <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                <label className="block space-y-1.5">
                  <span className="form-label">Good output kg *</span>
                  <input className="form-input" type="number" min="0.001" step="0.001" value={actualWeight} onChange={(event) => setActualWeight(event.target.value)} disabled={isPending} />
                </label>
                <label className="block space-y-1.5">
                  <span className="form-label">Actual pieces {Number(job.pieces ?? 0) > 0 ? "*" : ""}</span>
                  <input className="form-input" type="number" min="0" step="1" value={actualPieces} onChange={(event) => setActualPieces(event.target.value)} disabled={isPending} />
                </label>
                <label className="block space-y-1.5">
                  <span className="form-label">Actual metres</span>
                  <input className="form-input" type="number" min="0" step="0.01" value={actualMeters} onChange={(event) => setActualMeters(event.target.value)} placeholder={derivedMeters > 0 ? "Auto: " + derivedMeters.toFixed(2) : "Optional"} disabled={isPending} />
                </label>
                <label className="block space-y-1.5">
                  <span className="form-label">Process scrap kg</span>
                  <input className="form-input" type="number" min="0" step="0.001" value={scrapWeight} onChange={(event) => setScrapWeight(event.target.value)} disabled={isPending} />
                </label>
                <label className="block space-y-1.5 sm:col-span-2 xl:col-span-1">
                  <span className="form-label">Completion remarks</span>
                  <input className="form-input" value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Press or output exception" disabled={isPending} />
                </label>
              </div>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button type="button" onClick={completeJob} disabled={!canUpdate || isPending || !actualWeight || (Number(job.pieces ?? 0) > 0 && !actualPieces)}>
                  <CheckCircle2 className="h-4 w-4" /> {isPending ? "Completing..." : "Complete and Route Output"}
                </Button>
                <p className="text-xs font-semibold text-slate-500">This writes actuals, scrap, billet consumption, and the next workflow queue in one transaction.</p>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

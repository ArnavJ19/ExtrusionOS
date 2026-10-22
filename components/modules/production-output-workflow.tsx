"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CirclePause, Play, Scale } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  correctCompletedProductionOutputAction,
  updateProductionJobStatusAction
} from "@/lib/actions/production";
import { completeProductionJobWithScrapAction } from "@/lib/actions/production-completion";
import { PRODUCTION_SCRAP_CATEGORIES, type ProductionScrapCategory } from "@/lib/workflow/production-scrap";
import { formatWeight } from "@/lib/utils/format";
import { reconcileProcessMass } from "@/lib/calculations/production-performance";

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
  // Scrap already posted against the job (null when it could not be read); counted by the completion transaction.
  existing_scrap_kg?: number | null;
};

function routeLabel(finishingType: string | null) {
  if (!finishingType || finishingType === "mill_finish") return "QC release and packaging";
  return finishingType.replaceAll("_", " ") + " finishing, QC release, and packaging";
}

export function ProductionOutputWorkflow({
  job,
  canUpdate,
  canCorrect = false
}: {
  job: ProductionFloorJob;
  canUpdate: boolean;
  canCorrect?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actualWeight, setActualWeight] = useState("");
  const [actualPieces, setActualPieces] = useState("");
  const [actualMeters, setActualMeters] = useState("");
  const [scrapWeights, setScrapWeights] = useState<Record<ProductionScrapCategory, string>>(() =>
    Object.fromEntries(PRODUCTION_SCRAP_CATEGORIES.map((category) => [category.value, ""])) as Record<ProductionScrapCategory, string>);
  const [remarks, setRemarks] = useState("");
  const [correctedWeight, setCorrectedWeight] = useState(String(job.actual_quantity_kg ?? ""));
  const [correctedPieces, setCorrectedPieces] = useState(String(job.actual_pieces ?? ""));
  const [correctedMeters, setCorrectedMeters] = useState(String(job.actual_meters ?? ""));
  const [correctionReason, setCorrectionReason] = useState("");

  const derivedMeters = Number(actualPieces || 0) * Number(job.length_per_piece_m || 0);
  const totalScrap = PRODUCTION_SCRAP_CATEGORIES.reduce((sum, category) => sum + Number(scrapWeights[category.value] || 0), 0);
  const accountedKg = Number(actualWeight || 0) + totalScrap;
  // Mirrors the completion transaction: linked input against new output, new scrap and earlier scrap postings.
  const balancePreview = job.linked_billet_count > 0 && actualWeight && job.existing_scrap_kg != null
    ? reconcileProcessMass({ inputKg: job.linked_billet_input_kg, goodOutputKg: actualWeight, scrapKg: totalScrap + job.existing_scrap_kg })
    : { status: "not_captured" as const };
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
      const result = await completeProductionJobWithScrapAction({
        job_id: job.id,
        actual_weight_kg: Number(actualWeight),
        actual_pieces: Number(actualPieces || 0),
        actual_meters: actualMeters ? Number(actualMeters) : null,
        scrap_lines: PRODUCTION_SCRAP_CATEGORIES.map((category) => ({ category: category.value, weight_kg: Number(scrapWeights[category.value] || 0) })),
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

  function correctOutput() {
    if (!window.confirm("Save this audited correction to completed production output? Downstream work must still be untouched.")) return;
    startTransition(async () => {
      const result = await correctCompletedProductionOutputAction({
        job_id: job.id,
        actual_weight_kg: Number(correctedWeight),
        actual_pieces: Number(correctedPieces || 0),
        actual_meters: Number(correctedMeters || 0),
        reason: correctionReason
      });
      if (!result.success) { toast.error(result.error); return; }
      toast.success("Output correction recorded and pending handoffs reconciled.");
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
          {job.status === "completed" && canCorrect ? (
            <div className="mt-4 border-t border-slate-200 pt-4">
              <p className="text-sm font-bold text-slate-800">Audited output correction</p>
              <p className="mt-1 text-xs text-slate-500">Available only before QC disposition, finishing start, packaging issue, or dispatch. Input plus scrap must still reconcile.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <input aria-label="Corrected output kilograms" className="form-input" type="number" min="0.001" step="0.001" value={correctedWeight} onChange={(event) => setCorrectedWeight(event.target.value)} />
                <input aria-label="Corrected output pieces" className="form-input" type="number" min="0" step="1" value={correctedPieces} onChange={(event) => setCorrectedPieces(event.target.value)} />
                <input aria-label="Corrected output metres" className="form-input" type="number" min="0" step="0.001" value={correctedMeters} onChange={(event) => setCorrectedMeters(event.target.value)} />
                <input aria-label="Correction reason" className="form-input" minLength={8} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Reason (at least 8 characters)" />
              </div>
              <Button type="button" className="mt-3" variant="secondary" onClick={correctOutput} disabled={isPending || !correctedWeight || correctionReason.trim().length < 8}>Record audited correction</Button>
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
                <p className="mt-2 text-sm font-semibold text-amber-700">No billets are issued to this job. Issue the linked billets, or have a manager record an input exception below, before completing.</p>
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
                <label className="block space-y-1.5 sm:col-span-2 xl:col-span-1">
                  <span className="form-label">Completion remarks</span>
                  <input className="form-input" value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Press or output exception" disabled={isPending} />
                </label>
              </div>
              <div className="mt-4 rounded-2xl border border-slate-200 p-4">
                <p className="text-sm font-black text-slate-950">Weighed scrap by category</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">Butt end, front/back end, saw cut and press rejects go to the furnace scrap store with this job&apos;s alloy. Unrecoverable loss is reported only.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  {PRODUCTION_SCRAP_CATEGORIES.map((category) => (
                    <label key={category.value} className="block space-y-1.5">
                      <span className="form-label">{category.label}</span>
                      <input className="form-input" type="number" min="0" step="0.001" value={scrapWeights[category.value]} onChange={(event) => setScrapWeights({ ...scrapWeights, [category.value]: event.target.value })} disabled={isPending} />
                    </label>
                  ))}
                </div>
                <p className="mt-3 text-xs font-bold text-slate-600">Output {formatWeight(Number(actualWeight || 0))} + scrap {formatWeight(totalScrap)} = {formatWeight(accountedKg)}{job.linked_billet_count > 0 ? ` against ${formatWeight(job.linked_billet_input_kg)} billet input` : ""}</p>
                {balancePreview.status !== "not_captured" ? (
                  <p role="status" className={`mt-1 text-xs font-bold ${balancePreview.withinTolerance ? "text-emerald-700" : "text-amber-700"}`}>
                    {balancePreview.status === "balanced"
                      ? "Input fully accounted."
                      : `${formatWeight(Math.abs(balancePreview.differenceKg))} ${balancePreview.status === "unaccounted" ? "unaccounted" : "more than the linked input, including earlier scrap postings"}. `}
                    {balancePreview.status === "balanced"
                      ? null
                      : balancePreview.withinTolerance
                        ? `Within the ${formatWeight(balancePreview.toleranceKg)} completion tolerance; the difference stays visible on the job.`
                        : `Outside the ${formatWeight(balancePreview.toleranceKg)} completion tolerance, so completion will be rejected. Recheck the weighed output and scrap.`}
                  </p>
                ) : null}
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

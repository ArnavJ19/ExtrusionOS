"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { diePreparationAction } from "@/lib/actions/orchestration";
import { floorText, type FloorKey, type FloorLanguage } from "@/lib/i18n/floor";
import { DIE_CHECKS, nextPrepSteps, type DieCheck, type PrepDetail } from "@/lib/workflow/orchestration";

const input = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
const localNow = () => { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };

/** The tool room records each die step with its evidence; the database checks the order of steps and the preheat standard. */
export function DiePrepActions({ prep, canCancel, lang = "en" }: { prep: PrepDetail; canCancel: boolean; lang?: FloorLanguage }) {
  const router = useRouter();
  const t = floorText(lang);
  const steps = nextPrepSteps(prep.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checks, setChecks] = useState<Record<DieCheck, boolean>>(() => Object.fromEntries(Object.keys(DIE_CHECKS).map(k => [k, false])) as Record<DieCheck, boolean>);
  const [note, setNote] = useState("");
  const [when, setWhen] = useState(localNow());
  const [oven, setOven] = useState("");
  const [temperature, setTemperature] = useState("");
  const [soak, setSoak] = useState("");
  const [condition, setCondition] = useState("");
  const [reason, setReason] = useState("");

  async function run(payload: Record<string, unknown>) {
    setBusy(true); setError("");
    const result = await diePreparationAction({ id: prep.id, ...payload });
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    setNote(""); router.refresh();
  }
  if (!prep.can_write) return <p className="text-sm text-slate-600">{t("olo.dpa.noWrite")}</p>;

  return (
    <div className="space-y-4">
      {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-900">{error}</p> : null}
      {steps.includes("prep.check") ? (
        <form className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4" onSubmit={e => { e.preventDefault(); run({ command: "prep.check", results: checks, note: note || undefined }); }}>
          <h3 className="font-bold">{t("olo.dpa.checkTitle")}</h3>
          <p className="text-xs text-slate-600">{t("olo.dpa.checkHelp")}</p>
          {(Object.keys(DIE_CHECKS) as DieCheck[]).map(key => (
            <label key={key} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={checks[key]} onChange={e => setChecks({ ...checks, [key]: e.target.checked })} />{t(`olo.check.${key}` as FloorKey)}</label>
          ))}
          <label className="block text-sm font-semibold">{t("olo.dpa.findings")}<textarea className={input} rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></label>
          <Button disabled={busy}>{t("olo.dpa.recordCheck")}</Button>
        </form>
      ) : null}
      {steps.includes("prep.start") ? <Button variant="secondary" disabled={busy} onClick={() => run({ command: "prep.start" })}>{t("olo.dpa.startPrep")}</Button> : null}
      {steps.includes("prep.prepared") ? (
        <form className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4" onSubmit={e => { e.preventDefault(); run({ command: "prep.prepared", note }); }}>
          <h3 className="font-bold">{t("olo.dpa.preparedTitle")}</h3>
          <label className="block text-sm font-semibold">{t("olo.dpa.whatDone")}<textarea required minLength={5} className={input} rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder={t("olo.dpa.whatDoneHint")} /></label>
          <Button disabled={busy}>{t("olo.dpa.markPrepared")}</Button>
        </form>
      ) : null}
      {steps.includes("prep.schedule_preheat") ? (
        <form className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4" onSubmit={e => { e.preventDefault(); run({ command: "prep.schedule_preheat", scheduled_for: new Date(when).toISOString() }); }}>
          <h3 className="font-bold">{t(prep.status === "ready" ? "olo.dpa.reheat" : "olo.dpa.schedule")}</h3>
          {prep.planned_start_at ? <p className="text-xs text-slate-600">{t("olo.dpa.runStart", { at: new Date(prep.planned_start_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) })}</p> : null}
          {prep.standard ? <p className="text-xs text-slate-600">{t("olo.dpa.standard", { sop: prep.standard.sop_reference, min: prep.standard.min_temperature_c, max: prep.standard.max_temperature_c, soak: prep.standard.min_soak_minutes, hold: prep.standard.max_hold_minutes })}</p>
            : <p className="text-xs font-semibold text-amber-900">{t("olo.dpa.noStandard")}</p>}
          <label className="block text-sm font-semibold">{t("olo.dpa.preheatStart")}<input type="datetime-local" required className={input} value={when} onChange={e => setWhen(e.target.value)} /></label>
          <Button disabled={busy || !prep.standard}>{t("olo.dpa.schedulePreheat")}</Button>
        </form>
      ) : null}
      {steps.includes("prep.start_preheat") ? (
        <form className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4" onSubmit={e => { e.preventDefault(); run({ command: "prep.start_preheat", oven_reference: oven }); }}>
          <h3 className="font-bold">{t("olo.dpa.startTitle")}</h3>
          <label className="block text-sm font-semibold">{t("olo.dpa.oven")}<input required maxLength={60} className={input} value={oven} onChange={e => setOven(e.target.value)} /></label>
          <Button disabled={busy}>{t("olo.dpa.startPreheat")}</Button>
        </form>
      ) : null}
      {steps.includes("prep.complete_preheat") ? (
        <form className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4" onSubmit={e => { e.preventDefault(); run({ command: "prep.complete_preheat", temperature_c: Number(temperature), soak_minutes: Number(soak) }); }}>
          <h3 className="font-bold">{t("olo.dpa.completeTitle")}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold">{t("olo.dpa.temp")}<input required inputMode="decimal" className={input} value={temperature} onChange={e => setTemperature(e.target.value)} /></label>
            <label className="block text-sm font-semibold">{t("olo.dpa.soak")}<input required inputMode="numeric" className={input} value={soak} onChange={e => setSoak(e.target.value)} /></label>
          </div>
          <Button disabled={busy}>{t("olo.dpa.recordComplete")}</Button>
        </form>
      ) : null}
      {steps.includes("prep.return") ? (
        <form className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4" onSubmit={e => { e.preventDefault(); run({ command: "prep.return", condition }); }}>
          <h3 className="font-bold">{t("olo.dpa.returnTitle")}</h3>
          <label className="block text-sm font-semibold">{t("olo.dpa.condition")}<textarea required minLength={5} maxLength={300} className={input} rows={2} value={condition} onChange={e => setCondition(e.target.value)} /></label>
          <Button disabled={busy}>{t("olo.dpa.recordReturn")}</Button>
        </form>
      ) : null}
      {canCancel && !["issued", "returned", "cancelled"].includes(prep.status) ? (
        <details className="rounded-2xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-bold">{t("olo.dpa.cancelTitle")}</summary>
          <form className="mt-2 space-y-2" onSubmit={e => { e.preventDefault(); run({ command: "prep.cancel", reason }); }}>
            <label className="block text-sm font-semibold">{t("olo.dpa.reason")}<textarea required minLength={5} maxLength={300} className={input} rows={2} value={reason} onChange={e => setReason(e.target.value)} /></label>
            <Button variant="danger" disabled={busy}>{t("olo.dpa.cancel")}</Button>
          </form>
        </details>
      ) : null}
    </div>
  );
}

export function OpenPrepButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button variant="secondary" disabled={busy} onClick={async () => {
        setBusy(true); setError("");
        const result = await diePreparationAction({ command: "prep.open", job_id: jobId });
        setBusy(false);
        if (!result.success) { setError(result.error); return; }
        router.push(`/dies/preparation/${(result.data as { id: string }).id}`);
      }}>Open die preparation</Button>
      {error ? <span role="alert" className="text-xs font-semibold text-red-800">{error}</span> : null}
    </span>
  );
}

"use client";

// Orchestration Phase 5: QA records the final QC of material that came out of ageing. The database checks the quantity
// waiting, the profile minimums and the first-stage approval, and reverses the rejected kilograms; this form only
// collects the results and the decision.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { finalQcAction } from "@/lib/actions/orchestration";
import { floorText, type FloorKey, type FloorLanguage } from "@/lib/i18n/floor";
import { FINAL_QC_NUMBER_RESULTS, acceptableKg, belowSpec, collectResults, finalQcResultsSchema, type FinalQcCheck, type FinalQcJob } from "@/lib/workflow/final-qc";

const input = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
const NUMBER_LABELS: Record<(typeof FINAL_QC_NUMBER_RESULTS)[number], FloorKey> = {
  hardness_webster: "fqc.form.hardnessWebster", hardness_hb: "fqc.form.hardnessHb", tensile_strength_mpa: "fqc.form.tensile",
  yield_strength_mpa: "fqc.form.yield", elongation_percent: "fqc.form.elongation", conductivity_ms_m: "fqc.form.conductivity"
};
type Check = FinalQcCheck;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function FinalQcForm({ job, lang = "en" }: { job: FinalQcJob; lang?: FloorLanguage }) {
  const router = useRouter();
  const t = floorText(lang);
  const maxAccept = round3(acceptableKg(job));
  const total = round3(job.awaiting_final_kg);
  const [v, setV] = useState({ accepted_kg: String(maxAccept), rejected_kg: "0", samples: "", method: "", sampling_reference: "", certificate_reference: "", temper_verified: "", rejection_reason: "", note: "" });
  const [values, setValues] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<{ dimensional: Check; surface: Check }>({ dimensional: "", surface: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const results = collectResults(values, checks, v.samples);
  const failing = belowSpec(results, job.spec);
  const accepted = Number(v.accepted_kg);
  const rejected = Number(v.rejected_kg || "0");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(accepted) || !Number.isFinite(rejected) || accepted < 0 || rejected < 0 || accepted > maxAccept + 0.0005 || accepted + rejected > total + 0.0005 || accepted + rejected <= 0) {
      setError(t("fqc.form.kgRange", { max: maxAccept, total })); return;
    }
    if (!finalQcResultsSchema.safeParse(results).success) { setError(t("fqc.form.needResult")); return; }
    if (rejected > 0 && v.rejection_reason.trim().length < 10) { setError(t("fqc.form.needReason")); return; }
    setBusy(true); setError(null);
    const optional = (key: "certificate_reference" | "temper_verified" | "note") => (v[key].trim() ? { [key]: v[key].trim() } : {});
    const result = await finalQcAction({ command: "record", job_id: job.job_id, accepted_kg: accepted, rejected_kg: rejected, results, method: v.method, sampling_reference: v.sampling_reference,
      ...optional("certificate_reference"), ...optional("temper_verified"), ...optional("note"), ...(rejected > 0 ? { rejection_reason: v.rejection_reason.trim() } : {}) });
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    router.refresh();
  }
  const set = (key: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [key]: e.target.value });
  const checkSelect = (key: "dimensional" | "surface", label: FloorKey) => (
    <label className="text-sm font-semibold">{t(label)}
      <select className={input} value={checks[key]} onChange={e => setChecks({ ...checks, [key]: e.target.value as Check })}>
        <option value="">{t("fqc.form.notChecked")}</option><option value="passed">{t("fqc.form.passed")}</option><option value="failed">{t("fqc.form.failed")}</option></select></label>
  );
  return (
    <form className="space-y-3 rounded-2xl border border-slate-300 bg-white p-4" onSubmit={submit} lang={lang}>
      <h2 className="text-lg font-bold">{t("fqc.form.title")}</h2>
      <p className="text-xs text-slate-600">{t("fqc.form.help")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">{t("fqc.form.accepted", { max: maxAccept })}
          <input required inputMode="decimal" className={input} value={v.accepted_kg} onChange={set("accepted_kg")} /></label>
        <label className="text-sm font-semibold">{t("fqc.form.rejected", { max: total })}
          <input inputMode="decimal" className={input} value={v.rejected_kg} onChange={set("rejected_kg")} /></label>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-bold">{t("fqc.form.results")}</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FINAL_QC_NUMBER_RESULTS.map(key => <label key={key} className="text-sm font-semibold">{t(NUMBER_LABELS[key])}
            <input inputMode="decimal" className={input} value={values[key] ?? ""} onChange={e => setValues({ ...values, [key]: e.target.value })} /></label>)}
          <label className="text-sm font-semibold">{t("fqc.form.samples")}
            <input required inputMode="numeric" className={input} value={v.samples} onChange={set("samples")} /></label>
          {checkSelect("dimensional", "fqc.form.dimensional")}
          {checkSelect("surface", "fqc.form.surface")}
        </div>
      </fieldset>
      {failing.length && accepted > 0 ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-950">{t("fqc.form.belowSpec")}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">{t("fqc.form.method")}
          <input required minLength={2} maxLength={120} className={input} value={v.method} onChange={set("method")} placeholder={t("fqc.form.methodHint")} /></label>
        <label className="text-sm font-semibold">{t("fqc.form.sampling")}
          <input required minLength={2} maxLength={120} className={input} value={v.sampling_reference} onChange={set("sampling_reference")} placeholder={t("fqc.form.samplingHint")} /></label>
        <label className="text-sm font-semibold">{t("fqc.form.certificate")}
          <input maxLength={80} className={input} value={v.certificate_reference} onChange={set("certificate_reference")} /></label>
        <label className="text-sm font-semibold">{t("fqc.form.temper")}
          <input maxLength={10} className={input} value={v.temper_verified} onChange={set("temper_verified")} placeholder={job.temper ?? ""} /></label>
      </div>
      {rejected > 0 ? <label className="block text-sm font-semibold">{t("fqc.form.reason")}
        <textarea required minLength={10} maxLength={500} rows={3} className={input} value={v.rejection_reason} onChange={set("rejection_reason")} /></label> : null}
      <label className="block text-sm font-semibold">{t("fqc.form.note")}
        <textarea maxLength={500} rows={2} className={input} value={v.note} onChange={set("note")} /></label>
      <Button disabled={busy || total <= 0}>{t("fqc.form.submit")}</Button>
      {error ? <p role="alert" className="text-sm font-semibold text-red-800">{error}</p> : null}
    </form>
  );
}

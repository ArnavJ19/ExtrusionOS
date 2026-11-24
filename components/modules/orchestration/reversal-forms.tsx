"use client";

// Orchestration Phase 4: QA reverses an earlier QC approval. The database refuses anything already moved on, checks the
// containment state and writes the child records; this form only collects the decision and its evidence.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { qualityReversalAction } from "@/lib/actions/orchestration";
import { floorText, type FloorLanguage } from "@/lib/i18n/floor";
import { reversibleKg, type ReversalPreview } from "@/lib/workflow/quality-reversal";

const input = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";

export function ReversalForm({ preview, lang = "en" }: { preview: ReversalPreview; lang?: FloorLanguage }) {
  const router = useRouter();
  const t = floorText(lang);
  const max = reversibleKg(preview);
  const [v, setV] = useState({ reversed_kg: String(max), reversed_as: "rejected", method: "", reason: "", reference: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kg = Number(v.reversed_kg);
  const retained = Number.isFinite(kg) ? Math.max(0, Math.round((preview.quantity_kg - kg) * 1000) / 1000) : null;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(kg) || kg <= 0 || kg > max + 0.0005) { setError(t("olo.rev.kgRange", { max })); return; }
    setBusy(true); setError(null);
    const result = await qualityReversalAction({ command: "reverse", inspection_id: preview.inspection_id, reversed_kg: kg, reversed_as: v.reversed_as, method: v.method, reason: v.reason,
      ...(v.reference.trim() ? { reference: v.reference.trim() } : {}) });
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    router.push(`/quality/reversals/${(result.data as { id: string }).id}`);
    router.refresh();
  }
  return (
    <form className="space-y-3 rounded-2xl border border-red-200 bg-white p-4" onSubmit={submit} lang={lang}>
      <h2 className="text-lg font-bold">{t("olo.rev.formTitle")}</h2>
      <p className="text-xs text-slate-600">{t("olo.rev.formHelp")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">{t("olo.rev.kg", { max })}
          <input required inputMode="decimal" className={input} value={v.reversed_kg} onChange={e => setV({ ...v, reversed_kg: e.target.value })} /></label>
        <label className="text-sm font-semibold">{t("olo.rev.as")}
          <select className={input} value={v.reversed_as} onChange={e => setV({ ...v, reversed_as: e.target.value })}>
            <option value="rejected">{t("olo.rev.as.rejected")}</option><option value="rework">{t("olo.rev.as.rework")}</option></select></label>
        <label className="text-sm font-semibold">{t("olo.rev.method")}
          <input required minLength={2} maxLength={120} className={input} value={v.method} onChange={e => setV({ ...v, method: e.target.value })} placeholder={t("olo.rev.methodHint")} /></label>
        <label className="text-sm font-semibold">{t("olo.rev.reference")}
          <input maxLength={80} className={input} value={v.reference} onChange={e => setV({ ...v, reference: e.target.value })} placeholder={t("olo.rev.referenceHint")} /></label>
      </div>
      <label className="block text-sm font-semibold">{t("olo.rev.reason")}
        <textarea required minLength={10} maxLength={500} rows={3} className={input} value={v.reason} onChange={e => setV({ ...v, reason: e.target.value })} /></label>
      {retained !== null && retained > 0 ? <p className="text-sm font-semibold text-slate-800">{t("olo.rev.retains", { kg: retained })}</p> : null}
      <Button variant="danger" disabled={busy || max <= 0}>{t("olo.rev.submit")}</Button>
      {error ? <p role="alert" className="text-sm font-semibold text-red-800">{error}</p> : null}
    </form>
  );
}

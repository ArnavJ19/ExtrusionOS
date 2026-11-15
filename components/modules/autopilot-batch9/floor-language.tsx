"use client";

// AP-095: English / Hindi switch on shop-floor screens. The choice is saved per person on the server (it follows the
// operator to any workstation) and the screen re-renders with the other labels; record values never change. It saves
// through /api/floor-language with fetch, so no server module reaches the floor screens' browser bundles.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FLOOR_LANGUAGES, floorText, type FloorLanguage } from "@/lib/i18n/floor";

export function FloorLanguageToggle({ lang, dark = false }: { lang: FloorLanguage; dark?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const t = floorText(lang);
  async function choose(next: FloorLanguage) {
    if (next === lang || busy) return;
    setBusy(true); setError(null);
    let out: { success: boolean; error?: string };
    try {
      const response = await fetch("/api/floor-language", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language: next }) });
      out = await response.json() as { success: boolean; error?: string };
    } catch { out = { success: false, error: "The language could not be saved. Check the connection." }; }
    setBusy(false);
    if (!out.success) { setError(out.error ?? "The language could not be saved."); return; }
    router.refresh();
  }
  const base = dark ? "border-white/30 text-white" : "border-neutral-300 text-neutral-800";
  return <div className="flex flex-col items-end gap-1">
    <div role="group" aria-label={t("lang.label")} className={`flex rounded-xl border p-1 text-sm font-bold ${base}`}>
      {(Object.keys(FLOOR_LANGUAGES) as FloorLanguage[]).map(value => <button key={value} type="button" lang={value} aria-pressed={lang === value} disabled={busy} onClick={() => void choose(value)}
        className={`min-h-10 rounded-lg px-3 ${lang === value ? (dark ? "bg-white text-slate-950" : "bg-neutral-950 text-white") : ""}`}>{FLOOR_LANGUAGES[value]}</button>)}
    </div>
    {error ? <p role="alert" className={`text-xs ${dark ? "text-amber-200" : "text-amber-800"}`}>{error}</p> : null}
  </div>;
}

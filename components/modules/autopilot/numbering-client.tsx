"use client";

// AP-005: financial-year number series. Accounts confirms a format once (usually by accepting the prepared proposal);
// from then on every new document of that type takes the next number of its financial year.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { autopilotAction } from "@/lib/actions/autopilot";
import { DOCUMENT_SERIES, checkSeriesTemplate, seriesConfirmSchema, type DocumentSeriesKey, type SeriesList } from "@/lib/numbering/financial-year";

export function NumberingClient({ initial, today }: { initial: SeriesList; today: string }) {
  const router = useRouter();
  const [doc, setDoc] = useState<DocumentSeriesKey>("invoices");
  const [template, setTemplate] = useState<string>(DOCUMENT_SERIES.invoices.suggested);
  const [pad, setPad] = useState("4");
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);
  const check = checkSeriesTemplate(doc, template, Number(pad) || 0, today);
  const active = new Map(initial.series.filter(row => row.status === "active").map(row => [row.doc_key, row]));

  async function confirm() {
    const parsed = seriesConfirmSchema.safeParse({ doc_key: doc, prefix_template: template, pad_width: Number(pad) });
    if (!parsed.success || !check.ok) return setMessage({ text: !check.ok ? check.message : parsed.error?.issues[0]?.message ?? "Check the format", tone: "error" });
    setBusy(true);
    const result = await autopilotAction("ap_series", "confirm", parsed.data);
    setBusy(false);
    setMessage(result.success ? { text: `${DOCUMENT_SERIES[doc].label} now number as ${check.example}, ${check.example.replace(/\d+$/, m => String(Number(m) + 1).padStart(m.length, "0"))} …`, tone: "ok" } : { text: result.error, tone: "error" });
    if (result.success) router.refresh();
  }

  return <div className="space-y-4">
    <section className="min-w-0 rounded-2xl border border-neutral-200 bg-white p-4">
      <h2 className="text-lg font-bold">Series in use · financial year {initial.fy}</h2>
      <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-neutral-500"><th className="py-2 pr-3">Document</th><th className="pr-3">Format</th><th className="pr-3">Next number</th><th className="pr-3">Issued this year</th><th>Confirmed</th></tr></thead>
        <tbody>{(Object.keys(DOCUMENT_SERIES) as DocumentSeriesKey[]).map(key => { const row = active.get(key); return <tr key={key} className="border-b">
          <td className="py-2 pr-3 font-semibold">{DOCUMENT_SERIES[key].label}{DOCUMENT_SERIES[key].gapFree ? <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-xs">gap-free</span> : null}</td>
          <td className="pr-3 font-mono">{row ? `${row.prefix_template} + ${row.pad_width} digits` : <span className="font-sans text-neutral-600">Calendar-year numbering (not yet confirmed)</span>}</td>
          <td className="pr-3 font-mono">{row?.next_example ?? "-"}</td><td className="pr-3">{row?.issued_this_year ?? "-"}</td>
          <td>{row ? `${row.confirmed_by ?? ""}, ${new Date(row.confirmed_at).toLocaleDateString("en-IN")}` : "-"}</td></tr>; })}</tbody></table></div>
      <p className="mt-3 text-xs text-neutral-600">Numbers already issued are never changed. A number is taken inside the posting itself, so two invoices posted together get consecutive numbers and a failed posting does not leave a gap. Cancelled tax documents keep their number.</p>
    </section>
    {initial.can_confirm ? <section className="min-w-0 space-y-3 rounded-2xl border border-neutral-200 bg-white p-4">
      <h2 className="text-lg font-bold">Confirm a format directly</h2>
      {message ? <p role={message.tone === "error" ? "alert" : "status"} className={`rounded-xl p-3 text-sm font-semibold ${message.tone === "error" ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>{message.text}</p> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-semibold">Document<select className="mt-1 block h-11 w-full rounded-xl border border-neutral-300 bg-white px-2" value={doc} onChange={event => { const key = event.target.value as DocumentSeriesKey; setDoc(key); setTemplate(DOCUMENT_SERIES[key].suggested); }}>
          {(Object.keys(DOCUMENT_SERIES) as DocumentSeriesKey[]).map(key => <option key={key} value={key}>{DOCUMENT_SERIES[key].label}</option>)}</select></label>
        <label className="text-sm font-semibold">Format<input className="mt-1 block h-11 w-full rounded-xl border border-neutral-300 px-3 font-mono uppercase" value={template} onChange={event => setTemplate(event.target.value.toUpperCase())} /></label>
        <label className="text-sm font-semibold">Digits<input inputMode="numeric" className="mt-1 block h-11 w-full rounded-xl border border-neutral-300 px-3" value={pad} onChange={event => setPad(event.target.value.replace(/\D/g, ""))} /></label>
      </div>
      <p className={`text-sm ${check.ok ? "text-neutral-700" : "font-semibold text-rose-700"}`}>{check.ok ? `First number this year: ${check.example}. Longest: ${check.longest} (${check.longest.length} characters).` : check.message}</p>
      <button type="button" disabled={busy || !check.ok} onClick={confirm} className="min-h-11 rounded-xl bg-neutral-950 px-4 text-sm font-bold text-white disabled:opacity-50">Confirm this series</button>
    </section> : <p className="text-sm text-neutral-600">Accounts, the owner or an admin confirm number series.</p>}
  </div>;
}

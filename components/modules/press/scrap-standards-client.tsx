"use client";

// AP-013: engineering scrap standards (butt, crops, saw kerf, density) proposed by production, approved by the owner and
// versioned per company, press or die; and the monthly reconciliation of derived scrap against scrap-yard weighings.
import { useCallback, useEffect, useState } from "react";
import { autopilotAction } from "@/lib/actions/autopilot";
import { fmtKg, fmtTime } from "@/lib/press/types";
import { percent } from "@/lib/press/press-floor";
import { NumericField } from "@/components/ui/numeric-field";
import { parseKeypadValue } from "@/lib/forms/numeric-keypad";

type Standard = { id: string; version: number; status: "proposed" | "approved" | "retired"; scope: string; scope_label: string; butt_length_mm: number; front_crop_mm: number; back_crop_mm: number;
  saw_kerf_mm: number; density_kg_m3: number; default_billet_length_mm: number | null; rationale: string; proposed_by_name: string | null; approved_by_name: string | null; proposed_at: string; approved_at: string | null };
type List = { total_count: number; page: number; can_propose: boolean; can_approve: boolean; rows: Standard[] };
type Reconcile = { month: string; derived_engineering_kg: number; derived_process_kg: number; jobs_derived: number; entered_kg: number; weighed_kg: number | null;
  weighings: { id: string; weighed_kg: number; reference: string | null; recorded_at: string; recorded_by: string | null }[] };

const thisMonth = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);

export function ScrapStandardsClient({ presses, canWeigh }: { presses: { id: string; name: string }[]; canWeigh: boolean }) {
  const [list, setList] = useState<List | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ scope: "", butt: "", front: "", back: "", kerf: "", density: "2700", billet: "", rationale: "" });
  const [month, setMonth] = useState(thisMonth());
  const [rec, setRec] = useState<Reconcile | null>(null);
  const [weigh, setWeigh] = useState({ kg: "", reference: "" });

  const load = useCallback(async () => {
    const result = await autopilotAction("ap_scrap", "list", { page });
    if (!result.success) { setError(result.error); return; }
    setError(null); setList(result.data as List);
  }, [page]);
  const loadRec = useCallback(async () => {
    const result = await autopilotAction("ap_scrap", "reconcile", { month });
    if (result.success) setRec(result.data as Reconcile); else setMessage(result.error);
  }, [month]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadRec(); }, [loadRec]);

  async function propose() {
    const n = (value: string) => parseKeypadValue(value);
    const payload: Record<string, unknown> = { butt_length_mm: n(form.butt), front_crop_mm: n(form.front), back_crop_mm: n(form.back), saw_kerf_mm: n(form.kerf), rationale: form.rationale.trim() };
    if (Object.values(payload).some(value => value === null)) { setMessage("Enter butt length, both crops and the saw kerf."); return; }
    if (n(form.density) !== null) payload.density_kg_m3 = n(form.density);
    if (n(form.billet) !== null) payload.default_billet_length_mm = n(form.billet);
    if (form.scope.startsWith("press:")) payload.machine_id = form.scope.slice(6);
    const result = await autopilotAction("ap_scrap", "propose", payload);
    setMessage(result.success ? "Standard proposed. The owner approves it before it is used." : result.error);
    if (result.success) setForm({ scope: "", butt: "", front: "", back: "", kerf: "", density: "2700", billet: "", rationale: "" });
    await load();
  }
  async function decide(id: string, command: "approve" | "retire") {
    const result = await autopilotAction("ap_scrap", command, { id });
    setMessage(result.success ? (command === "approve" ? "Approved. New expected output uses this version; the previous one is retired." : "Retired.") : result.error);
    await load();
  }
  async function saveWeighing() {
    const kg = parseKeypadValue(weigh.kg);
    if (!kg) { setMessage("Enter the weighed kg."); return; }
    const result = await autopilotAction("ap_scrap", "weigh", { month, weighed_kg: kg, ...(weigh.reference.trim() ? { reference: weigh.reference.trim() } : {}) });
    setMessage(result.success ? "Weighing recorded." : result.error);
    if (result.success) setWeigh({ kg: "", reference: "" });
    await loadRec();
  }
  const derived = rec ? Number(rec.derived_engineering_kg) + Number(rec.derived_process_kg) : null;
  const diff = rec && rec.weighed_kg !== null && derived !== null ? Number(rec.weighed_kg) - derived : null;
  const pages = Math.max(1, Math.ceil((list?.total_count ?? 0) / 10));

  return <div className="min-w-0 space-y-6">
    {message ? <p role="status" className="rounded-xl bg-neutral-100 p-3 text-sm font-semibold">{message}</p> : null}
    <section aria-labelledby="standards" className="space-y-3 rounded-2xl border bg-white p-4 sm:p-5">
      <div><h2 id="standards" className="text-lg font-bold">Standards</h2><p className="text-sm text-neutral-600">A die standard beats a press standard, which beats the company default. Each approval is a new version; jobs record which version they used.</p></div>
      {error ? <p role="alert" className="text-sm text-amber-900">{error}</p> : !list ? <p role="status" className="text-sm">Loading…</p> : !list.rows.length
        ? <p className="rounded-xl border border-dashed p-3 text-sm text-neutral-600">No standard yet. Without an approved standard, expected output and engineering scrap stay blank.</p>
        : <ul className="space-y-2">{list.rows.map(row => <li key={row.id} className="rounded-xl border p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold">{row.scope_label} · v{row.version}</p>
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${row.status === "approved" ? "bg-emerald-50 text-emerald-800" : row.status === "proposed" ? "bg-sky-50 text-sky-800" : "bg-neutral-100 text-neutral-600"}`}>{row.status}</span></div>
          <p className="mt-1 tabular-nums">Butt {row.butt_length_mm} mm · crops {row.front_crop_mm} + {row.back_crop_mm} mm · kerf {row.saw_kerf_mm} mm · {row.density_kg_m3} kg/m³{row.default_billet_length_mm ? ` · billet ${row.default_billet_length_mm} mm (for estimates)` : ""}</p>
          <p className="text-xs text-neutral-600">{row.rationale} · proposed by {row.proposed_by_name ?? "—"} {fmtTime(row.proposed_at)}{row.approved_by_name ? ` · approved by ${row.approved_by_name}` : ""}</p>
          {list.can_approve && row.status !== "retired" ? <div className="mt-2 flex gap-2">{row.status === "proposed" ? <button type="button" onClick={() => decide(row.id, "approve")} className="min-h-10 rounded-lg bg-neutral-950 px-3 font-bold text-white">Approve</button> : null}
            <button type="button" onClick={() => decide(row.id, "retire")} className="min-h-10 rounded-lg border px-3 font-bold">Retire</button></div> : null}
        </li>)}</ul>}
      {pages > 1 ? <nav aria-label="Standard pages" className="flex items-center justify-between text-sm"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="min-h-10 rounded-lg border px-3 disabled:opacity-40">Previous</button><span>Page {page} of {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="min-h-10 rounded-lg border px-3 disabled:opacity-40">Next</button></nav> : null}
    </section>
    {list?.can_propose ? <section aria-labelledby="propose" className="space-y-3 rounded-2xl border bg-white p-4 sm:p-5">
      <h2 id="propose" className="text-lg font-bold">Propose a standard</h2>
      <label className="block max-w-sm text-sm font-semibold">Applies to<select className="mt-1 h-11 w-full rounded-xl border px-3" value={form.scope} onChange={event => setForm({ ...form, scope: event.target.value })}>
        <option value="">All presses (company default)</option>{presses.map(press => <option key={press.id} value={`press:${press.id}`}>{press.name}</option>)}</select></label>
      <div className="grid gap-3 sm:grid-cols-3">
        <NumericField label="Butt length" unit="mm" value={form.butt} onChange={value => setForm({ ...form, butt: value })} />
        <NumericField label="Front crop" unit="mm" value={form.front} onChange={value => setForm({ ...form, front: value })} />
        <NumericField label="Back crop" unit="mm" value={form.back} onChange={value => setForm({ ...form, back: value })} />
        <NumericField label="Saw kerf" unit="mm" value={form.kerf} onChange={value => setForm({ ...form, kerf: value })} />
        <NumericField label="Density" unit="kg/m³" value={form.density} onChange={value => setForm({ ...form, density: value })} />
        <NumericField label="Standard billet length (optional)" unit="mm" value={form.billet} onChange={value => setForm({ ...form, billet: value })} hint="Used only to estimate billet weight when no billet is linked." />
      </div>
      <label className="block text-sm font-semibold">Rationale<input className="mt-1 h-11 w-full rounded-xl border px-3" value={form.rationale} maxLength={500} onChange={event => setForm({ ...form, rationale: event.target.value })} /></label>
      <p className="text-xs text-neutral-600">Die-specific standards are proposed from the die record once a die needs its own butt or crops.</p>
      <button type="button" onClick={propose} disabled={form.rationale.trim().length < 5} className="min-h-11 rounded-xl bg-neutral-950 px-4 text-sm font-bold text-white disabled:opacity-50">Propose for owner approval</button>
    </section> : null}
    <section aria-labelledby="reconcile" className="space-y-3 rounded-2xl border bg-white p-4 sm:p-5">
      <div><h2 id="reconcile" className="text-lg font-bold">Monthly reconciliation</h2><p className="text-sm text-neutral-600">Scrap derived at completion (engineering and rejects) against scrap weighed at the scrap yard for the same month.</p></div>
      <label className="block w-44 text-sm font-semibold">Month<input type="month" className="mt-1 h-11 w-full rounded-xl border px-3" value={month} max={thisMonth()} onChange={event => setMonth(event.target.value)} /></label>
      {rec ? <dl className="grid gap-2 text-sm sm:grid-cols-4">
        <div className="rounded-xl bg-neutral-50 p-3"><dt className="text-xs text-neutral-500">Derived engineering</dt><dd className="font-black">{fmtKg(rec.derived_engineering_kg)}</dd><dd className="text-xs">{rec.jobs_derived} job(s)</dd></div>
        <div className="rounded-xl bg-neutral-50 p-3"><dt className="text-xs text-neutral-500">Rejects</dt><dd className="font-black">{fmtKg(rec.derived_process_kg)}</dd></div>
        <div className="rounded-xl bg-neutral-50 p-3"><dt className="text-xs text-neutral-500">Typed on manual completions</dt><dd className="font-black">{fmtKg(rec.entered_kg)}</dd></div>
        <div className="rounded-xl bg-neutral-50 p-3"><dt className="text-xs text-neutral-500">Weighed at scrap yard</dt><dd className="font-black">{fmtKg(rec.weighed_kg)}</dd>
          <dd className="text-xs">{diff === null ? "Not weighed yet" : `${diff >= 0 ? "+" : ""}${fmtKg(diff)} vs derived (${percent(diff, derived) ?? "—"}%)`}</dd></div>
      </dl> : <p role="status" className="text-sm">Loading…</p>}
      {canWeigh ? <div className="flex flex-wrap items-end gap-3"><div className="w-40"><NumericField label="Weighed kg" unit="kg" value={weigh.kg} onChange={value => setWeigh({ ...weigh, kg: value })} /></div>
        <label className="block min-w-0 flex-1 text-sm font-semibold">Weighbridge reference<input className="mt-1 h-11 w-full rounded-xl border px-3" value={weigh.reference} maxLength={80} onChange={event => setWeigh({ ...weigh, reference: event.target.value })} /></label>
        <button type="button" onClick={saveWeighing} className="min-h-11 rounded-xl bg-neutral-950 px-4 text-sm font-bold text-white">Record weighing</button></div> : null}
    </section>
  </div>;
}

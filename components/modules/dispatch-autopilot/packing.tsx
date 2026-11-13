"use client";

// AP-035: the packing standard. A versioned spec per customer (or the company default) sets the bundle limits and the
// packaging materials; the plan proposes pieces per bundle and material per order line from profile weight and cut
// length. Recorded bundles that differ are listed as deviations; material issued is compared with the standard.
import { useState } from "react";
import { DEVIATION_LABELS } from "@/lib/dispatch-autopilot/commands";
import { WRAPPING_LABELS, compareMaterials, packingInstruction, type Wrapping } from "@/lib/calculations/bundle-packing";
import { fmtDay, fmtWhen } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";

type Note = { tone: "ok" | "error"; text: string } | null;
type Material = { material_id: string | null; code: string; name: string; unit: string; method: string; rate: number; quantity: number };
type PlanLine = { line_id: string; profile: string; finish: string; pieces: number | null; length_m: number | null; kg_per_m: number | null; piece_kg: number | null; per_bundle: number | null; basis: string | null;
  bundles: number | null; last_bundle_pieces: number | null; bundle_kg: number | null; heavy_piece: boolean; materials: Material[] };
type Spec = { id: string; revision: number; scope: string; max_bundle_kg: number | null; max_pieces: number | null; wrapping: Wrapping; interleaving_paper: boolean; battens_per_bundle: number; notes: string | null };
type Plan = { spec: Spec | null; lines: PlanLine[]; complete: boolean; materials: Material[]; totals: { pieces: number; metres: number; kg: number; bundles: number };
  deviations: Array<{ id: string; bundle_number: string; kind: string; expected_pieces: number | null; actual_pieces: number; max_bundle_kg: number | null; actual_kg: number; note: string | null; created_at: string }> };

const qty = (m: { quantity: number; unit: string }) => `${Number(m.quantity).toLocaleString("en-IN", { maximumFractionDigits: 2 })} ${m.unit}`;

export function PackingPlanPanel({ orderId, compact = false }: { orderId: string; compact?: boolean }) {
  const plan = useApRead<Plan>("ap_dispatch", "pack_plan", { order_id: orderId }, []);
  const p = plan.data;
  const spec = p?.spec ? { wrapping: p.spec.wrapping, interleavingPaper: p.spec.interleaving_paper, battensPerBundle: p.spec.battens_per_bundle, maxBundleKg: p.spec.max_bundle_kg } : null;
  return <Section title="Packing standard" description={p?.spec ? `${p.spec.scope === "customer" ? "Customer" : "Company"} spec revision ${p.spec.revision}${p.spec.max_bundle_kg ? ` · up to ${p.spec.max_bundle_kg} kg` : ""}${p.spec.max_pieces ? ` · up to ${p.spec.max_pieces} pcs` : ""} per bundle` : "No packing spec yet: bundle sizes come from the profile's standard only."}>
    {plan.loading && !p ? <Loading what="the packing plan" /> : plan.error ? <Failure text={plan.error} /> : !p?.lines.length ? <Empty>This order has no lines to pack.</Empty> : <>
      <ul className="space-y-2 text-sm">{p.lines.map(l => <li key={l.line_id} className="rounded-xl bg-neutral-50 p-3"><p className="font-bold">{l.profile} <span className="font-normal text-neutral-500">· {l.finish}</span></p>
        <p>{packingInstruction({ pieceKg: l.piece_kg, perBundle: l.per_bundle, basis: l.basis as never, bundles: l.bundles, lastBundlePieces: l.last_bundle_pieces, bundleKg: l.bundle_kg, heavyPiece: l.heavy_piece }, spec)}</p>
        {!compact && l.materials.length ? <p className="text-neutral-600">Material: {l.materials.map(m => `${m.name} ${qty(m)}`).join(" · ")}</p> : null}</li>)}</ul>
      {!compact && p.materials.length ? <p className="text-sm"><b>Order total:</b> {p.totals.bundles} bundles · {p.materials.map(m => `${m.name} ${qty(m)}`).join(" · ")}{p.complete ? "" : " (lines without a bundle limit are not counted)"}</p> : null}
      {p.deviations.length ? <div className="space-y-1 text-sm"><p className="font-semibold">Deviations recorded</p>{p.deviations.slice(0, compact ? 3 : 10).map(d => <p key={d.id} className="text-amber-900"><b className="font-mono">{d.bundle_number}</b> · {DEVIATION_LABELS[d.kind] ?? d.kind}: {d.actual_pieces} pcs / {d.actual_kg} kg (standard {d.expected_pieces ?? "—"} pcs{d.max_bundle_kg ? `, ≤ ${d.max_bundle_kg} kg` : ""}){d.note ? ` · ${d.note}` : ""}</p>)}</div> : null}
    </>}
  </Section>;
}

type SpecState = { customer_id: string | null; can_edit: boolean; effective: (Spec & { customer_id: string | null; material_ids: string[] }) | null;
  history: Array<Spec & { status: string; reason: string; set_by: string; set_at: string; material_ids: string[] }>;
  materials: Array<{ id: string; code: string; name: string; type: string; unit: string; method: string; rate: number }> };

export function PackingSpecPanel({ customerId }: { customerId?: string }) {
  const [key, setKey] = useState(0);
  const state = useApRead<SpecState>("ap_dispatch", "pack_specs", customerId ? { customer_id: customerId } : {}, [key]);
  const s = state.data; const current = s?.history.find(h => h.status === "active") ?? null;
  const [form, setForm] = useState<{ max_bundle_kg: string; max_pieces: string; wrapping: Wrapping; interleaving_paper: boolean; battens_per_bundle: string; material_ids: string[]; notes: string; reason: string } | null>(null);
  const [message, setMessage] = useState<Note>(null);
  const begin = () => setForm({ max_bundle_kg: current?.max_bundle_kg ? String(current.max_bundle_kg) : "", max_pieces: current?.max_pieces ? String(current.max_pieces) : "",
    wrapping: current?.wrapping ?? "stretch_film", interleaving_paper: current?.interleaving_paper ?? false, battens_per_bundle: String(current?.battens_per_bundle ?? 0), material_ids: current?.material_ids ?? [], notes: current?.notes ?? "", reason: "" });
  async function save() {
    if (!form) return;
    const payload: Record<string, unknown> = { wrapping: form.wrapping, interleaving_paper: form.interleaving_paper, battens_per_bundle: Number(form.battens_per_bundle || 0), material_ids: form.material_ids, reason: form.reason.trim() };
    if (customerId) payload.customer_id = customerId;
    if (form.max_bundle_kg.trim()) payload.max_bundle_kg = Number(form.max_bundle_kg);
    if (form.max_pieces.trim()) payload.max_pieces = Number(form.max_pieces);
    if (form.notes.trim()) payload.notes = form.notes.trim();
    if (await apWrite("ap_dispatch", "save_pack_spec", payload, setMessage, "Packing spec saved as a new revision.")) { setForm(null); setKey(k => k + 1); }
  }
  const inherited = !current && s?.effective && s.effective.customer_id === null && customerId;
  return <Section id="packing-spec" title={customerId ? "Packing spec" : "Company packing standard"} description={customerId ? "Bundle limits and packaging for this customer. Each change is a new revision." : "Applies to customers without their own spec."}
    actions={s?.can_edit && !form ? <button type="button" className={secondaryClass} onClick={begin}>{current ? "Change" : "Set spec"}</button> : null}>
    {state.loading && !s ? <Loading what="the packing spec" /> : state.error ? <Failure text={state.error} /> : form ? <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm font-semibold">Max bundle kg<input inputMode="decimal" className={`${inputClass} mt-1`} value={form.max_bundle_kg} onChange={e => setForm({ ...form, max_bundle_kg: e.target.value })} placeholder="No limit" /></label>
        <label className="text-sm font-semibold">Max pieces per bundle<input inputMode="numeric" className={`${inputClass} mt-1`} value={form.max_pieces} onChange={e => setForm({ ...form, max_pieces: e.target.value })} placeholder="No limit" /></label>
        <label className="text-sm font-semibold">Wrapping<select className={`${inputClass} mt-1`} value={form.wrapping} onChange={e => setForm({ ...form, wrapping: e.target.value as Wrapping })}>{Object.entries(WRAPPING_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="text-sm font-semibold">Wooden battens per bundle<input inputMode="numeric" className={`${inputClass} mt-1`} value={form.battens_per_bundle} onChange={e => setForm({ ...form, battens_per_bundle: e.target.value })} /></label>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={form.interleaving_paper} onChange={e => setForm({ ...form, interleaving_paper: e.target.checked })} />Interleaving paper between pieces</label>
      <fieldset className="space-y-1"><legend className="text-sm font-semibold">Packaging materials used (each with its own consumption standard)</legend>
        {s?.materials.length ? s.materials.map(m => <label key={m.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.material_ids.includes(m.id)}
          onChange={e => setForm({ ...form, material_ids: e.target.checked ? [...form.material_ids, m.id] : form.material_ids.filter(x => x !== m.id) })} />{m.code} · {m.name} ({m.rate} {m.unit} {m.method.replaceAll("_", " ")})</label>)
          : <p className="text-sm text-neutral-600">No active packaging materials. Add them under Packaging.</p>}</fieldset>
      <label className="block text-sm font-semibold">Notes for the packer<input className={`${inputClass} mt-1`} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
      <label className="block text-sm font-semibold">Why it changes<input className={`${inputClass} mt-1`} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="For example: customer packing sheet dated 1 Nov" /></label>
      <div className="flex gap-2"><button type="button" className={buttonClass} onClick={save}>Save revision</button><button type="button" className={secondaryClass} onClick={() => setForm(null)}>Cancel</button></div>
    </div> : current ? <p className="text-sm">Revision {current.revision}: {current.max_bundle_kg ? `≤ ${current.max_bundle_kg} kg` : "no kg limit"}, {current.max_pieces ? `≤ ${current.max_pieces} pcs` : "no piece limit"}, {WRAPPING_LABELS[current.wrapping]}{current.interleaving_paper ? ", interleaving paper" : ""}{current.battens_per_bundle ? `, ${current.battens_per_bundle} battens` : ""} · set by {current.set_by} {fmtDay(current.set_at)} ({current.reason})</p>
      : inherited ? <p className="text-sm text-neutral-600">Uses the company standard (revision {s!.effective!.revision}).</p> : <Empty>No packing spec set.</Empty>}
    {s && s.history.length > 1 && !form ? <details className="text-sm"><summary className="cursor-pointer font-semibold">Earlier revisions</summary><ul className="mt-1 space-y-1">{s.history.filter(h => h.status !== "active").map(h =>
      <li key={h.id}>Rev {h.revision}: {h.max_bundle_kg ?? "—"} kg / {h.max_pieces ?? "—"} pcs, {WRAPPING_LABELS[h.wrapping]} · {h.set_by} {fmtDay(h.set_at)} · {h.reason}</li>)}</ul></details> : null}
    <Message value={message} />
  </Section>;
}

type Deviation = { id: string; bundle_number: string; order_id: string; order_number: string; customer: string; kind: string; expected_pieces: number | null; actual_pieces: number; max_bundle_kg: number | null;
  actual_kg: number; spec_revision: number | null; note: string | null; noted_by: string | null; created_at: string };
type ReportRow = { order_id: string; order_number: string; customer: string; bundles: number; pieces: number; metres: number; kg: number; spec_revision: number | null;
  standard: Material[]; issued: Array<{ code: string; name: string; unit: string; quantity: number }> };

export function PackingClient({ canEditSpec }: { canEditSpec: boolean }) {
  const [dPage, setDPage] = useState(1); const [rPage, setRPage] = useState(1); const [key, setKey] = useState(0); const [openOnly, setOpenOnly] = useState(true);
  const deviations = useApRead<{ rows: Deviation[]; total_count: number }>("ap_dispatch", "deviations", { page: dPage, open_only: openOnly }, [key]);
  const report = useApRead<{ rows: ReportRow[]; total_count: number }>("ap_dispatch", "pack_report", { page: rPage, days: 30 }, []);
  const [noting, setNoting] = useState<{ id: string; note: string } | null>(null);
  const [message, setMessage] = useState<Note>(null);
  return <div className="space-y-4">
    {canEditSpec ? <PackingSpecPanel /> : null}
    <Section title="Packing deviations" description="Bundles that differ from the standard of their order line. A note records why."
      actions={<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={openOnly} onChange={e => { setOpenOnly(e.target.checked); setDPage(1); }} />Without a note</label>}>
      {deviations.loading && !deviations.data ? <Loading what="deviations" /> : deviations.error ? <Failure text={deviations.error} /> : !deviations.data?.rows.length ? <Empty>No deviations.</Empty> :
        <ul className="space-y-2 text-sm">{deviations.data.rows.map(d => <li key={d.id} className="rounded-xl border border-neutral-200 p-2">
          <p><b className="font-mono">{d.bundle_number}</b> · {d.order_number} · {d.customer} · <b>{DEVIATION_LABELS[d.kind] ?? d.kind}</b>: {d.actual_pieces} pcs, {d.actual_kg} kg (standard {d.expected_pieces ?? "—"} pcs{d.max_bundle_kg ? `, ≤ ${d.max_bundle_kg} kg` : ""}, rev {d.spec_revision ?? "—"}) · {fmtWhen(d.created_at)}</p>
          {d.note ? <p className="text-neutral-600">Note by {d.noted_by}: {d.note}</p> : noting?.id === d.id ? <div className="mt-1 flex flex-wrap gap-2"><input aria-label="Deviation note" className={`${inputClass} flex-1`} value={noting.note} onChange={e => setNoting({ id: d.id, note: e.target.value })} />
            <button type="button" className={secondaryClass} onClick={async () => { if (await apWrite("ap_dispatch", "deviation_note", { id: d.id, note: noting.note.trim() }, setMessage, "Note saved.")) { setNoting(null); setKey(k => k + 1); } }}>Save note</button></div>
            : <button type="button" className="underline" onClick={() => setNoting({ id: d.id, note: "" })}>Add a note</button>}</li>)}</ul>}
      {deviations.data ? <Pager page={dPage} total={deviations.data.total_count} onPage={setDPage} /> : null}
      <Message value={message} />
    </Section>
    <Section title="Packing material: standard vs issued" description="Orders with bundles recorded in the last 30 days. Standard = the spec's materials for what was packed; issued = packaging material movements for the order.">
      {report.loading && !report.data ? <Loading what="the material report" /> : report.error ? <Failure text={report.error} /> : !report.data?.rows.length ? <Empty>No bundles recorded in the period.</Empty> :
        <div className="space-y-3">{report.data.rows.map(r => {
          const rows = compareMaterials(r.standard.map(m => ({ code: m.code, name: m.name, unit: m.unit, quantity: Number(m.quantity) })), r.issued.map(m => ({ ...m, quantity: Number(m.quantity) })));
          return <article key={r.order_id} className="rounded-xl border border-neutral-200 p-3 text-sm"><p className="font-bold">{r.order_number} · {r.customer} <span className="font-normal text-neutral-600">· {r.bundles} bundles, {r.pieces} pcs, {Number(r.kg).toLocaleString("en-IN")} kg{r.spec_revision ? ` · spec rev ${r.spec_revision}` : " · no spec"}</span></p>
            {rows.length ? <div className="overflow-x-auto"><table className="mt-1 w-full min-w-[480px]"><thead><tr className="text-left text-neutral-500"><th>Material</th><th>Standard</th><th>Issued</th><th>Variance</th></tr></thead>
              <tbody>{rows.map(m => <tr key={m.code} className="border-t border-neutral-100"><td className="py-1">{m.code} · {m.name}</td><td>{m.standard === null ? "—" : `${m.standard} ${m.unit}`}</td><td>{m.issued === null ? "—" : `${m.issued} ${m.unit}`}</td>
                <td className={m.variancePercent !== null && Math.abs(m.variancePercent) > 10 ? "font-bold text-rose-700" : ""}>{m.variance === null ? "—" : `${m.variance} ${m.unit} (${m.variancePercent ?? "—"}%)`}</td></tr>)}</tbody></table></div> : <p className="text-neutral-600">No standard or issued material to compare.</p>}
          </article>; })}</div>}
      {report.data ? <Pager page={rPage} total={report.data.total_count} onPage={setRPage} /> : null}
    </Section>
  </div>;
}

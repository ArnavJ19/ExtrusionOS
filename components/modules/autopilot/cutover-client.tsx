"use client";

// AP-007: cut-over checklist. Stores, accounts and the plant head each load their opening section from the go-live
// sheet with the totals signed on it; another person signs it off, which posts it into the ledgers as "opening".
// Signing off the plan locks every entry dated before the cut-over date.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { autopilotAction } from "@/lib/actions/autopilot";
import { SECTION_LEDGER, cutoverGetSchema, sectionLabel, type CutoverPlan } from "@/lib/cutover/cutover";
import { CUTOVER_DEFINITIONS } from "@/lib/master-data/import/definitions";
import { fieldGuide } from "@/lib/master-data/import/engine";

const n = (value: number | null | undefined, digits = 3) => value === null || value === undefined ? "-" : value.toLocaleString("en-IN", { maximumFractionDigits: digits });
const blankNumber = (value: string) => value.trim() === "" ? null : Number(value.replace(/,/g, ""));

function SectionCard({ section, plan, onChange, busy, setBusy, setMessage }: { section: CutoverPlan["sections"][number]; plan: CutoverPlan; onChange: () => Promise<void>; busy: boolean; setBusy: (value: boolean) => void; setMessage: (value: { text: string; tone: "ok" | "error" } | null) => void }) {
  const definition = CUTOVER_DEFINITIONS[section.section];
  const [file, setFile] = useState<File | null>(null);
  const [control, setControl] = useState({ count: "", quantity: "", amount: "" });
  const [errors, setErrors] = useState<Array<{ row: number; errors: string[] }>>([]);
  const [reason, setReason] = useState<string | null>(null);
  const matches = section.status === "loaded" && section.loaded_totals.count === section.control_count
    && (section.control_quantity === null || section.loaded_totals.quantity === section.control_quantity)
    && (section.control_amount === null || section.loaded_totals.amount === section.control_amount);

  async function load() {
    if (!file) return setMessage({ text: "Choose the section sheet.", tone: "error" });
    const totals = { count: Number(control.count), quantity: definition.controls?.quantity ? blankNumber(control.quantity) : null, amount: definition.controls?.amount ? blankNumber(control.amount) : null };
    if (!Number.isInteger(totals.count) || control.count.trim() === "" || [totals.quantity, totals.amount].some(value => value !== null && !Number.isFinite(value))) return setMessage({ text: "Enter the line count and totals exactly as signed on the sheet.", tone: "error" });
    setBusy(true); setErrors([]); setMessage(null);
    const body = new FormData(); body.set("section", section.section); body.set("file", file); body.set("control", JSON.stringify(totals));
    try {
      const response = await fetch("/api/cutover/load", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) setMessage({ text: data.error ?? "The section could not be loaded.", tone: "error" });
      else if (data.state === "rejected") { setErrors(data.errors ?? []); setMessage({ text: "Some lines need fixing; nothing was loaded.", tone: "error" }); }
      else { setMessage({ text: `${sectionLabel(section.section)} loaded: ${data.rows} line(s). Another person now signs it off.`, tone: "ok" }); setFile(null); await onChange(); }
    } catch { setMessage({ text: "The upload did not complete. Retry.", tone: "error" }); }
    finally { setBusy(false); }
  }
  async function command(name: "sign_off_section" | "reverse_section", payload: Record<string, unknown>, done: string) {
    setBusy(true); setMessage(null);
    const result = await autopilotAction("ap_cutover", name, { section: section.section, ...payload });
    setBusy(false);
    setMessage(result.success ? { text: done, tone: "ok" } : { text: result.error, tone: "error" });
    if (result.success) { setReason(null); await onChange(); }
  }

  return <li aria-label={definition.label} className="min-w-0 space-y-3 rounded-2xl border border-neutral-200 bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h3 className="font-bold">{definition.label}</h3><p className="text-sm text-neutral-600">{definition.description}</p>
      <p className="text-xs text-neutral-500">Posts to: {SECTION_LEDGER[section.section]}</p></div>
      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${section.status === "signed_off" ? "bg-emerald-50 text-emerald-800" : section.status === "loaded" ? "bg-sky-50 text-sky-800" : "bg-neutral-100 text-neutral-700"}`}>{section.status === "signed_off" ? "Signed off" : section.status === "loaded" ? "Loaded, awaiting sign-off" : "Not loaded"}</span></div>
    {section.status !== "open" ? <dl className="grid grid-cols-3 gap-2 rounded-xl bg-neutral-50 p-3 text-sm">
      <div><dt className="text-xs text-neutral-500">Lines (sheet / loaded)</dt><dd className="font-semibold">{n(section.control_count, 0)} / {n(section.loaded_totals.count, 0)}</dd></div>
      {definition.controls?.quantity ? <div><dt className="text-xs text-neutral-500">{definition.controls.quantity}</dt><dd className="font-semibold">{n(section.control_quantity)} / {n(section.loaded_totals.quantity)}</dd></div> : null}
      {definition.controls?.amount ? <div><dt className="text-xs text-neutral-500">{definition.controls.amount}</dt><dd className="font-semibold">₹{n(section.control_amount, 2)} / ₹{n(section.loaded_totals.amount, 2)}</dd></div> : null}
      {section.ledger_totals ? <div className="col-span-3 text-xs text-emerald-800">Posted to the ledgers: {n(section.ledger_totals.count, 0)} line(s){section.ledger_totals.quantity !== undefined ? `, ${n(section.ledger_totals.quantity)} qty` : ""}{section.ledger_totals.amount ? `, ₹${n(section.ledger_totals.amount, 2)}` : ""} · signed off by {section.signed_off_by}</div> : null}
      {section.status === "loaded" && !matches ? <p className="col-span-3 text-xs font-semibold text-rose-700">The loaded totals do not equal the signed sheet. Fix the sheet or the control totals and load again.</p> : null}
    </dl> : null}
    {section.reversal_reason && section.status === "open" ? <p className="text-xs text-neutral-600">Last reversed: {section.reversal_reason}</p> : null}
    {section.lines.length ? <details className="text-sm"><summary className="cursor-pointer font-semibold">First lines loaded</summary><ul className="mt-1 space-y-1 text-xs">{section.lines.map(line => <li key={line.row} className="[overflow-wrap:anywhere]">Row {line.row}: {Object.entries(line.payload).filter(([, value]) => value !== null && value !== "").map(([key, value]) => `${key} ${value}`).join(" · ")}</li>)}</ul></details> : null}
    {section.can_act && section.status !== "signed_off" ? <div className="space-y-2 rounded-xl border border-dashed border-neutral-300 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <a href={`/api/master-import/template/${section.section}`} className="inline-flex min-h-10 items-center rounded-lg border border-neutral-300 px-3 text-sm font-bold">Template</a>
        <label className="text-xs font-semibold">Section sheet (.xlsx or .csv)<input type="file" accept=".xlsx,.csv" className="mt-1 block max-w-[14rem] text-sm" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
        <label className="text-xs font-semibold">Lines on sheet<input inputMode="numeric" className="mt-1 block h-10 w-24 rounded-lg border border-neutral-300 px-2 text-sm" value={control.count} onChange={event => setControl({ ...control, count: event.target.value.replace(/\D/g, "") })} /></label>
        {definition.controls?.quantity ? <label className="text-xs font-semibold">{definition.controls.quantity}<input inputMode="decimal" className="mt-1 block h-10 w-32 rounded-lg border border-neutral-300 px-2 text-sm" value={control.quantity} onChange={event => setControl({ ...control, quantity: event.target.value })} /></label> : null}
        {definition.controls?.amount ? <label className="text-xs font-semibold">{definition.controls.amount}<input inputMode="decimal" className="mt-1 block h-10 w-36 rounded-lg border border-neutral-300 px-2 text-sm" value={control.amount} onChange={event => setControl({ ...control, amount: event.target.value })} /></label> : null}
        <button type="button" disabled={busy || !file} onClick={load} className="min-h-10 rounded-lg bg-neutral-950 px-3 text-sm font-bold text-white disabled:opacity-50">{section.status === "loaded" ? "Load again" : "Load section"}</button>
      </div>
      <details className="text-xs text-neutral-600"><summary className="cursor-pointer font-semibold">Columns</summary><ul className="mt-1 grid gap-1 sm:grid-cols-2">{fieldGuide(definition).map(field => <li key={field.label}><strong>{field.label}</strong>{field.required ? " *" : ""}: {field.accepts}</li>)}</ul></details>
      {errors.length ? <ul role="alert" className="max-h-48 space-y-1 overflow-y-auto text-sm text-rose-800">{errors.map(item => <li key={item.row}>Row {item.row}: {item.errors.join("; ")}</li>)}</ul> : null}
    </div> : null}
    {section.can_act ? <div className="flex flex-wrap gap-2">
      {section.status === "loaded" ? <button type="button" disabled={busy || !matches} onClick={() => command("sign_off_section", {}, `${definition.label} signed off and posted as opening entries.`)} className="min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-50">Sign off and post</button> : null}
      {section.status !== "open" ? reason === null ? <button type="button" disabled={busy} onClick={() => setReason("")} className="min-h-11 rounded-xl border border-neutral-300 px-4 text-sm font-bold">Reverse with a reason…</button>
        : <div className="flex flex-wrap items-center gap-2"><input className="h-11 min-w-56 rounded-xl border border-neutral-300 px-3 text-sm" placeholder="Why is this section reversed?" value={reason} maxLength={300} onChange={event => setReason(event.target.value)} />
          <button type="button" disabled={busy || reason.trim().length < 10} onClick={() => command("reverse_section", { reason: reason.trim() }, `${definition.label} reversed.`)} className="min-h-11 rounded-xl bg-rose-600 px-4 text-sm font-bold text-white disabled:opacity-50">Reverse</button></div> : null}
    </div> : plan.status === "draft" ? <p className="text-xs text-neutral-600">Your role does not load or sign off this section.</p> : null}
  </li>;
}

export function CutoverClient({ initial }: { initial: { plan: CutoverPlan | null; can_start: boolean; today: string } }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [date, setDate] = useState(initial.today);
  const [busy, setBusy] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  async function refresh() {
    const result = await autopilotAction("ap_cutover", "get", {});
    const parsed = result.success ? cutoverGetSchema.safeParse(result.data) : null;
    if (parsed?.success) setState(parsed.data);
    router.refresh();
  }
  async function start() {
    setBusy(true);
    const result = await autopilotAction("ap_cutover", "start", { cutover_date: date });
    setBusy(false);
    setMessage(result.success ? { text: "Cut-over plan started.", tone: "ok" } : { text: result.error, tone: "error" });
    if (result.success) await refresh();
  }
  async function signOffPlan() {
    setBusy(true);
    const result = await autopilotAction("ap_cutover", "sign_off_plan", { empty_sections_confirmed: confirmEmpty });
    setBusy(false);
    setMessage(result.success ? { text: "Cut-over signed off. Entries dated before the cut-over date are now locked.", tone: "ok" } : { text: result.error, tone: "error" });
    if (result.success) await refresh();
  }
  const plan = state.plan;
  const open = plan?.sections.filter(section => section.status === "open").length ?? 0;
  return <div className="space-y-5">
    {message ? <p role={message.tone === "error" ? "alert" : "status"} className={`rounded-xl p-3 text-sm font-semibold ${message.tone === "error" ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>{message.text}</p> : null}
    {!plan ? <section className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4">
      <h2 className="text-lg font-bold">Start the cut-over</h2>
      <p className="text-sm text-neutral-600">Choose the go-live date. Opening stock is counted as at the start of this day; receivables, payables and open orders are the balances on that date.</p>
      {state.can_start ? <div className="flex flex-wrap items-end gap-2"><label className="text-sm font-semibold">Cut-over date<input type="date" className="mt-1 block h-11 rounded-xl border border-neutral-300 px-3" value={date} onChange={event => setDate(event.target.value)} /></label>
        <button type="button" disabled={busy} onClick={start} className="min-h-11 rounded-xl bg-neutral-950 px-4 text-sm font-bold text-white disabled:opacity-50">Start cut-over plan</button></div>
        : <p className="text-sm text-neutral-600">The owner, an admin or accounts starts the cut-over plan.</p>}
    </section> : <>
      <section className="space-y-2 rounded-2xl border border-neutral-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-bold">Cut-over on {new Date(`${plan.cutover_date}T00:00:00`).toLocaleDateString("en-IN", { dateStyle: "long" })}</h2>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${plan.status === "signed_off" ? "bg-emerald-50 text-emerald-800" : "bg-sky-50 text-sky-800"}`}>{plan.status === "signed_off" ? `Signed off by ${plan.signed_off_by}` : `${plan.sections.filter(s => s.status === "signed_off").length} of 7 sections signed off`}</span></div>
        <p className="text-sm text-neutral-600">Books closed through: <strong>{plan.locked_through ?? "not yet"}</strong>. Opening entries cannot be edited after sign-off; a section can be reversed with a reason only until the plan is signed off and only while nothing has used its entries.</p>
        {plan.status === "draft" && state.can_start ? <div className="flex flex-wrap items-center gap-3 pt-2">
          {open ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmEmpty} onChange={event => setConfirmEmpty(event.target.checked)} />{open} section(s) have no opening entries; they are empty at cut-over</label> : null}
          <button type="button" disabled={busy || plan.sections.some(section => section.status === "loaded")} onClick={signOffPlan} className="min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-50">Sign off cut-over and lock earlier entries</button></div> : null}
      </section>
      <ul className="grid gap-4 lg:grid-cols-2">{plan.sections.map(section => <SectionCard key={section.id} section={section} plan={plan} onChange={refresh} busy={busy} setBusy={setBusy} setMessage={setMessage} />)}</ul>
    </>}
  </div>;
}

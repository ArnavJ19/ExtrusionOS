"use client";

// AP-016: quality samples created from press output by the inspection plan's triggers. QC records readings against the
// plan's characteristics; a missed sample stays visible on the job and blocks QC release when its trigger says so.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { autopilotAction } from "@/lib/actions/autopilot";
import { SAMPLING_KINDS, type SamplingKind } from "@/lib/press/press-floor";
import { fmtTime, type SampleRow } from "@/lib/press/types";
import { NumericField } from "@/components/ui/numeric-field";
import { parseKeypadValue } from "@/lib/forms/numeric-keypad";
import { OfflineQueuePanel, useOfflineQueue } from "@/components/modules/offline/offline-queue";

const statusLabel: Record<string, string> = { open: "Due", missed: "Missed window", recorded: "Recorded", waived: "Waived" };
const statusStyle: Record<string, string> = { open: "bg-sky-50 text-sky-800", missed: "bg-rose-50 text-rose-800", recorded: "bg-emerald-50 text-emerald-800", waived: "bg-neutral-100 text-neutral-700" };

function windowText(row: SampleRow) {
  if (row.window_push !== null) return `before push ${row.window_push} (now ${row.current_pushes})`;
  if (row.window_ends_at) return `by ${fmtTime(row.window_ends_at)}`;
  return "—";
}

export function SamplesClient() {
  const [status, setStatus] = useState<"due" | "recorded" | "waived" | "all">("due");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total_count: number; rows: SampleRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setData(null);
    void autopilotAction("ap_sampling", "samples", { status, page }).then(result => {
      if (!current) return;
      if (!result.success) { setError(result.error); return; }
      setError(null); setData(result.data as { total_count: number; rows: SampleRow[] });
    });
    return () => { current = false; };
  }, [status, page]);
  const pages = Math.max(1, Math.ceil((data?.total_count ?? 0) / 10));
  return <section className="min-w-0 space-y-3 rounded-2xl border bg-white p-4 sm:p-5" aria-labelledby="samples">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h2 id="samples" className="text-lg font-bold">Samples</h2><p className="text-sm text-neutral-600">Samples that block QC release come first.</p></div>
      <div role="group" aria-label="Show samples" className="flex flex-wrap gap-1">{(["due", "recorded", "waived", "all"] as const).map(value => <button key={value} type="button" aria-pressed={status === value}
        onClick={() => { setStatus(value); setPage(1); }} className={`min-h-10 rounded-lg px-3 text-sm font-semibold ${status === value ? "bg-neutral-950 text-white" : "border"}`}>{value === "due" ? "Due" : value[0].toUpperCase() + value.slice(1)}</button>)}</div></div>
    {error ? <p role="alert" className="text-sm text-amber-900">{error}</p> : !data ? <p role="status" className="text-sm">Loading samples…</p>
      : !data.rows.length ? <p className="rounded-xl border border-dashed p-3 text-sm text-neutral-600">{status === "due" ? "No sample is due. Triggers on approved inspection plans create them from press output." : "No samples."}</p>
      : <ul className="divide-y rounded-xl border">{data.rows.map(row => <li key={row.id}><Link href={`/quality/samples/${row.id}`} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm hover:bg-neutral-50">
        <span className="min-w-0"><span className="font-bold">{row.job_number ?? "Job"}</span> · {row.machine} · {row.profile_code ?? "—"}<br />
          <span className="text-neutral-600">{SAMPLING_KINDS[row.kind as SamplingKind] ?? row.kind} · due {fmtTime(row.due_at)} · window {windowText(row)}</span></span>
        <span className="flex items-center gap-2">{row.blocks_release && (row.status === "open" || row.status === "missed") ? <span className="rounded-full bg-rose-600 px-2 py-0.5 text-xs font-bold text-white">Blocks release</span> : null}
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${statusStyle[row.status]}`}>{statusLabel[row.status]}{row.recorded_late ? " (late)" : ""}</span></span></Link></li>)}</ul>}
    {pages > 1 ? <nav aria-label="Sample pages" className="flex items-center justify-between text-sm"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="min-h-10 rounded-lg border px-3 disabled:opacity-40">Previous</button><span>Page {page} of {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="min-h-10 rounded-lg border px-3 disabled:opacity-40">Next</button></nav> : null}
  </section>;
}

type SampleItem = { id: string; seq: number; characteristic: string; unit: string | null; method: string | null; nominal: number | null; lower_limit: number | null; upper_limit: number | null; critical: boolean;
  result: { observed: number | null; visual_ok: boolean | null; outcome: "pass" | "fail" } | null };
type SampleDetail = SampleRow & { can_record: boolean; items: SampleItem[] };
const isMeasured = (item: SampleItem) => item.lower_limit !== null || item.upper_limit !== null || Boolean(item.unit && item.unit !== "visual");

export function SampleClient({ id, companyId = "local", userId = "local" }: { id: string; companyId?: string; userId?: string }) {
  const router = useRouter();
  const [sample, setSample] = useState<SampleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [visual, setVisual] = useState<Record<string, boolean | undefined>>({});
  const [waive, setWaive] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  // AP-094: a reading entered without signal stays on this phone and is sent once when the connection returns.
  const queue = useOfflineQueue(companyId, userId);
  const load = useCallback(async () => {
    const result = await autopilotAction("ap_sampling", "sample", { id });
    if (!result.success) { setError(result.error); return; }
    setError(null); setSample(result.data as SampleDetail);
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  async function record() {
    if (!sample) return;
    const results = [];
    for (const item of sample.items) {
      if (isMeasured(item)) { const value = parseKeypadValue(values[item.id] ?? ""); if (value === null) { setMessage(`Enter the measured value for ${item.characteristic}.`); return; } results.push({ item_id: item.id, observed: value }); }
      else { if (visual[item.id] === undefined) { setMessage(`Mark ${item.characteristic} as OK or not OK.`); return; } results.push({ item_id: item.id, visual_ok: visual[item.id] }); }
    }
    const outcome = await queue.submit({ rpc: "ap_sampling", command: "sample_record", payload: { id, results }, label: `QC reading ${sample.job_number ?? ""}`.trim() });
    if (outcome.kind === "retry") { setMessage("No connection. The reading is saved on this phone and will be sent."); return; }
    if (outcome.kind === "conflict") { setMessage(outcome.message); return; }
    const data = outcome.data as { failed: number; late: boolean };
    setMessage(data.failed ? `${data.failed} characteristic(s) failed; production has been told.` : data.late ? "Recorded (late)." : "Recorded on time.");
    await load(); router.refresh();
  }
  async function waiveSample() {
    const result = await autopilotAction("ap_sampling", "sample_waive", { id, reason: waive.trim() });
    setMessage(result.success ? "Sample waived with your reason." : result.error);
    await load();
  }
  if (error) return <p role="alert" className="rounded-2xl border bg-white p-4 text-sm text-amber-900">{error}</p>;
  if (!sample) return <p role="status" className="rounded-2xl border bg-white p-4 text-sm">Loading sample…</p>;
  const editable = sample.can_record && (sample.status === "open" || sample.status === "missed");
  return <div className="min-w-0 space-y-4"><OfflineQueuePanel queue={queue} what="reading(s)" />
    <section className="space-y-2 rounded-2xl border bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h1 className="text-2xl font-black">{sample.job_number ?? "Job"} · {SAMPLING_KINDS[sample.kind as SamplingKind] ?? sample.kind}</h1>
        <p className="text-sm text-neutral-600">{sample.machine} · {sample.profile_code ?? "—"} · due {fmtTime(sample.due_at)} · window {windowText(sample)}</p></div>
        <span className={`rounded-full px-3 py-1 text-sm font-bold ${statusStyle[sample.status]}`}>{statusLabel[sample.status]}{sample.recorded_late ? " (late)" : ""}</span></div>
      {sample.blocks_release ? <p className="text-sm font-semibold text-rose-800">QC release of this job waits for this sample.</p> : null}
      <Link className="text-sm font-semibold underline" href={`/production/${sample.job_id}`}>Open the job</Link>
    </section>
    <section className="space-y-3 rounded-2xl border bg-white p-4 sm:p-5" aria-labelledby="readings"><h2 id="readings" className="text-lg font-bold">Readings</h2>
      <ul className="space-y-3">{sample.items.map(item => <li key={item.id} className="rounded-xl border p-3">
        <p className="font-semibold">{item.seq}. {item.characteristic}{item.critical ? " · critical" : ""}</p>
        <p className="text-xs text-neutral-600">{item.method ?? "—"}{item.nominal !== null ? ` · nominal ${item.nominal}` : ""}{item.lower_limit !== null || item.upper_limit !== null ? ` · limits ${item.lower_limit ?? "—"} to ${item.upper_limit ?? "—"} ${item.unit ?? ""}` : ""}</p>
        {item.result ? <p className={`mt-1 text-sm font-bold ${item.result.outcome === "pass" ? "text-emerald-700" : "text-rose-700"}`}>{item.result.observed ?? (item.result.visual_ok ? "OK" : "Not OK")} · {item.result.outcome}</p>
          : editable ? (isMeasured(item)
            ? <div className="mt-2 max-w-xs"><NumericField label="Measured" unit={item.unit ?? undefined} value={values[item.id] ?? ""} onChange={value => setValues(v => ({ ...v, [item.id]: value }))} /></div>
            : <div className="mt-2 flex gap-2">{[true, false].map(ok => <button key={String(ok)} type="button" aria-pressed={visual[item.id] === ok} onClick={() => setVisual(v => ({ ...v, [item.id]: ok }))}
              className={`min-h-11 rounded-xl border px-4 font-bold ${visual[item.id] === ok ? "border-neutral-950 bg-neutral-950 text-white" : "bg-white"}`}>{ok ? "OK" : "Not OK"}</button>)}</div>) : <p className="mt-1 text-sm text-neutral-600">Not recorded.</p>}
      </li>)}</ul>
      {editable ? <button type="button" onClick={record} className="min-h-11 rounded-xl bg-neutral-950 px-4 text-sm font-bold text-white">Record sample</button> : null}
      {sample.status === "recorded" ? <p className="text-sm">Recorded by {sample.recorded_by ?? "—"} {fmtTime(sample.recorded_at)}.</p> : null}
      {sample.status === "waived" ? <p className="text-sm">Waived: {sample.waive_reason}</p> : null}
    </section>
    {editable ? <details className="rounded-2xl border bg-white p-4 text-sm"><summary className="cursor-pointer font-semibold">Waive this sample</summary>
      <div className="mt-2 flex flex-wrap items-end gap-2"><label className="block min-w-0 flex-1 font-semibold">Reason (kept on the job)<input className="mt-1 h-11 w-full rounded-xl border px-3" value={waive} maxLength={300} onChange={event => setWaive(event.target.value)} /></label>
        <button type="button" disabled={waive.trim().length < 8} onClick={waiveSample} className="min-h-11 rounded-xl border border-neutral-950 px-4 font-bold disabled:opacity-50">Waive</button></div></details> : null}
    {message ? <p role="status" className="rounded-xl bg-neutral-100 p-3 text-sm font-semibold">{message}</p> : null}
  </div>;
}

type PlanRow = { id: string; version: number; profile_code: string; sampling_instruction: string; items: number; triggers: number };
type TriggerView = { plan: { id: string; version: number; sampling_instruction: string }; can_edit: boolean; items: { id: string; seq: number; characteristic: string }[];
  triggers: { id: string; kind: SamplingKind; every_n: number | null; item_ids: string[] | null; blocks_release: boolean; status: string }[] };

export function TriggersClient() {
  const [plans, setPlans] = useState<{ total_count: number; rows: PlanRow[]; can_edit: boolean } | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<TriggerView | null>(null);
  const [form, setForm] = useState<{ kind: SamplingKind; every: string; items: string[]; blocks: boolean }>({ kind: "first_after_die_change", every: "", items: [], blocks: true });
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { void autopilotAction("ap_sampling", "plans", { page }).then(result => { if (result.success) setPlans(result.data as { total_count: number; rows: PlanRow[]; can_edit: boolean }); else setMessage(result.error); }); }, [page]);
  const loadPlan = useCallback(async (id: string) => {
    const result = await autopilotAction("ap_sampling", "triggers", { plan_id: id });
    if (result.success) setView(result.data as TriggerView); else setMessage(result.error);
  }, []);
  useEffect(() => { if (selected) void loadPlan(selected); }, [selected, loadPlan]);
  async function save() {
    if (!view) return;
    const every = parseKeypadValue(form.every);
    const result = await autopilotAction("ap_sampling", "trigger_save", { plan_id: view.plan.id, kind: form.kind, blocks_release: form.blocks,
      ...(form.kind === "every_n_pushes" || form.kind === "every_n_bundles" ? { every_n: every ?? 0 } : {}), ...(form.items.length ? { item_ids: form.items } : {}) });
    setMessage(result.success ? "Trigger added." : result.error);
    await loadPlan(view.plan.id);
  }
  async function retire(id: string) { const result = await autopilotAction("ap_sampling", "trigger_retire", { id }); setMessage(result.success ? "Trigger retired." : result.error); if (view) await loadPlan(view.plan.id); }
  const pages = Math.max(1, Math.ceil((plans?.total_count ?? 0) / 10));
  return <div className="min-w-0 space-y-4">
    {message ? <p role="status" className="rounded-xl bg-neutral-100 p-3 text-sm font-semibold">{message}</p> : null}
    <section className="space-y-3 rounded-2xl border bg-white p-4 sm:p-5" aria-labelledby="plans"><h2 id="plans" className="text-lg font-bold">Approved inspection plans</h2>
      {!plans ? <p role="status" className="text-sm">Loading…</p> : !plans.rows.length ? <p className="text-sm text-neutral-600">No approved inspection plan. Approve one under Quality first.</p>
        : <ul className="divide-y rounded-xl border">{plans.rows.map(plan => <li key={plan.id}><button type="button" onClick={() => setSelected(plan.id)} aria-pressed={selected === plan.id}
          className={`flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left text-sm ${selected === plan.id ? "bg-neutral-100" : ""}`}><span className="font-bold">{plan.profile_code} · v{plan.version}</span><span>{plan.items} characteristic(s) · {plan.triggers} trigger(s)</span></button></li>)}</ul>}
      {pages > 1 ? <nav aria-label="Plan pages" className="flex items-center justify-between text-sm"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="min-h-10 rounded-lg border px-3 disabled:opacity-40">Previous</button><span>Page {page} of {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className="min-h-10 rounded-lg border px-3 disabled:opacity-40">Next</button></nav> : null}
    </section>
    {view ? <section className="space-y-3 rounded-2xl border bg-white p-4 sm:p-5" aria-labelledby="triggers"><h2 id="triggers" className="text-lg font-bold">Triggers for v{view.plan.version}</h2>
      <p className="text-sm text-neutral-600">{view.plan.sampling_instruction}</p>
      {view.triggers.length ? <ul className="divide-y rounded-xl border text-sm">{view.triggers.map(trigger => <li key={trigger.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
        <span className={trigger.status === "retired" ? "text-neutral-400 line-through" : ""}>{SAMPLING_KINDS[trigger.kind]}{trigger.every_n ? ` (N = ${trigger.every_n})` : ""} · {trigger.item_ids?.length ? `${trigger.item_ids.length} characteristic(s)` : "all characteristics"}{trigger.blocks_release ? " · blocks QC release" : ""}</span>
        {view.can_edit && trigger.status === "active" ? <button type="button" onClick={() => retire(trigger.id)} className="min-h-9 rounded-lg border px-3 text-xs font-bold">Retire</button> : null}</li>)}</ul>
        : <p className="text-sm text-neutral-600">No triggers. Without them, samples are still taken by rounds and are not created automatically.</p>}
      {view.can_edit ? <div className="space-y-3 rounded-xl bg-neutral-50 p-3">
        <label className="block max-w-sm text-sm font-semibold">When<select className="mt-1 h-11 w-full rounded-xl border px-3" value={form.kind} onChange={event => setForm({ ...form, kind: event.target.value as SamplingKind })}>{Object.entries(SAMPLING_KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {form.kind === "every_n_pushes" || form.kind === "every_n_bundles" ? <div className="max-w-xs"><NumericField label="Every how many" value={form.every} onChange={value => setForm({ ...form, every: value })} decimal={false} /></div> : null}
        <fieldset><legend className="text-sm font-semibold">Characteristics (none ticked = all)</legend><div className="mt-1 flex flex-wrap gap-3">{view.items.map(item => <label key={item.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={form.items.includes(item.id)} onChange={event => setForm({ ...form, items: event.target.checked ? [...form.items, item.id] : form.items.filter(x => x !== item.id) })} />{item.characteristic}</label>)}</div></fieldset>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" className="h-5 w-5" checked={form.blocks} onChange={event => setForm({ ...form, blocks: event.target.checked })} />A missing sample blocks QC release</label>
        <button type="button" onClick={save} className="min-h-11 rounded-xl bg-neutral-950 px-4 text-sm font-bold text-white">Add trigger</button>
      </div> : null}
    </section> : null}
  </div>;
}

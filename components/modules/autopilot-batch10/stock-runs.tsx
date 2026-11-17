"use client";

// AP-068: make-to-stock runs for idle press capacity. Targets say how much of a fast-moving profile to hold; when the
// presses have free capacity, the system suggests runs for profiles below target, within the billets in stock and the
// holding limit. The owner or planner approves; approval gives the planner a task. Nothing is planned automatically.
import { useState } from "react";
import Link from "next/link";
import { fmtDay, fmtWhen } from "@/lib/order-to-cash/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";
import { ProfilePicker } from "../autopilot-batch9/pickers";

type Note = { tone: "ok" | "error"; text: string } | null;
type Idle = { configured: boolean; weeks: { week_start: string; available_kg: number; booked_kg: number; free_kg: number; working_days: number; load_percent: number | null }[]; free_kg: number; available_kg: number; idle_hours: number | null; can_decide: boolean; open_suggestions: number; active_targets: number };
type Suggestion = { id: string; profile_id: string; profile_code: string; profile_name: string; finish: string; piece_length_m: number; week_start: string; suggested_kg: number; status: string; decision_note: string | null; decided_by: string | null; decided_at: string | null; task_id: string | null;
  basis: { demand_90d_kg: number; stock_kg: number; target_kg: number; max_kg: number; free_capacity_kg: number; billet_free_kg: number; alloy: string | null; limited_by: string; idle_hours: number | null } };
type Target = { id: string; profile_id: string; profile_code: string; profile_name: string; finish: string; piece_length_m: number; target_kg: number; max_kg: number; note: string | null; stock_kg: number; demand_90d_kg: number };
type Mover = { profile_id: string; profile_code: string; profile_name: string; demand_90d_kg: number; orders: number; free_stock_kg: number; targets: number };
const kg = (v: unknown) => (v === null || v === undefined ? "—" : `${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })} kg`);
const LIMIT: Record<string, string> = { target: "fills the target", capacity: "limited by free press capacity", billets: "limited by billets in stock" };
const FINISHES = ["mill_finish", "powder_coating", "anodizing"];

export function StockRunsClient() {
  const idle = useApRead<Idle>("ap_stock_runs", "idle", {}, []);
  const [status, setStatus] = useState("suggested"); const [page, setPage] = useState(1); const [note, setNote] = useState<Note>(null);
  const list = useApRead<{ rows: Suggestion[]; total_count: number; can_decide: boolean }>("ap_stock_runs", "list", { page, status }, []);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [tpage, setTpage] = useState(1); const [search, setSearch] = useState("");
  const targets = useApRead<{ rows: Target[]; total_count: number; can_decide: boolean }>("ap_stock_runs", "targets", { page: tpage, ...(search.trim() ? { search: search.trim() } : {}) }, []);
  const [mpage, setMpage] = useState(1);
  const movers = useApRead<{ rows: Mover[]; total_count: number }>("ap_stock_runs", "fast_movers", { page: mpage }, []);
  const [profile, setProfile] = useState<{ id: string; name: string } | null>(null); const [finish, setFinish] = useState("mill_finish"); const [length, setLength] = useState(""); const [target, setTarget] = useState(""); const [max, setMax] = useState("");
  const canDecide = Boolean(idle.data?.can_decide);
  const reloadAll = () => { void idle.reload(); void list.reload(); void targets.reload(); void movers.reload(); };
  async function run(command: string, payload: Record<string, unknown>, ok: string) { if (await apWrite("ap_stock_runs", command, payload, setNote, ok)) reloadAll(); }
  async function saveTarget() {
    if (!profile || !(Number(length) > 0) || !(Number(target) > 0)) { setNote({ tone: "error", text: "Choose the profile and enter the piece length and the target stock." }); return; }
    if (max.trim() && Number(max) < Number(target)) { setNote({ tone: "error", text: "The holding limit cannot be below the target stock." }); return; }
    const out = await apWrite("ap_stock_runs", "save_target", { profile_id: profile.id, finish, piece_length_m: Number(length), target_kg: Number(target), ...(max.trim() ? { max_kg: Number(max) } : {}) }, setNote, "Target saved.");
    if (out) { setProfile(null); setLength(""); setTarget(""); setMax(""); reloadAll(); }
  }
  return <div className="space-y-5">
    <Section title="Idle press capacity" description="This week and next, from the shift pattern, the factory calendar, maintenance windows and planned jobs."
      actions={canDecide ? <button type="button" className={secondaryClass} onClick={() => run("suggest", {}, "Suggestions refreshed.")}>Suggest runs now</button> : undefined}>
      {idle.loading && !idle.data ? <Loading what="capacity" /> : idle.error ? <Failure text={idle.error} /> : idle.data ? !idle.data.configured ? <Empty>Press shift capacity is not set up, so idle capacity cannot be shown. Set shifts in Production → Capacity.</Empty> : <>
        <dl className="grid gap-2 sm:grid-cols-4">{[["Free capacity", kg(idle.data.free_kg)], ["Idle hours", idle.data.idle_hours === null ? "—" : `${idle.data.idle_hours} h`], ["Open suggestions", idle.data.open_suggestions], ["Stock targets", idle.data.active_targets]].map(([l, v]) =>
          <div key={String(l)} className="rounded-xl bg-neutral-50 p-3"><dt className="text-xs font-bold uppercase text-neutral-500">{l}</dt><dd className="text-xl font-black tabular-nums">{v}</dd></div>)}</dl>
        <ul className="divide-y rounded-xl border text-sm">{idle.data.weeks.map(w => <li key={w.week_start} className="flex flex-wrap justify-between gap-2 p-3"><span>Week of {fmtDay(w.week_start)} · {w.working_days} working day(s)</span>
          <span className="tabular-nums">{kg(w.free_kg)} free of {kg(w.available_kg)}{w.load_percent !== null ? ` · ${w.load_percent}% loaded` : ""}</span></li>)}</ul>
        {idle.data.free_kg > 0 && !idle.data.active_targets ? <p className="text-sm text-amber-900">There is idle capacity but no stock target, so nothing can be suggested. Set targets for fast-moving profiles below.</p> : null}
      </> : null}
    </Section>
    <Section title="Suggested stock runs" description="Fastest movers first. Each shows where its numbers came from.">
      <select aria-label="Show" className={`${inputClass} sm:w-56`} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
        <option value="suggested">Waiting for a decision</option><option value="approved">Approved</option><option value="dismissed">Dismissed</option><option value="all">All</option></select>
      {list.loading && !list.data ? <Loading what="suggestions" /> : list.error ? <Failure text={list.error} /> : list.data ? <>
        {list.data.rows.length ? <ul className="space-y-3">{list.data.rows.map(s => <li key={s.id} className="space-y-2 rounded-xl border border-neutral-200 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><p><Link href={`/profiles/${s.profile_id}`} className="font-bold underline">{s.profile_code}</Link> · {s.profile_name} · {s.piece_length_m} m {s.finish.replaceAll("_", " ")} · <b>make {kg(s.suggested_kg)}</b></p><Pill value={s.status} /></div>
          <p className="text-neutral-600">Week of {fmtDay(s.week_start)}. Stock {kg(s.basis.stock_kg)} against a target of {kg(s.basis.target_kg)} (holding limit {kg(s.basis.max_kg)}); ordered {kg(s.basis.demand_90d_kg)} in 90 days. Free capacity {kg(s.basis.free_capacity_kg)}; {s.basis.alloy ?? "alloy not set"} billets free {kg(s.basis.billet_free_kg)}. The quantity {LIMIT[s.basis.limited_by] ?? ""}.</p>
          {s.status === "suggested" && list.data!.can_decide ? <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={buttonClass} onClick={() => run("approve", { id: s.id }, "Approved. A planning task was created; the job is planned through production planning.")}>Approve</button>
            <input className={`${inputClass} sm:w-64`} placeholder="Reason to dismiss" maxLength={300} value={reason[s.id] ?? ""} onChange={e => setReason({ ...reason, [s.id]: e.target.value })} />
            <button type="button" className={secondaryClass} disabled={(reason[s.id] ?? "").trim().length < 3} onClick={() => run("dismiss", { id: s.id, note: (reason[s.id] ?? "").trim() }, "Dismissed.")}>Dismiss</button></div> : null}
          {s.decided_by ? <p className="text-xs text-neutral-500">{s.status === "approved" ? "Approved" : "Dismissed"} by {s.decided_by} {fmtWhen(s.decided_at)}{s.decision_note ? ` · ${s.decision_note}` : ""}{s.task_id ? <> · <Link className="underline" href={`/tasks/${s.task_id}`}>planning task</Link></> : null}</p> : null}
        </li>)}</ul> : <Empty>{status === "suggested" ? "No suggestion is waiting. Suggestions appear when presses have free capacity and a targeted profile is below its stock." : "Nothing in this list."}</Empty>}
        <Pager page={page} total={list.data.total_count} onPage={setPage} />
      </> : null}
      <Message value={note} />
    </Section>
    <Section title="Stock targets" description="How much of a profile, finish and length to hold. Suggestions never exceed the holding limit.">
      <input type="search" aria-label="Search targets" placeholder="Search profile" className={`${inputClass} sm:w-72`} value={search} maxLength={80} onChange={e => { setSearch(e.target.value); setTpage(1); }} />
      {targets.loading && !targets.data ? <Loading what="targets" /> : targets.error ? <Failure text={targets.error} /> : targets.data ? <>
        {targets.data.rows.length ? <ul className="divide-y rounded-xl border">{targets.data.rows.map(t => <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <span><b>{t.profile_code}</b> · {t.piece_length_m} m {t.finish.replaceAll("_", " ")} · target {kg(t.target_kg)} (limit {kg(t.max_kg)}) · stock {kg(t.stock_kg)} · 90-day demand {kg(t.demand_90d_kg)}</span>
          {canDecide ? <button type="button" className="min-h-11 text-sm font-bold underline" onClick={() => run("retire_target", { id: t.id }, "Target removed.")}>Remove</button> : null}</li>)}</ul> : <Empty>No stock target yet.</Empty>}
        <Pager page={tpage} total={targets.data.total_count} onPage={setTpage} />
      </> : null}
      {canDecide ? <div className="space-y-2 rounded-xl bg-neutral-50 p-3">
        <h3 className="text-sm font-bold">Set a target</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <ProfilePicker value={profile} onChange={setProfile} label="Profile" />
          <label className="block text-sm font-semibold">Finish<select className={`${inputClass} mt-1`} value={finish} onChange={e => setFinish(e.target.value)}>{FINISHES.map(f => <option key={f} value={f}>{f.replaceAll("_", " ")}</option>)}</select></label>
          <label className="block text-sm font-semibold">Piece length (m)<input inputMode="decimal" className={`${inputClass} mt-1`} value={length} onChange={e => setLength(e.target.value)} /></label>
          <label className="block text-sm font-semibold">Target stock (kg)<input inputMode="decimal" className={`${inputClass} mt-1`} value={target} onChange={e => setTarget(e.target.value)} /></label>
          <label className="block text-sm font-semibold">Holding limit (kg)<input inputMode="decimal" className={`${inputClass} mt-1`} value={max} placeholder="Same as target" onChange={e => setMax(e.target.value)} /></label>
        </div>
        <button type="button" className={buttonClass} onClick={saveTarget}>Save target</button>
      </div> : null}
    </Section>
    <Section title="Fast movers (last 90 days)" description="Profiles by ordered kilograms, to decide which deserve a stock target.">
      {movers.loading && !movers.data ? <Loading what="fast movers" /> : movers.error ? <Failure text={movers.error} /> : movers.data ? <>
        {movers.data.rows.length ? <ul className="divide-y rounded-xl border">{movers.data.rows.map(m => <li key={m.profile_id} className="flex flex-wrap justify-between gap-2 p-3 text-sm">
          <span><b>{m.profile_code}</b> · {m.profile_name} · {m.orders} order(s)</span><span className="tabular-nums">{kg(m.demand_90d_kg)} ordered · {kg(m.free_stock_kg)} free · {m.targets ? `${m.targets} target(s)` : "no target"}</span></li>)}</ul>
          : <Empty>No orders in the last 90 days.</Empty>}
        <Pager page={mpage} total={movers.data.total_count} onPage={setMpage} />
      </> : null}
    </Section>
  </div>;
}

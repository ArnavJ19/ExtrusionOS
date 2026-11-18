"use client";

// AP-011 / AP-014 / AP-066 / AP-087 / AP-012: the running job at a press. One tap per billet records a push (billet,
// weight and time come from the job's linked lot); undo is open for 30 seconds; an idle press asks for one reason; the
// shift target from the published plan is shown against live pushes; closing the job confirms the expected output with
// only rejects typed on the large keypad. Taps that cannot reach the server wait on this station and are sent again
// (AP-094: every tap carries its own request ID through public.ap_offline, so a retry never records a push twice).
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Undo2 } from "lucide-react";
import { autopilotAction } from "@/lib/actions/autopilot";
import { IDLE_REASONS, tapQueueKey, type IdleReason, type QueuedTap } from "@/lib/press/press-floor";
import { legacyTapEntries } from "@/lib/offline/queue";
import { OfflineQueuePanel, useOfflineQueue } from "@/components/modules/offline/offline-queue";
import { fmtClock, fmtKg, fmtNum, type PushResult, type StationView } from "@/lib/press/types";
import { ProposalCards } from "@/components/modules/autopilot/proposal-cards";
import { WorkstationMode } from "@/components/ui/numeric-field";
import { floorText, type FloorKey, type FloorLanguage, type FloorText } from "@/lib/i18n/floor";

type Props = { companyId: string; userId: string; sessionId: string; today: string; onExpired: (message: string) => void; onRenewed: (expiresAt: string) => void; lang?: FloorLanguage };

function Bar({ label, actual, target, unit, t }: { label: string; actual: number; target: number | null; unit: string; t: FloorText }) {
  const share = target && target > 0 ? Math.min(100, Math.round(actual * 100 / target)) : null;
  return <div className="min-w-0">
    <div className="flex items-baseline justify-between gap-2 text-sm"><span className="font-semibold">{label}</span>
      <span className="tabular-nums">{fmtNum(actual, 1)} / {target === null ? t("ps.noTarget") : `${fmtNum(target, 1)} ${unit}`}</span></div>
    <div className="mt-1 h-3 overflow-hidden rounded-full bg-neutral-200" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={share ?? undefined}>
      <div className="h-full rounded-full bg-emerald-600" style={{ width: `${share ?? 0}%` }} /></div>
  </div>;
}

export function PressStation({ companyId, userId, sessionId, today, onExpired, onRenewed, lang = "en" }: Props) {
  const t = floorText(lang);
  const [view, setView] = useState<StationView | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [note, setNote] = useState("");
  const [closing, setClosing] = useState(false);
  const [closeState, setCloseState] = useState<{ ready: boolean; messages: string[]; key: number }>({ ready: false, messages: [], key: 0 });
  const callbacks = useRef({ onExpired, onRenewed });
  useEffect(() => { callbacks.current = { onExpired, onRenewed }; }, [onExpired, onRenewed]);
  const key = tapQueueKey(companyId, userId);

  const load = useCallback(async () => {
    const result = await autopilotAction("ap_press", "station", { session_id: sessionId, ...(jobId ? { job_id: jobId } : {}) });
    if (!result.success) {
      if (/session expired|not available to your current session/i.test(result.error)) callbacks.current.onExpired(result.error);
      else setMessage(result.error);
      return;
    }
    const data = result.data as StationView;
    setView(data); callbacks.current.onRenewed(data.expires_at);
  }, [jobId, sessionId]);

  const queue = useOfflineQueue(companyId, userId, () => { void load(); });
  const adopt = queue.adopt;
  // Taps saved by the earlier station queue (localStorage) move into the offline queue once, keeping their IDs.
  useEffect(() => {
    try { const legacy = legacyTapEntries(queue.owner, localStorage.getItem(key)); if (legacy.length) { void adopt(legacy); } localStorage.removeItem(key); } catch { /* storage may be blocked */ }
  }, [adopt, key, queue.owner]);

  useEffect(() => {
    void load();
    const poll = setInterval(() => { void load(); }, 15000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [load]);

  async function tap() {
    if (!view?.job || busy) return;
    const entry: QueuedTap = { id: crypto.randomUUID(), session_id: sessionId, job_id: view.job.id, client_at: new Date().toISOString() };
    setBusy(true); setMessage(null);
    try {
      const result = await queue.submit({ rpc: "ap_press", command: "push", payload: entry, label: `Press push (${view.job.job_number ?? "job"})`, requestId: entry.id });
      if (result.kind === "conflict") setMessage(result.message);
      else if (result.kind === "retry") setMessage(t("ps.offline"));
      else {
        const push = result.data as PushResult;
        if (push.state === "double_tap") setMessage(lang === "hi" ? t("ps.doubleTap") : push.message ?? t("ps.doubleTap"));
        if (push.expires_at) callbacks.current.onRenewed(push.expires_at);
        if (push.samples_created) setMessage(t("ps.sample", { seq: push.seq }));
        await load();
      }
    } finally { setBusy(false); }
  }

  async function undo() {
    if (!view?.job?.undo) return;
    setBusy(true);
    const result = await autopilotAction("ap_press", "undo", { session_id: sessionId, push_id: view.job.undo.push_id });
    setBusy(false);
    setMessage(result.success ? t("ps.undone", { seq: view.job.undo.seq }) : result.error);
    await load();
  }

  async function answer(reason: IdleReason) {
    if (reason === "other" && note.trim().length < 3) { setMessage(t("ps.otherNote")); return; }
    setBusy(true);
    const result = await autopilotAction("ap_press", "idle_answer", { session_id: sessionId, reason, ...(reason === "other" ? { note: note.trim() } : {}) });
    setBusy(false);
    setMessage(result.success ? t("ps.reasonRecorded") : result.error);
    setNote("");
    await load();
  }

  async function prepareClose() {
    if (!view?.job) return;
    setClosing(true);
    const result = await autopilotAction("ap_press", "expected", { job_id: view.job.id });
    if (!result.success) { setCloseState(state => ({ ready: false, messages: [result.error], key: state.key + 1 })); return; }
    const data = result.data as { state: string; expected: { blockers: string[]; missing: string[] } };
    setCloseState(state => ({ ready: data.state === "ready", messages: [...(data.expected?.blockers ?? []), ...(data.expected?.missing ?? [])], key: state.key + 1 }));
  }

  if (!view) return <p role="status" className="rounded-2xl border bg-white p-5">{t("ps.loading")}</p>;
  const job = view.job;
  const undoLeft = job?.undo ? Math.min(30, Math.max(0, Math.ceil((Date.parse(job.undo.until) - now) / 1000))) : 0;
  const lastAt = view.last_push ? Date.parse(view.last_push.at) : null;
  const idleMinutes = lastAt && job ? Math.floor((now - lastAt) / 60000) : 0;
  const idle = Boolean(job && lastAt && idleMinutes >= view.idle_gap_minutes);
  const answered = view.idle?.reason ?? null;
  const target = view.shift?.target;

  return <WorkstationMode><div className="space-y-4">
    <OfflineQueuePanel queue={queue} what={lang === "hi" ? "टैप" : "tap(s)"} place={lang === "hi" ? "स्टेशन" : "station"} lang={lang} />
    {view.running_jobs.length > 1 ? <div role="group" aria-label={t("ps.runningJobs")} className="flex flex-wrap gap-2">
      {view.running_jobs.map(item => <button key={item.id} type="button" aria-pressed={job?.id === item.id} onClick={() => { setJobId(item.id); setClosing(false); }}
        className={`min-h-12 rounded-xl border px-4 font-bold ${job?.id === item.id ? "border-neutral-950 bg-neutral-950 text-white" : "border-neutral-300 bg-white"}`}>{item.job_number ?? "Job"}</button>)}
    </div> : null}
    {!job ? <section className="rounded-2xl border bg-white p-5"><p className="font-bold">{t("ps.noJob", { press: view.machine_name })}</p>
      <p className="mt-1 text-sm text-neutral-600">{t("ps.noJobHelp")}</p></section>
      : <section aria-label="Running job" className="space-y-4 rounded-3xl border bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">{t("ps.running")}</p>
            <h2 className="text-2xl font-black [overflow-wrap:anywhere]">{job.job_number}</h2>
            <p className="text-sm text-neutral-600">{job.profile_code ?? t("ps.profile")} · {t("ps.die")} {job.die_number ?? "—"} · {t("ps.plan")} {fmtKg(job.planned_quantity_kg, 0)}</p></div>
          <div className="text-right"><p className="text-4xl font-black tabular-nums">{job.pushes}</p><p className="text-sm text-neutral-600">{t("ps.pushes")} · {fmtKg(job.billet_kg)} {t("ps.billet")}</p>
            {job.linked_billets ? <p className="text-xs text-neutral-600">{t("ps.linkedLeft", { left: job.linked_remaining, total: job.linked_billets })}</p> : <p className="text-xs text-amber-800">{t("ps.noLinked")}</p>}</div>
        </div>
        <button type="button" onClick={tap} disabled={busy} className="flex min-h-40 w-full flex-col items-center justify-center rounded-3xl bg-emerald-600 text-white shadow-lg active:bg-emerald-700 disabled:opacity-60">
          <span className="text-4xl font-black">{t("ps.tap")}</span><span className="mt-1 text-base font-semibold">{t("ps.tapHelp")}</span></button>
        {job.undo && undoLeft > 0 ? <button type="button" onClick={undo} disabled={busy} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 border-neutral-950 bg-white text-lg font-black">
          <Undo2 className="h-5 w-5" aria-hidden="true" />{t("ps.undo", { seq: job.undo.seq, s: undoLeft })}</button> : null}
        {idle && !answered ? <div role="alert" className="space-y-3 rounded-2xl border-2 border-amber-500 bg-amber-50 p-4">
          <p className="text-lg font-black text-amber-950">{t("ps.idleAsk", { m: idleMinutes })}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{IDLE_REASONS.map(reason => <button key={reason.value} type="button" disabled={busy} onClick={() => answer(reason.value)}
            className="min-h-16 rounded-xl border border-amber-700 bg-white px-2 text-lg font-bold">{t(`idle.${reason.value}` as FloorKey)}</button>)}</div>
          <label className="block text-sm font-semibold">{t("ps.note")}<input className="mt-1 h-12 w-full rounded-xl border border-neutral-300 bg-white px-3" value={note} maxLength={300} onChange={event => setNote(event.target.value)} /></label>
          <p className="text-xs text-amber-900">{t("ps.idleNever")}</p>
        </div> : idle && answered ? <p className="rounded-2xl bg-neutral-100 p-3 text-sm font-semibold">{t("ps.idleAnswered", { m: idleMinutes, reason: IDLE_REASONS.some(r => r.value === answered) ? t(`idle.${answered}` as FloorKey) : answered })}</p> : null}
        {job.samples_open ? <p className="rounded-xl bg-sky-50 p-3 text-sm font-semibold text-sky-900">{t("ps.samples", { n: job.samples_open })}</p> : null}
        <div className="rounded-2xl border border-neutral-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold">{t("ps.close")}</p>
            <button type="button" onClick={prepareClose} className="min-h-12 rounded-xl border border-neutral-950 px-4 font-bold">{closing ? t("ps.refreshExpected") : t("ps.closeFromPushes")}</button></div>
          {closing ? <div className="mt-3 space-y-3">
            {closeState.messages.length ? <ul className="list-disc space-y-1 rounded-xl bg-amber-50 p-3 pl-6 text-sm text-amber-900">{closeState.messages.map(item => <li key={item}>{item}</li>)}</ul> : null}
            {closeState.ready ? <ProposalCards type="production.expected_output" target={job.id} initial={null} today={today} reloadKey={closeState.key} onDecided={() => { void load(); }}
              title={t("ps.expectedTitle")} description={t("ps.expectedHelp")} emptyText={t("ps.expectedEmpty")} /> : null}
          </div> : null}
        </div>
      </section>}
    {view.shift ? <section aria-label="Shift target" className="space-y-3 rounded-2xl border bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="font-bold">{t("ps.shiftTarget", { code: view.shift.code })}</p>
        <p className="text-sm text-neutral-600">{fmtClock(view.shift.starts_at)}–{fmtClock(view.shift.ends_at)}</p></div>
      {target && target.slots > 0 ? <>
        <Bar t={t} label={t("ps.barPushes")} actual={view.shift.actual.pushes} target={target.target_pushes} unit={t("ps.pushes")} />
        <Bar t={t} label={t("ps.barOutput")} actual={view.shift.actual.estimated_output_kg} target={target.target_kg} unit="kg" />
        <p className="text-xs text-neutral-600">{lang === "hi" ? t("ps.targetNote", { m: target.maintenance_minutes, d: target.die_changes, a: fmtNum(target.die_change_allowance_minutes) }) : `From the published plan, less ${target.maintenance_minutes} min planned maintenance and ${target.die_changes} die change(s) at ${fmtNum(target.die_change_allowance_minutes)} min each (${target.allowance_basis === "measured" ? "measured average" : "press setting"}).`}{target.pushes_unknown ? ` ${t("ps.pushesUnknown")}` : ""}</p>
      </> : <p className="text-sm text-neutral-600">{t("ps.noPlan", { n: view.shift.actual.pushes })}</p>}
    </section> : null}
    {message ? <p role="status" className="rounded-xl bg-neutral-100 p-3 text-sm font-semibold [overflow-wrap:anywhere]">{message}</p> : null}
    {job ? <Link href={`/production/${job.id}`} className="block text-sm font-semibold underline">{t("ps.openRecord")}</Link> : null}
  </div></WorkstationMode>;
}

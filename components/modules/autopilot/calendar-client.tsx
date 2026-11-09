"use client";

// AP-004: the factory calendar. The plant head enters the year's holidays and shutdowns once; delivery proposals and
// capacity skip those days, and lead times count in calendar or working days as chosen here.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { autopilotAction } from "@/lib/actions/autopilot";
import { CALENDAR_KINDS, WEEKDAYS, addWorkingDays, calendarExceptionInputSchema, calendarFromRead, calendarSettingsSchema, isWorkingDay, plusDays, type CalendarRead } from "@/lib/calendar/working-time";

export function CalendarClient({ initial, today }: { initial: CalendarRead; today: string }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [weeklyOff, setWeeklyOff] = useState<number[]>(initial.settings.weekly_off);
  const [shifts, setShifts] = useState(initial.settings.shifts);
  const [basis, setBasis] = useState(initial.settings.promise_basis);
  const [entry, setEntry] = useState({ date_from: "", date_to: "", kind: "holiday" as keyof typeof CALENDAR_KINDS, label: "" });
  const [check, setCheck] = useState({ start: today, days: "10" });
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);
  const calendar = calendarFromRead({ ...data, settings: { ...data.settings, weekly_off: weeklyOff, promise_basis: basis } });

  async function reload() {
    const result = await autopilotAction("ap_calendar", "read", { from: data.from, to: data.to });
    if (result.success) setData(result.data as CalendarRead);
    router.refresh();
  }
  async function saveSettings() {
    const parsed = calendarSettingsSchema.safeParse({ weekly_off: weeklyOff, shifts, promise_basis: basis });
    if (!parsed.success) return setMessage({ text: parsed.error.issues[0]?.message ?? "Check the settings", tone: "error" });
    setBusy(true);
    const result = await autopilotAction("ap_calendar", "save_settings", parsed.data);
    setBusy(false);
    setMessage(result.success ? { text: "Calendar settings saved.", tone: "ok" } : { text: result.error, tone: "error" });
    if (result.success) await reload();
  }
  async function addEntry() {
    const parsed = calendarExceptionInputSchema.safeParse({ ...entry, date_to: entry.date_to || entry.date_from });
    if (!parsed.success) return setMessage({ text: parsed.error.issues[0]?.message ?? "Check the entry", tone: "error" });
    setBusy(true);
    const result = await autopilotAction("ap_calendar", "add_exception", parsed.data);
    setBusy(false);
    setMessage(result.success ? { text: `${CALENDAR_KINDS[parsed.data.kind]} added.`, tone: "ok" } : { text: result.error, tone: "error" });
    if (result.success) { setEntry({ date_from: "", date_to: "", kind: "holiday", label: "" }); await reload(); }
  }
  async function removeEntry(id: string) {
    setBusy(true);
    const result = await autopilotAction("ap_calendar", "remove_exception", { id });
    setBusy(false);
    setMessage(result.success ? { text: "Entry removed.", tone: "ok" } : { text: result.error, tone: "error" });
    if (result.success) await reload();
  }

  const days = Number(check.days);
  let promise: { working: string; calendar: string } | null = null;
  try { if (/^\d{4}-\d{2}-\d{2}$/.test(check.start) && Number.isInteger(days) && days >= 0 && days <= 365) promise = { working: addWorkingDays(calendar, check.start, days), calendar: plusDays(check.start, days) }; } catch { promise = null; }
  const next30 = Array.from({ length: 35 }, (_, index) => plusDays(today, index));

  return <div className="space-y-5">
    {message ? <p role={message.tone === "error" ? "alert" : "status"} className={`rounded-xl p-3 text-sm font-semibold ${message.tone === "error" ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>{message.text}</p> : null}
    <section className="grid gap-4 lg:grid-cols-2">
      <div className="min-w-0 space-y-3 rounded-2xl border border-neutral-200 bg-white p-4">
        <h2 className="text-lg font-bold">Next five weeks</h2>
        <div className="grid grid-cols-7 gap-1 text-center text-xs" role="grid" aria-label="Working days for the next five weeks">
          {next30.map(value => { const working = isWorkingDay(calendar, value); return <div key={value} role="gridcell" title={working ? "Working day" : "Not a working day"}
            className={`rounded-lg p-1.5 ${working ? "bg-emerald-50 text-emerald-900" : "bg-neutral-200 text-neutral-600 line-through"}`}><span className="block font-bold">{value.slice(8)}</span><span>{WEEKDAYS[new Date(`${value}T00:00:00Z`).getUTCDay()].slice(0, 2)}</span></div>; })}
        </div>
        <div className="rounded-xl bg-neutral-50 p-3 text-sm">
          <p className="font-semibold">Promise check</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="text-xs font-semibold">From<input type="date" className="mt-1 block h-10 rounded-lg border border-neutral-300 bg-white px-2 text-sm" value={check.start} onChange={event => setCheck({ ...check, start: event.target.value })} /></label>
            <label className="text-xs font-semibold">Lead days<input inputMode="numeric" className="mt-1 block h-10 w-20 rounded-lg border border-neutral-300 bg-white px-2 text-sm" value={check.days} onChange={event => setCheck({ ...check, days: event.target.value.replace(/\D/g, "") })} /></label>
          </div>
          {promise ? <p className="mt-2">{days} working days → <strong>{promise.working}</strong>; {days} calendar days → {promise.calendar}. Promises use <strong>{basis === "working" ? "working days" : "calendar days"}</strong>.</p> : <p className="mt-2 text-neutral-600">Enter a start date and up to 365 days.</p>}
        </div>
      </div>
      <div className="min-w-0 space-y-3 rounded-2xl border border-neutral-200 bg-white p-4">
        <h2 className="text-lg font-bold">Weekly off, shifts and promise basis</h2>
        <fieldset disabled={!data.can_edit || busy} className="space-y-3">
          <legend className="sr-only">Weekly off days</legend>
          <div className="flex flex-wrap gap-2">{WEEKDAYS.map((name, index) => <label key={name} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-neutral-200 px-3 text-sm">
            <input type="checkbox" checked={weeklyOff.includes(index)} onChange={event => setWeeklyOff(event.target.checked ? [...weeklyOff, index].sort() : weeklyOff.filter(value => value !== index))} />{name}</label>)}</div>
          <div className="space-y-2">{shifts.map((shift, index) => <div key={index} className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-semibold">Shift<input className="mt-1 block h-10 w-16 rounded-lg border border-neutral-300 px-2 text-sm uppercase" value={shift.code} onChange={event => setShifts(shifts.map((item, i) => i === index ? { ...item, code: event.target.value.toUpperCase() } : item))} /></label>
            <label className="text-xs font-semibold">Starts<input type="time" className="mt-1 block h-10 rounded-lg border border-neutral-300 px-2 text-sm" value={shift.start} onChange={event => setShifts(shifts.map((item, i) => i === index ? { ...item, start: event.target.value } : item))} /></label>
            <label className="text-xs font-semibold">Ends<input type="time" className="mt-1 block h-10 rounded-lg border border-neutral-300 px-2 text-sm" value={shift.end} onChange={event => setShifts(shifts.map((item, i) => i === index ? { ...item, end: event.target.value } : item))} /></label>
            {shifts.length > 1 ? <button type="button" className="min-h-10 rounded-lg border px-3 text-sm" onClick={() => setShifts(shifts.filter((_, i) => i !== index))}>Remove</button> : null}
          </div>)}
            {shifts.length < 4 ? <button type="button" className="min-h-10 rounded-lg border px-3 text-sm font-semibold" onClick={() => setShifts([...shifts, { code: "", start: "06:00", end: "14:00" }])}>Add shift</button> : null}</div>
          <label className="block text-sm font-semibold">Count delivery lead times in
            <select className="mt-1 block h-11 w-full rounded-xl border border-neutral-300 bg-white px-3" value={basis} onChange={event => setBasis(event.target.value as "calendar" | "working")}>
              <option value="calendar">Calendar days (unchanged from before)</option><option value="working">Working days (skip holidays, shutdowns and weekly offs)</option></select></label>
          <p className="text-xs text-neutral-600">Press capacity always skips holidays, shutdowns and maintenance days. Receivable ageing and payment due dates stay in calendar days, as agreed payment terms are.</p>
          {data.can_edit ? <button type="button" onClick={saveSettings} className="min-h-11 rounded-xl bg-neutral-950 px-4 text-sm font-bold text-white">Save settings</button> : <p className="text-sm text-neutral-600">Only the owner, admin, factory manager or production manager can change the calendar.</p>}
        </fieldset>
      </div>
    </section>
    <section className="min-w-0 space-y-3 rounded-2xl border border-neutral-200 bg-white p-4">
      <h2 className="text-lg font-bold">Holidays, shutdowns and extra working days</h2>
      {data.can_edit ? <div className="grid gap-2 sm:grid-cols-5 sm:items-end">
        <label className="text-xs font-semibold">From<input type="date" className="mt-1 block h-11 w-full rounded-xl border border-neutral-300 px-2 text-sm" value={entry.date_from} onChange={event => setEntry({ ...entry, date_from: event.target.value })} /></label>
        <label className="text-xs font-semibold">To (optional)<input type="date" className="mt-1 block h-11 w-full rounded-xl border border-neutral-300 px-2 text-sm" value={entry.date_to} onChange={event => setEntry({ ...entry, date_to: event.target.value })} /></label>
        <label className="text-xs font-semibold">Kind<select className="mt-1 block h-11 w-full rounded-xl border border-neutral-300 bg-white px-2 text-sm" value={entry.kind} onChange={event => setEntry({ ...entry, kind: event.target.value as keyof typeof CALENDAR_KINDS })}>
          {Object.entries(CALENDAR_KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-xs font-semibold">Label<input className="mt-1 block h-11 w-full rounded-xl border border-neutral-300 px-2 text-sm" placeholder="Diwali shutdown" value={entry.label} maxLength={80} onChange={event => setEntry({ ...entry, label: event.target.value })} /></label>
        <button type="button" disabled={busy} onClick={addEntry} className="min-h-11 rounded-xl bg-neutral-950 px-4 text-sm font-bold text-white disabled:opacity-50">Add to calendar</button>
      </div> : null}
      {!data.exceptions.length ? <p className="rounded-xl border border-dashed border-neutral-300 p-4 text-sm text-neutral-600">No holidays or shutdowns are entered for {data.from} to {data.to}. Until they are, every day except the weekly off counts as working.</p>
        : <ul className="divide-y rounded-xl border border-neutral-200">{data.exceptions.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <span className="min-w-0"><strong>{item.label}</strong> · {CALENDAR_KINDS[item.kind]} · {item.date_from}{item.date_to !== item.date_from ? ` to ${item.date_to}` : ""} ({item.days} day{item.days === 1 ? "" : "s"})</span>
          {data.can_edit ? <button type="button" disabled={busy} onClick={() => removeEntry(item.id)} className="min-h-10 rounded-lg border px-3 text-sm">Remove</button> : null}
        </li>)}</ul>}
    </section>
  </div>;
}

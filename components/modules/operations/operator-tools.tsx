"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { canUseOperatorCommand, exceptionReasons, type OperatorCommand, type OperatorData, type OperatorRow, type ProfileAliasOption } from "@/lib/operations/operator-workflows";
import { requestOperatorWorkflow } from "@/lib/operations/operator-workflow-client";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import type { SessionContext } from "@/types/app";

function useWorkflow(read: OperatorCommand, onConfirmed?: (command: OperatorCommand) => void) {
  const router = useRouter();
  const key = JSON.stringify(read);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; data: OperatorData } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const held = useRef<OperatorCommand | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const confirmed = useRef(onConfirmed);
  useEffect(() => { confirmed.current = onConfirmed; }, [onConfirmed]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    setLoading(true); setError("");
    void requestOperatorWorkflow(JSON.parse(key)).then(result => {
      if (!current) return;
      if (result.success) { setLoaded({ key, data: result.data }); setUnavailable(false); }
      else { setLoaded(null); setError(result.error); setUnavailable(result.unavailable === true); }
      setLoading(false);
    });
    return () => { current = false; };
  }, [key, revision]);
  async function mutate(command: OperatorCommand) {
    if (pending.current || (held.current && uncertain && command !== held.current)) return false;
    held.current = command; pending.current = true; setBusy(true); setMessage(""); setError("");
    const result = await requestOperatorWorkflow(command);
    pending.current = false;
    if (!mounted.current) return false;
    setBusy(false);
    if (!result.success) {
      setError(result.error); setUncertain(result.uncertain === true); setUnavailable(result.unavailable === true);
      if (!result.uncertain) held.current = null;
      return false;
    }
    held.current = null; setUncertain(false); setUnavailable(false); confirmed.current?.(command); setMessage("Recorded successfully."); setRevision(value => value + 1); router.refresh();
    return true;
  }
  return { data: loaded?.key === key ? loaded.data : null, loading, error, message, busy, uncertain, unavailable, locked: busy || uncertain || unavailable || loading || loaded?.key !== key,
    mutate, retry: () => held.current ? mutate(held.current) : Promise.resolve(false), refresh: () => setRevision(value => value + 1) };
}
type Workflow = ReturnType<typeof useWorkflow>;
type ContextProps = { context: SessionContext };
const value = (row: OperatorRow, field: string) => String(row[field] ?? "");
function recorded(value: string) {
  const parsed = new Date(value.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(parsed) : "Recorded time unavailable";
}
function ToolFrame({ title, description, workflow: w, children }: { title: string; description: string; workflow: Workflow; children: React.ReactNode }) {
  return <Card className="min-w-0"><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="section-title">{title}</h2><p className="mt-2 text-sm text-slate-600">{description}</p></div><Button type="button" variant="secondary" disabled={w.busy || w.uncertain || w.loading} onClick={w.refresh}>Refresh</Button></div></CardHeader><CardContent className="min-w-0 space-y-4">
    {w.loading ? <p role="status" className="text-sm text-slate-500">Loading current information...</p> : null}
    {w.error ? <p role="alert" className="break-words rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{w.error}</p> : null}
    {w.message ? <p role="status" className="text-sm text-emerald-800">{w.message}</p> : null}
    {w.uncertain ? <Button type="button" disabled={w.busy} onClick={() => void w.retry()}>Retry the same request</Button> : null}
    {children}
  </CardContent></Card>;
}
function Pages({ page, total, blocked, onChange }: { page: number; total: number; blocked: boolean; onChange: (page: number) => void }) {
  const last = Math.max(1, Math.ceil(total / 10));
  useEffect(() => { if (!blocked && page > last) onChange(last); }, [page, last, blocked, onChange]);
  return <div className="flex flex-wrap items-center gap-3 text-sm"><Button type="button" variant="secondary" disabled={blocked || page <= 1} onClick={() => onChange(page - 1)}>Previous</Button><span>Page {page} of {last} · {total} recorded</span><Button type="button" variant="secondary" disabled={blocked || page >= last} onClick={() => onChange(page + 1)}>Next</Button></div>;
}
function Rows({ rows, render }: { rows: OperatorRow[]; render: (row: OperatorRow) => React.ReactNode }) {
  return rows.length ? <ul className="space-y-3">{rows.map(row => <li key={value(row, "id")} className="min-w-0 break-words rounded-xl border border-slate-200 p-3 text-sm">{render(row)}</li>)}</ul> : <p className="text-sm text-slate-500">None recorded.</p>;
}

export function CustomerAliasManager({ context, customerId }: ContextProps & { customerId: string }) {
  const [page, setPage] = useState(1), [alias, setAlias] = useState(""), [code, setCode] = useState("");
  const w = useWorkflow({ command: "aliases.list", customer_id: customerId, page }, command => { if (command.command === "aliases.create") { setAlias(""); setCode(""); setPage(1); } });
  const canWrite = canUseOperatorCommand(context.role, "aliases.create");
  return <ToolFrame title="Customer profile codes" description="Customer codes and familiar names map to canonical company profiles. Multiple matches always require a choice." workflow={w}>
    {canWrite ? <details><summary className="cursor-pointer font-semibold">Add a customer profile code</summary><form className="mt-3" onSubmit={async event => { event.preventDefault(); if (await w.mutate({ command: "aliases.create", customer_id: customerId, profile_code: code, alias, request_id: crypto.randomUUID() })) { setAlias(""); setCode(""); setPage(1); } }}><fieldset disabled={w.locked} className="grid min-w-0 gap-3 sm:grid-cols-2"><label className="space-y-1"><span className="form-label">Customer code or alias</span><input className="form-input" value={alias} maxLength={80} required onChange={event => setAlias(event.target.value)} /></label><label className="space-y-1"><span className="form-label">Exact canonical profile code</span><input className="form-input" value={code} maxLength={80} required onChange={event => setCode(event.target.value)} /></label><Button type="submit">Save customer code</Button></fieldset></form></details> : null}
    {w.data ? <><Rows rows={w.data.rows ?? []} render={row => <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold">{value(row, "alias")} → {value(row, "profile_code")}</p><p>{value(row, "profile_name")} · {row.is_active ? "Active" : "Deactivated; retained in history"}</p></div>{canWrite && row.is_active ? <Button type="button" variant="secondary" disabled={w.locked} onClick={() => void w.mutate({ command: "aliases.deactivate", customer_id: customerId, alias_id: value(row, "id") })}>Deactivate code</Button> : null}</div>} /><Pages page={page} total={w.data.total_count ?? 0} blocked={w.locked} onChange={setPage} /></> : null}
  </ToolFrame>;
}

export function CustomerProfileAliasPicker({ customerId, onSelect }: { customerId: string; onSelect: (option: ProfileAliasOption) => Promise<void> }) {
  const [alias, setAlias] = useState(""), [options, setOptions] = useState<ProfileAliasOption[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(""), [checked, setChecked] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const version = useRef(0);
  useEffect(() => () => { version.current += 1; }, []);
  return <details className="mt-3 text-xs"><summary className="cursor-pointer font-semibold text-slate-600">Find a customer code</summary><div className="mt-2 space-y-2"><label className="block space-y-1"><span>Exact customer profile code or alias</span><input disabled={selecting} className="form-input py-2 text-xs" value={alias} maxLength={80} onChange={event => { version.current += 1; setAlias(event.target.value); setOptions([]); setChecked(false); setBusy(false); setError(""); }} /></label><Button type="button" variant="secondary" disabled={busy || !alias.trim()} onClick={async () => { const request = ++version.current; setBusy(true); setError(""); const result = await requestOperatorWorkflow({ command: "aliases.search", customer_id: customerId, search: alias }); if (request !== version.current) return; setBusy(false); setChecked(true); if (result.success) setOptions(result.data.profiles ?? []); else { setOptions([]); setError(result.error); } }}>Check customer code</Button>
    {error ? <p role="alert" className="break-words text-amber-800">{error}</p> : null}
    {checked && !busy && !error && !options.length ? <p>No active exact match for this customer. Use the canonical profile search.</p> : null}
    {options.length > 1 ? <p className="font-semibold text-amber-800">This code has multiple matches. Choose the intended canonical profile.</p> : null}
    {options.map(option => <Button key={option.profile_id} type="button" variant="secondary" className="w-full justify-start whitespace-normal text-left text-xs" disabled={busy} onClick={async () => { const request = ++version.current; setBusy(true); setSelecting(true); setError(""); try { await onSelect(option); if (request === version.current) { setOptions([]); setChecked(false); } } catch { if (request === version.current) setError("The canonical profile could not be verified. Retry or use the canonical search."); } finally { if (request === version.current) { setBusy(false); setSelecting(false); } } }}>{option.alias} → {option.profile_code} · {option.profile_name}</Button>)}
    {options.length === 10 ? <p>Up to 10 matches are shown. Confirm the canonical code before selecting.</p> : null}
  </div></details>;
}

export function LocationGuidance({ context, entityType, entityId, readOnly = false }: ContextProps & { entityType: "die" | "inventory_item"; entityId: string; readOnly?: boolean }) {
  const [page, setPage] = useState(1), [location, setLocation] = useState(""), [reason, setReason] = useState("");
  const w = useWorkflow({ command: "locations.load", entity_type: entityType, entity_id: entityId, page }, command => { if (command.command === "locations.move") { setLocation(""); setReason(""); setPage(1); } });
  const canWrite = !readOnly && canUseOperatorCommand(context.role, "locations.move", entityType);
  return <ToolFrame title={entityType === "die" ? "Die retrieval location" : "Physical stock location"} description="Use the recorded shed, rack and level for retrieval. Confirm the material physically before picking; this location is not proof of stock quantity." workflow={w}>
    {w.data ? <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase text-slate-500">Current recorded location</p><p className="mt-2 break-words font-bold">{w.data.current_location?.trim() || "Not captured"}</p></div> : null}
    {canWrite ? <details><summary className="cursor-pointer font-semibold">Record a location move</summary><form className="mt-3" onSubmit={async event => { event.preventDefault(); if (!w.data) return; if (await w.mutate({ command: "locations.move", entity_type: entityType, entity_id: entityId, expected_location: w.data.current_location ?? "", location, reason, request_id: crypto.randomUUID() })) { setLocation(""); setReason(""); setPage(1); } }}><fieldset disabled={w.locked} className="min-w-0 space-y-3"><label className="block space-y-1"><span className="form-label">New physical location</span><input className="form-input" placeholder="Shed B / Rack 04 / Level 2" value={location} maxLength={160} required onChange={event => setLocation(event.target.value)} /></label><label className="block space-y-1"><span className="form-label">Reason for move</span><input className="form-input" value={reason} maxLength={500} required onChange={event => setReason(event.target.value)} /></label><Button type="submit">Confirm location move</Button><p className="text-xs text-slate-500">The old location remains in history. Stock quantity is unchanged. Refresh already-open retrieval forms after a move.</p></fieldset></form></details> : null}
    {w.data ? <><Rows rows={w.data.rows ?? []} render={row => <><p className="font-semibold">{value(row, "previous_location") || "Not captured"} → {value(row, "location") || "Not captured"}</p><p>{value(row, "reason")}</p><p className="mt-1 text-xs text-slate-500">Recorded {recorded(value(row, "recorded_at"))}</p></>} /><Pages page={page} total={w.data.total_count ?? 0} blocked={w.locked} onChange={setPage} /></> : null}
  </ToolFrame>;
}

export function ProductionExceptions({ context, jobId }: ContextProps & { jobId: string }) {
  const [page, setPage] = useState(1), [reason, setReason] = useState<keyof typeof exceptionReasons>("material_shortage"), [note, setNote] = useState("");
  const w = useWorkflow({ command: "exceptions.list", job_id: jobId, page }, command => { if (command.command === "exceptions.report") { setNote(""); setPage(1); } });
  const canWrite = canUseOperatorCommand(context.role, "exceptions.report");
  return <ToolFrame title="Production exceptions" description="Record a shortage, defect, die issue or breakdown against this job. Job, machine, reporter and recorded time are captured from current records." workflow={w}>
    {canWrite ? <details><summary className="cursor-pointer font-semibold">Record an exception</summary><form className="mt-3" onSubmit={async event => { event.preventDefault(); if (await w.mutate({ command: "exceptions.report", job_id: jobId, reason, note, request_id: crypto.randomUUID() })) { setNote(""); setPage(1); } }}><fieldset disabled={w.locked} className="min-w-0 space-y-3"><label className="block space-y-1"><span className="form-label">Exception reason</span><select aria-label="Exception reason" className="form-input" value={reason} onChange={event => setReason(event.target.value as keyof typeof exceptionReasons)}>{Object.entries(exceptionReasons).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="block space-y-1"><span className="form-label">Exception note{reason === "other" ? " (required)" : " (optional)"}</span><textarea className="form-input" value={note} maxLength={1000} required={reason === "other"} onChange={event => setNote(event.target.value)} /></label><Button type="submit">Record exception</Button><p className="text-xs text-slate-500">This records an observation. It does not invent a measured quantity, stop the job, or alter stock.</p></fieldset></form></details> : null}
    {w.data ? <><Rows rows={w.data.rows ?? []} render={row => <><p className="font-bold">{exceptionReasons[value(row, "reason") as keyof typeof exceptionReasons] ?? "Exception"}</p>{row.note ? <p className="whitespace-pre-wrap">{value(row, "note")}</p> : null}<p className="mt-1 text-xs text-slate-500">Reported by {value(row, "reporter_name")} · {recorded(value(row, "recorded_at"))}</p><p className="mt-1 text-xs text-slate-500">Recorded job operator: {value(row, "operator_name") || "Not captured"}</p></>} /><Pages page={page} total={w.data.total_count ?? 0} blocked={w.locked} onChange={setPage} /></> : null}
  </ToolFrame>;
}

function CommitmentHistory({ customerId, commitmentId }: { customerId: string; commitmentId: string }) {
  const [page, setPage] = useState(1);
  const w = useWorkflow({ command: "commitments.history", customer_id: customerId, commitment_id: commitmentId, page });
  return <ToolFrame title="Commitment change history" description="Earlier deadlines and recorded reasons are retained." workflow={w}>{w.data ? <><Rows rows={w.data.rows ?? []} render={row => <><p className="font-bold">{value(row, "event_type")} · {value(row, "previous_due_date")} → {value(row, "due_date")}</p><p>{value(row, "note")}</p><p className="mt-1 text-xs text-slate-500">{value(row, "reporter_name")} · {recorded(value(row, "recorded_at"))}</p></>} /><Pages page={page} total={w.data.total_count ?? 0} blocked={w.locked} onChange={setPage} /></> : null}</ToolFrame>;
}
function CommitmentChange({ row, customerId, workflow: w }: { row: OperatorRow; customerId: string; workflow: Workflow }) {
  const [mode, setMode] = useState<"reschedule" | "completed" | "cancelled">("reschedule"), [date, setDate] = useState(value(row, "due_date")), [note, setNote] = useState("");
  return <details className="mt-3"><summary className="cursor-pointer font-semibold">Reschedule or close commitment</summary><form className="mt-3" onSubmit={async event => {
    event.preventDefault();
    const common = { customer_id: customerId, commitment_id: value(row, "id"), request_id: crypto.randomUUID() };
    const command: OperatorCommand = mode === "reschedule" ? { command: "commitments.reschedule", ...common, due_date: date, expected_due_date: value(row, "due_date"), reason: note } : { command: "commitments.close", ...common, status: mode, outcome: note };
    if (await w.mutate(command)) setNote("");
  }}><fieldset disabled={w.locked} className="min-w-0 space-y-3"><label className="block space-y-1"><span className="form-label">Commitment action</span><select aria-label="Commitment action" className="form-input" value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="reschedule">Reschedule</option><option value="completed">Complete</option><option value="cancelled">Cancel</option></select></label>{mode === "reschedule" ? <label className="block space-y-1"><span className="form-label">Revised due date</span><input className="form-input" type="date" required value={date} onChange={event => setDate(event.target.value)} /></label> : null}<label className="block space-y-1"><span className="form-label">{mode === "reschedule" ? "Reason for rescheduling" : "Commitment outcome"}</span><textarea className="form-input" required maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></label><Button type="submit">{mode === "reschedule" ? "Confirm reschedule" : mode === "completed" ? "Record completion" : "Record cancellation"}</Button></fieldset></form></details>;
}
export function CustomerCommitments({ context, customerId, commitmentId }: ContextProps & { customerId: string; commitmentId?: string }) {
  const [page, setPage] = useState(1), [focus, setFocus] = useState(commitmentId ?? ""), [status, setStatus] = useState<"open" | "completed" | "cancelled" | "all">(commitmentId ? "all" : "open"), [title, setTitle] = useState(""), [due, setDue] = useState(""), [history, setHistory] = useState("");
  const w = useWorkflow({ command: "commitments.list", customer_id: customerId, ...(focus ? { commitment_id: focus } : {}), status, page }, command => { if (command.command === "commitments.create") { setTitle(""); setDue(""); setStatus("open"); setFocus(""); setPage(1); } });
  const canWrite = canUseOperatorCommand(context.role, "commitments.create");
  const today = getBusinessDateBoundaries().today;
  return <ToolFrame title="Customer commitments" description="Keep promised actions visible until completed, cancelled with an outcome, or explicitly rescheduled. The original deadline remains available." workflow={w}>
    <Link href="/tasks/commitments" className="inline-flex text-sm font-semibold text-slate-700 underline">Open customer commitment queue</Link>
    {focus ? <div className="flex flex-wrap items-center gap-3 text-sm"><span>Showing the selected promise.</span><Button type="button" variant="secondary" disabled={w.busy || w.uncertain} onClick={() => { setFocus(""); setStatus("open"); setPage(1); }}>Show all customer promises</Button></div> : null}
    {canWrite ? <details><summary className="cursor-pointer font-semibold">Record a customer promise</summary><form className="mt-3" onSubmit={async event => { event.preventDefault(); if (await w.mutate({ command: "commitments.create", customer_id: customerId, title, due_date: due, request_id: crypto.randomUUID() })) { setTitle(""); setDue(""); setStatus("open"); setPage(1); } }}><fieldset disabled={w.locked} className="min-w-0 space-y-3"><label className="block space-y-1"><span className="form-label">Promised action</span><input className="form-input" value={title} maxLength={160} required onChange={event => setTitle(event.target.value)} /></label><label className="block space-y-1"><span className="form-label">Promised date</span><input className="form-input" type="date" value={due} required onChange={event => setDue(event.target.value)} /></label><p className="text-xs text-slate-500">Responsible employee: {context.fullName || "you"}. This records your promise to this customer.</p><Button type="submit">Record customer promise</Button></fieldset></form></details> : null}
    <label className="block max-w-xs space-y-1"><span className="form-label">Commitment status</span><select aria-label="Commitment status" className="form-input" value={status} disabled={w.busy || w.uncertain} onChange={event => { setStatus(event.target.value as typeof status); setPage(1); setHistory(""); }}><option value="open">Open promises</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="all">All</option></select></label>
    {w.data ? <><Rows rows={w.data.rows ?? []} render={row => <><p className="font-bold">{value(row, "title")}</p><p className="mt-1">{value(row, "responsible_name")} · Due {value(row, "due_date")} · {value(row, "status")}{row.status === "open" && value(row, "due_date") < today ? " · Overdue" : ""}</p><p className="mt-1 text-xs text-slate-500">Original promised date: {value(row, "original_due_date")}</p>{row.outcome ? <p className="mt-2">Outcome: {value(row, "outcome")}</p> : null}{canWrite && row.status === "open" ? <CommitmentChange key={`${value(row, "id")}:${value(row, "due_date")}`} row={row} customerId={customerId} workflow={w} /> : null}<Button type="button" variant="secondary" className="mt-3" onClick={() => setHistory(history === value(row, "id") ? "" : value(row, "id"))}>{history === value(row, "id") ? "Hide change history" : "Show change history"}</Button>{history === value(row, "id") ? <div className="mt-3"><CommitmentHistory key={history} customerId={customerId} commitmentId={history} /></div> : null}</>} /><Pages page={page} total={w.data.total_count ?? 0} blocked={w.locked} onChange={setPage} /></> : null}
  </ToolFrame>;
}

export function CustomerCommitmentQueue({ context }: ContextProps) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<"open" | "completed" | "cancelled" | "all">("open");
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [sort, setSort] = useState<"due" | "newest">("due");
  const [search, setSearch] = useState(""), [query, setQuery] = useState("");
  const w = useWorkflow({ command: "commitments.queue", status, scope, sort, search: query, page });
  const today = getBusinessDateBoundaries().today;
  const canWrite = canUseOperatorCommand(context.role, "commitments.close");
  return <ToolFrame title="Promises requiring follow-up" description="Your open promises appear first, ordered by promised date. Review recorded outcomes or other employees' promises using the filters." workflow={w}>
    <form className="grid min-w-0 gap-3 sm:grid-cols-[1fr_auto]" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setPage(1); }}>
      <label className="block min-w-0 space-y-1"><span className="form-label">Search promise or customer</span><input className="form-input" value={search} maxLength={80} onChange={event => setSearch(event.target.value)} /></label>
      <Button type="submit" className="self-end" disabled={w.busy || w.uncertain}>Search promises</Button>
    </form>
    <div className="grid min-w-0 gap-3 sm:grid-cols-3">
      <label className="space-y-1"><span className="form-label">Responsible employee</span><select aria-label="Responsible employee" className="form-input" value={scope} disabled={w.busy || w.uncertain} onChange={event => { setScope(event.target.value as typeof scope); setPage(1); }}><option value="mine">My promises</option><option value="all">All permitted employees</option></select></label>
      <label className="space-y-1"><span className="form-label">Promise status</span><select aria-label="Promise status" className="form-input" value={status} disabled={w.busy || w.uncertain} onChange={event => { setStatus(event.target.value as typeof status); setPage(1); }}><option value="open">Open</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="all">All</option></select></label>
      <label className="space-y-1"><span className="form-label">Promise order</span><select aria-label="Promise order" className="form-input" value={sort} disabled={w.busy || w.uncertain} onChange={event => { setSort(event.target.value as typeof sort); setPage(1); }}><option value="due">Due soonest</option><option value="newest">Recently recorded</option></select></label>
    </div>
    {w.data ? <><Rows rows={w.data.rows ?? []} render={row => <><p className="font-bold">{value(row, "title")}</p><p className="mt-1">{value(row, "customer_name")} · {value(row, "responsible_name")}</p><p className="mt-1">Due {value(row, "due_date")} · {value(row, "status")}{row.status === "open" && value(row, "due_date") < today ? " · Overdue" : ""}</p><p className="mt-1 text-xs text-slate-500">Original promised date: {value(row, "original_due_date")}</p>{row.outcome ? <p className="mt-2">Outcome: {value(row, "outcome")}</p> : null}{!row.customer_available ? <p className="mt-2 text-amber-800">Customer is inactive; the existing promise and its history are retained.</p> : null}<Link className="mt-3 inline-flex rounded-xl border border-slate-200 px-3 py-2 font-semibold" href={`/customers/${encodeURIComponent(value(row, "customer_id"))}?commitment=${encodeURIComponent(value(row, "id"))}#customer-commitments`}>Open this promise</Link>{canWrite && row.status === "open" ? <CommitmentChange key={`${value(row, "id")}:${value(row, "due_date")}`} customerId={value(row, "customer_id")} row={row} workflow={w} /> : null}</>} /><Pages page={page} total={w.data.total_count ?? 0} blocked={w.locked} onChange={setPage} /></> : null}
  </ToolFrame>;
}

"use client";

// AP-009: a photographed paper shift register becomes draft rows against the jobs that ran on that press in the shift.
// The system fills what it already knows (job, die, pushes already tapped). No vision provider is configured, so the
// supervisor types the remaining cells from the photo shown beside the grid; blank cells stay blank. Confirming adds only
// the pushes that were not tapped at the press (through the normal push recorder) and keeps output, rejects and downtime
// on the register record. A register showing fewer pushes than were tapped is refused, never silently reduced.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AttachmentDropZone } from "@/components/ui/attachment-drop-zone";
import { createRegisterCaptureAction, storedFileUrlAction } from "@/lib/actions/autopilot-batch9";
import { REGISTER_COLUMNS, type RegisterColumn } from "@/lib/autopilot-batch9/commands";
import { fmtDay, fmtWhen } from "@/lib/order-to-cash/commands";
import { uploadTenantFile } from "@/lib/utils/files";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";
import { PressPicker } from "./pickers";

type Note = { tone: "ok" | "error"; text: string } | null;
type Template = { id: string; name: string; columns: RegisterColumn[]; notes: string | null };
type CaptureRow = { id: string; seq: number; job_id: string | null; job_number: string | null; die_no: string | null; billets: number | null; pushes: number | null; output_pcs: number | null;
  rejects: number | null; downtime_min: number | null; remarks: string | null; cells: Record<string, { source: string }>; tapped_pushes: number; backfilled: number };
type Capture = { id: string; capture_number: string; status: string; machine: string; shift_day: string; shift_name: string | null; window_start: string; window_end: string; file_name: string; mime_type: string;
  template: Template | null; rows: CaptureRow[]; shift_jobs: { id: string; job_number: string; die_number: string | null; status: string }[]; summary: Record<string, number> | null;
  created_by_name: string | null; created_at: string; confirmed_at: string | null; discarded_reason: string | null };
const NUMERIC: RegisterColumn[] = ["billets", "pushes", "output_pcs", "rejects", "downtime_min"];
const ALL_COLUMNS = Object.keys(REGISTER_COLUMNS) as RegisterColumn[];

export function NewRegisterCapture({ companyId, today }: { companyId: string; today: string }) {
  const router = useRouter();
  const templates = useApRead<{ rows: Template[] }>("ap_register", "templates", {}, []);
  const [press, setPress] = useState<{ id: string; name: string } | null>(null); const [day, setDay] = useState(today); const [shift, setShift] = useState(""); const [template, setTemplate] = useState("");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<Note>(null);
  async function take(file: File) {
    const mime = file.type === "image/jpg" ? "image/jpeg" : file.type;
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(mime)) { setMessage({ tone: "error", text: "Upload the register as a JPEG, PNG, WebP photo or a PDF scan." }); return; }
    if (!press) { setMessage({ tone: "error", text: "Choose the press first." }); return; }
    setBusy(true); setMessage(null);
    try {
      const path = await uploadTenantFile("documents", companyId, `register-photos/${press.id}`, file);
      const out = await createRegisterCaptureAction({ machine_id: press.id, shift_day: day, ...(shift.trim() ? { shift_name: shift.trim() } : {}), ...(template ? { template_id: template } : {}),
        storage_path: path, file_name: file.name.slice(0, 200), mime_type: mime as "image/jpeg" });
      if (!out.success) { setMessage({ tone: "error", text: out.error }); setBusy(false); return; }
      router.push(`/production/registers/${out.data.id}`);
    } catch {
      setMessage({ tone: "error", text: "The photo could not be uploaded. Check the connection and retry." }); setBusy(false);
    }
  }
  return <Section title="Capture a shift register" description="Photograph the paper press log. A draft opens with the jobs that ran on the press in that shift; you type only what the sheet adds.">
    <div className="grid gap-3 sm:grid-cols-2">
      <PressPicker value={press} onChange={setPress} />
      <label className="text-xs font-bold">Shift date<input type="date" className={inputClass} value={day} max={today} onChange={e => setDay(e.target.value)} /></label>
      <label className="text-xs font-bold">Shift (as set up in factory capacity, optional)<input className={inputClass} value={shift} onChange={e => setShift(e.target.value)} placeholder="A" /></label>
      <label className="text-xs font-bold">Register layout<select className={inputClass} value={template} onChange={e => setTemplate(e.target.value)}><option value="">All columns</option>
        {(templates.data?.rows ?? []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    </div>
    <AttachmentDropZone onFile={take} accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" busy={busy} disabled={!press} label={busy ? "Uploading…" : "Take or choose the register photo"} hint="The photo is kept with the draft as evidence." />
    <Message value={message} />
    <TemplateEditor onSaved={() => void templates.reload()} />
  </Section>;
}

function TemplateEditor({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false); const [name, setName] = useState(""); const [cols, setCols] = useState<RegisterColumn[]>(["die_no", "billets", "pushes", "output_pcs", "rejects", "downtime_min"]); const [message, setMessage] = useState<Note>(null);
  if (!open) return <button type="button" className="text-sm font-bold underline" onClick={() => setOpen(true)}>Save a register layout</button>;
  return <div className="space-y-2 rounded-xl bg-neutral-50 p-3 text-sm">
    <label className="block text-xs font-bold">Layout name<input className={inputClass} value={name} onChange={e => setName(e.target.value)} placeholder="Press 2 day register" /></label>
    <p className="text-xs font-bold">Columns in the order they appear on the sheet</p>
    <div className="flex flex-wrap gap-2">{ALL_COLUMNS.map(c => <label key={c} className="flex items-center gap-1"><input type="checkbox" checked={cols.includes(c)} onChange={e => setCols(v => e.target.checked ? [...v, c] : v.filter(x => x !== c))} />{REGISTER_COLUMNS[c]}</label>)}</div>
    <button type="button" className={buttonClass} disabled={name.trim().length < 3 || !cols.length} onClick={async () => { if (await apWrite("ap_register", "save_template", { name: name.trim(), columns: cols }, setMessage, "Layout saved.")) { setOpen(false); onSaved(); } }}>Save layout</button>
    <Message value={message} />
  </div>;
}

type ListRow = { id: string; capture_number: string; shift_day: string; shift_name: string | null; status: string; machine: string; rows: number; created_at: string; summary: Record<string, number> | null };
export function RegisterList() {
  const [page, setPage] = useState(1); const [status, setStatus] = useState("all");
  const data = useApRead<{ rows: ListRow[]; total_count: number }>("ap_register", "list", { page, status }, []);
  return <Section id="registers" title="Captured registers" description="Ten per page, newest shift first.">
    <select aria-label="Status" className={`${inputClass} w-auto`} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>{[["all", "All"], ["draft", "To confirm"], ["confirmed", "Confirmed"], ["discarded", "Discarded"]].map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
    {data.loading && !data.data ? <Loading what="registers" /> : data.error ? <Failure text={data.error} /> : data.data ? <>
      {data.data.rows.length ? <ul className="divide-y rounded-xl border">{data.data.rows.map(r => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
        <p><Link className="font-bold underline" href={`/production/registers/${r.id}`}>{r.capture_number}</Link> · {r.machine} · {fmtDay(r.shift_day)}{r.shift_name ? ` shift ${r.shift_name}` : ""} · {r.rows} row(s)
          {r.summary ? ` · ${r.summary.pushes_added ?? 0} push(es) added` : ""}</p>
        <Pill value={r.status === "confirmed" ? "approved" : r.status === "discarded" ? "blocked" : "held"} label={r.status === "draft" ? "To confirm" : r.status === "confirmed" ? "Confirmed" : "Discarded"} /></li>)}</ul> : <Empty>No register captured yet.</Empty>}
      <Pager page={page} total={data.data.total_count} onPage={setPage} />
    </> : null}
  </Section>;
}

type Edit = Omit<CaptureRow, "id" | "seq" | "job_number" | "tapped_pushes" | "backfilled"> & { id?: string; key: string };
export function RegisterRecord({ id, canConfirm }: { id: string; canConfirm: boolean }) {
  const [key, setKey] = useState(0); const [message, setMessage] = useState<Note>(null); const [busy, setBusy] = useState(false); const [reason, setReason] = useState("");
  const data = useApRead<Capture>("ap_register", "get", { id }, [key]);
  const [rows, setRows] = useState<Edit[] | null>(null); const [photo, setPhoto] = useState<string | null>(null);
  const c = data.data;
  useEffect(() => { if (c) setRows(c.rows.map(r => ({ id: r.id, key: r.id, job_id: r.job_id, die_no: r.die_no, billets: r.billets, pushes: r.pushes, output_pcs: r.output_pcs, rejects: r.rejects, downtime_min: r.downtime_min, remarks: r.remarks, cells: r.cells ?? {} }))); }, [c]);
  useEffect(() => { let current = true; void storedFileUrlAction("register", id).then(out => { if (current && out.success) setPhoto(out.data.url); }); return () => { current = false; }; }, [id]);
  const columns = useMemo(() => (c?.template?.columns?.length ? c.template.columns : ALL_COLUMNS).filter(col => col !== "job_no"), [c]);
  if (data.loading && !c) return <Loading what="the register" />;
  if (data.error || !c) return <Failure text={data.error ?? "Register not found."} />;
  const draft = c.status === "draft";
  const tapped = new Map(c.rows.map(r => [r.job_id ?? "", r.tapped_pushes]));
  function set(k: string, col: string, value: string) {
    setRows(rs => rs!.map(r => r.key !== k ? r : { ...r, [col]: NUMERIC.includes(col as RegisterColumn) ? (value.trim() === "" ? null : Number(value)) : (value.trim() === "" ? null : value),
      cells: { ...r.cells, [col]: { source: "typed" } } }));
  }
  const payload = () => (rows ?? []).map(r => ({ ...(r.id ? { id: r.id } : {}), job_id: r.job_id, die_no: r.die_no, billets: r.billets, pushes: r.pushes, output_pcs: r.output_pcs, rejects: r.rejects, downtime_min: r.downtime_min, remarks: r.remarks, cells: r.cells }));
  const bad = (rows ?? []).some(r => NUMERIC.some(col => { const v = r[col as keyof Edit] as number | null; return v !== null && (!Number.isInteger(v) || v < 0); }));
  return <div className="space-y-5">
    <Section title={`Register ${c.capture_number}`} description={`${c.machine} · ${fmtDay(c.shift_day)}${c.shift_name ? ` shift ${c.shift_name}` : ""} · ${fmtWhen(c.window_start)} to ${fmtWhen(c.window_end)} · captured by ${c.created_by_name ?? "production"}`}
      actions={<Pill value={c.status === "confirmed" ? "approved" : c.status === "discarded" ? "blocked" : "held"} label={draft ? "To confirm" : c.status === "confirmed" ? "Confirmed" : "Discarded"} />}>
      {c.summary ? <p className="text-sm">Confirmed {fmtWhen(c.confirmed_at)}: {c.summary.pushes_added ?? 0} push(es) added to the jobs · output {c.summary.output_pcs ?? "—"} pcs · rejects {c.summary.rejects ?? "—"} · downtime {c.summary.downtime_min ?? "—"} min.</p> : null}
      {c.discarded_reason ? <p className="text-sm text-neutral-600">Discarded: {c.discarded_reason}</p> : null}
      <p className="text-xs text-neutral-600">No photo reader is configured: cells marked “system” come from the press records; type the rest from the photo. Blank cells stay blank.</p>
    </Section>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <Section title="Photo" description={c.file_name}>{photo ? (c.mime_type === "application/pdf" ? <a className="font-bold underline" href={photo} target="_blank" rel="noreferrer">Open the scan</a>
        : <a href={photo} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed storage link */}
          <img src={photo} alt={`Register ${c.capture_number}`} className="max-h-[70vh] w-full rounded-xl border object-contain" /></a>) : <Loading what="the photo" />}</Section>
      <Section title="Rows" description="One row per job on the sheet. Pushes already tapped at the press are shown; only the extra pushes on the sheet are added.">
        {rows ? <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs uppercase text-neutral-500"><tr><th className="p-1">Job</th>{columns.map(col => <th key={col} className="p-1">{REGISTER_COLUMNS[col]}</th>)}</tr></thead>
          <tbody>{rows.map(r => <tr key={r.key} className="border-t align-top"><td className="p-1">
            {draft ? <select aria-label="Job" className={`${inputClass} min-w-32`} value={r.job_id ?? ""} onChange={e => setRows(rs => rs!.map(x => x.key === r.key ? { ...x, job_id: e.target.value || null } : x))}>
              <option value="">Choose job</option>{c.shift_jobs.map(j => <option key={j.id} value={j.id}>{j.job_number}{j.die_number ? ` · ${j.die_number}` : ""}</option>)}</select>
              : <span className="font-bold">{c.rows.find(x => x.id === r.id)?.job_number ?? "—"}</span>}
            {r.job_id ? <span className="block text-xs text-neutral-500">tapped {tapped.get(r.job_id) ?? 0}{!draft ? ` · added ${c.rows.find(x => x.id === r.id)?.backfilled ?? 0}` : ""}</span> : null}</td>
            {columns.map(col => { const value = r[col as keyof Edit] as string | number | null; const src = r.cells?.[col]?.source;
              return <td key={col} className="p-1"><input aria-label={`${REGISTER_COLUMNS[col]} row ${r.key}`} disabled={!draft} inputMode={NUMERIC.includes(col) ? "numeric" : "text"}
                className={`${inputClass} min-w-20 ${src === "system" ? "bg-emerald-50" : value === null || value === "" ? "bg-amber-50" : ""}`} value={value ?? ""} onChange={e => set(r.key, col, e.target.value)} />
                <span className="text-[10px] text-neutral-500">{src ?? (value === null ? "blank" : "")}</span></td>; })}
          </tr>)}</tbody></table></div> : <Loading what="rows" />}
        {draft ? <div className="flex flex-wrap gap-2">
          <button type="button" className={secondaryClass} onClick={() => setRows(rs => [...(rs ?? []), { key: crypto.randomUUID(), job_id: null, die_no: null, billets: null, pushes: null, output_pcs: null, rejects: null, downtime_min: null, remarks: null, cells: {} }])}>Add row</button>
          <button type="button" className={secondaryClass} disabled={busy || bad} onClick={async () => { setBusy(true); const out = await apWrite("ap_register", "save_rows", { id, rows: payload() }, setMessage, "Draft saved."); setBusy(false); if (out) setKey(k => k + 1); }}>Save draft</button>
          {canConfirm ? <button type="button" className={buttonClass} disabled={busy || bad} onClick={async () => { setBusy(true); const out = await apWrite("ap_register", "confirm", { id, rows: payload() }, setMessage); setBusy(false); if (out) { setMessage({ tone: "ok", text: "Register confirmed." }); setKey(k => k + 1); } }}>Confirm register</button>
            : <span className="text-sm text-neutral-600">A supervisor confirms the register.</span>}
        </div> : null}
        {bad ? <p role="alert" className="text-sm text-rose-700">Counts must be whole numbers, zero or more.</p> : null}
        <Message value={message} />
      </Section>
    </div>
    {draft ? <Section title="Discard" description="If the photo is unreadable or belongs to another shift.">
      <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1 text-xs font-bold">Reason<input className={inputClass} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <button type="button" className={secondaryClass} disabled={reason.trim().length < 3} onClick={async () => { if (await apWrite("ap_register", "discard", { id, reason: reason.trim() }, setMessage)) setKey(k => k + 1); }}>Discard</button></div>
    </Section> : null}
  </div>;
}


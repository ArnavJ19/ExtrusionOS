"use client";

// AP-020: billet mill test certificates. Upload the supplier's PDF or a photo; the text of a digital PDF is read into a
// draft (heat number, alloy, Si/Fe/Cu/Mn/Mg/Zn/Ti) with each value's confidence and the line it came from. Quality
// confirms the values; the check against the alloy specification runs again in the database. Out-of-specification
// material goes to the incoming quality decision (concession or reject). Reading a certificate never accepts material.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AttachmentDropZone } from "@/components/ui/attachment-drop-zone";
import { certificateFileUrlAction, readCertificateAction } from "@/lib/actions/autopilot-batch8";
import { CERT_STATUS, MTC_CONFIRMERS, MTC_UPLOADERS, SPEC_RESULT } from "@/lib/autopilot-batch8/commands";
import { checkChemistry, MTC_ELEMENTS } from "@/lib/calculations/alloy-composition";
import { fmtDay, fmtWhen } from "@/lib/order-to-cash/commands";
import { uploadTenantFile } from "@/lib/utils/files";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, apWrite, buttonClass, inputClass, secondaryClass, useApRead } from "../order-to-cash/ui";

type Note = { tone: "ok" | "error"; text: string } | null;
type Field = { value: string | number | null; confidence: "high" | "medium" | "low" | null; source?: string | null };
type Template = { heat_labels: string[]; alloy_labels: string[]; element_order: string[]; decimal_comma: boolean; note: string | null } | null;
export type Certificate = { id: string; status: string; file_name: string; source_kind: string; extracted: Partial<Record<string, Field>>; heat_number: string | null; alloy: string | null;
  si: number | null; fe: number | null; cu: number | null; mn: number | null; mg: number | null; zn: number | null; ti: number | null; spec_result: string | null; edited_fields: string[];
  vendor_id: string | null; vendor: string | null; uploaded_at: string; uploaded_by_name: string | null; confirmed_at: string | null; confirmed_by_name: string | null; confirm_note: string | null;
  discarded_reason: string | null; line: { id: string; po_number: string; line_number: number; description: string; received_quantity: number; unit: string; receipt_date: string } | null;
  batches: { id: string; batch_number: string; heat_number: string | null; alloy: string }[]; duplicate_heat: { id: string; file_name: string }[] | null;
  live_check: { result: string; out: { element: string; value: number; min: number; max: number }[]; missing: string[] }; can_confirm?: boolean; template?: Template };

const SOURCE: Record<string, string> = { pdf_text: "Read from the PDF text", pdf_no_text: "PDF has no readable text (scan): type the values", photo: "Photo: type the values from the image", pasted_text: "Read from pasted text" };
const CONF: Record<string, string> = { high: "bg-emerald-50 text-emerald-800", medium: "bg-sky-50 text-sky-900", low: "bg-amber-50 text-amber-900" };
const SPEC_TONE: Record<string, string> = { in_spec: "approved", out_of_spec: "blocked", incomplete: "held", unknown_alloy: "held" };
const ELEMENT_KEYS = MTC_ELEMENTS.map(e => e.toLowerCase()) as ("si" | "fe" | "cu" | "mn" | "mg" | "zn" | "ti")[];

export function SpecPill({ result }: { result: string | null }) {
  if (!result) return <Pill value="unknown" label="Not checked" />;
  return <Pill value={SPEC_TONE[result] ?? "unknown"} label={SPEC_RESULT[result] ?? result} />;
}

/** Upload a certificate for a received line or a billet batch, then open the draft. */
export function CertificateUpload({ companyId, receiptLineId, billetBatchId }: { companyId: string; receiptLineId?: string; billetBatchId?: string }) {
  const router = useRouter();
  const payload = receiptLineId ? { receipt_line_id: receiptLineId } : { billet_batch_id: billetBatchId };
  const target = useApRead<{ vendor: string | null; target: { label: string; received: number; unit: string }; template: Template; existing: { id: string; status: string; heat_number: string | null; spec_result: string | null; file_name: string }[] }>("ap_mtc", "target", payload, []);
  const [pasted, setPasted] = useState(""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState<Note>(null);
  async function take(file: File) {
    const mime = file.type === "image/jpg" ? "image/jpeg" : file.type;
    if (!["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(mime)) { setMessage({ tone: "error", text: "Upload the certificate as a PDF, PNG, JPEG or WebP file." }); return; }
    setBusy(true); setMessage(null);
    try {
      const path = await uploadTenantFile("documents", companyId, `billet-certificates/${receiptLineId ?? billetBatchId}`, file);
      const out = await readCertificateAction({ ...payload, storage_path: path, file_name: file.name.slice(0, 200), mime_type: mime as "application/pdf", ...(pasted.trim() ? { pasted_text: pasted } : {}) });
      if (!out.success) { setMessage({ tone: "error", text: out.error }); setBusy(false); return; }
      router.push(`/quality/certificates/${out.data.id}`);
    } catch {
      setMessage({ tone: "error", text: "The file could not be uploaded. Check that storage is configured and retry." }); setBusy(false);
    }
  }
  return <Section title="Read a mill test certificate" description="Attach the supplier's certificate. A digital PDF is read automatically; for a photo or scan, the values are typed on the next screen.">
    {target.loading && !target.data ? <Loading what="the received material" /> : target.error ? <Failure text={target.error} /> : target.data ? <>
      <p className="text-sm"><b>{target.data.target.label}</b> · {target.data.target.received} {target.data.target.unit} · supplier {target.data.vendor ?? "not recorded"}{target.data.template ? " · supplier template in use" : ""}</p>
      {target.data.existing.length ? <ul className="space-y-1 text-sm">{target.data.existing.map(x => <li key={x.id}><Link className="underline" href={`/quality/certificates/${x.id}`}>{x.file_name}</Link> · {CERT_STATUS[x.status] ?? x.status}{x.heat_number ? ` · heat ${x.heat_number}` : ""} <SpecPill result={x.spec_result} /></li>)}</ul> : null}
      <AttachmentDropZone onFile={take} busy={busy} accept="application/pdf,image/png,image/jpeg,image/webp" label="Choose, drop or paste the certificate" hint="PDF, PNG, JPEG or WebP, up to 10 MB" />
      <details className="text-sm"><summary className="cursor-pointer font-bold">The certificate is a scan? Paste its text instead (optional)</summary>
        <textarea aria-label="Certificate text" className={`${inputClass} mt-2 min-h-28 py-2`} value={pasted} onChange={e => setPasted(e.target.value)} maxLength={20000} placeholder="Copy the text from the supplier's email or PDF and paste it here, then attach the file." /></details>
      <Message value={message} />
    </> : null}
  </Section>;
}

const show = (v: unknown) => v === null || v === undefined || v === "" ? "" : String(v);

export function CertificateDetail({ id, role }: { id: string; role: string }) {
  const [key, setKey] = useState(0);
  const cert = useApRead<Certificate>("ap_mtc", "get", { id }, [key]);
  return cert.loading && !cert.data ? <Loading what="the certificate" /> : cert.error ? <Failure text={cert.error} /> : cert.data
    ? <CertificateReview key={`${cert.data.id}:${cert.data.status}:${key}`} cert={cert.data} role={role} onChanged={() => setKey(k => k + 1)} /> : null;
}

function CertificateReview({ cert, role, onChanged }: { cert: Certificate; role: string; onChanged: () => void }) {
  const canConfirm = cert.status === "draft" && Boolean(cert.can_confirm) && (MTC_CONFIRMERS as readonly string[]).includes(role);
  const [values, setValues] = useState<Record<string, string>>(() => ({ heat_number: show(cert.heat_number), alloy: show(cert.alloy), ...Object.fromEntries(ELEMENT_KEYS.map(k => [k, show(cert[k])])) }));
  const [note, setNote] = useState(""); const [reason, setReason] = useState(""); const [message, setMessage] = useState<Note>(null); const [busy, setBusy] = useState(false);
  const nums = useMemo(() => Object.fromEntries(ELEMENT_KEYS.map(k => [k, values[k]?.trim() === "" ? null : Number(values[k])])), [values]);
  const live = cert.status === "draft" ? checkChemistry(values.alloy, nums) : null;
  const badNumber = ELEMENT_KEYS.some(k => values[k]?.trim() !== "" && (!Number.isFinite(Number(values[k])) || Number(values[k]) < 0 || Number(values[k]) > 100));
  async function openFile() {
    const out = await certificateFileUrlAction(cert.id);
    if (!out.success) { setMessage({ tone: "error", text: out.error }); return; }
    window.open(out.data.url, "_blank", "noopener,noreferrer");
  }
  async function confirm() {
    setBusy(true);
    const payload: Record<string, unknown> = { id: cert.id, heat_number: values.heat_number.trim(), alloy: values.alloy.trim().toUpperCase(), ...(note.trim() ? { note: note.trim() } : {}) };
    for (const k of ELEMENT_KEYS) payload[k] = values[k]?.trim() === "" ? null : Number(values[k]);
    const ok = await apWrite("ap_mtc", "confirm", payload, setMessage);
    setBusy(false); if (ok) onChanged();
  }
  const check = cert.status === "draft" ? live : cert.live_check;
  return <div className="space-y-4">
    <Section title={cert.file_name} description={`${SOURCE[cert.source_kind] ?? cert.source_kind} · uploaded by ${cert.uploaded_by_name ?? "a colleague"} ${fmtWhen(cert.uploaded_at)}`}
      actions={<div className="flex flex-wrap items-center gap-2"><Pill value={cert.status === "confirmed" ? "approved" : cert.status === "draft" ? "open" : "cancelled"} label={CERT_STATUS[cert.status] ?? cert.status} /><button type="button" className={secondaryClass} onClick={() => void openFile()}>Open file</button></div>}>
      <p className="text-sm">{cert.line ? <>PO {cert.line.po_number} line {cert.line.line_number} · {cert.line.description} · received {fmtDay(cert.line.receipt_date)} ({cert.line.received_quantity} {cert.line.unit})</> : "Attached to a billet batch"} · supplier {cert.vendor ?? "not recorded"}</p>
      {cert.batches.length ? <p className="text-sm">Billet batches: {cert.batches.map(b => `${b.batch_number}${b.heat_number ? ` (heat ${b.heat_number})` : ""}`).join(", ")}</p> : <p className="text-sm text-neutral-600">Not yet released to billet stock; batches released from this line will carry this chemistry.</p>}
      {cert.duplicate_heat?.length ? <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Heat {cert.heat_number} is also on another confirmed certificate ({cert.duplicate_heat.map(d => d.file_name).join(", ")}). Check it is not the same material twice.</p> : null}
      {/* A table on wide screens; on a phone each field stacks so the value to record stays in view. */}
      <div role="table" aria-label="Certificate values" className="text-sm">
        <div role="row" className="hidden grid-cols-[8rem_minmax(0,1fr)_9rem_10rem] gap-3 border-b pb-1 text-xs font-bold uppercase text-neutral-500 sm:grid"><span role="columnheader">Field</span><span role="columnheader">Read from certificate</span><span role="columnheader">Value to record</span><span role="columnheader">Specification</span></div>
        {(["heat_number", "alloy", ...ELEMENT_KEYS] as string[]).map(k => {
          const ex = cert.extracted[k]; const out = check?.out.find(o => o.element.toLowerCase() === k);
          return <div role="row" key={k} className="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 border-b py-2 sm:grid-cols-[8rem_minmax(0,1fr)_9rem_10rem]">
            <span role="cell" className="font-bold">{k === "heat_number" ? "Heat number" : k === "alloy" ? "Alloy" : MTC_ELEMENTS.find(e => e.toLowerCase() === k)}</span>
            <span role="cell" className="min-w-0">{ex?.value === null || ex?.value === undefined ? <span className="text-neutral-500">not read</span> : <><span className="font-mono">{String(ex.value)}</span> {ex.confidence ? <span className={`rounded px-1 text-[10px] font-bold ${CONF[ex.confidence]}`}>{ex.confidence}</span> : null}{ex.source ? <span className="block break-words text-[11px] text-neutral-500">“{ex.source}”</span> : null}</>}</span>
            <span role="cell" className="col-start-2 sm:col-start-auto">{canConfirm ? <input aria-label={`Value for ${k}`} inputMode={k.length === 2 ? "decimal" : "text"} className={`${inputClass} w-full sm:w-32 ${out ? "border-rose-400" : ""}`} value={values[k] ?? ""} onChange={e => setValues(v => ({ ...v, [k]: e.target.value }))} />
              : <span className="font-mono">{show(k === "heat_number" ? cert.heat_number : k === "alloy" ? cert.alloy : cert[k as "si"]) || "—"}</span>}</span>
            <span role="cell" className="col-start-2 text-xs sm:col-start-auto">{out ? <span className="font-bold text-rose-700">{out.value}% outside {out.min}–{out.max}%</span> : k.length === 2 && check?.missing.includes(MTC_ELEMENTS.find(e => e.toLowerCase() === k)!) ? <span className="text-amber-800">missing</span> : null}</span>
          </div>;
        })}
      </div>
      {check ? <p className="text-sm">Check against {values.alloy || cert.alloy || "the alloy"}: <SpecPill result={check.result} />{check.result === "out_of_spec" ? " Quality decides the material on the incoming line: an authorised concession, or reject. It cannot be accepted as is." : null}</p> : null}
      {cert.status === "confirmed" ? <p className="text-sm text-neutral-600">Confirmed by {cert.confirmed_by_name ?? "quality"} {fmtWhen(cert.confirmed_at)}{cert.edited_fields.length ? ` · typed or corrected: ${cert.edited_fields.join(", ")}` : " · every value as read"}{cert.confirm_note ? ` · ${cert.confirm_note}` : ""}</p> : null}
      {cert.status === "discarded" ? <p className="text-sm text-neutral-600">Discarded: {cert.discarded_reason}</p> : null}
      {canConfirm ? <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-xs font-bold">Note (optional)<input className={inputClass} value={note} onChange={e => setNote(e.target.value)} /></label>
        <button type="button" className={buttonClass} disabled={busy || badNumber || values.heat_number.trim().length < 2 || !/^\d{4}[A-Za-z]?$/.test(values.alloy.trim())} onClick={() => void confirm()}>Confirm certificate</button>
      </div> : null}
      {cert.status === "draft" && (MTC_UPLOADERS as readonly string[]).includes(role) ? <details className="text-sm"><summary className="cursor-pointer font-bold">Wrong file? Discard this draft</summary>
        <div className="mt-2 flex flex-wrap gap-2"><input aria-label="Why discard" className={`${inputClass} max-w-md`} value={reason} onChange={e => setReason(e.target.value)} placeholder="Uploaded the wrong supplier's certificate" />
          <button type="button" className={secondaryClass} disabled={reason.trim().length < 5} onClick={async () => { if (await apWrite("ap_mtc", "discard", { id: cert.id, reason: reason.trim() }, setMessage)) onChanged(); }}>Discard</button></div></details> : null}
      <Message value={message} />
    </Section>
    {cert.vendor_id && (MTC_CONFIRMERS as readonly string[]).includes(role) ? <TemplateEditor vendorId={cert.vendor_id} vendor={cert.vendor} template={cert.template ?? null} /> : null}
  </div>;
}

function TemplateEditor({ vendorId, vendor, template }: { vendorId: string; vendor: string | null; template: Template }) {
  const [heat, setHeat] = useState((template?.heat_labels ?? []).join(", ")); const [alloy, setAlloy] = useState((template?.alloy_labels ?? []).join(", "));
  const [order, setOrder] = useState((template?.element_order ?? []).join(" ")); const [comma, setComma] = useState(Boolean(template?.decimal_comma)); const [message, setMessage] = useState<Note>(null);
  const list = (v: string) => v.split(",").map(x => x.trim()).filter(Boolean).slice(0, 10);
  return <Section title={`Reading template for ${vendor ?? "this supplier"}`} description="How this supplier labels the heat number and alloy, and the order of its chemistry columns when the certificate has no header row. Used for the next certificate.">
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-xs font-bold">Heat number labels<input className={inputClass} value={heat} onChange={e => setHeat(e.target.value)} placeholder="Cast No, Melt No" /></label>
      <label className="text-xs font-bold">Alloy labels<input className={inputClass} value={alloy} onChange={e => setAlloy(e.target.value)} placeholder="Grade" /></label>
      <label className="text-xs font-bold">Chemistry column order<input className={inputClass} value={order} onChange={e => setOrder(e.target.value)} placeholder="Si Fe Cu Mn Mg Zn Ti" /></label>
      <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={comma} onChange={e => setComma(e.target.checked)} /> Uses a decimal comma (0,45)</label>
    </div>
    <button type="button" className={secondaryClass} onClick={async () => {
      const elements = order.split(/[\s,]+/).filter(Boolean).map(e => e.charAt(0).toUpperCase() + e.slice(1).toLowerCase());
      await apWrite("ap_mtc", "save_template", { vendor_id: vendorId, heat_labels: list(heat), alloy_labels: list(alloy), element_order: elements, decimal_comma: comma }, setMessage, "Template saved.");
    }}>Save template</button>
    <Message value={message} />
  </Section>;
}

type Row = { id: string; file_name: string; status: string; heat_number: string | null; alloy: string | null; spec_result: string | null; vendor: string | null; uploaded_at: string; source_kind: string; edited_fields: string[]; po_number: string | null };

export function CertificatesClient() {
  const [page, setPage] = useState(1); const [search, setSearch] = useState(""); const [q, setQ] = useState(""); const [status, setStatus] = useState("all"); const [spec, setSpec] = useState("");
  const data = useApRead<{ rows: Row[]; total_count: number; reading: { confirmed: number; read_without_edits: number; fields_typed: number | null } }>("ap_mtc", "list", { page, status, ...(spec ? { spec } : {}), ...(q ? { search: q } : {}) }, []);
  return <Section title="Mill test certificates" description="Every certificate read, with its specification result. Search by heat number, file or supplier.">
    <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); setQ(search.trim()); setPage(1); }}>
      <input aria-label="Search certificates" className={`${inputClass} max-w-xs`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Heat, file or supplier" />
      <select aria-label="Status" className={`${inputClass} w-auto`} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="all">Any status</option>{Object.entries(CERT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <select aria-label="Specification" className={`${inputClass} w-auto`} value={spec} onChange={e => { setSpec(e.target.value); setPage(1); }}><option value="">Any result</option>{Object.entries(SPEC_RESULT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <button type="submit" className={secondaryClass}>Search</button>
    </form>
    {data.loading && !data.data ? <Loading what="certificates" /> : data.error ? <Failure text={data.error} /> : data.data ? <>
      {data.data.reading.confirmed ? <p className="text-sm text-neutral-600">Last 90 days: {data.data.reading.read_without_edits} of {data.data.reading.confirmed} confirmed as read · {data.data.reading.fields_typed ?? 0} field(s) typed per certificate on average</p> : null}
      {data.data.rows.length ? <ul className="divide-y rounded-xl border">{data.data.rows.map(r => <li key={r.id}><Link href={`/quality/certificates/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm hover:bg-neutral-50">
        <span className="min-w-0"><b className="break-all">{r.heat_number ? `Heat ${r.heat_number}` : r.file_name}</b><span className="block text-xs text-neutral-500">{r.vendor ?? "Supplier not recorded"}{r.po_number ? ` · ${r.po_number}` : ""} · {r.alloy ?? "alloy not read"} · {fmtWhen(r.uploaded_at)}</span></span>
        <span className="flex flex-wrap gap-1"><Pill value={r.status === "confirmed" ? "approved" : r.status === "draft" ? "open" : "cancelled"} label={CERT_STATUS[r.status] ?? r.status} /><SpecPill result={r.spec_result} /></span></Link></li>)}</ul>
        : <Empty>{q || status !== "all" || spec ? "No certificate matches." : "No certificate has been read yet. Open a received billet line or a batch below to attach one."}</Empty>}
      <Pager page={page} total={data.data.total_count} onPage={setPage} />
    </> : null}
  </Section>;
}

export function CertificateCoverage() {
  const [page, setPage] = useState(1);
  const data = useApRead<{ rows: { id: string; batch_number: string; heat_number: string | null; alloy: string; received_date: string; available_weight_kg: number; receipt_line_id: string | null }[]; total_count: number; batches: number; traced: number }>("ap_mtc", "coverage", { page }, []);
  return <Section title="Billet batches without certificate chemistry" description="Every billet batch should trace its chemistry to a confirmed certificate: its own, or the one on the received line it was released from.">
    {data.loading && !data.data ? <Loading what="coverage" /> : data.error ? <Failure text={data.error} /> : data.data ? <>
      <p className="text-sm font-bold">{data.data.traced} of {data.data.batches} batch(es) traced to a certificate</p>
      {data.data.rows.length ? <ul className="divide-y rounded-xl border">{data.data.rows.map(b => <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
        <span><b>{b.batch_number}</b> · {b.alloy}{b.heat_number ? ` · heat ${b.heat_number}` : ""} · received {fmtDay(b.received_date)}</span>
        <Link className={`${secondaryClass} inline-flex items-center`} href={b.receipt_line_id ? `/quality/certificates/new?receipt_line=${b.receipt_line_id}` : `/quality/certificates/new?batch=${b.id}`}>Attach certificate</Link></li>)}</ul>
        : <Empty>Every billet batch traces to a confirmed certificate.</Empty>}
      <Pager page={page} total={data.data.total_count} onPage={setPage} />
    </> : null}
  </Section>;
}

/** On the incoming acceptance record: the certificates of this received line, and where to add one. */
export function CertificateLinePanel({ receiptLineId, canUpload }: { receiptLineId: string; canUpload: boolean }) {
  const data = useApRead<{ rows: { id: string; file_name: string; status: string; heat_number: string | null; alloy: string | null; spec_result: string | null; uploaded_at: string }[] }>("ap_mtc", "line", { receipt_line_id: receiptLineId }, []);
  return <Section title="Mill test certificate" description="Read the supplier's certificate into chemistry checked against the alloy specification before deciding the material."
    actions={canUpload ? <Link className={`${buttonClass} inline-flex items-center`} href={`/quality/certificates/new?receipt_line=${receiptLineId}`}>Read a certificate</Link> : undefined}>
    {data.loading && !data.data ? <Loading what="certificates" /> : data.error ? <Failure text={data.error} /> : data.data?.rows.length
      ? <ul className="space-y-1 text-sm">{data.data.rows.map(r => <li key={r.id} className="flex flex-wrap items-center gap-2"><Link className="font-bold underline" href={`/quality/certificates/${r.id}`}>{r.heat_number ? `Heat ${r.heat_number}` : r.file_name}</Link><span>{CERT_STATUS[r.status] ?? r.status}</span><SpecPill result={r.spec_result} /></li>)}</ul>
      : <Empty>No certificate has been read for this line.</Empty>}
  </Section>;
}

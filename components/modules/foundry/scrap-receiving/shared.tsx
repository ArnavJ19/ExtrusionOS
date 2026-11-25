"use client";

// Shared pieces for the foundry scrap receiving screens: a file attach area that uploads into the company folder and
// records the file on the receipt (or external source), previews through short-lived signed links, a vendor search,
// and the accounts bill form used for scrap receipts and external aluminium sources.
import { useEffect, useMemo, useState } from "react";
import { AttachmentDropZone } from "@/components/ui/attachment-drop-zone";
import { billTotal, FILE_KINDS, type FileKind, type ReceiptFile } from "@/lib/foundry/scrap-receiving";
import { inr } from "@/lib/order-to-cash/commands";
import { createClient } from "@/lib/supabase/browser";
import { getSignedFileUrl, uploadTenantFile } from "@/lib/utils/files";
import { Message, apWrite, buttonClass, inputClass } from "../../order-to-cash/ui";

export type Note = { tone: "ok" | "error"; text: string } | null;
export const kgText = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : `${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg`);
export const labelClass = "block text-xs font-bold text-neutral-700";

const IMAGE = ["image/jpeg", "image/png", "image/webp"];

/** Upload one file into documents/<company>/<folder>/<parent>/ and record it with the gateway. */
export function FileAttach({ companyId, parent, parentKey, kind, label, hint, onAdded, imagesOnly = false, capture }: {
  companyId: string; parent: string; parentKey: "receipt_id" | "external_source_id"; kind: FileKind; label: string; hint?: string;
  onAdded: () => void; imagesOnly?: boolean; capture?: "environment";
}) {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<Note>(null);
  const finance = kind === "bill" || kind === "eway_bill" || kind === "supporting";
  async function take(file: File) {
    const mime = file.type === "image/jpg" ? "image/jpeg" : file.type;
    const allowed = imagesOnly ? IMAGE : [...IMAGE, "application/pdf"];
    if (!allowed.includes(mime)) { setMessage({ tone: "error", text: imagesOnly ? "Attach a JPG, PNG or WEBP photo." : "Attach a JPG, PNG, WEBP or PDF file." }); return; }
    if (file.size > 10 * 1024 * 1024) { setMessage({ tone: "error", text: "The file must be 10 MB or less." }); return; }
    setBusy(true); setMessage(null);
    try {
      const path = await uploadTenantFile("documents", companyId, `${finance ? "scrap-receipt-bills" : "scrap-receipts"}/${parent}`, file);
      const out = await apWrite("ap_scrap_receipt", "add_file", { [parentKey]: parent, kind, storage_path: path, file_name: file.name.slice(0, 200), mime_type: mime, size_bytes: file.size }, setMessage);
      if (out) { setMessage({ tone: "ok", text: `${FILE_KINDS[kind]} attached.` }); onAdded(); }
    } catch {
      setMessage({ tone: "error", text: "The file could not be uploaded. Check the connection and retry." });
    } finally { setBusy(false); }
  }
  return <div className="space-y-1">
    <AttachmentDropZone onFile={take} busy={busy} accept={imagesOnly ? IMAGE.join(",") : [...IMAGE, "application/pdf"].join(",")} label={label} hint={hint ?? (imagesOnly ? "Take a photo or choose one, up to 10 MB" : "Photo or PDF, up to 10 MB")} capture={capture} />
    <Message value={message} />
  </div>;
}

/** Thumbnails for photos and links for PDFs, through signed links that expire after an hour. */
export function FileList({ files, kinds, empty }: { files: ReceiptFile[]; kinds?: FileKind[]; empty?: string }) {
  const shown = useMemo(() => files.filter((file) => !kinds || kinds.includes(file.kind)), [files, kinds]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = shown.map((file) => file.id).join(",");
  useEffect(() => {
    let current = true;
    void Promise.all(shown.map(async (file) => {
      try { return [file.id, await getSignedFileUrl("documents", file.storage_path)] as const; } catch { return [file.id, ""] as const; }
    })).then((pairs) => { if (current) setUrls(Object.fromEntries(pairs)); });
    return () => { current = false; };
  }, [key]);
  if (!shown.length) return empty ? <p className="text-sm text-neutral-500">{empty}</p> : null;
  return <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
    {shown.map((file) => <li key={file.id} className="min-w-0 rounded-xl border bg-neutral-50 p-1.5">
      {IMAGE.includes(file.mime_type) && urls[file.id]
        // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed storage link
        ? <a href={urls[file.id]} target="_blank" rel="noreferrer"><img src={urls[file.id]} alt={`${FILE_KINDS[file.kind]}: ${file.file_name}`} className="h-28 w-full rounded-lg object-cover" /></a>
        : <a href={urls[file.id] || undefined} target="_blank" rel="noreferrer" className="flex h-28 items-center justify-center rounded-lg bg-white text-xs font-bold underline">{file.mime_type === "application/pdf" ? "Open PDF" : "Loading…"}</a>}
      <p className="mt-1 truncate text-xs font-bold">{FILE_KINDS[file.kind]}</p>
      <p className="truncate text-[11px] text-neutral-500">{file.uploaded_by}</p>
    </li>)}
  </ul>;
}

type Vendor = { id: string; name: string; hint?: string | null };
export function VendorPicker({ value, onChange }: { value: Vendor | null; onChange: (vendor: Vendor | null) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [term, setTerm] = useState(""); const [options, setOptions] = useState<Vendor[]>([]); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (value) return;
    let current = true;
    const clean = term.trim().replace(/[,%()*\\]/g, " ").slice(0, 60);
    const timer = setTimeout(async () => {
      let query = supabase.from("vendors").select("id, vendor_name, vendor_type, city").eq("is_active", true).order("vendor_name").limit(10);
      if (clean) query = query.ilike("vendor_name", `%${clean}%`);
      const { data, error: failed } = await query;
      if (!current) return;
      if (failed) { setError("Could not search vendors. Check the connection and retry."); return; }
      setError(null);
      setOptions(((data ?? []) as { id: string; vendor_name: string; vendor_type: string | null; city: string | null }[]).map((row) => ({ id: row.id, name: row.vendor_name, hint: [row.vendor_type?.replaceAll("_", " "), row.city].filter(Boolean).join(" · ") })));
    }, 200);
    return () => { current = false; clearTimeout(timer); };
  }, [supabase, term, value]);
  if (value) return <div className="flex items-center justify-between gap-2 rounded-xl border bg-neutral-50 px-3 py-2 text-sm"><span><b>{value.name}</b>{value.hint ? <span className="text-neutral-500"> · {value.hint}</span> : null}</span>
    <button type="button" className="text-xs font-bold underline" onClick={() => onChange(null)}>Change</button></div>;
  return <div className="space-y-1">
    <input className={inputClass} aria-label="Search vendor" placeholder="Search vendor by name" value={term} onChange={(e) => setTerm(e.target.value)} />
    {error ? <p className="text-xs text-rose-700">{error}</p> : null}
    <ul className="max-h-48 overflow-y-auto rounded-xl border">{options.map((option) => <li key={option.id}>
      <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-neutral-50" onClick={() => onChange(option)}><b>{option.name}</b>{option.hint ? <span className="text-neutral-500"> · {option.hint}</span> : null}</button></li>)}
      {!options.length ? <li className="px-3 py-2 text-sm text-neutral-500">No matching vendor. Add the vendor under Vendors first.</li> : null}</ul>
  </div>;
}

export type FinanceValues = { vendor_id: string | null; vendor_name: string | null; invoice_number: string | null; invoice_date: string | null; due_date: string | null; rate_per_kg: number | null;
  tax_amount: number | null; freight_amount: number | null; discount_amount: number | null; payment_method: string | null; notes?: string | null };

const n = (v: string) => (v.trim() === "" ? undefined : Number(v));
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Vendor, bill, rate, GST, freight and discount; the expense is posted from these by the database. */
export function BillForm({ command, idKey, id, kg, initial, hasBill, onSaved }: {
  command: "finance_save" | "source_finance_save"; idKey: "receipt_id" | "source_id"; id: string; kg: number; initial: FinanceValues | null; hasBill: boolean; onSaved: () => void;
}) {
  const [vendor, setVendor] = useState<Vendor | null>(initial?.vendor_id ? { id: initial.vendor_id, name: initial.vendor_name ?? "Vendor" } : null);
  const [form, setForm] = useState({ invoice_number: s(initial?.invoice_number), invoice_date: s(initial?.invoice_date), due_date: s(initial?.due_date), rate_per_kg: s(initial?.rate_per_kg),
    tax_amount: s(initial?.tax_amount), freight_amount: s(initial?.freight_amount), discount_amount: s(initial?.discount_amount), payment_method: s(initial?.payment_method), notes: s(initial?.notes) });
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState<Note>(null);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: e.target.value }));
  const rate = Number(form.rate_per_kg || 0);
  const total = billTotal(kg, rate, Number(form.tax_amount || 0), Number(form.freight_amount || 0), Number(form.discount_amount || 0));
  async function save() {
    setBusy(true);
    const payload = { [idKey]: id, vendor_id: vendor?.id, invoice_number: form.invoice_number.trim(), invoice_date: form.invoice_date, rate_per_kg: n(form.rate_per_kg),
      ...(form.due_date ? { due_date: form.due_date } : {}), ...(form.tax_amount ? { tax_amount: n(form.tax_amount) } : {}), ...(form.freight_amount ? { freight_amount: n(form.freight_amount) } : {}),
      ...(form.discount_amount ? { discount_amount: n(form.discount_amount) } : {}), ...(form.payment_method.trim() ? { payment_method: form.payment_method.trim() } : {}), ...(form.notes.trim() ? { notes: form.notes.trim() } : {}) };
    const out = await apWrite<{ expense_number?: string | null }>("ap_scrap_receipt", command, payload, setMessage);
    setBusy(false);
    if (out) { setMessage({ tone: "ok", text: out.expense_number ? `Bill recorded. Expense ${out.expense_number} is waiting for approval.` : "Bill recorded." }); onSaved(); }
  }
  return <div className="space-y-3">
    <div><span className={labelClass}>Vendor</span><VendorPicker value={vendor} onChange={setVendor} /></div>
    <div className="grid gap-2 sm:grid-cols-3">
      <label className={labelClass}>Bill number<input className={inputClass} value={form.invoice_number} onChange={set("invoice_number")} maxLength={40} /></label>
      <label className={labelClass}>Bill date<input type="date" className={inputClass} value={form.invoice_date} onChange={set("invoice_date")} /></label>
      <label className={labelClass}>Due date (optional)<input type="date" className={inputClass} value={form.due_date} onChange={set("due_date")} /></label>
      <label className={labelClass}>Rate ₹ per kg<input className={inputClass} inputMode="decimal" value={form.rate_per_kg} onChange={set("rate_per_kg")} /></label>
      <label className={labelClass}>GST amount ₹<input className={inputClass} inputMode="decimal" value={form.tax_amount} onChange={set("tax_amount")} /></label>
      <label className={labelClass}>Freight ₹<input className={inputClass} inputMode="decimal" value={form.freight_amount} onChange={set("freight_amount")} /></label>
      <label className={labelClass}>Discount ₹<input className={inputClass} inputMode="decimal" value={form.discount_amount} onChange={set("discount_amount")} /></label>
      <label className={labelClass}>Payment method (optional)<input className={inputClass} value={form.payment_method} onChange={set("payment_method")} placeholder="RTGS, cheque…" maxLength={40} /></label>
    </div>
    <label className={labelClass}>Notes (optional)<textarea className={`${inputClass} min-h-16 py-2`} value={form.notes} onChange={set("notes")} maxLength={600} /></label>
    <p className="rounded-xl bg-neutral-50 px-3 py-2 text-sm">{kgText(kg)} × {inr(rate)} = <b>{inr(total.base)}</b> · bill total <b>{inr(total.total)}</b></p>
    {!hasBill ? <p className="text-sm font-semibold text-amber-800">Attach the bill above before saving.</p> : null}
    <button type="button" className={buttonClass} disabled={busy || !vendor || !hasBill || !form.invoice_number.trim() || !form.invoice_date || rate <= 0} onClick={save}>{busy ? "Saving…" : "Save bill details"}</button>
    <Message value={message} />
  </div>;
}

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { inTaskVendorAction } from "@/lib/actions/in-task-vendors";
import { inTaskVendorDefaults, type InTaskVendorInput, type InTaskVendorMatch, type InTaskVendorOption, type InTaskVendorRequest } from "@/lib/forms/in-task-vendor";
import { can } from "@/lib/auth/permissions";
import { labelize, type SessionContext } from "@/types/app";
import { Button } from "@/components/ui/button";

const vendorTypes = ["aluminum_ingot", "aluminum_sows", "aluminum_billets", "aluminum_wire_rods", "aluminum_t_ingots", "aluminum_chips", "die_maker", "powder_coating", "anodizing", "hardware_supplier", "transporter", "packing_supplier", "maintenance", "other"] as const;

// NOV-010: add a missing vendor from inside an operational form. The parent form keeps every typed
// value because this dialog never navigates; the new or matched vendor is selected on success.
export function InTaskVendor({ context, onSelected, taskLabel, defaultType = "other" }: { context: SessionContext; onSelected: (vendor: InTaskVendorOption) => void; taskLabel: string; defaultType?: InTaskVendorInput["vendor_type"] }) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const busyRef = useRef(false);
  const requestId = useRef<string | null>(null);
  const lastCreate = useRef<InTaskVendorRequest | null>(null);
  const [open, setOpen] = useState(false);
  const [vendor, setVendor] = useState<InTaskVendorInput>({ ...inTaskVendorDefaults, vendor_type: defaultType });
  const [matches, setMatches] = useState<InTaskVendorMatch[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) { dialog.showModal(); if (!uncertain) nameRef.current?.focus(); }
    if (!open && dialog.open) { dialog.close(); triggerRef.current?.focus(); }
  }, [open, uncertain]);

  if (context.dealerId || !can(context.role, "create", "vendors") || !can(context.role, "read", "vendors")) return null;

  function update(field: keyof InTaskVendorInput, value: string) {
    if (busyRef.current || uncertain) return;
    setVendor(current => ({ ...current, [field]: value }));
    setMatches(null); setHasMore(false); setAcknowledged(false); setError(null);
  }
  async function run(request: InTaskVendorRequest) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    if (request.intent === "create") lastCreate.current = request;
    try {
      const result = await inTaskVendorAction(request);
      if (!alive.current) return;
      if (result.kind === "created" || result.kind === "selected") {
        onSelected(result.vendor);
        setOpen(false); setVendor({ ...inTaskVendorDefaults, vendor_type: defaultType }); setMatches(null); setHasMore(false); setAcknowledged(false); setUncertain(false);
        requestId.current = null; lastCreate.current = null;
      } else if (result.kind === "checked" || result.kind === "similar") { setMatches(result.matches); setHasMore(result.hasMore); setAcknowledged(false); setUncertain(false); }
      else if (result.kind === "error") { setError(result.error); setUncertain(Boolean(result.uncertain)); }
    } catch {
      if (!alive.current) return;
      const mayHaveSaved = request.intent === "create";
      setUncertain(mayHaveSaved);
      setError(mayHaveSaved ? "The vendor may have been saved. Retry the unchanged request to check its result." : "The vendor check failed. Retry when your connection is available.");
    } finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  function create() {
    if (uncertain && lastCreate.current) { void run(lastCreate.current); return; }
    requestId.current ??= crypto.randomUUID();
    void run({ intent: "create", vendor, request_id: requestId.current, acknowledge_similar: acknowledged });
  }
  const text = (field: "vendor_name" | "contact_person" | "phone" | "gst_number" | "city", label: string, extra: Record<string, unknown> = {}) =>
    <label className="space-y-1"><span className="form-label">{label}</span><input className="form-input" value={vendor[field] ?? ""} maxLength={160} onChange={event => update(field, event.target.value)} {...extra} /></label>;

  return <div className="mt-2">
    <button ref={triggerRef} type="button" onClick={() => setOpen(true)} className="min-h-10 rounded-lg border border-neutral-200 px-3 py-2 text-xs font-bold text-neutral-700 hover:bg-neutral-50">Add new vendor</button>
    <dialog ref={dialogRef} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={event => { event.preventDefault(); if (!busyRef.current) setOpen(false); }} onKeyDown={event => event.stopPropagation()}
      className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-3xl border border-neutral-200 bg-white p-5 shadow-2xl backdrop:bg-neutral-950/40 sm:p-6">
      <div className="flex items-start justify-between gap-4"><div><h2 id={`${id}-title`} className="text-xl font-black">Add vendor to this {taskLabel}</h2>
        <p id={`${id}-description`} className="mt-1 text-sm text-neutral-600">Check likely duplicates, then create or select a vendor. Your {taskLabel} entries stay in place.</p></div>
        <button type="button" disabled={busy} onClick={() => setOpen(false)} className="min-h-10 rounded-lg px-3 text-sm font-bold text-neutral-600 hover:bg-neutral-100">Close</button></div>
      <form onSubmit={event => event.preventDefault()} className="mt-5 space-y-4">
        <fieldset disabled={busy || uncertain} className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="space-y-1"><span className="form-label">Vendor name *</span><input ref={nameRef} className="form-input" value={vendor.vendor_name} maxLength={160} required onChange={event => update("vendor_name", event.target.value)} /></label>
          <label className="space-y-1"><span className="form-label">Vendor type</span><select className="form-input" value={vendor.vendor_type} onChange={event => update("vendor_type", event.target.value)}>{vendorTypes.map(type => <option key={type} value={type}>{labelize(type)}</option>)}</select></label>
          {text("contact_person", "Contact person")}{text("phone", "Phone", { type: "tel", autoComplete: "tel", maxLength: 25 })}{text("gst_number", "GST number", { className: "form-input uppercase", maxLength: 15 })}{text("city", "City")}
        </fieldset>
        {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
        {uncertain ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Details are held unchanged so a retry recovers the same vendor without creating a second record.</p> : null}
        {matches !== null ? <section aria-label="Possible existing vendors" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-semibold">{matches.length ? "Review these possible matches before creating a separate vendor." : "No likely match was found in these checks."}</p>
          {matches.map(match => <div key={match.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-3"><div className="min-w-0 break-words text-sm"><p className="font-bold">{match.vendor_name}</p>
            <p>{labelize(match.vendor_type)}{match.phone ? ` / ${match.phone}` : ""}{match.gst_number ? ` / ${match.gst_number}` : ""} · matched on {match.matched_on.join(", ")}{match.is_active ? "" : " · inactive"}</p></div>
            {match.is_active ? <Button type="button" variant="secondary" disabled={busy || uncertain} onClick={() => void run({ intent: "select", vendor_id: match.id })}>Use this vendor</Button> : null}</div>)}
          {hasMore ? <p className="text-xs font-semibold">Showing up to 10 matches. Review the Vendor Database for a broader search.</p> : null}
          {matches.length ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledged} disabled={busy || uncertain} onChange={event => setAcknowledged(event.target.checked)} className="mt-1 h-4 w-4" /><span>I reviewed the possible matches and need a separate vendor record.</span></label> : null}
        </section> : null}
        <div className="flex flex-wrap gap-2 border-t border-neutral-200 pt-4"><Button type="button" variant="secondary" disabled={busy || uncertain} onClick={() => void run({ intent: "check", vendor })}>Check existing vendors</Button>
          <Button type="button" disabled={busy || (!uncertain && Boolean(matches?.length) && !acknowledged)} onClick={create}>{uncertain ? "Retry and check result" : "Create vendor"}</Button></div>
        <p className="text-xs text-neutral-600">Creates a vendor master record. Complete its payment terms and address later in Vendors. Your {taskLabel} stays unsaved until you save it.</p>
      </form>
    </dialog>
  </div>;
}

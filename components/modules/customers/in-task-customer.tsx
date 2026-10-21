"use client";

import { useEffect, useId, useRef, useState } from "react";
import { inTaskCustomerAction } from "@/lib/actions/in-task-customers";
import { inTaskCustomerDefaults, type InTaskCustomerInput, type InTaskCustomerMatch, type InTaskCustomerOption, type InTaskCustomerRequest } from "@/lib/forms/in-task-customer";
import { can } from "@/lib/auth/permissions";
import { customerTypes, labelize, type SessionContext } from "@/types/app";
import { Button } from "@/components/ui/button";

export function InTaskCustomer({ context, onSelected }: { context: SessionContext; onSelected: (customer: InTaskCustomerOption) => void }) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const busyRef = useRef(false);
  const requestId = useRef<string | null>(null);
  const lastCreate = useRef<InTaskCustomerRequest | null>(null);
  const [open, setOpen] = useState(false);
  const [customer, setCustomer] = useState<InTaskCustomerInput>({ ...inTaskCustomerDefaults });
  const [matches, setMatches] = useState<InTaskCustomerMatch[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) { dialog.showModal(); if (!uncertain) nameRef.current?.focus(); }
    if (!open && dialog.open) { dialog.close(); triggerRef.current?.focus(); }
  }, [open, uncertain]);

  const permitted = can(context.role, "create", "customers") && can(context.role, "read", "customers");
  if (!permitted) return null;

  function update(field: keyof InTaskCustomerInput, value: string) {
    if (busyRef.current || uncertain) return;
    setCustomer((current) => ({ ...current, [field]: value }));
    setMatches(null); setHasMore(false); setAcknowledged(false); setError(null);
  }

  async function run(request: InTaskCustomerRequest) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(null);
    if (request.intent === "create") lastCreate.current = request;
    try {
      const result = await inTaskCustomerAction(request);
      if (!alive.current) return;
      if (result.kind === "created" || result.kind === "selected") {
        onSelected(result.customer);
        setOpen(false); setCustomer({ ...inTaskCustomerDefaults }); setMatches(null);
        setHasMore(false); setAcknowledged(false); setUncertain(false);
        requestId.current = null; lastCreate.current = null;
      } else if (result.kind === "checked" || result.kind === "similar") {
        setMatches(result.matches); setHasMore(result.hasMore); setAcknowledged(false); setUncertain(false);
      } else if (result.kind === "error") {
        setError(result.error); setUncertain(Boolean(result.uncertain));
      } else throw new Error("Customer confirmation is unavailable.");
    } catch {
      if (!alive.current) return;
      const mayHaveSaved = request.intent === "create";
      setUncertain(mayHaveSaved);
      setError(mayHaveSaved ? "The customer may have been saved. Retry the unchanged request to check its result." : "The customer check failed. Retry when your connection is available.");
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }

  function create() {
    if (uncertain && lastCreate.current) { void run(lastCreate.current); return; }
    requestId.current ??= crypto.randomUUID();
    void run({ intent: "create", customer, request_id: requestId.current, acknowledge_similar: acknowledged });
  }

  return <div className="mt-2">
    <button ref={triggerRef} type="button" onClick={() => setOpen(true)} className="min-h-10 rounded-lg border border-neutral-200 px-3 py-2 text-xs font-bold text-neutral-700 hover:bg-neutral-50">Add new customer</button>
    <dialog ref={dialogRef} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={(event) => { event.preventDefault(); if (!busyRef.current) setOpen(false); }} onKeyDown={(event) => event.stopPropagation()} className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-3xl border border-neutral-200 bg-white p-5 text-neutral-900 shadow-2xl backdrop:bg-neutral-950/40 sm:p-7">
      <div className="flex items-start justify-between gap-4"><div><h2 id={`${id}-title`} className="text-xl font-black">Add customer to this quotation</h2><p id={`${id}-description`} className="mt-1 text-sm text-neutral-600">Check likely duplicates, then create or select a customer. Your quotation entries stay in place.</p></div><button type="button" aria-label="Close customer dialog" disabled={busy} onClick={() => setOpen(false)} className="shrink-0 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-semibold disabled:opacity-50">Close</button></div>
      <form onSubmit={(event) => event.preventDefault()} className="mt-5 space-y-4">
        <fieldset disabled={busy || uncertain} className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="space-y-1"><span className="form-label">Customer name *</span><input ref={nameRef} className="form-input" value={customer.customer_name} maxLength={160} required onChange={(event) => update("customer_name", event.target.value)} /></label>
          <label className="space-y-1"><span className="form-label">Company name</span><input className="form-input" value={customer.company_name ?? ""} maxLength={160} onChange={(event) => update("company_name", event.target.value)} /></label>
          <label className="space-y-1"><span className="form-label">Customer type</span><select className="form-input" value={customer.customer_type} onChange={(event) => update("customer_type", event.target.value)}>{customerTypes.map((type) => <option key={type} value={type}>{labelize(type)}</option>)}</select></label>
          <label className="space-y-1"><span className="form-label">Phone</span><input className="form-input" type="tel" autoComplete="tel" value={customer.phone ?? ""} maxLength={25} onChange={(event) => update("phone", event.target.value)} /></label>
          <label className="space-y-1"><span className="form-label">GST number</span><input className="form-input uppercase" value={customer.gst_number ?? ""} maxLength={15} onChange={(event) => update("gst_number", event.target.value)} /></label>
          <label className="space-y-1"><span className="form-label">Email</span><input className="form-input" type="email" autoComplete="email" value={customer.email ?? ""} maxLength={160} onChange={(event) => update("email", event.target.value)} /></label>
          <details className="sm:col-span-2"><summary className="cursor-pointer py-2 text-sm font-semibold">Address and location (optional)</summary><div className="mt-2 grid gap-3 sm:grid-cols-2">
            {([ ["billing_address", "Billing address"], ["shipping_address", "Shipping address"] ] as const).map(([field, label]) => <label key={field} className="space-y-1"><span className="form-label">{label}</span><textarea className="form-input" maxLength={1000} value={customer[field] ?? ""} onChange={(event) => update(field, event.target.value)} /></label>)}
            {([ ["city", "City"], ["state", "State"], ["pincode", "Pincode"] ] as const).map(([field, label]) => <label key={field} className="space-y-1"><span className="form-label">{label}</span><input className="form-input" maxLength={160} value={customer[field] ?? ""} onChange={(event) => update(field, event.target.value)} /></label>)}
          </div></details>
        </fieldset>
        {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
        {uncertain ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Details are held unchanged so retry can recover the same customer without creating a second record. Closing this dialog keeps these details available while this quotation page stays open.</p> : null}
        {matches !== null ? <section aria-label="Possible existing customers" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-semibold">{matches.length ? "Review these possible matches before creating a separate customer." : "No likely match was found in these checks. Review the Customer Database if you are unsure."}</p>
          {matches.map((match) => <div key={match.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-3"><div className="min-w-0 break-words text-sm"><p className="font-bold">{match.company_name || match.customer_name}</p><p>{match.customer_name} {match.phone ? ` / ${match.phone}` : ""} {match.gst_number ? ` / ${match.gst_number}` : ""}</p><p className="text-xs text-neutral-600">Matched on {match.matched_on.join(", ")}{match.is_active ? "" : "; inactive customer"}</p></div><Button type="button" variant="secondary" disabled={busy || uncertain || !match.is_active} onClick={() => void run({ intent: "select", customer_id: match.id })}>Use this customer</Button></div>)}
          {hasMore ? <p className="text-xs font-semibold">Showing up to 10 matches. Review the Customer Database if you need a broader search.</p> : null}
          {matches.length ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledged} disabled={busy || uncertain} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1 h-4 w-4" /><span>I reviewed the possible matches and need a separate customer record.</span></label> : null}
        </section> : null}
        <div className="flex flex-wrap gap-2 border-t border-neutral-200 pt-4"><Button type="button" variant="secondary" disabled={busy || uncertain} onClick={() => void run({ intent: "check", customer })}>Check existing customers</Button><Button type="button" disabled={busy || (!uncertain && Boolean(matches?.length) && !acknowledged)} onClick={create}>{busy ? "Working..." : uncertain ? "Check saved result" : "Create customer and select"}</Button></div>
        <p className="text-xs text-neutral-600">Creates a customer master record. Your quotation remains unsaved until you choose its Save action.</p>
      </form>
    </dialog>
  </div>;
}

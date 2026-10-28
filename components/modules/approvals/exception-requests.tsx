"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { exceptionAction } from "@/lib/actions/exception-requests";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { EXCEPTION_TYPES, STATUS_LABELS, exceptionSummary, type ExceptionPolicy, type ExceptionRequestRow, type ExceptionType, type Restriction } from "@/lib/workflow/exception-requests";

const money = (value: number) => formatCurrency(value);

// UPGRADE_EOS feature 45: beside a restriction, explain it and let an eligible employee request the
// exception the company allows. Renders nothing when the record is not restricted and has no requests.
export function RestrictionPanel({ exceptionType, entityId, defaultWeightKg }: { exceptionType: ExceptionType; entityId: string; defaultWeightKg?: number }) {
  const router = useRouter();
  const [state, setState] = useState<Restriction | null>(null);
  const [reason, setReason] = useState("");
  const [weight, setWeight] = useState(defaultWeightKg ? String(defaultWeightKg) : "");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    void exceptionAction({ command: "restriction.check", exception_type: exceptionType, entity_id: entityId }).then((result) => {
      if (live && result.success) setState(result.data as Restriction);
    });
    return () => { live = false; };
  }, [exceptionType, entityId, version]);
  if (!state || (!state.restricted && !state.requests.length)) return null;
  const pending = state.requests.find((r) => r.status === "pending");

  async function submit() {
    const kg = Number(weight);
    if (exceptionType === "overdue_dispatch" && (!weight.trim() || !Number.isFinite(kg) || kg <= 0)) { setMessage("Enter the weight to dispatch in kg"); return; }
    setBusy(true); setMessage("");
    const result = await exceptionAction({ command: "request.create", id: requestId, exception_type: exceptionType, entity_id: entityId, reason, ...(exceptionType === "overdue_dispatch" ? { weight_kg: kg } : {}) });
    setBusy(false);
    if (!result.success) { setMessage(result.error); return; }
    setReason(""); setRequestId(crypto.randomUUID()); setVersion(version + 1);
    setMessage("Request sent to the approvers. You will be notified with a link back here.");
    router.refresh();
  }
  async function withdraw(id: string) {
    setBusy(true);
    const result = await exceptionAction({ command: "request.withdraw", id });
    setBusy(false);
    setMessage(result.success ? "Request withdrawn." : result.error);
    setVersion(version + 1);
  }

  return (
    <section className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm">
      <h3 className="font-bold text-amber-950">{state.restricted ? "Restricted" : "Exception history"}: {EXCEPTION_TYPES[exceptionType].label}</h3>
      {state.restricted ? <p className="text-amber-950">{state.reason}</p> : null}
      {state.blocker ? <p className="font-semibold text-red-800">{state.blocker}</p> : null}
      {state.requests.length ? (
        <ul className="space-y-1 text-xs">
          {state.requests.map((request) => (
            <li key={request.id} className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{STATUS_LABELS[request.status]}</span>
              <span>requested by {request.requested_by_name}, {formatDate(request.requested_at)}{request.weight_kg ? ` · up to ${request.weight_kg} kg` : ""}</span>
              {request.decided_by_name ? <span>· {request.decided_by_name}{request.decision_note ? `: ${request.decision_note}` : ""}</span> : null}
              {request.status === "approved" && request.expires_at ? <span>· valid until {formatDate(request.expires_at)}{request.covers_current ? "" : " (does not cover the current version)"}</span> : null}
              {request.status === "pending" ? <button type="button" className="font-bold underline" disabled={busy} onClick={() => void withdraw(request.id)}>Withdraw</button> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {state.can_request && !pending ? (
        <form className="grid gap-2 md:grid-cols-[1fr_auto]" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div className="grid gap-2 md:grid-cols-[1fr_10rem]">
            <input className="form-input" maxLength={500} aria-label="Reason for the exception" placeholder="Why is the exception needed? (customer commitment, payment promised on…)" value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} />
            {exceptionType === "overdue_dispatch" ? <input className="form-input" inputMode="decimal" aria-label="Weight to dispatch (kg)" placeholder="Weight (kg)" value={weight} disabled={busy} onChange={(e) => setWeight(e.target.value)} /> : null}
          </div>
          <Button type="submit" disabled={busy || reason.trim().length < 10}>{busy ? "Sending…" : "Request exception"}</Button>
        </form>
      ) : null}
      {message ? <p role="status" className="text-xs font-semibold text-slate-800">{message}</p> : null}
    </section>
  );
}

// Approvers decide exceptions here (the approval inbox). A decision names the version it covers.
export function ExceptionDecisionRow({ row }: { row: ExceptionRequestRow }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function decide(decision: "approve" | "reject") {
    setBusy(true); setMessage("");
    const result = await exceptionAction({ command: "request.decide", id: row.id, decision, version: row.version, note });
    setBusy(false);
    if (!result.success) { setMessage(result.error); return; }
    const data = result.data as { status: string; message: string | null };
    if (data.message) { setMessage(data.message); return; }
    router.refresh();
  }
  return (
    <li className="space-y-2 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <a href={row.return_path} className="font-bold underline-offset-2 hover:underline">{EXCEPTION_TYPES[row.exception_type].label}: {exceptionSummary(row, money)}</a>
        <span className="text-xs text-slate-500">{row.requested_by_name} · {formatDate(row.requested_at)}</span>
      </div>
      <p>{row.reason}</p>
      {!row.current ? <p className="text-xs font-semibold text-amber-900">The record changed after the request{row.current_detail ? ` (now ${exceptionSummary({ ...row, detail: row.current_detail }, money)})` : ""}. Approving will close it as superseded.</p> : null}
      {row.blocker ? <p className="text-xs font-semibold text-red-800">{row.blocker}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <input className="form-input w-64" maxLength={500} aria-label="Decision note" placeholder="Note (required to reject)" value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} />
        <Button type="button" disabled={busy || Boolean(row.blocker)} onClick={() => void decide("approve")}>Approve</Button>
        <Button type="button" variant="secondary" disabled={busy || note.trim().length < 3} onClick={() => void decide("reject")}>Reject</Button>
      </div>
      {message ? <p role="alert" className="text-xs font-semibold text-red-700">{message}</p> : null}
    </li>
  );
}

export function ExceptionPolicyForm({ type, initial }: { type: ExceptionType; initial?: ExceptionPolicy }) {
  const router = useRouter();
  const meta = EXCEPTION_TYPES[type];
  const [form, setForm] = useState({
    is_active: initial?.is_active ?? false, approver_roles: initial?.approver_roles ?? ["owner", "admin"], validity_hours: String(initial?.validity_hours ?? 24),
    overdue_days: String(initial?.overdue_days ?? 30), min_overdue_amount: String(initial?.min_overdue_amount ?? 50000),
    hard_limit_amount: initial?.hard_limit_amount === null || initial?.hard_limit_amount === undefined ? "" : String(initial.hard_limit_amount),
    max_shortfall_points: initial?.max_shortfall_points === null || initial?.max_shortfall_points === undefined ? "" : String(initial.max_shortfall_points)
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const optional = (value: string) => (value.trim() === "" ? null : Number(value));
  async function save() {
    setBusy(true); setMessage("");
    const result = await exceptionAction({
      command: "policy.set", exception_type: type, is_active: form.is_active, approver_roles: form.approver_roles, validity_hours: Number(form.validity_hours),
      ...(type === "overdue_dispatch" ? { overdue_days: Number(form.overdue_days), min_overdue_amount: Number(form.min_overdue_amount), hard_limit_amount: optional(form.hard_limit_amount) } : { max_shortfall_points: optional(form.max_shortfall_points) })
    });
    setBusy(false);
    setMessage(result.success ? "Saved." : result.error);
    if (result.success) router.refresh();
  }
  return (
    <form className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">{meta.label}</h3>
        <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={form.is_active} disabled={busy} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Enabled</label>
      </div>
      <p className="text-xs text-slate-600">{meta.restriction}</p>
      <fieldset className="flex flex-wrap gap-2"><legend className="form-label">Approved by</legend>
        {meta.approvers.map((role) => (
          <label key={role} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs">
            <input type="checkbox" checked={form.approver_roles.includes(role)} disabled={busy} onChange={(e) => setForm({ ...form, approver_roles: e.target.checked ? [...form.approver_roles, role] : form.approver_roles.filter((r) => r !== role) })} />{role.replace(/_/g, " ")}
          </label>
        ))}
      </fieldset>
      <div className="grid gap-2 md:grid-cols-4">
        <label className="space-y-1"><span className="form-label">Approval valid for (hours)</span><input className="form-input" inputMode="numeric" value={form.validity_hours} disabled={busy} onChange={(e) => setForm({ ...form, validity_hours: e.target.value })} /></label>
        {type === "overdue_dispatch" ? (
          <>
            <label className="space-y-1"><span className="form-label">Overdue by more than (days)</span><input className="form-input" inputMode="numeric" value={form.overdue_days} disabled={busy} onChange={(e) => setForm({ ...form, overdue_days: e.target.value })} /></label>
            <label className="space-y-1"><span className="form-label">Hold from (INR overdue)</span><input className="form-input" inputMode="decimal" value={form.min_overdue_amount} disabled={busy} onChange={(e) => setForm({ ...form, min_overdue_amount: e.target.value })} /></label>
            <label className="space-y-1"><span className="form-label">Hard limit, no exception (INR)</span><input className="form-input" inputMode="decimal" placeholder="optional" value={form.hard_limit_amount} disabled={busy} onChange={(e) => setForm({ ...form, hard_limit_amount: e.target.value })} /></label>
          </>
        ) : (
          <label className="space-y-1"><span className="form-label">Largest shortfall an exception may cover (points)</span><input className="form-input" inputMode="decimal" placeholder="optional" value={form.max_shortfall_points} disabled={busy} onChange={(e) => setForm({ ...form, max_shortfall_points: e.target.value })} /></label>
        )}
      </div>
      <p className="text-xs text-slate-500">{type === "low_margin_quote" ? "A quotation priced below cost is never released by exception." : "Above the hard limit the hold is lifted only by collecting payment."} An approval covers only the exact record and content it was requested for.</p>
      <Button type="submit" disabled={busy || !form.approver_roles.length}>{busy ? "Saving…" : "Save policy"}</Button>
      {message ? <span role="status" className="ml-2 text-xs font-semibold">{message}</span> : null}
    </form>
  );
}

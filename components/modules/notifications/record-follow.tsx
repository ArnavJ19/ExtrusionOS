"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { subscriptionAction } from "@/lib/actions/subscriptions";
import { formatDate } from "@/lib/utils/format";
import {
  CATEGORY_LABELS, REQUEST_TYPES, RESOLUTION_LABELS, digestWhatsAppText, quietText, recordHref, requestTypesFor,
  type ActionRequest, type Category, type Digest, type FollowType, type Preferences, type RequestType
} from "@/lib/workflow/subscriptions";

type Status = { following: boolean; categories: Category[]; available: Category[] };

// UPGRADE_EOS feature 48: follow a record (chosen kinds of update) and ask a colleague for an action on it.
export function RecordFollow({ entityType, entityId }: { entityType: FollowType; entityId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [choice, setChoice] = useState<Category[]>([]);
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    void subscriptionAction({ command: "follow.status", entity_type: entityType, entity_id: entityId }).then((result) => {
      if (!live) return;
      if (!result.success) { setMessage(result.unavailable ? "" : result.error); return; }
      const data = result.data as Status;
      setStatus(data); setChoice(data.following ? data.categories : data.available);
    });
    return () => { live = false; };
  }, [entityType, entityId]);
  if (!status) return message ? <p className="text-xs text-slate-500">{message}</p> : null;
  const current = status;

  async function save(following: boolean) {
    setBusy(true); setMessage("");
    const result = await subscriptionAction(following ? { command: "follow.set", entity_type: entityType, entity_id: entityId, categories: choice } : { command: "follow.remove", entity_type: entityType, entity_id: entityId });
    setBusy(false);
    if (!result.success) { setMessage(result.error); return; }
    setStatus({ ...current, following, categories: following ? choice : [] }); setEditing(false);
    setMessage(following ? "Following. Updates arrive grouped in your notifications." : "No longer following.");
  }

  return (
    <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {status.following
          ? <><span className="font-bold">Following</span><span className="text-xs text-slate-500">{status.categories.map((c) => CATEGORY_LABELS[c]).join(", ")}</span>
              <button type="button" className="text-xs font-bold underline" disabled={busy} onClick={() => setEditing(!editing)}>Change</button>
              <button type="button" className="text-xs font-bold underline" disabled={busy} onClick={() => void save(false)}>Unfollow</button></>
          : <Button type="button" variant="secondary" disabled={busy} onClick={() => setEditing(!editing)}>Follow updates</Button>}
        <button type="button" className="ml-auto text-xs font-bold underline" onClick={() => setAsking(!asking)}>Ask someone to act</button>
      </div>
      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          {status.available.map((category) => (
            <label key={category} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs">
              <input type="checkbox" checked={choice.includes(category)} disabled={busy} onChange={(e) => setChoice(e.target.checked ? [...choice, category] : choice.filter((c) => c !== category))} />{CATEGORY_LABELS[category]}
            </label>
          ))}
          <Button type="button" disabled={busy || !choice.length} onClick={() => void save(true)}>{status.following ? "Save" : "Follow"}</Button>
        </div>
      ) : null}
      {asking ? <ActionRequestForm entityType={entityType} entityId={entityId} onDone={(text) => { setAsking(false); setMessage(text); }} /> : null}
      {message ? <p role="status" className="text-xs font-semibold text-slate-700">{message}</p> : null}
    </div>
  );
}

function ActionRequestForm({ entityType, entityId, onDone }: { entityType: FollowType; entityId: string; onDone: (message: string) => void }) {
  const types = requestTypesFor(entityType);
  const [requestType, setRequestType] = useState<RequestType>(types[0]);
  const [recipients, setRecipients] = useState<{ id: string; name: string; role: string }[] | null>(null);
  const [form, setForm] = useState({ recipient_id: "", message: "", reminder_hours: "4" });
  const [requestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setRecipients(null);
    void subscriptionAction({ command: "request.recipients", entity_type: entityType, entity_id: entityId, request_type: requestType }).then((result) => {
      if (!live) return;
      if (!result.success) { setError(result.error); setRecipients([]); return; }
      setRecipients(result.data as { id: string; name: string; role: string }[]);
    });
    return () => { live = false; };
  }, [entityType, entityId, requestType]);
  async function send() {
    setBusy(true); setError("");
    const result = await subscriptionAction({ command: "request.create", id: requestId, recipient_id: form.recipient_id, request_type: requestType, entity_type: entityType, entity_id: entityId, message: form.message, reminder_hours: Number(form.reminder_hours) });
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    onDone("Request sent. Reminders stop by themselves once it is done.");
  }
  return (
    <form className="grid gap-2 rounded-xl border border-dashed border-slate-300 p-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <label className="space-y-1"><span className="form-label">What is needed</span>
        <select className="form-input" value={requestType} disabled={busy} onChange={(e) => { setRequestType(e.target.value as RequestType); setForm({ ...form, recipient_id: "" }); }}>
          {types.map((type) => <option key={type} value={type}>{REQUEST_TYPES[type].label}</option>)}
        </select>
      </label>
      <label className="space-y-1"><span className="form-label">Ask</span>
        <select className="form-input" value={form.recipient_id} disabled={busy || !recipients} onChange={(e) => setForm({ ...form, recipient_id: e.target.value })}>
          <option value="">{recipients === null ? "Loading…" : recipients.length ? "Choose" : "No one can act on this"}</option>
          {recipients?.map((person) => <option key={person.id} value={person.id}>{person.name} ({person.role.replace(/_/g, " ")})</option>)}
        </select>
      </label>
      <label className="space-y-1 md:col-span-2"><span className="form-label">Message</span><input className="form-input" maxLength={300} placeholder="e.g. Customer is waiting for the revised price" value={form.message} disabled={busy} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
      <label className="space-y-1"><span className="form-label">Remind every (hours)</span><input className="form-input" inputMode="numeric" value={form.reminder_hours} disabled={busy} onChange={(e) => setForm({ ...form, reminder_hours: e.target.value })} /></label>
      <p className="self-end text-xs text-slate-500">Resolves {REQUEST_TYPES[requestType].resolves}.</p>
      <div className="md:col-span-2"><Button type="submit" disabled={busy || !form.recipient_id || form.message.trim().length < 3}>{busy ? "Sending…" : "Send request"}</Button></div>
      {error ? <p role="alert" className="text-xs font-semibold text-red-700 md:col-span-2">{error}</p> : null}
    </form>
  );
}

export function PreferencesForm({ initial }: { initial: Preferences }) {
  const router = useRouter();
  const [form, setForm] = useState({ digest_mode: initial.digest_mode, daily_hour: String(initial.daily_hour), quiet_start: initial.quiet_start === null ? "" : String(initial.quiet_start), quiet_end: initial.quiet_end === null ? "" : String(initial.quiet_end), muted: initial.muted_categories });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const hours = Array.from({ length: 24 }, (_, h) => h);
  async function save() {
    setBusy(true); setMessage("");
    const result = await subscriptionAction({ command: "prefs.set", digest_mode: form.digest_mode, daily_hour: Number(form.daily_hour), quiet_start: form.quiet_start === "" ? null : Number(form.quiet_start), quiet_end: form.quiet_end === "" ? null : Number(form.quiet_end), muted_categories: form.muted });
    setBusy(false);
    setMessage(result.success ? "Saved." : result.error);
    if (result.success) router.refresh();
  }
  return (
    <form className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="space-y-1"><span className="form-label">Send updates</span>
        <select className="form-input" value={form.digest_mode} disabled={busy} onChange={(e) => setForm({ ...form, digest_mode: e.target.value as Preferences["digest_mode"] })}>
          <option value="immediate">As they happen (grouped)</option><option value="hourly">Hourly summary</option><option value="daily">Daily summary</option>
        </select>
      </label>
      {form.digest_mode === "daily" ? (
        <label className="space-y-1"><span className="form-label">Daily at (IST)</span>
          <select className="form-input" value={form.daily_hour} disabled={busy} onChange={(e) => setForm({ ...form, daily_hour: e.target.value })}>{hours.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select>
        </label>
      ) : <span />}
      <label className="space-y-1"><span className="form-label">Quiet from</span>
        <select className="form-input" value={form.quiet_start} disabled={busy} onChange={(e) => setForm({ ...form, quiet_start: e.target.value })}><option value="">Off</option>{hours.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select>
      </label>
      <label className="space-y-1"><span className="form-label">Quiet until</span>
        <select className="form-input" value={form.quiet_end} disabled={busy} onChange={(e) => setForm({ ...form, quiet_end: e.target.value })}><option value="">Off</option>{hours.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select>
      </label>
      <fieldset className="flex flex-wrap gap-2 md:col-span-4"><legend className="form-label">Never send</legend>
        {(Object.keys(CATEGORY_LABELS) as Category[]).map((category) => (
          <label key={category} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs">
            <input type="checkbox" checked={form.muted.includes(category)} disabled={busy} onChange={(e) => setForm({ ...form, muted: e.target.checked ? [...form.muted, category] : form.muted.filter((c) => c !== category) })} />{CATEGORY_LABELS[category]}
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-slate-500 md:col-span-3">Quiet hours: {quietText(form.quiet_start === "" ? null : Number(form.quiet_start), form.quiet_end === "" ? null : Number(form.quiet_end))}. Updates and reminders wait until they end. Requests for action are always kept separate from information.</p>
      <div><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save preferences"}</Button>{message ? <span role="status" className="ml-2 text-xs font-semibold">{message}</span> : null}</div>
    </form>
  );
}

export function DigestCard({ digest }: { digest: Digest }) {
  const [copied, setCopied] = useState(false);
  const text = digestWhatsAppText(digest, (iso) => formatDate(iso));
  return (
    <li className="space-y-2 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-bold">{digest.event_count} update{digest.event_count === 1 ? "" : "s"} on {digest.record_count} record{digest.record_count === 1 ? "" : "s"}</p>
        <span className="text-xs text-slate-500">{formatDate(digest.created_at)}</span>
      </div>
      <ul className="space-y-1 text-xs">
        {digest.items.map((item) => (
          <li key={`${item.entity_type}:${item.entity_id}`}>
            <a href={recordHref(item.entity_type, item.entity_id)} className="font-bold underline-offset-2 hover:underline">{item.label}</a> · {item.latest}
            {item.updates > 1 ? <span className="text-slate-500"> ({item.updates} updates; earlier: {item.earlier.join("; ")})</span> : null}
          </li>
        ))}
      </ul>
      <button type="button" className="text-xs font-bold underline" onClick={() => { void navigator.clipboard.writeText(text).then(() => setCopied(true), () => setCopied(false)); }}>{copied ? "Copied for WhatsApp" : "Copy for WhatsApp"}</button>
    </li>
  );
}

export function DigestNowButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button type="button" variant="secondary" disabled={busy} onClick={async () => {
        setBusy(true); setMessage("");
        const result = await subscriptionAction({ command: "digest.now" });
        setBusy(false);
        if (!result.success) { setMessage(result.error); return; }
        const records = (result.data as { records: number }).records;
        setMessage(records ? `Summary of ${records} record${records === 1 ? "" : "s"} added.` : "No new updates.");
        router.refresh();
      }}>{busy ? "Checking…" : "Show my updates now"}</Button>
      {message ? <span role="status" className="text-xs font-semibold">{message}</span> : null}
    </span>
  );
}

export function RequestRow({ request, box }: { request: ActionRequest; box: "inbox" | "sent" }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <li className="space-y-2 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <a href={recordHref(request.entity_type, request.entity_id)} className="font-bold underline-offset-2 hover:underline">{REQUEST_TYPES[request.request_type].label}: {request.label}</a>
        <span className="text-xs text-slate-500">{box === "inbox" ? `from ${request.requester_name ?? "-"}` : `to ${request.recipient_name ?? "-"}`} · {formatDate(request.created_at)}</span>
      </div>
      <p>{request.message}</p>
      <p className="text-xs text-slate-500">
        {request.resolution ? `${RESOLUTION_LABELS[request.resolution]}${request.resolved_at ? `, ${formatDate(request.resolved_at)}` : ""}${request.resolution_note ? ` · ${request.resolution_note}` : ""}`
          : `Reminders every ${request.reminder_hours} h (${request.reminder_count} sent) · resolves ${REQUEST_TYPES[request.request_type].resolves}`}
      </p>
      {request.can_close ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setError("");
          const result = await subscriptionAction({ command: "request.close", id: request.id, note });
          setBusy(false);
          if (!result.success) { setError(result.error); return; }
          router.refresh();
        }}>
          <input className="form-input w-64" maxLength={300} aria-label="Note" placeholder={box === "inbox" ? "What you did (optional)" : "Why it is no longer needed (optional)"} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} />
          <Button type="submit" variant="secondary" disabled={busy}>{box === "inbox" ? "Mark done" : "Withdraw"}</Button>
        </form>
      ) : null}
      {error ? <p role="alert" className="text-xs font-semibold text-red-700">{error}</p> : null}
    </li>
  );
}

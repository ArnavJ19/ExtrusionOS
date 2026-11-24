"use client";

// Orchestration Phase 6: send packed bundles to the finished-goods area, scan them in there, close a transfer short or
// cancel it. The database checks every bundle (packed, not dispatched, not held, not already sent), who may receive
// (never the sender, owner excepted) and the transfer's state; these forms only collect the request.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { packagingFlowAction } from "@/lib/actions/orchestration";
import { floorText, type FloorLanguage } from "@/lib/i18n/floor";
import { formatWeight } from "@/lib/utils/format";
import { fgReceiveSchema, fgTransferSchema, selectedNetKg, tagSchema, MAX_TRANSFER_BUNDLES, type FgCandidate } from "@/lib/workflow/packaging-flow";

const input = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
const Message = ({ message }: { message: { ok: boolean; text: string } | null }) => message
  ? <p role={message.ok ? "status" : "alert"} className={`text-sm font-semibold [overflow-wrap:anywhere] ${message.ok ? "text-emerald-800" : "text-red-800"}`}>{message.text}</p> : null;

export function FgSendForm({ locations, candidates, lang = "en" }: { locations: { id: string; location_name: string; location_code: string }[]; candidates: FgCandidate[]; lang?: FloorLanguage }) {
  const router = useRouter();
  const t = floorText(lang);
  // One identity per attempt: a retry after an unconfirmed send replays it instead of recording a second transfer.
  const requestId = useRef<string>(crypto.randomUUID());
  const [location, setLocation] = useState(locations.length === 1 ? locations[0].id : "");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const toggle = (id: string) => { const next = new Set(chosen); if (next.has(id)) next.delete(id); else next.add(id); setChosen(next); requestId.current = crypto.randomUUID(); };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!location || chosen.size === 0) return;
    setBusy(true); setMessage(null);
    const result = await packagingFlowAction({ command: "fg.send", id: requestId.current, location_id: location, bundle_ids: [...chosen], ...(note.trim() ? { note: note.trim() } : {}) });
    setBusy(false);
    if (!result.success) { setMessage({ ok: false, text: result.error }); return; }
    const sent = fgTransferSchema.safeParse(result.data);
    if (sent.success) router.push(`/packaging/fg-transfers/${sent.data.id}`); else router.refresh();
  }
  if (locations.length === 0) return <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">{t("pkf.fg.noLocations")}</p>;
  return (
    <form className="space-y-3 rounded-2xl border border-slate-300 bg-white p-4" onSubmit={submit} lang={lang}>
      <label className="block text-sm font-semibold">{t("pkf.fg.location")}
        <select required className={input} value={location} onChange={e => { setLocation(e.target.value); requestId.current = crypto.randomUUID(); }}>
          <option value="">{t("pkf.fg.chooseLocation")}</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.location_name} ({l.location_code})</option>)}</select></label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{t("pkf.fg.choose")}</legend>
        {candidates.length === 0 ? <p className="text-sm">{t("pkf.fg.noCandidates")}</p> : <ul className="divide-y rounded-xl border">{candidates.map(c => (
          <li key={c.id}><label className={`flex min-h-11 items-center gap-3 px-3 py-2 text-sm ${c.hold ? "opacity-60" : ""}`}>
            <input type="checkbox" className="h-5 w-5" disabled={Boolean(c.hold) || (!chosen.has(c.id) && chosen.size >= MAX_TRANSFER_BUNDLES)} checked={chosen.has(c.id)} onChange={() => toggle(c.id)} />
            <span className="whitespace-nowrap font-mono font-semibold">{c.bundle_number}</span>
            <span>{c.order_number ?? "—"} · {c.job_number ?? "—"} · {c.profile_code ?? "—"} · {c.pieces} pcs · {formatWeight(c.net_kg)}</span>
            {c.hold ? <span className="font-bold text-red-900">{t("pkf.fg.heldBundle", { number: c.hold })}</span> : null}</label></li>))}</ul>}
      </fieldset>
      <p className="text-sm font-semibold">{t("pkf.fg.selected", { n: chosen.size, kg: formatWeight(selectedNetKg(candidates, chosen)) })}</p>
      <label className="block text-sm font-semibold">{t("pkf.fg.note")}<textarea maxLength={500} className={input} value={note} onChange={e => setNote(e.target.value)} /></label>
      <Button disabled={busy || !location || chosen.size === 0}>{t("pkf.fg.send")}</Button>
      <Message message={message} />
    </form>
  );
}

export function FgReceivePanel({ transferId, remaining, lang = "en" }: { transferId: string; remaining: number; lang?: FloorLanguage }) {
  const router = useRouter();
  const t = floorText(lang);
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const field = useRef<HTMLInputElement>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = tagSchema.safeParse(tag);
    if (!parsed.success) { setMessage({ ok: false, text: parsed.error.issues[0]?.message ?? t("pkf.fg.tag") }); return; }
    setBusy(true); setMessage(null);
    const result = await packagingFlowAction({ command: "fg.receive", transfer_id: transferId, tag: parsed.data });
    setBusy(false);
    setTag("");
    field.current?.focus();
    if (!result.success) { setMessage({ ok: false, text: result.error }); return; }
    const r = fgReceiveSchema.safeParse(result.data);
    if (r.success) {
      setMessage({ ok: true, text: r.data.state === "already_received" ? t("pkf.fg.already", { tag: r.data.bundle_number })
        : r.data.transfer.remaining === 0 ? t("pkf.fg.allReceived") : t("pkf.fg.received", { tag: r.data.bundle_number, n: r.data.transfer.remaining }) });
    }
    router.refresh();
  }
  return (
    <form className="space-y-2 rounded-2xl border border-slate-300 bg-white p-4" onSubmit={submit} lang={lang}>
      <h2 className="text-lg font-bold">{t("pkf.fg.receive")}</h2>
      <p className="text-sm text-slate-600">{t("pkf.fg.receiveHelp")}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm font-semibold">{t("pkf.fg.tag")}
          <input ref={field} autoFocus autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={160} className={`${input} font-mono`} value={tag} onChange={e => setTag(e.target.value)} disabled={busy || remaining === 0} /></label>
        <Button disabled={busy || remaining === 0 || !tag.trim()}>{t("pkf.fg.scan")}</Button>
      </div>
      <Message message={message} />
    </form>
  );
}

export function FgCloseForm({ transferId, mode, lang = "en" }: { transferId: string; mode: "close" | "cancel"; lang?: FloorLanguage }) {
  const router = useRouter();
  const t = floorText(lang);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMessage(null);
    const result = await packagingFlowAction({ command: mode === "close" ? "fg.close" : "fg.cancel", transfer_id: transferId, note: note.trim() });
    setBusy(false);
    if (!result.success) { setMessage({ ok: false, text: result.error }); return; }
    setOpen(false); router.refresh();
  }
  const label = t(mode === "close" ? "pkf.fg.close" : "pkf.fg.cancel");
  if (!open) return <button type="button" className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold" onClick={() => setOpen(true)}>{label}</button>;
  return (
    <form className="space-y-2 rounded-2xl border border-slate-300 bg-white p-4" onSubmit={submit} lang={lang}>
      <h2 className="text-lg font-bold">{label}</h2>
      {mode === "close" ? <p className="text-sm text-slate-600">{t("pkf.fg.closeHelp")}</p> : null}
      <label className="block text-sm font-semibold">{t(mode === "close" ? "pkf.fg.closeNote" : "pkf.fg.cancelNote")}
        <textarea required minLength={10} maxLength={500} className={input} value={note} onChange={e => setNote(e.target.value)} /></label>
      <div className="flex gap-2"><Button disabled={busy || note.trim().length < 10}>{label}</Button>
        <button type="button" className="min-h-11 rounded-xl border px-4 text-sm font-bold" onClick={() => setOpen(false)}>✕</button></div>
      <Message message={message} />
    </form>
  );
}

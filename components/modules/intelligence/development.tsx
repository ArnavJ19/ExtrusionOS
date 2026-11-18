"use client";

// FS-54: one pipeline from a customer drawing to first approved production. Each stage has an owner and an age; the
// database refuses a move whose evidence is missing (feasible verdict, die cost and who pays, customer approval, die
// record, trials, sample, approval and profile).
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fmtDay, inr } from "@/lib/order-to-cash/commands";
import { DEVELOPMENT_ORDER, DEVELOPMENT_STAGES, type DevelopmentStage } from "@/lib/intelligence/commands";
import { Empty, Failure, Loading, Message, Pager, Pill, Section, buttonClass, fsWrite, inputClass, numberOrUndefined, secondaryClass, useFsRead, type Note } from "./shared";

type Option = { id: string; label: string };
export type DevProject = { id: string; project_number: string; title: string; customer_id: string; customer_name: string; drawing_reference: string | null; stage: DevelopmentStage; stage_since: string;
  owner_id: string; owner_name: string; age_days: number; feasibility: { ccd_mm?: number; weight_kg_per_m?: number; min_wall_mm?: number; tongue_ratio?: number; press_id?: string; verdict?: string; note?: string } | null;
  die_cost: number | null; die_cost_payer: string | null; amortisation_terms: string | null; die_cost_approved_by_customer_at: string | null; die_vendor_id: string | null; vendor_name: string | null;
  expected_die_date: string | null; die_id: string | null; die_number: string | null; profile_id: string | null; profile_code: string | null; trial_count: number; sample_reference: string | null;
  customer_approval_reference: string | null; drop_reason: string | null; customer_die_charge: number | null; die_amortization_type: string | null; die_amortization_quantity_kg: number | null;
  die_record_update: Record<string, unknown> | null; trials: { id: string; trial_date: string; result: string | null; correction_required: boolean | null; recovery_percent: number | null; remarks: string | null }[];
  events?: { from_stage: string | null; to_stage: string; note: string; owner: string | null; recorded_by: string; recorded_at: string }[] };
type Lists = { customers: Option[]; users: Option[]; dies: Option[]; profiles: Option[]; vendors: Option[]; presses: Option[] };

export function DevelopmentBoard({ canEdit, lists }: { canEdit: boolean; lists: Lists }) {
  const [key, setKey] = useState(0);
  const d = useFsRead<{ stages: { stage: DevelopmentStage; count: number; projects: DevProject[] }[] }>("fs_development", "board", {}, [key]);
  return <div className="space-y-5">
    {canEdit ? <CreateForm lists={lists} onCreated={() => setKey(k => k + 1)} /> : null}
    {d.loading && !d.data ? <Loading what="the pipeline" /> : d.error ? <Failure text={d.error} /> : d.data ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {d.data.stages.map(s => <section key={s.stage} className="min-w-0 rounded-2xl border border-neutral-200 bg-white p-3">
        <h2 className="flex items-center justify-between text-sm font-black">{DEVELOPMENT_STAGES[s.stage]} <span className="rounded-full bg-neutral-100 px-2 text-xs">{s.count}</span></h2>
        {s.projects.length ? <ul className="mt-2 space-y-2">{s.projects.map(p => <li key={p.id}><Link href={`/profiles/development/${p.id}`} className="block rounded-xl bg-neutral-50 p-2 text-sm hover:bg-neutral-100">
          <span className="font-bold">{p.project_number}</span> · {p.title}<br /><span className="text-xs text-neutral-600">{p.customer_name} · {p.owner_name} · {p.age_days} day(s) in stage</span></Link></li>)}</ul>
          : <p className="mt-2 text-xs text-neutral-500">None</p>}
        {s.count > s.projects.length ? <Link className="mt-1 inline-block text-xs font-bold underline" href={`/profiles/development/database?stage=${s.stage}`}>All {s.count}</Link> : null}
      </section>)}</div> : null}
  </div>;
}

function CreateForm({ lists, onCreated }: { lists: Lists; onCreated: () => void }) {
  const [message, setMessage] = useState<Note>(null); const [title, setTitle] = useState(""); const [customer, setCustomer] = useState(""); const [drawing, setDrawing] = useState(""); const [owner, setOwner] = useState("");
  return <Section title="New development" description="A customer's drawing for a section Omalco does not make yet.">
    <Message value={message} />
    <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 flex-1 text-xs font-bold">Title<input className={inputClass} value={title} onChange={e => setTitle(e.target.value)} placeholder="3-track sliding sash" /></label>
      <label className="min-w-0 flex-1 text-xs font-bold">Customer<select className={inputClass} value={customer} onChange={e => setCustomer(e.target.value)}><option value="">Choose…</option>{lists.customers.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
      <label className="text-xs font-bold">Drawing reference<input className={`${inputClass} w-40`} value={drawing} onChange={e => setDrawing(e.target.value)} /></label>
      <label className="text-xs font-bold">Owner<select className={inputClass} value={owner} onChange={e => setOwner(e.target.value)}><option value="">Me</option>{lists.users.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}</select></label>
      <button type="button" className={buttonClass} disabled={title.trim().length < 3 || !customer} onClick={async () => {
        if (await fsWrite("fs_development", "create", { title: title.trim(), customer_id: customer, ...(drawing.trim() ? { drawing_reference: drawing.trim() } : {}), ...(owner ? { owner_id: owner } : {}) }, setMessage, "Development recorded.")) {
          setTitle(""); setDrawing(""); onCreated(); }
      }}>Record</button></div>
  </Section>;
}

export function DevelopmentDetail({ id, canEdit, lists }: { id: string; canEdit: boolean; lists: Lists }) {
  const [key, setKey] = useState(0); const [message, setMessage] = useState<Note>(null);
  const d = useFsRead<DevProject>("fs_development", "get", { id }, [key]);
  const p = d.data;
  if (d.loading && !p) return <Loading what="the development" />;
  if (d.error) return <Failure text={d.error} />;
  if (!p) return null;
  const closed = p.stage === "released" || p.stage === "dropped";
  const refresh = () => setKey(k => k + 1);
  return <div className="space-y-5">
    <Message value={message} />
    <Section title={`${p.project_number} · ${p.title}`} description={`${p.customer_name}${p.drawing_reference ? ` · drawing ${p.drawing_reference}` : ""}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm"><Pill value={p.stage === "released" ? "approved" : p.stage === "dropped" ? "cancelled" : "open"} label={DEVELOPMENT_STAGES[p.stage]} />
        <span>Owner {p.owner_name} · {p.age_days} day(s) in this stage</span></div>
      <ol className="mt-2 flex flex-wrap gap-1 text-xs">{DEVELOPMENT_ORDER.map(s => <li key={s} className={`rounded-full px-2 py-0.5 ${s === p.stage ? "bg-neutral-950 text-white" : DEVELOPMENT_ORDER.indexOf(s) < DEVELOPMENT_ORDER.indexOf(p.stage as DevelopmentStage) ? "bg-emerald-50 text-emerald-800" : "bg-neutral-100 text-neutral-600"}`}>{DEVELOPMENT_STAGES[s]}</li>)}</ol>
      {p.drop_reason ? <p className="text-sm text-rose-800">Dropped: {p.drop_reason}</p> : null}
    </Section>
    {!closed && canEdit ? <MoveForm p={p} users={lists.users} setMessage={setMessage} onMoved={refresh} /> : null}
    <Facts p={p} lists={lists} editable={!closed && canEdit} setMessage={setMessage} onSaved={refresh} />
    <DieTerms p={p} editable={!closed && canEdit} setMessage={setMessage} onSaved={refresh} />
    <Section title="Trials on the die" description="Recorded in the die's trial register.">
      {p.trials.length ? <ul className="divide-y rounded-xl border text-sm">{p.trials.map(t => <li key={t.id} className="p-2">{fmtDay(t.trial_date)} · {t.result ?? "no result"}{t.recovery_percent !== null ? ` · recovery ${t.recovery_percent}%` : ""}{t.correction_required ? " · correction required" : ""}{t.remarks ? ` · ${t.remarks}` : ""}</li>)}</ul>
        : <Empty>{p.die_id ? "No trial recorded on this die yet." : "Link the die to see its trials."}</Empty>}
      {p.die_id ? <Link className="text-sm font-bold underline" href={`/dies/${p.die_id}`}>Open die {p.die_number}</Link> : null}
    </Section>
    <Section title="History">
      {p.events?.length ? <ol className="space-y-1 text-sm">{p.events.map((e, k) => <li key={k}><b>{e.from_stage ? `${DEVELOPMENT_STAGES[e.from_stage as DevelopmentStage] ?? e.from_stage} → ` : ""}{DEVELOPMENT_STAGES[e.to_stage as DevelopmentStage] ?? e.to_stage}</b> · {e.recorded_by} · {new Date(e.recorded_at).toLocaleString("en-IN")}{e.owner ? ` · owner ${e.owner}` : ""} — {e.note}</li>)}</ol> : <Empty>No history.</Empty>}
    </Section>
  </div>;
}

function MoveForm({ p, users, setMessage, onMoved }: { p: DevProject; users: Option[]; setMessage: (m: Note) => void; onMoved: () => void }) {
  const i = DEVELOPMENT_ORDER.indexOf(p.stage as DevelopmentStage);
  const choices: DevelopmentStage[] = [...(i + 1 < DEVELOPMENT_ORDER.length ? [DEVELOPMENT_ORDER[i + 1]] : []), ...(p.stage === "trial" ? ["trial" as DevelopmentStage] : []), ...DEVELOPMENT_ORDER.slice(0, i).reverse(), "dropped"];
  const [to, setTo] = useState<string>(choices[0] ?? ""); const [note, setNote] = useState(""); const [owner, setOwner] = useState("");
  const router = useRouter();
  return <Section title="Move the development" description="Forward one stage at a time; back to an earlier stage (another trial, a revised quotation) with a note.">
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs font-bold">To<select className={inputClass} value={to} onChange={e => setTo(e.target.value)}>{choices.map(s => <option key={s + (s === p.stage ? "again" : "")} value={s}>{s === p.stage ? "Another trial" : DEVELOPMENT_STAGES[s]}</option>)}</select></label>
      <label className="text-xs font-bold">Next owner<select className={inputClass} value={owner} onChange={e => setOwner(e.target.value)}><option value="">{p.owner_name}</option>{users.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}</select></label>
      <label className="min-w-0 flex-1 text-xs font-bold">Note<input className={inputClass} value={note} onChange={e => setNote(e.target.value)} placeholder={to === "dropped" ? "Why it is dropped" : "What happened"} /></label>
      <button type="button" className={buttonClass} disabled={note.trim().length < 3 || !to} onClick={async () => {
        if (await fsWrite("fs_development", "move", { id: p.id, to_stage: to, note: note.trim(), ...(owner ? { owner_id: owner } : {}) }, setMessage, "Moved.")) { setNote(""); onMoved(); router.refresh(); }
      }}>Move</button></div>
  </Section>;
}

function Facts({ p, lists, editable, setMessage, onSaved }: { p: DevProject; lists: Lists; editable: boolean; setMessage: (m: Note) => void; onSaved: () => void }) {
  const f = p.feasibility ?? {};
  const [v, setV] = useState({ ccd: f.ccd_mm?.toString() ?? "", kgm: f.weight_kg_per_m?.toString() ?? "", wall: f.min_wall_mm?.toString() ?? "", tongue: f.tongue_ratio?.toString() ?? "", press: f.press_id ?? "",
    verdict: f.verdict ?? "pending", fnote: f.note ?? "", cost: p.die_cost?.toString() ?? "", payer: p.die_cost_payer ?? "", terms: p.amortisation_terms ?? "", approved: p.die_cost_approved_by_customer_at ?? "",
    vendor: p.die_vendor_id ?? "", expected: p.expected_die_date ?? "", die: p.die_id ?? "", profile: p.profile_id ?? "", sample: p.sample_reference ?? "", approval: p.customer_approval_reference ?? "" });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(x => ({ ...x, [k]: e.target.value }));
  const sel = (k: keyof typeof v, label: string, options: Option[]) => <label className="text-xs font-bold">{label}<select className={inputClass} disabled={!editable} value={v[k]} onChange={set(k)}><option value="">—</option>{options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>;
  const inp = (k: keyof typeof v, label: string, type = "text") => <label className="text-xs font-bold">{label}<input type={type} className={inputClass} disabled={!editable} value={v[k]} onChange={set(k)} inputMode={type === "number" ? "decimal" : undefined} /></label>;
  const save = async () => {
    const feasibility = { verdict: v.verdict, ...(numberOrUndefined(v.ccd) !== undefined ? { ccd_mm: Number(v.ccd) } : {}), ...(numberOrUndefined(v.kgm) !== undefined ? { weight_kg_per_m: Number(v.kgm) } : {}),
      ...(numberOrUndefined(v.wall) !== undefined ? { min_wall_mm: Number(v.wall) } : {}), ...(numberOrUndefined(v.tongue) !== undefined ? { tongue_ratio: Number(v.tongue) } : {}),
      ...(v.press ? { press_id: v.press } : {}), ...(v.fnote.trim() ? { note: v.fnote.trim() } : {}) };
    const payload: Record<string, unknown> = { id: p.id, feasibility, die_vendor_id: v.vendor, expected_die_date: v.expected, die_id: v.die, profile_id: v.profile, die_cost_approved_by_customer_at: v.approved };
    if (v.cost.trim()) payload.die_cost = Number(v.cost);
    if (v.payer) payload.die_cost_payer = v.payer;
    if (v.terms.trim()) payload.amortisation_terms = v.terms.trim();
    if (v.sample.trim()) payload.sample_reference = v.sample.trim();
    if (v.approval.trim()) payload.customer_approval_reference = v.approval.trim();
    if (await fsWrite("fs_development", "update", payload, setMessage, "Saved.")) onSaved();
  };
  return <Section title="Facts for each stage" description="Recorded once on this development; each stage move keeps a copy of the die cost, who pays and the amortisation terms in its history.">
    <fieldset className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4"><legend className="mb-1 text-sm font-bold">Feasibility</legend>
      {inp("ccd", "Circumscribing circle mm", "number")}{inp("kgm", "Weight kg/m", "number")}{inp("wall", "Minimum wall mm", "number")}{inp("tongue", "Tongue ratio", "number")}
      {sel("press", "Suitable press", lists.presses)}
      <label className="text-xs font-bold">Verdict<select className={inputClass} disabled={!editable} value={v.verdict} onChange={set("verdict")}><option value="pending">Pending</option><option value="feasible">Feasible</option><option value="not_feasible">Not feasible</option></select></label>
      <div className="sm:col-span-2">{inp("fnote", "Feasibility note")}</div></fieldset>
    <fieldset className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4"><legend className="mb-1 text-sm font-bold">Die</legend>
      {inp("cost", "Die cost ₹", "number")}
      <label className="text-xs font-bold">Who pays<select className={inputClass} disabled={!editable} value={v.payer} onChange={set("payer")}><option value="">—</option><option value="company">Omalco</option><option value="customer">Customer</option><option value="shared">Shared</option></select></label>
      {inp("approved", "Customer approved die cost on", "date")}{inp("expected", "Expected die date", "date")}
      {sel("vendor", "Die maker", lists.vendors)}{sel("die", "Die record", lists.dies)}<div className="sm:col-span-2">{inp("terms", "Amortisation terms")}</div></fieldset>
    <fieldset className="grid gap-2 sm:grid-cols-3"><legend className="mb-1 text-sm font-bold">Sample and release</legend>
      {inp("sample", "Sample reference")}{inp("approval", "Customer approval reference")}{sel("profile", "Profile", lists.profiles)}</fieldset>
    {p.die_cost !== null ? <p className="text-xs text-neutral-600">Recorded die cost {inr(p.die_cost)}{p.die_cost_payer ? `, paid by ${p.die_cost_payer === "company" ? "Omalco" : p.die_cost_payer}` : ""}.</p> : null}
    {editable ? <div className="flex gap-2"><button type="button" className={buttonClass} onClick={save}>Save facts</button><button type="button" className={secondaryClass} onClick={onSaved}>Reload</button></div> : null}
  </Section>;
}

export function DevelopmentDatabase({ initialStage }: { initialStage?: string }) {
  const [page, setPage] = useState(1); const [stage, setStage] = useState(initialStage && initialStage in DEVELOPMENT_STAGES ? initialStage : ""); const [search, setSearch] = useState("");
  const d = useFsRead<{ rows: DevProject[]; total_count: number }>("fs_development", "list", { page, ...(stage ? { stage } : {}), ...(search.trim() ? { search: search.trim() } : {}) }, []);
  return <Section title="All developments" description="Newest activity first.">
    <div className="flex flex-wrap gap-2">
      <select aria-label="Stage" className={`${inputClass} w-auto`} value={stage} onChange={e => { setStage(e.target.value); setPage(1); }}><option value="">All stages</option>{Object.entries(DEVELOPMENT_STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <input aria-label="Search" className={`${inputClass} w-64`} placeholder="Number or title" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
    </div>
    {d.loading && !d.data ? <Loading what="developments" /> : d.error ? <Failure text={d.error} /> : d.data ? <>
      {d.data.rows.length ? <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[640px] text-sm">
        <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500"><tr><th className="p-2">Number</th><th className="p-2">Title</th><th className="p-2">Customer</th><th className="p-2">Stage</th><th className="p-2">Owner</th><th className="p-2 text-right">Days in stage</th></tr></thead>
        <tbody>{d.data.rows.map(p => <tr key={p.id} className="border-t hover:bg-neutral-50"><td className="p-2"><Link className="font-bold underline" href={`/profiles/development/${p.id}`}>{p.project_number}</Link></td>
          <td className="p-2">{p.title}</td><td className="p-2">{p.customer_name}</td><td className="p-2">{DEVELOPMENT_STAGES[p.stage]}</td><td className="p-2">{p.owner_name}</td><td className="p-2 text-right tabular-nums">{p.age_days}</td></tr>)}</tbody>
      </table></div> : <Empty>No developments match.</Empty>}
      <Pager page={page} total={d.data.total_count} onPage={setPage} />
    </> : null}
  </Section>;
}

const CHARGE_TYPES: Record<string, string> = { full_die_charge: "Full die charge on the first order", per_kg: "Amortised per kg", customer_paid: "Customer pays the die maker directly", waived: "Not charged (Omalco pays)" };

/** FS-54: how the die is charged to the customer. Quotations read this when the die is chosen, and the quoted die charge
 *  is billed once through the existing invoice die-charge line. Required before release when the customer pays. */
function DieTerms({ p, editable, setMessage, onSaved }: { p: DevProject; editable: boolean; setMessage: (m: Note) => void; onSaved: () => void }) {
  const [type, setType] = useState(p.die_amortization_type ?? ""); const [charge, setCharge] = useState(p.customer_die_charge?.toString() ?? ""); const [kg, setKg] = useState(p.die_amortization_quantity_kg?.toString() ?? "");
  return <Section title="How the die is charged" description="Quotations for this die start from these terms; the die charge is then billed once on the invoice.">
    {p.die_record_update && Object.keys(p.die_record_update).length ? <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">On release the die record was updated: {Object.entries(p.die_record_update).map(([k, v]) => `${k.replaceAll("_", " ")} ${k === "die_cost" ? inr(v) : String(v).replaceAll("_", " ")}`).join(", ")}.</p> : null}
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs font-bold">Charging<select className={inputClass} disabled={!editable} value={type} onChange={e => setType(e.target.value)}><option value="">Choose…</option>{Object.entries(CHARGE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      {["full_die_charge", "per_kg"].includes(type) ? <label className="text-xs font-bold">Die charge to customer ₹<input className={`${inputClass} w-36`} inputMode="decimal" disabled={!editable} value={charge} onChange={e => setCharge(e.target.value)} /></label> : null}
      {type === "per_kg" ? <label className="text-xs font-bold">Amortise over kg<input className={`${inputClass} w-32`} inputMode="decimal" disabled={!editable} value={kg} onChange={e => setKg(e.target.value)} /></label> : null}
      {editable ? <button type="button" className={buttonClass} disabled={!type} onClick={async () => {
        if (await fsWrite("fs_development", "set_die_terms", { id: p.id, die_amortization_type: type, ...(charge.trim() ? { customer_die_charge: Number(charge) } : {}), ...(type === "per_kg" && kg.trim() ? { die_amortization_quantity_kg: Number(kg) } : {}) }, setMessage, "Die terms saved.")) onSaved();
      }}>Save terms</button> : null}
    </div>
  </Section>;
}

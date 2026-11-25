"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { orchestrationAction } from "@/lib/actions/orchestration";
import { DEPARTMENTS, ESCALATION_STAGES, departmentLabel, type OrchestrationSettings } from "@/lib/workflow/orchestration";

const input = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
const ROLES = ["owner", "admin", "factory_manager", "production_manager", "production", "inventory_manager", "quality", "sales_manager", "sales", "accounts", "dispatch_manager", "dispatch", "viewer"];

function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  async function run(payload: Record<string, unknown>, done: string) {
    setBusy(true); setMessage(null);
    const result = await orchestrationAction(payload);
    setBusy(false);
    setMessage(result.success ? { ok: true, text: done } : { ok: false, text: result.error });
    if (result.success) router.refresh();
    return result.success;
  }
  return { busy, message, run };
}
const Message = ({ message }: { message: { ok: boolean; text: string } | null }) => message
  ? <p role={message.ok ? "status" : "alert"} className={`text-sm font-semibold ${message.ok ? "text-emerald-800" : "text-red-800"}`}>{message.text}</p> : null;

export function OrchestrationSettingsForm({ data }: { data: OrchestrationSettings }) {
  const { busy, message, run } = useRun();
  const [s, setS] = useState(data.settings);
  const num = (key: keyof typeof s) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [key]: Number(e.target.value) });
  const phase4 = s.dispatch_release_hours !== undefined;
  const phase5 = s.enforce_qc_route !== undefined;
  const phase6 = s.enforce_fg_receipt !== undefined;
  const phase7 = s.payment_followup_lead_days !== undefined;
  return (
    <form className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4" onSubmit={e => { e.preventDefault(); run({ command: "settings.save", billet_rank_threshold: s.billet_rank_threshold, die_rank_threshold: s.die_rank_threshold,
      material_risk_horizon_days: s.material_risk_horizon_days, ack_sla_hours: s.ack_sla_hours, action_sla_hours: s.action_sla_hours, enforce_die_preparation: s.enforce_die_preparation,
      enforce_preheat: s.enforce_die_preparation && s.enforce_preheat,
      // Phase 4 saves these; before that upgrade the database reports no release validity and accepts none of them.
      ...(phase4 ? { delivery_confirmation_days: s.delivery_confirmation_days, reproduction_tolerance_kg: s.reproduction_tolerance_kg, dispatch_release_hours: s.dispatch_release_hours } : {}),
      // Phase 5 saves these; before that upgrade the database reports no QC route control.
      ...(phase5 ? { enforce_qc_route: s.enforce_qc_route, ageing_overdue_grace_minutes: s.ageing_overdue_grace_minutes } : {}),
      // Phase 6 saves these; before that upgrade the database reports no finished-goods receipt control.
      ...(phase6 ? { enforce_fg_receipt: s.enforce_fg_receipt, fg_transfer_hours: s.fg_transfer_hours, invoice_due_hours: s.invoice_due_hours } : {}),
      // Phase 7 saves this; before that upgrade the database reports no payment follow-up lead.
      ...(phase7 ? { payment_followup_lead_days: s.payment_followup_lead_days } : {}) }, "Settings saved and the queue re-checked."); }}>
      <h2 className="text-lg font-bold">Queue triggers and response times</h2>
      <fieldset disabled={!data.can_edit || busy} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm font-semibold">Billet allocation at queue rank ≤<input type="number" min={1} max={50} className={input} value={s.billet_rank_threshold} onChange={num("billet_rank_threshold")} /></label>
        <label className="text-sm font-semibold">Die preparation at queue rank ≤<input type="number" min={1} max={50} className={input} value={s.die_rank_threshold} onChange={num("die_rank_threshold")} /></label>
        <label className="text-sm font-semibold">Billet shortage forecast horizon (days)<input type="number" min={1} max={120} className={input} value={s.material_risk_horizon_days} onChange={num("material_risk_horizon_days")} /></label>
        <label className="text-sm font-semibold">Acknowledge within (hours)<input type="number" min={1} max={168} className={input} value={s.ack_sla_hours} onChange={num("ack_sla_hours")} /></label>
        <label className="text-sm font-semibold">Complete within (hours)<input type="number" min={1} max={720} className={input} value={s.action_sla_hours} onChange={num("action_sla_hours")} /></label>
        {phase4 ? <label className="text-sm font-semibold">Confirm delivery within (days after dispatch, when no appointment)<input type="number" min={1} max={60} className={input} value={s.delivery_confirmation_days} onChange={num("delivery_confirmation_days")} /></label> : null}
        {phase4 ? <label className="text-sm font-semibold">Reproduction tolerance (kg short before planning is asked)<input type="number" min={0} max={1000} step="0.001" className={input} value={s.reproduction_tolerance_kg} onChange={num("reproduction_tolerance_kg")} /></label> : null}
        {phase4 ? <label className="text-sm font-semibold">A finance release lasts (hours)<input type="number" min={4} max={168} className={input} value={s.dispatch_release_hours} onChange={num("dispatch_release_hours")} /></label> : null}
        {phase5 ? <label className="text-sm font-semibold">Ageing cycle overdue after the recipe&apos;s maximum soak plus (minutes)<input type="number" min={0} max={720} className={input} value={s.ageing_overdue_grace_minutes} onChange={num("ageing_overdue_grace_minutes")} /></label> : null}
        {phase6 ? <label className="text-sm font-semibold">Remind packaging to move packed bundles to finished goods after (hours)<input type="number" min={1} max={168} className={input} value={s.fg_transfer_hours} onChange={num("fg_transfer_hours")} /></label> : null}
        {phase6 ? <label className="text-sm font-semibold">Ask finance for the tax invoice of a dispatch that left after (hours; 0 = at once)<input type="number" min={0} max={168} className={input} value={s.invoice_due_hours} onChange={num("invoice_due_hours")} /></label> : null}
        {phase7 ? <label className="text-sm font-semibold">Start customer payment follow-up before the due date (days; 0 = on the due date)<input type="number" min={0} max={30} className={input} value={s.payment_followup_lead_days} onChange={num("payment_followup_lead_days")} /></label> : null}
      </fieldset>
      <fieldset disabled={!data.can_edit || busy} className="space-y-2">
        <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5" checked={s.enforce_die_preparation} onChange={e => setS({ ...s, enforce_die_preparation: e.target.checked, enforce_preheat: e.target.checked && s.enforce_preheat })} />
          <span><b>Refuse production start unless the die preparation is recorded.</b> Switch on once the tool room records every die check and preparation in ExtrusionOS.</span></label>
        <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5" disabled={!s.enforce_die_preparation} checked={s.enforce_preheat} onChange={e => setS({ ...s, enforce_preheat: e.target.checked })} />
          <span><b>Also refuse start unless the die is preheated within the approved standard and hold time.</b> Needs an approved preheat standard for every die type in use.</span></label>
        {phase5 ? <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5" checked={s.enforce_qc_route ?? false} onChange={e => setS({ ...s, enforce_qc_route: e.target.checked })} />
          <span><b>Enforce the QC route.</b> Material is loaded for ageing only up to its first-stage QC approval, and a job whose profile needs artificial ageing is packed only up to what final QC after ageing released. Switch on once QA records the final QC of aged material in ExtrusionOS and every profile records its temper or ageing requirement.</span></label> : null}
        {phase6 ? <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5" checked={s.enforce_fg_receipt ?? false} onChange={e => setS({ ...s, enforce_fg_receipt: e.target.checked })} />
          <span><b>Load only bundles received in the finished-goods area.</b> A bundle is loaded or put on a dispatch only after it was sent on a finished-goods transfer and scanned in there. A bundle still on a transfer is never loaded, whether this is on or off. Switch on once packaging and dispatch use the transfer screen for every bundle.</span></label> : null}
      </fieldset>
      {data.can_edit ? <Button disabled={busy}>Save settings</Button> : <p className="text-sm text-slate-600">Only the owner, admin or factory manager can change these settings.</p>}
      <Message message={message} />
    </form>
  );
}

export function PreheatStandardForm({ canEdit }: { canEdit: boolean }) {
  const { busy, message, run } = useRun();
  const [v, setV] = useState({ name: "", die_type: "", min_temperature_c: "", max_temperature_c: "", min_soak_minutes: "", max_hold_minutes: "", sop_reference: "" });
  if (!canEdit) return null;
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <form className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4" onSubmit={async e => {
      e.preventDefault();
      const ok = await run({ command: "standards.save", name: v.name, die_type: v.die_type || null, min_temperature_c: Number(v.min_temperature_c), max_temperature_c: Number(v.max_temperature_c),
        min_soak_minutes: Number(v.min_soak_minutes), max_hold_minutes: Number(v.max_hold_minutes), sop_reference: v.sop_reference }, "Standard approved. It replaces the previous standard for this die type.");
      if (ok) setV({ name: "", die_type: "", min_temperature_c: "", max_temperature_c: "", min_soak_minutes: "", max_hold_minutes: "", sop_reference: "" });
    }}>
      <h3 className="font-bold">Approve a die preheat standard</h3>
      <p className="text-xs text-slate-600">Enter the values from Omalco&apos;s approved die preheating SOP. ExtrusionOS does not assume any temperatures.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm font-semibold">Name<input required minLength={3} maxLength={120} className={input} value={v.name} onChange={set("name")} /></label>
        <label className="text-sm font-semibold">Die type<select className={input} value={v.die_type} onChange={set("die_type")}><option value="">All die types</option>{["solid", "hollow", "semi_hollow", "porthole", "bridge", "feeder", "multi_cavity", "flat", "special"].map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select></label>
        <label className="text-sm font-semibold">Minimum °C<input required inputMode="decimal" className={input} value={v.min_temperature_c} onChange={set("min_temperature_c")} /></label>
        <label className="text-sm font-semibold">Maximum °C<input required inputMode="decimal" className={input} value={v.max_temperature_c} onChange={set("max_temperature_c")} /></label>
        <label className="text-sm font-semibold">Minimum soak (min)<input required inputMode="numeric" className={input} value={v.min_soak_minutes} onChange={set("min_soak_minutes")} /></label>
        <label className="text-sm font-semibold">Maximum hold when hot (min)<input required inputMode="numeric" className={input} value={v.max_hold_minutes} onChange={set("max_hold_minutes")} /></label>
        <label className="text-sm font-semibold">SOP reference<input required minLength={2} maxLength={120} className={input} value={v.sop_reference} onChange={set("sop_reference")} /></label>
      </div>
      <Button disabled={busy}>Approve standard</Button>
      <Message message={message} />
    </form>
  );
}

export function RetireStandardButton({ id }: { id: string }) {
  const { busy, message, run } = useRun();
  return <span className="inline-flex items-center gap-2"><Button variant="ghost" disabled={busy} onClick={() => run({ command: "standards.retire", id }, "Standard retired.")}>Retire</Button><Message message={message} /></span>;
}

export function RoutingEditor({ data }: { data: OrchestrationSettings }) {
  const { busy, message, run } = useRun();
  const [department, setDepartment] = useState("billet_inventory");
  const [stage, setStage] = useState(0);
  const current = data.routing.find(r => r.department === department && r.stage === stage);
  const [roles, setRoles] = useState<string[]>(current?.roles ?? []);
  const select = (d: string, s: number) => { setDepartment(d); setStage(s); setRoles(data.routing.find(r => r.department === d && r.stage === s)?.roles ?? []); };
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-bold">Who receives each department&apos;s work</h2>
      <p className="text-sm text-slate-600">Work goes to the least-loaded active employee of the first stage; escalations notify the later stages. Defaults apply until changed.</p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead><tr className="border-b">{["Department", ...ESCALATION_STAGES].map(h => <th key={h} className="px-2 py-2 font-bold">{h}</th>)}</tr></thead>
          <tbody>{Object.keys(DEPARTMENTS).map(d => <tr key={d} className="border-b align-top">
            <td className="px-2 py-2 font-semibold">{departmentLabel(d)}</td>
            {[0, 1, 2, 3].map(s => { const r = data.routing.find(x => x.department === d && x.stage === s);
              return <td key={s} className="px-2 py-2">{data.can_edit_routing ? <button type="button" className={`text-left underline-offset-2 hover:underline ${department === d && stage === s ? "font-bold text-orange-700" : ""}`} onClick={() => select(d, s)}>{r?.roles.join(", ").replace(/_/g, " ") ?? "—"}{r?.customised ? " *" : ""}</button> : <span>{r?.roles.join(", ").replace(/_/g, " ")}{r?.customised ? " *" : ""}</span>}</td>; })}
          </tr>)}</tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">* changed from the default.</p>
      {data.can_edit_routing ? (
        <form className="space-y-2 rounded-xl border border-slate-200 p-3" onSubmit={e => { e.preventDefault(); run({ command: "routing.save", department, stage, roles }, "Routing saved."); }}>
          <p className="text-sm font-bold">{departmentLabel(department)} · {ESCALATION_STAGES[stage]}</p>
          <div className="flex flex-wrap gap-3">{ROLES.map(r => <label key={r} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={roles.includes(r)} onChange={e => setRoles(e.target.checked ? [...roles, r] : roles.filter(x => x !== r))} />{r.replace(/_/g, " ")}</label>)}</div>
          <div className="flex flex-wrap gap-2"><Button disabled={busy || !roles.length}>Save routing</Button>
            {current?.customised ? <Button type="button" variant="secondary" disabled={busy} onClick={() => run({ command: "routing.save", department, stage, reset: true }, "Default restored.")}>Restore default</Button> : null}</div>
        </form>
      ) : null}
      <Message message={message} />
    </div>
  );
}

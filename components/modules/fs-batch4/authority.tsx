"use client";

// FS-75: the delegation-of-authority matrix. Transaction type x amount band x approving roles, a second approver from an
// amount, leave delegations with dates, and the month's approvals under the matrix. The database enforces it in the
// approval workflows listed as enforced; the others are recorded for when their workflow is connected.
import { useState } from "react";
import { APPROVER_ROLES, AUTHORITY_TYPES, ENFORCED_AUTHORITY_TYPES, type AuthorityType } from "@/lib/fs-batch4/commands";
import { businessToday } from "@/lib/utils/business-date";
import { Empty, Failure, Loading, Message, Pill, Section, b4Write, buttonClass, inputClass, secondaryClass, useB4Read, when, type Note } from "./shared";

type Rule = { id: string; transaction_type: AuthorityType; min_amount: number; max_amount: number | null; approver_roles: string[]; second_approver_from: number | null; second_approver_roles: string[] | null; reason: string; created_by_name: string; created_at: string };
type Overview = { rules: Rule[]; delegations: { id: string; from: string; to: string; types: string[] | null; starts_on: string; ends_on: string; reason: string; active: boolean }[]; people: { id: string; name: string; role: string }[]; can_edit_rules: boolean };
type Report = { month: string; approvals: { at: string; type: string; reference: string | null; amount: number; step: number; completes: boolean; approver: string; role: string; delegated: boolean; requester: string | null }[]; delegated_count: number };

const inr = (v: number | null | undefined) => v === null || v === undefined ? "no limit" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const roleText = (roles: string[] | null | undefined) => (roles ?? []).map(r => r.replaceAll("_", " ")).join(", ");
const num = (v: string) => v.trim() === "" ? null : Number(v);

export function AuthorityMatrix() {
  const { data, error, loading, reload } = useB4Read<Overview>("fs_authority", "overview", {});
  const [month, setMonth] = useState(`${businessToday().slice(0, 7)}-01`);
  const report = useB4Read<Report>("fs_authority", "report", { month }, [month]);
  const [message, setMessage] = useState<Note>(null);
  const [busy, setBusy] = useState(false);
  const [rule, setRule] = useState({ transaction_type: "quote" as AuthorityType, min: "0", max: "", roles: [] as string[], second: "", secondRoles: [] as string[], reason: "", replaces: "" });
  const [retireReason, setRetireReason] = useState("");
  const [del, setDel] = useState({ from: "", to: "", starts: businessToday(), ends: businessToday(), types: [] as string[], reason: "" });

  if (loading && !data) return <Loading what="the authority matrix" />;
  if (error) return <Failure text={error} />;
  if (!data) return null;
  const toggle = (list: string[], value: string) => list.includes(value) ? list.filter(v => v !== value) : [...list, value];

  async function run(command: string, payload: Record<string, unknown>, ok: string) {
    setBusy(true);
    const result = await b4Write("fs_authority", command, payload, setMessage, ok);
    setBusy(false);
    if (result) { void reload(); void report.reload(); }
    return result;
  }
  async function saveRule() {
    const ok = await run("save_rule", { transaction_type: rule.transaction_type, min_amount: num(rule.min) ?? 0, max_amount: num(rule.max), approver_roles: rule.roles,
      second_approver_from: num(rule.second), second_approver_roles: rule.secondRoles.length ? rule.secondRoles : null, reason: rule.reason, ...(rule.replaces ? { replaces: rule.replaces } : {}) }, "Rule saved.");
    if (ok) setRule(r => ({ ...r, reason: "", replaces: "" }));
  }
  async function retire(id: string) {
    if (retireReason.trim().length < 5) { setMessage({ tone: "error", text: "Write why the rule is being retired (at least 5 characters) in the box under the rules." }); return; }
    const ok = await run("retire_rule", { id, reason: retireReason }, "Rule retired.");
    if (ok) setRetireReason("");
  }

  return <div className="space-y-5">
    <Section title="Rules" description={`Who approves what, by amount. Enforced today in: ${ENFORCED_AUTHORITY_TYPES.map(t => AUTHORITY_TYPES[t]).join(", ")}. A type with no rule keeps its built-in rule.`}>
      {data.rules.length === 0 ? <Empty>No rules yet. Every approval follows its built-in rule.</Empty> : <div className="overflow-x-auto rounded-xl border border-neutral-200">
        <table className="industrial-table min-w-[760px]">
          <thead><tr><th>Transaction</th><th>Band</th><th>Approves</th><th>Second approver</th><th>Reason</th><th /></tr></thead>
          <tbody>{data.rules.map(r => <tr key={r.id}>
            <td className="font-semibold">{AUTHORITY_TYPES[r.transaction_type]} {ENFORCED_AUTHORITY_TYPES.includes(r.transaction_type) ? <Pill value="approved" label="enforced" /> : <Pill value="unknown" label="recorded only" />}</td>
            <td className="tabular-nums">{inr(r.min_amount)} to {inr(r.max_amount)}</td>
            <td>{roleText(r.approver_roles)}</td>
            <td>{r.second_approver_from === null ? "—" : `From ${inr(r.second_approver_from)}: ${roleText(r.second_approver_roles ?? r.approver_roles)}`}</td>
            <td className="text-sm">{r.reason}<br /><span className="text-xs text-neutral-500">{r.created_by_name}, {when(r.created_at)}</span></td>
            <td>{data.can_edit_rules ? <div className="flex gap-1">
              <button type="button" className={secondaryClass} onClick={() => setRule({ transaction_type: r.transaction_type, min: String(r.min_amount), max: r.max_amount === null ? "" : String(r.max_amount), roles: r.approver_roles,
                second: r.second_approver_from === null ? "" : String(r.second_approver_from), secondRoles: r.second_approver_roles ?? [], reason: "", replaces: r.id })}>Change</button>
              <button type="button" className={secondaryClass} disabled={busy} onClick={() => retire(r.id)}>Retire</button></div> : null}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      {data.can_edit_rules && data.rules.length > 0 ? <label className="block text-sm font-semibold">Reason for retiring a rule
        <input className={inputClass} value={retireReason} onChange={e => setRetireReason(e.target.value)} placeholder="Then press Retire on the rule" /></label> : null}
      <p className="text-xs text-neutral-600">Nobody approves their own entry when a rule applies. Accounts&apos; built-in ₹25,000 expense ceiling still applies on top of any expense rule.</p>
    </Section>

    {data.can_edit_rules ? <Section title={rule.replaces ? "Change a rule" : "Add a rule"} description="A change retires the old rule and adds a new one; nothing is edited in place.">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-semibold">Transaction
          <select className={inputClass} value={rule.transaction_type} onChange={e => setRule({ ...rule, transaction_type: e.target.value as AuthorityType })}>
            {Object.entries(AUTHORITY_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <label className="text-sm font-semibold">From ₹<input className={inputClass} inputMode="decimal" value={rule.min} onChange={e => setRule({ ...rule, min: e.target.value })} /></label>
        <label className="text-sm font-semibold">Up to ₹ (blank = no limit)<input className={inputClass} inputMode="decimal" value={rule.max} onChange={e => setRule({ ...rule, max: e.target.value })} /></label>
      </div>
      <fieldset className="text-sm"><legend className="font-semibold">Approving roles</legend>
        <div className="mt-1 flex flex-wrap gap-2">{APPROVER_ROLES.map(r => <label key={r} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-neutral-300 px-3">
          <input type="checkbox" checked={rule.roles.includes(r)} onChange={() => setRule({ ...rule, roles: toggle(rule.roles, r) })} />{r.replaceAll("_", " ")}</label>)}</div></fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-semibold">Second approver from ₹ (optional)<input className={inputClass} inputMode="decimal" value={rule.second} onChange={e => setRule({ ...rule, second: e.target.value })} /></label>
        <label className="text-sm font-semibold sm:col-span-2">Reason<input className={inputClass} value={rule.reason} onChange={e => setRule({ ...rule, reason: e.target.value })} /></label>
      </div>
      {rule.second.trim() !== "" ? <fieldset className="text-sm"><legend className="font-semibold">Second-approver roles (blank = same as above)</legend>
        <div className="mt-1 flex flex-wrap gap-2">{APPROVER_ROLES.map(r => <label key={r} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-neutral-300 px-3">
          <input type="checkbox" checked={rule.secondRoles.includes(r)} onChange={() => setRule({ ...rule, secondRoles: toggle(rule.secondRoles, r) })} />{r.replaceAll("_", " ")}</label>)}</div></fieldset> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={busy || rule.roles.length === 0 || rule.reason.trim().length < 5} onClick={saveRule}>{rule.replaces ? "Replace the rule" : "Add the rule"}</button>
        {rule.replaces ? <button type="button" className={secondaryClass} onClick={() => setRule({ ...rule, replaces: "" })}>Cancel change</button> : null}
      </div>
    </Section> : null}

    <Section title="Leave delegations" description="Someone standing in for an approver on leave, for up to 90 days.">
      {data.delegations.length === 0 ? <Empty>No current delegations.</Empty> : <ul className="divide-y divide-neutral-200 text-sm">
        {data.delegations.map(d => <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span><span className="font-bold">{d.to}</span> approves for <span className="font-bold">{d.from}</span>, {d.starts_on} to {d.ends_on}{d.types?.length ? ` (${d.types.map(t => (AUTHORITY_TYPES as Record<string, string>)[t] ?? t).join(", ")})` : " (all types)"} — {d.reason} {d.active ? <Pill value="open" label="active" /> : null}</span>
          <button type="button" className={secondaryClass} disabled={busy} onClick={() => run("revoke_delegation", { id: d.id }, "Delegation ended.")}>End now</button>
        </li>)}
      </ul>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">On leave<select className={inputClass} value={del.from} onChange={e => setDel({ ...del, from: e.target.value })}><option value="">Choose…</option>{data.people.map(p => <option key={p.id} value={p.id}>{p.name} ({p.role.replaceAll("_", " ")})</option>)}</select></label>
        <label className="text-sm font-semibold">Stands in<select className={inputClass} value={del.to} onChange={e => setDel({ ...del, to: e.target.value })}><option value="">Choose…</option>{data.people.map(p => <option key={p.id} value={p.id}>{p.name} ({p.role.replaceAll("_", " ")})</option>)}</select></label>
        <label className="text-sm font-semibold">From<input type="date" className={inputClass} value={del.starts} onChange={e => setDel({ ...del, starts: e.target.value })} /></label>
        <label className="text-sm font-semibold">To<input type="date" className={inputClass} value={del.ends} onChange={e => setDel({ ...del, ends: e.target.value })} /></label>
        <label className="text-sm font-semibold sm:col-span-2">Reason<input className={inputClass} value={del.reason} onChange={e => setDel({ ...del, reason: e.target.value })} /></label>
      </div>
      <fieldset className="text-sm"><legend className="font-semibold">Only these types (blank = all)</legend>
        <div className="mt-1 flex flex-wrap gap-2">{Object.entries(AUTHORITY_TYPES).map(([k, v]) => <label key={k} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-neutral-300 px-3">
          <input type="checkbox" checked={del.types.includes(k)} onChange={() => setDel({ ...del, types: toggle(del.types, k) })} />{v}</label>)}</div></fieldset>
      <button type="button" className={buttonClass} disabled={busy || !del.from || !del.to || del.reason.trim().length < 5}
        onClick={async () => { const ok = await run("delegate", { from_user: del.from, to_user: del.to, starts_on: del.starts, ends_on: del.ends, ...(del.types.length ? { transaction_types: del.types } : {}), reason: del.reason }, "Delegation recorded."); if (ok) setDel({ ...del, reason: "" }); }}>Record the delegation</button>
    </Section>

    <Section title="Approvals this month" description="Every approval decided under the matrix, with second approvals and stand-ins marked."
      actions={<label className="text-sm font-semibold">Month <input type="month" className={inputClass} value={month.slice(0, 7)} onChange={e => e.target.value && setMonth(`${e.target.value}-01`)} /></label>}>
      {report.loading && !report.data ? <Loading what="approvals" /> : null}
      {report.error ? <Failure text={report.error} /> : null}
      {report.data && report.data.approvals.length === 0 ? <Empty>No approval under the matrix in this month.</Empty> : null}
      {report.data && report.data.approvals.length > 0 ? <div className="overflow-x-auto rounded-xl border border-neutral-200"><table className="industrial-table min-w-[720px]">
        <thead><tr><th>When</th><th>Transaction</th><th>Reference</th><th className="text-right">Amount</th><th>Approver</th><th>Step</th><th>Raised by</th></tr></thead>
        <tbody>{report.data.approvals.map((a, n) => <tr key={`${a.at}-${n}`}>
          <td>{when(a.at)}</td><td>{(AUTHORITY_TYPES as Record<string, string>)[a.type] ?? a.type}</td><td>{a.reference ?? "—"}</td><td className="text-right tabular-nums">{inr(a.amount)}</td>
          <td>{a.approver} ({a.role?.replaceAll("_", " ")}){a.delegated ? <> <Pill value="held" label="stand-in" /></> : null}</td>
          <td>{a.step === 1 && !a.completes ? "First of two" : a.step === 2 ? "Second" : "Final"}</td><td>{a.requester ?? "—"}</td>
        </tr>)}</tbody></table></div> : null}
      {report.data ? <p className="text-xs text-neutral-600">{report.data.delegated_count} approval(s) by a stand-in this month.</p> : null}
    </Section>
    <Message value={message} />
  </div>;
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inspectionPlanAction } from "@/lib/actions/inspection-plans";
import { UNITS, itemProblem, type PlanDetail, type Unit } from "@/lib/workflow/inspection-plans";

type Row = { characteristic: string; unit: Unit; method: string; nominal: string; lower_limit: string; upper_limit: string; critical: boolean };
const toNumber = (value: string) => (value.trim() === "" ? null : Number(value));
const emptyRow: Row = { characteristic: "", unit: "mm", method: "", nominal: "", lower_limit: "", upper_limit: "", critical: true };

// UPGRADE_EOS feature 54: edit a draft plan (approved versions are read only).
export function PlanEditor({ planId, profiles, initial }: { planId: string; profiles: { value: string; label: string }[]; initial?: PlanDetail }) {
  const router = useRouter();
  const [profileId, setProfileId] = useState(initial?.profile_id ?? "");
  const [sampling, setSampling] = useState(initial?.sampling_instruction ?? "");
  const [rows, setRows] = useState<Row[]>(initial?.items.map((item) => ({
    characteristic: item.characteristic, unit: item.unit, method: item.method ?? "", critical: item.critical,
    nominal: item.nominal === null ? "" : String(item.nominal), lower_limit: item.lower_limit === null ? "" : String(item.lower_limit), upper_limit: item.upper_limit === null ? "" : String(item.upper_limit)
  })) ?? [{ ...emptyRow }]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const update = (index: number, patch: Partial<Row>) => setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  async function save() {
    const items = rows.map((row) => ({
      characteristic: row.characteristic, unit: row.unit, method: row.method, critical: row.critical,
      nominal: row.unit === "visual" ? null : toNumber(row.nominal), lower_limit: row.unit === "visual" ? null : toNumber(row.lower_limit), upper_limit: row.unit === "visual" ? null : toNumber(row.upper_limit)
    }));
    if (items.some((item) => [item.nominal, item.lower_limit, item.upper_limit].some((value) => value !== null && !Number.isFinite(value)))) { setMessage("Limits must be numbers"); return; }
    setBusy(true); setMessage("");
    const result = await inspectionPlanAction({ command: "plan.save_draft", plan_id: planId, profile_id: profileId || null, sampling_instruction: sampling, items });
    setBusy(false);
    if (!result.success) { setMessage(result.error); return; }
    router.push(`/quality/plans/${(result.data as { id: string }).id}`);
    router.refresh();
  }

  return (
    <form className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="grid gap-3 md:grid-cols-2">
        {initial ? (
          <p className="space-y-1 text-sm"><span className="form-label block">Applies to</span><span className="font-bold">{initial.profile_code ?? "Company default (profiles without their own plan)"}</span></p>
        ) : (
          <label className="space-y-1"><span className="form-label">Applies to</span>
            <select className="form-input" value={profileId} disabled={busy} onChange={(event) => setProfileId(event.target.value)}>
              <option value="">Company default (profiles without their own plan)</option>
              {profiles.map((profile) => <option key={profile.value} value={profile.value}>{profile.label}</option>)}
            </select>
          </label>
        )}
        <label className="space-y-1"><span className="form-label">Sampling instruction</span>
          <input className="form-input" maxLength={500} value={sampling} disabled={busy} placeholder="e.g. 3 pieces per 500 kg lot: both ends and middle" onChange={(event) => setSampling(event.target.value)} />
        </label>
      </div>
      <div className="space-y-2">
        {rows.map((row, index) => {
          const problem = row.characteristic ? itemProblem({ unit: row.unit, nominal: row.unit === "visual" ? null : toNumber(row.nominal), lower_limit: row.unit === "visual" ? null : toNumber(row.lower_limit), upper_limit: row.unit === "visual" ? null : toNumber(row.upper_limit) }) : null;
          return (
            <div key={index} className="grid gap-2 rounded-xl border border-slate-200 p-3 md:grid-cols-[1.4fr_1fr_0.7fr_0.7fr_0.7fr_auto]">
              <input className="form-input" aria-label="Characteristic" placeholder="Characteristic (e.g. Wall thickness)" value={row.characteristic} disabled={busy} onChange={(event) => update(index, { characteristic: event.target.value })} />
              <select className="form-input" aria-label="Unit" value={row.unit} disabled={busy} onChange={(event) => update(index, { unit: event.target.value as Unit })}>
                {Object.entries(UNITS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
              </select>
              {(["lower_limit", "nominal", "upper_limit"] as const).map((key) => (
                <input key={key} className="form-input" inputMode="decimal" aria-label={key.replace("_", " ")} placeholder={key === "nominal" ? "Nominal" : key === "lower_limit" ? "Min" : "Max"} value={row[key]} disabled={busy || row.unit === "visual"} onChange={(event) => update(index, { [key]: event.target.value })} />
              ))}
              <button type="button" className="text-xs font-bold text-red-700 underline" disabled={busy || rows.length === 1} onClick={() => setRows(rows.filter((_, i) => i !== index))}>Remove</button>
              <input className="form-input md:col-span-5" aria-label="Method" placeholder="Method (optional), e.g. Micrometer at 3 points" value={row.method} disabled={busy} onChange={(event) => update(index, { method: event.target.value })} />
              {problem ? <p className="text-xs font-semibold text-red-700 md:col-span-6">{problem}</p> : null}
            </div>
          );
        })}
        <button type="button" className="text-xs font-bold text-slate-700 underline" disabled={busy || rows.length >= 50} onClick={() => setRows([...rows, { ...emptyRow }])}>Add characteristic</button>
      </div>
      <Button type="submit" disabled={busy || sampling.trim().length < 3}>{busy ? "Saving…" : "Save draft"}</Button>
      {message ? <p role="alert" className="text-sm font-semibold text-red-700">{message}</p> : null}
    </form>
  );
}

export function PlanDecision({ planId, canApprove }: { planId: string; canApprove: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run(command: "plan.approve" | "plan.discard_draft") {
    setBusy(true); setMessage("");
    const result = await inspectionPlanAction({ command, plan_id: planId });
    setBusy(false);
    if (!result.success) { setMessage(result.error); return; }
    if (command === "plan.discard_draft") router.push("/quality/plans");
    router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canApprove ? <Button type="button" disabled={busy} onClick={() => void run("plan.approve")}>{busy ? "Working…" : "Approve this version"}</Button> : null}
      <Button type="button" variant="secondary" disabled={busy} onClick={() => void run("plan.discard_draft")}>Discard draft</Button>
      {message ? <p role="alert" className="w-full text-sm font-semibold text-red-700">{message}</p> : null}
    </div>
  );
}

export { InspectionResultsPanel } from "./inspection-results";

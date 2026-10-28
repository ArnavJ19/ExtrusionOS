"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inspectionPlanAction } from "@/lib/actions/inspection-plans";
import { formatDate } from "@/lib/utils/format";
import { UNITS, itemProblem, judge, limitText, type Evaluation, type PlanDetail, type Unit } from "@/lib/workflow/inspection-plans";

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

const outcomeTone = { pass: "text-emerald-700", fail: "text-red-700", missing: "text-amber-700" } as const;

// UPGRADE_EOS feature 54: record each planned observation for an inspection; nothing is pre-filled.
export function InspectionResultsPanel({ inspectionId, initial, canRecord }: { inspectionId: string; initial: Evaluation; canRecord: boolean }) {
  const router = useRouter();
  const [evaluation, setEvaluation] = useState(initial);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (evaluation.state === "no_plan") return null;
  const pending = evaluation.inspection_status === "pending";

  async function save() {
    if (evaluation.state === "no_plan") return;
    type Result = { item_id: string; observed: number } | { item_id: string; visual_ok: boolean };
    const results = evaluation.items.flatMap((item): Result[] => {
      const value = values[item.item_id];
      if (value === undefined || value === "") return [];
      return item.unit === "visual" ? [{ item_id: item.item_id, visual_ok: value === "pass" }] : [{ item_id: item.item_id, observed: Number(value) }];
    });
    if (!results.length) { setMessage("Enter at least one observation"); return; }
    if (results.some((row) => "observed" in row && !Number.isFinite(row.observed))) { setMessage("Measured values must be numbers"); return; }
    setBusy(true); setMessage("");
    const result = await inspectionPlanAction({ command: "results.record", inspection_id: inspectionId, plan_id: evaluation.plan_id, results });
    setBusy(false);
    if (!result.success) { setMessage(result.error); return; }
    setEvaluation(result.data as Evaluation); setValues({});
    router.refresh();
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-slate-900">Inspection plan v{evaluation.plan_version} ({evaluation.plan_scope === "default" ? "company default" : "this profile"})</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-black ${evaluation.state === "pass" ? "bg-emerald-100 text-emerald-800" : evaluation.state === "fail" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"}`}>
          {evaluation.state === "pass" ? "All results within limits" : evaluation.state === "fail" ? `${evaluation.failed} outside limits: rework or reject` : `${evaluation.missing} of ${evaluation.total} results missing`}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-600">Sampling: {evaluation.sampling_instruction}</p>
      <p className="mt-1 text-xs text-slate-500">The inspection cannot be approved until every result is recorded and within limits. Values are never filled in for you.</p>
      <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        {evaluation.items.map((item) => {
          const entered = values[item.item_id];
          const preview = item.unit !== "visual" && entered && Number.isFinite(Number(entered)) ? judge(Number(entered), item.lower_limit, item.upper_limit) : null;
          return (
            <div key={item.item_id} className="grid items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm md:grid-cols-[1.5fr_1fr_1fr_1fr]">
              <div><p className="font-bold">{item.characteristic}{item.critical ? "" : " (non-critical)"}</p>{item.method ? <p className="text-xs text-slate-500">{item.method}</p> : null}</div>
              <p className="text-xs text-slate-600">{limitText(item)}{item.nominal !== null ? ` · nominal ${item.nominal}` : ""}</p>
              <p className={`text-xs font-bold ${outcomeTone[item.outcome]}`}>
                {item.outcome === "missing" ? "Not recorded" : `${item.unit === "visual" ? (item.visual_ok ? "Pass" : "Fail") : `${item.observed} ${item.unit}`} · ${item.outcome}`}
                {item.recorded_by_name ? <span className="block font-normal text-slate-500">{item.recorded_by_name}, {formatDate(item.recorded_at)}</span> : null}
              </p>
              {canRecord && pending ? (
                item.unit === "visual" ? (
                  <select className="form-input" aria-label={`Result for ${item.characteristic}`} value={entered ?? ""} disabled={busy} onChange={(event) => setValues({ ...values, [item.item_id]: event.target.value })}>
                    <option value="">{item.outcome === "missing" ? "Record…" : "Change…"}</option><option value="pass">Pass</option><option value="fail">Fail</option>
                  </select>
                ) : (
                  <div>
                    <input className="form-input" inputMode="decimal" aria-label={`Measured ${item.characteristic}`} placeholder={`Measured (${item.unit})`} value={entered ?? ""} disabled={busy} onChange={(event) => setValues({ ...values, [item.item_id]: event.target.value })} />
                    {preview ? <p className={`text-xs font-bold ${outcomeTone[preview]}`}>Would {preview}</p> : null}
                  </div>
                )
              ) : <span />}
            </div>
          );
        })}
        {canRecord && pending ? <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save results"}</Button> : null}
      </form>
      {message ? <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{message}</p> : null}
    </section>
  );
}

"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge, MasterDataManager } from "./master-data-manager";
import { qualityInspectionSchema } from "@/lib/validations/schemas";
import { qualityStatuses, labelize, type SessionContext } from "@/types/app";
import { createClient } from "@/lib/supabase/browser";
import { resolveQualityReworkAction } from "@/lib/actions/quality";

type ReworkItem = { id: string; batch_number: string | null; quantity_checked_kg: number; profile_id: string; production_job_id: string; profile_code: string | null; profile_name: string | null; total_count: number };

export function QualityClient({ context }: { context: SessionContext }) {
  const supabase = useMemo(() => createClient(), []);
  const [profiles, setProfiles] = useState<{ value: string; label: string }[]>([]);
  const [reworkItems, setReworkItems] = useState<ReworkItem[]>([]);
  const [reworkTotal, setReworkTotal] = useState(0);
  const [pending, startTransition] = useTransition();
  const canResolveRework = ["owner", "admin", "factory_manager", "quality_manager", "quality"].includes(context.role);

  async function refreshRework(offset = 0) {
    const { data, error } = await supabase.rpc("list_open_quality_rework_inspections", { p_offset: offset, p_limit: 10 });
    if (error) { toast.error("Could not load open rework inspections."); return; }
    const page = (data ?? []) as ReworkItem[];
    setReworkTotal(Number(page[0]?.total_count ?? (offset === 0 ? 0 : reworkTotal)));
    setReworkItems((current) => offset === 0 ? page : [...current, ...page]);
  }

  useEffect(() => {
    supabase.from("aluminium_profiles").select("id, profile_code, profile_name")
      .eq("company_id", context.companyId)
      .eq("is_active", true)
      .order("profile_code")
      .then(({ data }) => {
        if (data) setProfiles(data.map(p => ({
          value: p.id,
          label: `${p.profile_code} · ${p.profile_name}`
        })));
      });
    void refreshRework();
  }, [supabase, context.companyId]);

  function submitResolution(event: React.FormEvent<HTMLFormElement>, item: ReworkItem) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await resolveQualityReworkAction({
        inspection_id: item.id,
        approved_weight_kg: Number(form.get("approved_weight_kg")),
        rejected_weight_kg: Number(form.get("rejected_weight_kg")),
        inspector_name: String(form.get("inspector_name") ?? ""),
        reason: String(form.get("reason") ?? "")
      });
      if (!result.success) { toast.error(result.error); return; }
      toast.success("Rework resolved and linked to immutable QC dispositions.");
      await refreshRework();
    });
  }

  return (
    <>
    {reworkItems.length > 0 && <section className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <div className="mb-3">
        <h2 className="font-semibold text-amber-950">Open rework resolutions</h2>
        <p className="text-sm text-amber-900">Record the recovered and rejected kilograms once. The original inspection remains in the audit trail.</p>
      </div>
      <div className="space-y-3">
        {reworkItems.map((item) => canResolveRework ? <form key={item.id} onSubmit={(event) => submitResolution(event, item)} className="grid gap-3 rounded-lg border border-amber-200 bg-white p-3 md:grid-cols-6">
          <div className="md:col-span-2">
          <p className="font-medium">{item.profile_code ? `${item.profile_code} · ${item.profile_name ?? ""}` : "Quality rework"}</p>
            <p className="text-sm text-slate-600">{item.batch_number || item.production_job_id} · {Number(item.quantity_checked_kg).toFixed(3)} kg</p>
          </div>
          <label className="text-sm">Approved kg<input required min="0" step="0.001" name="approved_weight_kg" type="number" defaultValue="0" className="mt-1 w-full rounded border px-2 py-1" /></label>
          <label className="text-sm">Rejected kg<input required min="0" step="0.001" name="rejected_weight_kg" type="number" defaultValue={Number(item.quantity_checked_kg).toFixed(3)} className="mt-1 w-full rounded border px-2 py-1" /></label>
          <label className="text-sm">Inspector<input required name="inspector_name" className="mt-1 w-full rounded border px-2 py-1" /></label>
          <div className="flex gap-2 md:col-span-6">
            <input required minLength={8} name="reason" placeholder="Resolution reason (at least 8 characters)" className="min-w-0 flex-1 rounded border px-2 py-1" />
            <button disabled={pending} className="rounded bg-amber-800 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">{pending ? "Saving…" : "Resolve"}</button>
          </div>
        </form> : <div key={item.id} className="rounded-lg border border-amber-200 bg-white p-3">
          <p className="font-medium">{item.profile_code ? `${item.profile_code} · ${item.profile_name ?? ""}` : item.batch_number || item.production_job_id}</p>
          <p className="text-sm text-slate-600">{Number(item.quantity_checked_kg).toFixed(3)} kg awaits an authorized quality disposition.</p>
        </div>)}
      </div>
      {reworkItems.length < reworkTotal && <button type="button" onClick={() => void refreshRework(reworkItems.length)} className="mt-3 rounded border border-amber-400 px-3 py-1.5 text-sm font-medium text-amber-950">Load more rework inspections</button>}
    </section>}
    <MasterDataManager
      title="Quality Inspections"
      description="Record dimensional checks, surface finish, and hardness before dispatch."
      table="quality_inspections"
      select="*, aluminium_profiles(profile_code, profile_name)"
      context={context}
      schema={qualityInspectionSchema}
      searchPlaceholder="Search batch number, status, profile..."
      defaultValues={{ status: "pending", surface_finish_ok: true, quantity_checked_kg: 0 }}
      fields={[
        { name: "profile_id", label: "Profile", type: "select", options: profiles, required: true },
        { name: "batch_number", label: "Batch Number" },
        { name: "quantity_checked_kg", label: "Quantity Checked (kg)", type: "number" },
        { name: "dimensional_variance", label: "Dimensional Variance" },
        { name: "hardness_webster", label: "Hardness (Webster)", type: "number", step: "0.01" },
        { name: "weight_per_meter_actual", label: "Actual Weight/m (kg)", type: "number", step: "0.001" },
        { name: "surface_finish_ok", label: "Surface Finish OK?", type: "checkbox" },
        { name: "status", label: "Status", type: "select", options: qualityStatuses.map(c => ({ value: c, label: labelize(c) })) },
        { name: "inspector_name", label: "Inspector Name" },
        { name: "notes", label: "Notes", type: "textarea" }
      ]}
      columns={[
        { label: "Profile", value: (row) => row.aluminium_profiles ? `${row.aluminium_profiles.profile_code} · ${row.aluminium_profiles.profile_name}` : "Unknown" },
        { label: "Batch", value: (row) => row.batch_number || "N/A" },
        { label: "Qty (kg)", value: (row) => row.quantity_checked_kg },
        { label: "Hardness", value: (row) => row.hardness_webster ? `${row.hardness_webster} HW` : "-" },
        { label: "Wt/m", value: (row) => row.weight_per_meter_actual ? `${row.weight_per_meter_actual} kg/m` : "-" },
        { label: "Surface", value: (row) => row.surface_finish_ok ? "OK" : <span className="text-red-600 font-bold">Failed</span> },
        { label: "Status", value: (row) => <Badge value={row.status} /> }
      ]}
      canDelete={context.role === "owner" || context.role === "admin" || context.role === "quality"}
    />
    </>
  );
}

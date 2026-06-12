"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, MasterDataManager } from "./master-data-manager";
import { qualityInspectionSchema } from "@/lib/validations/schemas";
import { qualityStatuses, labelize, type SessionContext } from "@/types/app";
import { createClient } from "@/lib/supabase/browser";

export function QualityClient({ context }: { context: SessionContext }) {
  const supabase = useMemo(() => createClient(), []);
  const [profiles, setProfiles] = useState<{ value: string; label: string }[]>([]);

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
  }, [supabase, context.companyId]);

  return (
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
  );
}

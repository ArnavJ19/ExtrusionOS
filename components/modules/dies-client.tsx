"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge, MasterDataManager, type Field } from "./master-data-manager";
import { dieSchema } from "@/lib/validations/schemas";
import { createClient } from "@/lib/supabase/browser";
import { getErrorMessage } from "@/lib/utils/errors";
import { dieStatuses, labelize, type SessionContext } from "@/types/app";
import { formatDate, formatWeight } from "@/lib/utils/format";

export function DiesClient({ context }: { context: SessionContext }) {
  const supabase = useMemo(() => createClient(), []);
  const [profiles, setProfiles] = useState<{ id: string; profile_code: string; profile_name: string }[]>([]);
  const [customers, setCustomers] = useState<{ id: string; customer_name: string; company_name: string | null }[]>([]);

  useEffect(() => {
    async function loadLookups() {
      const [profileResult, customerResult] = await Promise.all([
        supabase.from("aluminium_profiles").select("id, profile_code, profile_name").eq("company_id", context.companyId).order("profile_code"),
        supabase.from("customers").select("id, customer_name, company_name").eq("company_id", context.companyId).order("customer_name")
      ]);
      if (profileResult.error) toast.error(getErrorMessage(profileResult.error));
      if (customerResult.error) toast.error(getErrorMessage(customerResult.error));
      setProfiles(profileResult.data ?? []);
      setCustomers(customerResult.data ?? []);
    }
    void loadLookups();
  }, []);

  const fields: Field[] = [
    { name: "die_number", label: "Die number", required: true },
    { name: "profile_id", label: "Linked profile", type: "select", required: true, options: profiles.map((profile) => ({ value: profile.id, label: `${profile.profile_code} · ${profile.profile_name}` })) },
    { name: "ownership_type", label: "Ownership", type: "select", options: [{ value: "company_owned", label: "Company owned" }, { value: "customer_owned", label: "Customer owned" }] },
    { name: "customer_id", label: "Customer", type: "select", options: customers.map((customer) => ({ value: customer.id, label: customer.company_name || customer.customer_name })) },
    { name: "die_status", label: "Status", type: "select", options: dieStatuses.map((value) => ({ value, label: labelize(value) })) },
    { name: "rack_location", label: "Rack/location" },
    { name: "total_production_kg", label: "Total production kg", type: "number", step: "0.001" },
    { name: "total_runs", label: "Total runs", type: "number" },
    { name: "last_used_date", label: "Last used", type: "date" },
    { name: "die_manufacturer", label: "Die manufacturer" },
    { name: "die_cost", label: "Die cost", type: "number", step: "0.01" },
    { name: "purchase_date", label: "Purchase date", type: "date" },
    { name: "correction_history", label: "Correction history", type: "textarea" },
    { name: "drawing_url", label: "Drawing URL" },
    { name: "notes", label: "Notes", type: "textarea" }
  ];

  return (
    <MasterDataManager
      title="Die Management"
      description="Track dies by status, rack location, linked profile, ownership, corrections, and production history."
      table="dies"
      select="*, aluminium_profiles!dies_profile_id_fkey(profile_code, profile_name), customers(customer_name, company_name)"
      context={context}
      schema={dieSchema}
      searchPlaceholder="Search die number, profile, customer, rack..."
      defaultValues={{ die_number: "", profile_id: "", customer_id: "", ownership_type: "company_owned", die_status: "active", rack_location: "", total_production_kg: 0, total_runs: 0, last_used_date: "", die_manufacturer: "", die_cost: "", purchase_date: "", correction_history: "", drawing_url: "", notes: "" }}
      fields={fields}
      columns={[
        { label: "Die", value: (row) => row.die_number },
        { label: "Profile", value: (row) => `${row.aluminium_profiles?.profile_code ?? "-"} ${row.aluminium_profiles?.profile_name ?? ""}` },
        { label: "Customer", value: (row) => row.customers?.company_name || row.customers?.customer_name || "-" },
        { label: "Ownership", value: (row) => <Badge value={row.ownership_type} /> },
        { label: "Status", value: (row) => <Badge value={row.die_status} /> },
        { label: "Rack", value: (row) => row.rack_location },
        { label: "Production", value: (row) => formatWeight(row.total_production_kg) },
        { label: "Last used", value: (row) => formatDate(row.last_used_date) }
      ]}
      canDelete={context.role === "owner" || context.role === "admin"}
    />
  );
}

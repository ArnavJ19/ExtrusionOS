// Choice lists for the Phase 4 forms, read as the signed-in employee (row-level security applies). Capped for a select;
// the database re-validates every chosen id against the company.
import { createClient } from "@/lib/supabase/server";

export type Option = { id: string; label: string };
const cap = 500;

export async function loadOptions(kinds: ("customers" | "users" | "dies" | "profiles" | "vendors" | "presses")[]) {
  const supabase = await createClient();
  const out: Record<string, Option[]> = { customers: [], users: [], dies: [], profiles: [], vendors: [], presses: [] };
  await Promise.all(kinds.map(async kind => {
    if (kind === "customers") {
      const { data } = await supabase.from("customers").select("id, customer_name, company_name").is("deleted_at", null).eq("is_active", true).order("customer_name").limit(cap);
      out.customers = (data ?? []).map(r => ({ id: r.id, label: (r.company_name?.trim() || r.customer_name) as string }));
    } else if (kind === "users") {
      const { data } = await supabase.from("app_users").select("id, full_name, role").eq("is_active", true).is("dealer_id", null).order("full_name").limit(cap);
      out.users = (data ?? []).map(r => ({ id: r.id, label: `${r.full_name} (${String(r.role).replaceAll("_", " ")})` }));
    } else if (kind === "dies") {
      const { data } = await supabase.from("dies").select("id, die_number, die_status").is("deleted_at", null).order("die_number").limit(cap);
      out.dies = (data ?? []).map(r => ({ id: r.id, label: `${r.die_number}${r.die_status ? ` · ${String(r.die_status).replaceAll("_", " ")}` : ""}` }));
    } else if (kind === "profiles") {
      const { data } = await supabase.from("aluminium_profiles").select("id, profile_code, profile_name").order("profile_code").limit(cap);
      out.profiles = (data ?? []).map(r => ({ id: r.id, label: `${r.profile_code}${r.profile_name ? ` · ${r.profile_name}` : ""}` }));
    } else if (kind === "vendors") {
      const { data } = await supabase.from("vendors").select("id, vendor_name").eq("is_active", true).order("vendor_name").limit(cap);
      out.vendors = (data ?? []).map(r => ({ id: r.id, label: r.vendor_name as string }));
    } else if (kind === "presses") {
      const { data } = await supabase.from("machines").select("id, machine_name").eq("machine_type", "extrusion_press").eq("is_active", true).order("machine_name").limit(cap);
      out.presses = (data ?? []).map(r => ({ id: r.id, label: r.machine_name as string }));
    }
  }));
  return out as { customers: Option[]; users: Option[]; dies: Option[]; profiles: Option[]; vendors: Option[]; presses: Option[] };
}

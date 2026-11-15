"use client";

// Search-as-you-type pickers for customers, profiles and presses used by the Autopilot batch 9 screens. They read through
// the person's own Supabase session, so row security decides what can be found; at most ten matches are shown.
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { inputClass } from "../order-to-cash/ui";

type Option = { id: string; name: string; hint?: string | null };

function usePicker(table: "customers" | "aluminium_profiles" | "machines", term: string, enabled: boolean) {
  const supabase = useMemo(() => createClient(), []);
  const [options, setOptions] = useState<Option[]>([]); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    const clean = term.trim().replace(/[,%()*\\]/g, " ").slice(0, 60);
    const timer = setTimeout(async () => {
      let query;
      if (table === "customers") {
        query = supabase.from("customers").select("id, customer_name, company_name, city").eq("is_active", true).is("deleted_at", null).order("customer_name").limit(10);
        if (clean) query = query.or(`customer_name.ilike.*${clean}*,company_name.ilike.*${clean}*,phone.ilike.*${clean}*`);
      } else if (table === "aluminium_profiles") {
        query = supabase.from("aluminium_profiles").select("id, profile_code, profile_name, section_weight_kg_per_m").eq("is_active", true).is("deleted_at", null).order("profile_code").limit(10);
        if (clean) query = query.or(`profile_code.ilike.*${clean}*,profile_name.ilike.*${clean}*,section_code.ilike.*${clean}*`);
      } else {
        query = supabase.from("machines").select("id, machine_name, machine_code").eq("is_active", true).eq("machine_type", "extrusion_press").order("machine_name").limit(20);
        if (clean) query = query.ilike("machine_name", `%${clean}%`);
      }
      const { data, error: failed } = await query;
      if (!current) return;
      if (failed) { setError("Could not search. Check the connection and retry."); return; }
      setError(null);
      setOptions(((data ?? []) as Record<string, unknown>[]).map(r => table === "customers" ? { id: String(r.id), name: String(r.company_name || r.customer_name), hint: (r.city as string) ?? null }
        : table === "aluminium_profiles" ? { id: String(r.id), name: String(r.profile_code), hint: `${r.profile_name ?? ""} · ${r.section_weight_kg_per_m ?? "—"} kg/m` }
        : { id: String(r.id), name: String(r.machine_name), hint: (r.machine_code as string) ?? null }));
    }, 200);
    return () => { current = false; clearTimeout(timer); };
  }, [enabled, supabase, table, term]);
  return { options, error };
}

function Picker({ label, table, value, onChange, placeholder }: { label: string; table: "customers" | "aluminium_profiles" | "machines"; value: { id: string; name: string } | null;
  onChange: (value: { id: string; name: string } | null) => void; placeholder: string }) {
  const [term, setTerm] = useState(""); const [open, setOpen] = useState(false);
  const { options, error } = usePicker(table, term, open);
  if (value) return <div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-xs font-bold uppercase text-neutral-500">{label}</span><b>{value.name}</b>
    <button type="button" className="text-sm font-bold underline" onClick={() => { onChange(null); setTerm(""); setOpen(true); }}>Change</button></div>;
  return <div className="relative max-w-md">
    <label className="block text-xs font-bold">{label}<input className={inputClass} value={term} placeholder={placeholder} onFocus={() => setOpen(true)} onChange={e => { setTerm(e.target.value); setOpen(true); }} /></label>
    {open ? <ul role="listbox" aria-label={`${label} matches`} className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border bg-white shadow-lg">
      {error ? <li className="p-2 text-sm text-amber-800">{error}</li> : options.length ? options.map(o => <li key={o.id}><button type="button" role="option" aria-selected={false} className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50"
        onClick={() => { onChange({ id: o.id, name: o.name }); setOpen(false); }}><b>{o.name}</b>{o.hint ? <span className="block text-xs text-neutral-500">{o.hint}</span> : null}</button></li>)
        : <li className="p-2 text-sm text-neutral-500">No match.</li>}
    </ul> : null}
  </div>;
}

export function CustomerPicker(props: { value: { id: string; name: string } | null; onChange: (value: { id: string; name: string } | null) => void; label?: string }) {
  return <Picker label={props.label ?? "Customer"} table="customers" value={props.value} onChange={props.onChange} placeholder="Name, company or phone" />;
}
export function ProfilePicker(props: { value: { id: string; name: string } | null; onChange: (value: { id: string; name: string } | null) => void; label?: string }) {
  return <Picker label={props.label ?? "Profile"} table="aluminium_profiles" value={props.value} onChange={props.onChange} placeholder="Profile code or name" />;
}
export function PressPicker(props: { value: { id: string; name: string } | null; onChange: (value: { id: string; name: string } | null) => void }) {
  return <Picker label="Press" table="machines" value={props.value} onChange={props.onChange} placeholder="Press name" />;
}

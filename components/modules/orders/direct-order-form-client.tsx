"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { createDirectOrderAction, searchDirectOrderOptionsAction } from "@/lib/actions/direct-orders";
import { calculateDirectOrderLine, calculateDirectOrderSummary, directOrderSchema, type DirectOrderCustomer, type DirectOrderLine, type DirectOrderProfile } from "@/lib/orders/direct-order";
import { formatCurrency, formatWeight } from "@/lib/utils/format";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";

const emptyLine = (): DirectOrderLine => ({ profile_id: "", die_id: null, quantity_pieces: 1, length_per_piece_m: 0,
  expected_section_weight_kg_per_m: 0, net_rate: 0, gst_percent: 18, hsn_code: "", finishing_type: "mill_finish" });
const finishes: DirectOrderLine["finishing_type"][] = ["mill_finish", "powder_coating", "anodizing", "anodized_silver", "anodized_bronze", "anodized_black", "wood_finish", "wood_grain", "pvdf", "other"];

function useOrderOptions(kind: "customer" | "profile", search: string) {
  const [options, setOptions] = useState<{ customers: DirectOrderCustomer[]; profiles: DirectOrderProfile[]; loading: boolean; error: string | null }>(
    { customers: [], profiles: [], loading: true, error: null });
  useEffect(() => {
    let active = true;
    setOptions(previous => ({ ...previous, loading: true, error: null }));
    const timer = setTimeout(async () => {
      try {
        const result = await searchDirectOrderOptionsAction(kind, search);
        if (!active) return;
        setOptions(result.success ? { customers: result.customers ?? [], profiles: result.profiles ?? [], loading: false, error: null }
          : { customers: [], profiles: [], loading: false, error: result.error });
      } catch {
        if (active) setOptions({ customers: [], profiles: [], loading: false, error: "Options could not be loaded. Try the search again." });
      }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [kind, search]);
  return options;
}

type Entry = { key: string; line: DirectOrderLine; profile: DirectOrderProfile | null };
function lineTotals(entry: Entry) {
  if (!entry.profile || entry.profile.id !== entry.line.profile_id) return null;
  try { return calculateDirectOrderLine(entry.line, Number(entry.profile.section_weight_kg_per_m)); }
  catch { return null; }
}

function DirectOrderLineEditor({ entry, index, onChange, onRemove, removable }: {
  entry: Entry; index: number; onChange: (entry: Entry) => void; onRemove: () => void; removable: boolean;
}) {
  const [search, setSearch] = useState("");
  const options = useOrderOptions("profile", search);
  const profiles = [...options.profiles, entry.profile].filter((value, position, all): value is DirectOrderProfile =>
    Boolean(value) && all.findIndex(item => item?.id === value?.id) === position);
  const totals = lineTotals(entry);
  function field<Key extends keyof DirectOrderLine>(key: Key, value: DirectOrderLine[Key]) {
    onChange({ ...entry, line: { ...entry.line, [key]: value } });
  }
  function number(key: "quantity_pieces" | "length_per_piece_m" | "net_rate" | "gst_percent", label: string, step: string, min: number, max: number) {
    const value = entry.line[key];
    return <label className="min-w-0"><span className="form-label">{label}</span><input className="form-input w-full" type="number" required
      min={min} max={max} step={step} value={Number.isFinite(value) && (value !== 0 || key === "gst_percent") ? value : ""}
      onChange={event => field(key, event.target.value === "" ? Number.NaN : Number(event.target.value))} /></label>;
  }
  return <Card>
    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
      <h2 className="font-bold text-slate-900">Profile line {index + 1}</h2>
      <Button type="button" variant="secondary" disabled={!removable} onClick={onRemove} aria-label={`Remove profile line ${index + 1}`}>Remove line</Button>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="min-w-0 sm:col-span-2"><p className="form-label">Profile</p>
          <SearchableSelect value={entry.line.profile_id} options={profiles.map(profile => ({ value: profile.id, label: `${profile.profile_code} - ${profile.profile_name}` }))}
            placeholder="Search by profile code" ariaLabel="Profile" searching={options.loading}
            onSearchChange={value => { setSearch(value); onChange({ ...entry, profile: null,
              line: { ...entry.line, profile_id: "", die_id: null, expected_section_weight_kg_per_m: 0, hsn_code: "" } }); }}
            onChange={value => { const profile = profiles.find(row => row.id === value) ?? null;
              onChange({ ...entry, profile, line: { ...entry.line, profile_id: value, die_id: null, hsn_code: profile?.hsn_code ?? "",
                expected_section_weight_kg_per_m: Number(profile?.section_weight_kg_per_m ?? 0) } }); }} />
          <p className="form-hint">Search the catalogue; up to 25 matching profiles are shown.</p>
          {options.error ? <p className="mt-2 text-sm text-red-700" role="alert">{options.error}</p> : null}
        </div>
        <label className="min-w-0"><span className="form-label">Finish</span><select className="form-input w-full" aria-label="Finish" value={entry.line.finishing_type}
          onChange={event => field("finishing_type", event.target.value as DirectOrderLine["finishing_type"])}>
          {finishes.map(finish => <option key={finish} value={finish}>{finish.replaceAll("_", " ")}</option>)}
        </select></label>
        {number("quantity_pieces", "Pieces", "1", 1, 1000000)}
        {number("length_per_piece_m", "Cut length per piece (m)", "0.001", 0.001, 1000)}
        {number("net_rate", "Agreed net rate (INR/kg)", "0.01", 0.01, 10000000)}
        {number("gst_percent", "GST (%)", "0.01", 0, 100)}
        <label className="min-w-0"><span className="form-label">HSN code</span><input className="form-input w-full" inputMode="numeric" required maxLength={8}
          pattern="(?:[0-9]{4}|[0-9]{6}|[0-9]{8})" value={entry.line.hsn_code} onChange={event => field("hsn_code", event.target.value)} /></label>
        <div className="min-w-0"><p className="form-label">Section weight</p><p className="pt-2 text-sm font-semibold text-slate-800">{entry.profile ? `${entry.profile.section_weight_kg_per_m} kg/m` : "Select a profile"}</p></div>
      </div>
      <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
        {totals ? `${totals.total_meters.toLocaleString("en-IN")} m / ${formatWeight(totals.quantity_kg)} - ${formatCurrency(totals.subtotal)} before GST; ${formatCurrency(totals.grand_total)} including GST.`
          : "Complete this line to preview its weight and value."}
      </div>
    </CardContent>
  </Card>;
}

export function DirectOrderFormClient() {
  const router = useRouter();
  const [customerSearch, setCustomerSearch] = useState("");
  const [customer, setCustomer] = useState<DirectOrderCustomer | null>(null);
  const [entries, setEntries] = useState<Entry[]>(() => [{ key: "first-line", line: emptyLine(), profile: null }]);
  const [orderDate, setOrderDate] = useState(() => getBusinessDateBoundaries().today);
  const [expectedDate, setExpectedDate] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "high" | "urgent">("normal");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ key: string; pending: boolean } | null>(null);
  const options = useOrderOptions("customer", customerSearch);
  const customers = [customer, ...options.customers].filter((value, position, all): value is DirectOrderCustomer =>
    Boolean(value) && all.findIndex(item => item?.id === value?.id) === position);
  const calculated = entries.map(lineTotals);
  const complete = calculated.every(value => value !== null);
  const review = calculateDirectOrderSummary(calculated.filter(value => value !== null));
  const { weight, subtotal, tax } = review;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (attempt.current?.pending) return;
    const key = attempt.current?.key ?? crypto.randomUUID();
    const parsed = directOrderSchema.safeParse({ idempotency_key: key,
      order: { customer_id: customer?.id ?? "", order_date: orderDate, expected_dispatch_date: expectedDate || null, priority, notes },
      items: entries.map(entry => entry.line) });
    if (!parsed.success || !complete) { setError(parsed.success ? "Complete every profile line before saving." : parsed.error.issues[0]?.message ?? "Check the order details."); return; }
    if (!review.within_limits) { setError("The combined order exceeds the supported value or weight. Split it into separate orders."); return; }
    attempt.current = { key, pending: true };
    setSaving(true); setError(null);
    try {
      const result = await createDirectOrderAction(parsed.data);
      if (!result.success) { setError(result.error); return; }
      toast.success("Direct order created with priced lines.");
      router.push(`/orders/${result.orderId}`); router.refresh();
    } catch { setError("The order confirmation could not be received. Keep the submitted details and retry to check the result."); }
    finally { if (attempt.current) attempt.current.pending = false; setSaving(false); }
  }

  return <form className="space-y-5" onSubmit={submit}>
    <div><h1 className="text-2xl font-bold text-slate-950">Direct Order</h1><p className="mt-1 text-sm text-slate-600">Enter the agreed profile quantities and prices without a quotation. Check the HSN and GST for each line.</p></div>
    <fieldset disabled={saving} className="min-w-0 space-y-5">
      <Card><CardHeader><h2 className="font-bold text-slate-900">Customer and delivery</h2></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0 sm:col-span-2"><p className="form-label">Customer</p><SearchableSelect value={customer?.id ?? ""}
          options={customers.map(row => ({ value: row.id, label: `${row.customer_name}${row.company_name ? ` - ${row.company_name}` : ""}` }))}
          onSearchChange={value => { setCustomerSearch(value); setCustomer(null); }} searching={options.loading} placeholder="Search by customer name" ariaLabel="Customer"
          onChange={value => setCustomer(customers.find(row => row.id === value) ?? null)} />
          <p className="form-hint">Up to 25 matching customers are shown. Search by name for older records.</p>
          {options.error ? <p className="mt-2 text-sm text-red-700" role="alert">{options.error}</p> : null}
        </div>
        <label className="min-w-0"><span className="form-label">Order date</span><input className="form-input w-full" type="date" value={orderDate} required onChange={event => setOrderDate(event.target.value)} /></label>
        <label className="min-w-0"><span className="form-label">Expected dispatch date</span><input className="form-input w-full" type="date" min={orderDate} value={expectedDate} onChange={event => setExpectedDate(event.target.value)} /></label>
        <label className="min-w-0"><span className="form-label">Priority</span><select className="form-input w-full" aria-label="Priority" value={priority} onChange={event => setPriority(event.target.value as typeof priority)}>{["low", "normal", "high", "urgent"].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="min-w-0 sm:col-span-2"><span className="form-label">Order notes</span><textarea className="form-input w-full" rows={3} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
      </CardContent></Card>
      {entries.map((entry, index) => <DirectOrderLineEditor key={entry.key} entry={entry} index={index} removable={entries.length > 1}
        onChange={next => setEntries(previous => previous.map(row => row.key === entry.key ? next : row))}
        onRemove={() => setEntries(previous => previous.filter(row => row.key !== entry.key))} />)}
      <Button type="button" variant="secondary" disabled={entries.length >= 100} onClick={() => setEntries(previous => [...previous, { key: crypto.randomUUID(), line: emptyLine(), profile: null }])}>Add profile line</Button>
      <Card><CardHeader><h2 className="font-bold text-slate-900">Order review</h2></CardHeader><CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[["Profile weight", complete ? formatWeight(weight) : "Complete all lines"], ["Before GST", complete ? formatCurrency(subtotal) : "-"],
            ["GST", complete ? formatCurrency(tax) : "-"], ["Order total", complete ? formatCurrency(review.total) : "-"]].map(([label, value]) =>
            <div key={label} className="min-w-0"><p className="text-xs font-bold uppercase text-slate-500">{label}</p><p className="mt-1 break-words text-lg font-bold text-slate-950">{value}</p></div>)}
        </div>
        <p className="text-sm text-slate-600">Weight is calculated from pieces, cut length and the profile section weight. Rates are per kilogram. Die selection and physical stock allocation happen in their operational workflows.</p>
        {complete && !review.within_limits ? <p role="alert" className="text-sm text-red-700">The combined order exceeds the supported value or weight. Split it into separate orders.</p> : null}
        {complete && weight < 700 ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">This factory order is below 700 kg and will wait in the load consolidation queue before production release.</p> : null}
      </CardContent></Card>
      {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}<p className="mt-2">Keep the submitted details when retrying an uncertain result so the same order can be recovered.</p></div> : null}
      <Button type="submit" disabled={saving || !customer || !complete || !review.within_limits}>{saving ? "Creating order..." : "Create Direct Order"}</Button>
    </fieldset>
  </form>;
}

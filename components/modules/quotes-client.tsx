"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays } from "date-fns";
import { toast } from "sonner";
import { Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PageHeader } from "@/components/layout/page-header";
import { calculateQuoteItem, calculateQuoteSummary, getQuoteItemWarnings, type QuoteItemInput } from "@/lib/calculations/quote";
import { quoteSchema } from "@/lib/validations/schemas";
import { createClient } from "@/lib/supabase/browser";
import { formatCurrency, formatDate, formatMeters, formatWeight, todayIso } from "@/lib/utils/format";
import { getErrorMessage } from "@/lib/utils/errors";
import { rowMatchesSearch } from "@/lib/utils/search";
import { saveQuoteAction, updateQuoteStatusAction } from "@/lib/actions/quotes-orders";
import { dieAmortizationTypes, labelize, type DieAmortizationType, type FinishingChargeType, type FinishingType, type QuoteStatus, type SessionContext } from "@/types/app";

type Customer = { id: string; customer_name: string; company_name: string | null; gst_number: string | null; billing_address: string | null; shipping_address: string | null };
type Profile = {
  id: string;
  profile_code: string;
  profile_name: string;
  section_weight_kg_per_m: number;
  section_number?: string | null;
  section_code?: string | null;
  section_name?: string | null;
  drawing_document_id?: string | null;
  drawing_revision?: string | null;
  drawing_approval_status?: string | null;
  alloy_standard_id?: string | null;
  alloy_id?: string | null;
  temper_id?: string | null;
  min_weight?: number | null;
  max_weight?: number | null;
  weight_tolerance?: number | null;
  actual_weight_kg_per_m?: number | null;
  standard_length?: number | null;
  bundle_quantity?: number | null;
  pieces_per_bundle?: number | null;
  meter_per_bundle?: number | null;
  kg_per_bundle?: number | null;
};
type Die = { id: string; die_number: string; profile_id: string; die_status: string };
type QuoteRow = Record<string, any>;
type CompanySettingsRow = Record<string, any>;

type FormItem = QuoteItemInput & { profile_id: string; die_id: string; item_description: string; finishing_type: FinishingType; die_amortization_type: DieAmortizationType };

const emptyItem: FormItem = {
  profile_id: "",
  die_id: "",
  item_description: "",
  quantity_pieces: 1,
  length_per_piece_m: 5.8,
  section_weight_kg_per_m: 0,
  scrap_allowance_percent: 0,
  expected_recovery_percent: 100,
  minimum_billing_weight_kg: 0,
  billet_rate_per_kg: 0,
  conversion_charge_per_kg: 0,
  finishing_type: "mill_finish",
  finishing_charge_type: "per_kg",
  finishing_charge: 0,
  die_charge: 0,
  die_amortization_type: "full_die_charge",
  die_amortization_quantity_kg: 0,
  packing_charge: 0,
  transport_charge: 0,
  other_charges: 0,
  margin_percent: 10,
  sales_price_override: null,
  minimum_margin_percent: 8
};

function customerLabel(customer: Customer) {
  return [customer.company_name || customer.customer_name, customer.customer_name, customer.gst_number].filter(Boolean).join(" · ");
}

function cleanCustomerSearch(value: string) {
  return value.replace(/[%*_,()]/g, " ").replace(/\s+/g, " ").trim();
}

function mergeCustomers(current: Customer[], incoming: Customer[]) {
  const merged: Customer[] = [];
  const seen = new Set<string>();
  for (const customer of [...incoming, ...current]) {
    if (seen.has(customer.id)) continue;
    seen.add(customer.id);
    merged.push(customer);
  }
  return merged;
}

export function QuotesClient({ context, mode = "full", initialEditId }: { context: SessionContext; mode?: "full" | "form"; initialEditId?: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [dies, setDies] = useState<Die[]>([]);
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [settings, setSettings] = useState<CompanySettingsRow | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ customer_id: "", quote_date: todayIso(), valid_until: "", status: "draft" as QuoteStatus, gst_percent: 18, terms_and_conditions: "", delivery_timeline: "", payment_terms: "", approval_notes: "", notes: "" });
  const [items, setItems] = useState<FormItem[]>([{ ...emptyItem }]);

  const calculatedItems = items.map((item) => calculateQuoteItem(item));
  const summary = calculateQuoteSummary(calculatedItems, Number(form.gst_percent));
  const selectedCustomer = customers.find((customer) => customer.id === form.customer_id);
  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    const uniqueCustomers = mergeCustomers(customers, []);
    const matches = term ? uniqueCustomers.filter((customer) => customerLabel(customer).toLowerCase().includes(term)) : uniqueCustomers;
    return selectedCustomer && !matches.some((customer) => customer.id === selectedCustomer.id) ? [selectedCustomer, ...matches] : matches;
  }, [customerSearch, customers, selectedCustomer]);
  const canApproveLowMargin = ["owner", "admin", "sales_manager"].includes(context.role);

  async function loadAll() {
    setLoading(true);
    const [customerResult, profileResult, dieResult, quoteResult, settingsResult] = await Promise.all([
      supabase.from("customers").select("id, customer_name, company_name, gst_number, billing_address, shipping_address").eq("company_id", context.companyId).order("customer_name"),
      supabase.from("aluminium_profiles").select("id, profile_code, profile_name, section_weight_kg_per_m, section_number, section_code, section_name, drawing_document_id, drawing_revision, drawing_approval_status, alloy_standard_id, alloy_id, temper_id, min_weight, max_weight, weight_tolerance, actual_weight_kg_per_m, standard_length, bundle_quantity, pieces_per_bundle, meter_per_bundle, kg_per_bundle").eq("company_id", context.companyId).eq("is_active", true).order("profile_code"),
      supabase.from("dies").select("id, die_number, profile_id, die_status").eq("company_id", context.companyId).order("die_number"),
      supabase.from("quotes").select("*, customers(customer_name, company_name)").eq("company_id", context.companyId).order("created_at", { ascending: false }).limit(100),
      supabase.from("company_settings").select("*").eq("company_id", context.companyId).maybeSingle()
    ]);
    setLoading(false);
    if (customerResult.error) toast.error(getErrorMessage(customerResult.error));
    if (profileResult.error) toast.error(getErrorMessage(profileResult.error));
    if (dieResult.error) toast.error(getErrorMessage(dieResult.error));
    if (quoteResult.error) toast.error(getErrorMessage(quoteResult.error));
    setCustomers(customerResult.data ?? []);
    setProfiles(profileResult.data ?? []);
    setDies(dieResult.data ?? []);
    setQuotes(quoteResult.data ?? []);
    const loadedSettings = settingsResult.data;
    setSettings(loadedSettings ?? null);
    if (loadedSettings) {
      const validity = loadedSettings.default_quote_validity_days ?? 15;
      setForm((current) => ({
        ...current,
        gst_percent: loadedSettings.default_gst_percent ?? 18,
        valid_until: addDays(new Date(), validity).toISOString().slice(0, 10),
        terms_and_conditions: loadedSettings.default_terms_and_conditions ?? loadedSettings.default_quote_terms ?? "",
        delivery_timeline: loadedSettings.default_delivery_terms ?? "",
        payment_terms: loadedSettings.default_payment_terms ?? ""
      }));
      setItems([{ ...emptyItem, conversion_charge_per_kg: loadedSettings.default_conversion_charge_per_kg ?? 0, packing_charge: loadedSettings.default_packing_charge ?? 0, transport_charge: loadedSettings.default_transport_charge ?? 0, margin_percent: loadedSettings.default_margin_percent ?? 10, minimum_margin_percent: loadedSettings.minimum_margin_percent ?? 8 }]);
    }
  }

  useEffect(() => { void loadAll(); }, []);

  useEffect(() => {
    const term = cleanCustomerSearch(customerSearch);
    if (term.length < 2) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setCustomerSearchLoading(true);
      const select = "id, customer_name, company_name, gst_number, billing_address, shipping_address";
      const wildcard = `*${term}*`;
      const [broadResult, gstExactResult, gstPartialResult] = await Promise.all([
        supabase
          .from("customers")
          .select(select)
          .eq("company_id", context.companyId)
          .or(`customer_name.ilike.${wildcard},company_name.ilike.${wildcard},gst_number.ilike.${wildcard}`)
          .order("customer_name")
          .limit(25),
        supabase
          .from("customers")
          .select(select)
          .eq("company_id", context.companyId)
          .eq("gst_number", term.toUpperCase())
          .limit(25),
        supabase
          .from("customers")
          .select(select)
          .eq("company_id", context.companyId)
          .ilike("gst_number", `%${term}%`)
          .limit(25)
      ]);

      if (cancelled) return;
      setCustomerSearchLoading(false);
      const error = broadResult.error ?? gstExactResult.error ?? gstPartialResult.error;
      if (error) return toast.error(getErrorMessage(error, "Could not search customers"));
      setCustomers((current) => mergeCustomers(current, [...(gstExactResult.data ?? []), ...(gstPartialResult.data ?? []), ...(broadResult.data ?? [])]));
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [customerSearch, context.companyId, supabase]);

  function updateItem(index: number, key: keyof FormItem, value: string | number) {
    setItems((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const next = { ...item, [key]: value } as FormItem;
      if (key === "profile_id") {
        const profile = profiles.find((candidate) => candidate.id === value);
        next.section_weight_kg_per_m = profile?.section_weight_kg_per_m ?? 0;
        next.item_description = profile ? `${profile.profile_code} - ${profile.profile_name}` : "";
      }
      if (key === "die_id") {
        const die = dies.find((candidate) => candidate.id === value);
        if (die && ["inactive", "dead"].includes(die.die_status)) toast.warning(`Selected die is ${labelize(die.die_status)}. Confirm before quoting.`);
      }
      return next;
    }));
  }

  async function saveQuote() {
    const parsed = quoteSchema.safeParse({ ...form, items });
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Please check quote details");
    if (!customers.some((customer) => customer.id === parsed.data.customer_id)) return toast.error("Selected customer is not available for this company.");
    const invalidItem = parsed.data.items.find((item) => !profiles.some((profile) => profile.id === item.profile_id) || (item.die_id && !dies.some((die) => die.id === item.die_id && die.profile_id === item.profile_id)));
    if (invalidItem) return toast.error("One quote item has a stale profile or die selection. Refresh and select it again.");
    const calculatedParsedItems = parsed.data.items.map((item) => calculateQuoteItem(item));
    const parsedSummary = calculateQuoteSummary(calculatedParsedItems, parsed.data.gst_percent);
    const restrictedApprovalStatus = ["approved_for_sending", "sent", "customer_approved", "converted_to_order"].includes(parsed.data.status);
    if (parsedSummary.low_margin_approval_required && restrictedApprovalStatus && !canApproveLowMargin) {
      return toast.error("This quote is below the company minimum margin and needs owner/admin approval.");
    }
    setSaving(true);
    const result = await saveQuoteAction({ ...parsed.data, editing_id: editingId });
    setSaving(false);
    if (!result.success) return toast.error(result.error);
    toast.success("Quote saved");
    setEditingId(null);
    setItems([{ ...emptyItem }]);
    setCustomerSearch("");
    setForm((current) => ({ ...current, customer_id: "", status: "draft", approval_notes: "", notes: "" }));
    await loadAll();
  }

  async function editQuote(quote: QuoteRow) {
    const { data, error } = await supabase.from("quote_items").select("*").eq("quote_id", quote.id).eq("company_id", context.companyId).order("created_at");
    if (error) return toast.error(getErrorMessage(error));
    setEditingId(quote.id);
    setForm({ customer_id: quote.customer_id, quote_date: quote.quote_date, valid_until: quote.valid_until ?? "", status: quote.status, gst_percent: quote.gst_percent, terms_and_conditions: quote.terms_and_conditions ?? "", delivery_timeline: quote.delivery_timeline ?? "", payment_terms: quote.payment_terms ?? "", approval_notes: quote.approval_notes ?? "", notes: quote.notes ?? "" });
    const customer = customers.find((candidate) => candidate.id === quote.customer_id);
    setCustomerSearch(customer ? customerLabel(customer) : "");
    setItems((data ?? []).map((item: any) => ({ ...emptyItem, ...item, die_id: item.die_id ?? "", item_description: item.item_description ?? "", sales_price_override: item.sales_price_override ?? null, die_amortization_type: item.die_amortization_type ?? "full_die_charge" })));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  useEffect(() => {
    if (!initialEditId || loading || editingId) return;
    async function loadInitialEdit() {
      const existing = quotes.find((quote) => quote.id === initialEditId);
      if (existing) return editQuote(existing);
      const { data, error } = await supabase.from("quotes").select("*, customers(customer_name, company_name)").eq("id", initialEditId).eq("company_id", context.companyId).single();
      if (error || !data) return toast.error(getErrorMessage(error, "Could not load quote for editing"));
      await editQuote(data);
    }
    void loadInitialEdit();
  }, [initialEditId, loading, editingId, quotes]);

  async function updateStatus(quote: QuoteRow, status: QuoteStatus) {
    if (quote.low_margin_approval_required && ["approved_for_sending", "sent", "customer_approved"].includes(status) && !canApproveLowMargin) {
      return toast.error("This low-margin quote needs owner/admin approval.");
    }
    const result = await updateQuoteStatusAction(quote.id, status);
    if (!result.success) return toast.error(result.error);
    toast.success("Quote status updated");
    await loadAll();
  }

  function convertToOrder(quote: QuoteRow) {
    window.location.assign(`/orders/new?quoteId=${quote.id}`);
  }

  async function copyWhatsapp(quote: QuoteRow) {
    const customer = quote.customers?.company_name || quote.customers?.customer_name || "Customer";
    const message = `Dear ${customer}, please find quotation ${quote.quote_number} Rev ${quote.revision_number ?? 1} for aluminium profiles. Total value: ${formatCurrency(quote.grand_total)} incl. GST. Valid until ${quote.valid_until ? formatDate(quote.valid_until) : "as mentioned"}. PDF attached.`;
    try {
      await navigator.clipboard.writeText(message);
      toast.success("WhatsApp summary copied");
    } catch {
      toast.error("Could not copy automatically. Select the quote details and copy manually.");
    }
  }

  const filteredQuotes = quotes.filter((quote) => rowMatchesSearch(quote, search));

  return (
    <div>
      <PageHeader title={mode === "form" ? "Create Quote" : "Quotations"} description="Create accurate aluminium extrusion quotations with live kg/m, billet, conversion, finishing, margin, GST, and PDF output." />
      {loading ? <LoadingState title="Loading quotations" description="Fetching customers, profiles, dies, defaults, and saved quotes." /> : <div className="grid gap-6 2xl:grid-cols-[1fr_440px]">
        <Card><CardContent>
          <div className="mb-5 flex flex-col gap-2 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="section-title">Quote creation</h2>
              <p className="mt-1 text-sm font-medium text-slate-500">Build aluminium extrusion pricing with live weight, meter, margin, and GST totals.</p>
            </div>
            {editingId ? <Badge value="draft" className="w-fit" /> : null}
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            <label className="block space-y-1.5 sm:col-span-2"><span className="form-label">Customer *</span><input className="form-input" placeholder="Search customer name, company, or GST..." value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} /><SearchableSelect value={form.customer_id} placeholder={filteredCustomers.length ? "Select customer" : customerSearchLoading ? "Searching customers..." : "No matching customers"} options={filteredCustomers.map((customer) => ({ value: customer.id, label: customerLabel(customer) }))} onChange={(nextValue) => { const customer = customers.find((candidate) => candidate.id === nextValue); setForm({ ...form, customer_id: nextValue }); setCustomerSearch(customer ? customerLabel(customer) : ""); }} />{selectedCustomer ? <p className="text-xs font-semibold text-slate-500">Selected: {customerLabel(selectedCustomer)}</p> : customerSearchLoading ? <p className="text-xs font-semibold text-slate-500">Searching customer database...</p> : null}</label>
            <label className="block space-y-1.5"><span className="form-label">Quote date</span><input className="form-input" type="date" value={form.quote_date} onChange={(event) => setForm({ ...form, quote_date: event.target.value })} /></label>
            <label className="block space-y-1.5"><span className="form-label">Valid until</span><input className="form-input" type="date" value={form.valid_until} onChange={(event) => setForm({ ...form, valid_until: event.target.value })} /></label>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5"><span className="form-label">Delivery timeline</span><input className="form-input" placeholder="Example: 10-12 working days after approval" value={form.delivery_timeline} onChange={(event) => setForm({ ...form, delivery_timeline: event.target.value })} /></label>
            <label className="block space-y-1.5"><span className="form-label">Payment terms</span><input className="form-input" placeholder="Example: 50% advance, balance before dispatch" value={form.payment_terms} onChange={(event) => setForm({ ...form, payment_terms: event.target.value })} /></label>
          </div>
          <div className="mt-6 space-y-5">
            {items.map((item, index) => {
              const calculated = calculatedItems[index];
              const compatibleDies = dies.filter((die) => !item.profile_id || die.profile_id === item.profile_id);
              const selectedDie = dies.find((die) => die.id === item.die_id);
              const warnings = getQuoteItemWarnings(calculated, { dieStatus: selectedDie?.die_status, customerGstNumber: selectedCustomer?.gst_number, defaultConversionChargePerKg: settings?.default_conversion_charge_per_kg, quoteValidUntil: form.valid_until });
              return <div key={index} className="rounded-3xl border border-slate-200 bg-gradient-to-br from-aluminium/70 to-white p-4 shadow-sm">
                <div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-orange">Extrusion item</p><h3 className="mt-1 font-black text-slate-950">Item {index + 1}</h3></div>{items.length > 1 ? <Button variant="ghost" type="button" onClick={() => setItems(items.filter((_, itemIndex) => itemIndex !== index))}>Remove</Button> : null}</div>
                <div className="grid gap-3 md:grid-cols-4">
                  <label className="block space-y-1.5 md:col-span-2"><span className="form-label">Profile *</span><SearchableSelect value={item.profile_id} placeholder="Select profile" options={profiles.map((profile) => ({ value: profile.id, label: `${profile.profile_code} · ${profile.profile_name}` }))} onChange={(nextValue) => updateItem(index, "profile_id", nextValue)} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Die</span><SearchableSelect value={item.die_id} placeholder="No die" options={compatibleDies.map((die) => ({ value: die.id, label: `${die.die_number} · ${labelize(die.die_status)}` }))} onChange={(nextValue) => updateItem(index, "die_id", nextValue)} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Qty pcs</span><input className="form-input" type="number" inputMode="numeric" min="1" value={item.quantity_pieces} onChange={(event) => updateItem(index, "quantity_pieces", Number(event.target.value))} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Length m</span><input className="form-input" type="number" inputMode="decimal" min="0" step="0.001" value={item.length_per_piece_m} onChange={(event) => updateItem(index, "length_per_piece_m", Number(event.target.value))} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Kg/m</span><input className="form-input" type="number" inputMode="decimal" min="0" step="0.001" value={item.section_weight_kg_per_m} onChange={(event) => updateItem(index, "section_weight_kg_per_m", Number(event.target.value))} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Scrap allowance %</span><input className="form-input" type="number" inputMode="decimal" min="0" step="0.01" value={item.scrap_allowance_percent ?? 0} onChange={(event) => updateItem(index, "scrap_allowance_percent", Number(event.target.value))} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Recovery %</span><input className="form-input" type="number" inputMode="decimal" min="0" max="100" step="0.01" value={item.expected_recovery_percent ?? 100} onChange={(event) => updateItem(index, "expected_recovery_percent", Number(event.target.value))} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Min billing kg</span><input className="form-input" type="number" inputMode="decimal" min="0" step="0.001" value={item.minimum_billing_weight_kg ?? 0} onChange={(event) => updateItem(index, "minimum_billing_weight_kg", Number(event.target.value))} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Billet rate/kg</span><input className="form-input" type="number" inputMode="decimal" min="0" value={item.billet_rate_per_kg} onChange={(event) => updateItem(index, "billet_rate_per_kg", Number(event.target.value))} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Conversion/kg</span><input className="form-input" type="number" inputMode="decimal" min="0" value={item.conversion_charge_per_kg} onChange={(event) => updateItem(index, "conversion_charge_per_kg", Number(event.target.value))} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Finish</span><select className="form-input" value={item.finishing_type} onChange={(event) => updateItem(index, "finishing_type", event.target.value)}>{["mill_finish", "powder_coating", "anodizing", "wood_finish", "pvdf", "other"].map((value) => <option key={value} value={value}>{labelize(value)}</option>)}</select></label>
                  <label className="block space-y-1.5"><span className="form-label">Finish charge type</span><select className="form-input" value={item.finishing_charge_type} onChange={(event) => updateItem(index, "finishing_charge_type", event.target.value as FinishingChargeType)}>{["per_kg", "per_meter", "fixed", "per_sqft"].map((value) => <option key={value} value={value}>{labelize(value)}</option>)}</select></label>
                  <label className="block space-y-1.5"><span className="form-label">Finish charge</span><input className="form-input" type="number" inputMode="decimal" min="0" value={item.finishing_charge} onChange={(event) => updateItem(index, "finishing_charge", Number(event.target.value))} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Die charge</span><input className="form-input" type="number" inputMode="decimal" min="0" value={item.die_charge} onChange={(event) => updateItem(index, "die_charge", Number(event.target.value))} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Die amortization</span><select className="form-input" value={item.die_amortization_type} onChange={(event) => updateItem(index, "die_amortization_type", event.target.value as DieAmortizationType)}>{dieAmortizationTypes.map((value) => <option key={value} value={value}>{labelize(value)}</option>)}</select></label>
                  <label className="block space-y-1.5"><span className="form-label">Amortize over kg</span><input className="form-input" type="number" inputMode="decimal" min="0" step="0.001" value={item.die_amortization_quantity_kg ?? 0} onChange={(event) => updateItem(index, "die_amortization_quantity_kg", Number(event.target.value))} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Packing</span><input className="form-input" type="number" inputMode="decimal" min="0" value={item.packing_charge} onChange={(event) => updateItem(index, "packing_charge", Number(event.target.value))} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Transport</span><input className="form-input" type="number" inputMode="decimal" min="0" value={item.transport_charge} onChange={(event) => updateItem(index, "transport_charge", Number(event.target.value))} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Other</span><input className="form-input" type="number" inputMode="decimal" min="0" value={item.other_charges} onChange={(event) => updateItem(index, "other_charges", Number(event.target.value))} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Margin %</span><input className="form-input" type="number" inputMode="decimal" min="0" value={item.margin_percent} onChange={(event) => updateItem(index, "margin_percent", Number(event.target.value))} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Min margin %</span><input className="form-input" type="number" inputMode="decimal" min="0" value={item.minimum_margin_percent ?? 0} onChange={(event) => updateItem(index, "minimum_margin_percent", Number(event.target.value))} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Sales override</span><input className="form-input" type="number" inputMode="decimal" min="0" value={item.sales_price_override ?? ""} onChange={(event) => updateItem(index, "sales_price_override", event.target.value === "" ? 0 : Number(event.target.value))} /></label>
                  <label className="block space-y-1.5 md:col-span-4"><span className="form-label">Description</span><input className="form-input" value={item.item_description} onChange={(event) => updateItem(index, "item_description", event.target.value)} /></label>
                </div>
                <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-sm shadow-sm sm:grid-cols-5"><p className="text-slate-500">Total<br /><b className="text-slate-950">{formatMeters(calculated.total_meters)}</b></p><p className="text-slate-500">Physical weight<br /><b className="text-slate-950">{formatWeight(calculated.total_weight_kg)}</b></p><p className="text-slate-500">Billing weight<br /><b className="text-slate-950">{formatWeight(calculated.billing_weight_kg)}</b></p><p className="text-slate-500">Profit<br /><b className={calculated.estimated_profit_amount < 0 ? "text-red-700" : "text-slate-950"}>{formatCurrency(calculated.estimated_profit_amount)} ({calculated.estimated_profit_percent.toFixed(2)}%)</b></p><p className="text-slate-500">Line total<br /><b className="text-slate-950">{formatCurrency(calculated.line_total_before_gst)}</b></p></div>
                {warnings.length ? <div className="mt-3 grid gap-2 md:grid-cols-2">{warnings.map((warning) => <div key={`${index}-${warning.code}`} className={warning.severity === "critical" ? "rounded-2xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800" : warning.severity === "warning" ? "rounded-2xl border border-orange-200 bg-orange-50 p-3 text-xs font-semibold text-orange-800" : "rounded-2xl border border-slate-200 bg-white p-3 text-xs font-semibold text-slate-600"}>{warning.message}</div>)}</div> : null}
              </div>;
            })}
          </div>
          <Button type="button" variant="secondary" className="mt-4" onClick={() => setItems([...items, { ...emptyItem }])}>Add item</Button>
          <div className="mt-5 grid gap-4 sm:grid-cols-3"><label className="block space-y-1.5"><span className="form-label">GST %</span><input className="form-input" type="number" value={form.gst_percent} onChange={(event) => setForm({ ...form, gst_percent: Number(event.target.value) })} /></label><div className="space-y-1.5 sm:col-span-2"><span className="form-label">Workflow status</span><div className="flex min-h-12 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4"><Badge value={editingId ? form.status : "draft"} /><span className="text-xs font-semibold text-slate-600">Use the workflow actions after saving. Changing an approved or sent quote creates a new draft revision.</span></div></div></div>
          {summary.low_margin_approval_required ? <div className="mt-4 rounded-3xl border border-orange-200 bg-orange-50 p-4 text-sm font-semibold text-orange-900">This quotation is below the configured minimum margin. Sales users can save it as draft/internal review, but owner/admin approval is required before sending.</div> : null}
          <label className="mt-4 block space-y-1.5"><span className="form-label">Terms and conditions</span><textarea className="form-input min-h-24" value={form.terms_and_conditions} onChange={(event) => setForm({ ...form, terms_and_conditions: event.target.value })} /></label>
          <label className="mt-4 block space-y-1.5"><span className="form-label">Approval/revision notes</span><textarea className="form-input min-h-16" value={form.approval_notes} onChange={(event) => setForm({ ...form, approval_notes: event.target.value })} /></label>
          <label className="mt-4 block space-y-1.5"><span className="form-label">Notes</span><textarea className="form-input min-h-20" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
          <div className="mt-5 flex gap-2"><Button disabled={saving || loading} onClick={saveQuote}>{saving ? "Saving..." : editingId ? "Update quote" : "Save quote"}</Button>{editingId ? <Button variant="secondary" onClick={() => setEditingId(null)}>Cancel edit</Button> : null}</div>
        </CardContent></Card>
        <Card className="h-fit 2xl:sticky 2xl:top-24"><CardContent><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Commercial summary</p><h2 className="section-title mt-1">Quote Summary</h2><div className="mt-4 space-y-3 text-sm font-medium"><div className="flex justify-between"><span className="text-slate-500">Physical weight</span><b>{formatWeight(summary.total_weight_kg)}</b></div><div className="flex justify-between"><span className="text-slate-500">Billing weight</span><b>{formatWeight(summary.total_billing_weight_kg)}</b></div><div className="flex justify-between"><span className="text-slate-500">Total meters</span><b>{formatMeters(summary.total_meters)}</b></div><div className="flex justify-between"><span className="text-slate-500">Subtotal</span><b>{formatCurrency(summary.subtotal)}</b></div><div className="flex justify-between"><span className="text-slate-500">Est. profit</span><b className={summary.estimated_profit_amount < 0 ? "text-red-700" : "text-slate-950"}>{formatCurrency(summary.estimated_profit_amount)} ({summary.estimated_profit_percent.toFixed(2)}%)</b></div><div className="flex justify-between"><span className="text-slate-500">GST</span><b>{formatCurrency(summary.gst_amount)}</b></div><div className="rounded-2xl bg-charcoal p-4 text-white shadow-premium"><div className="flex justify-between text-xl"><span>Grand total</span><b>{formatCurrency(summary.grand_total)}</b></div></div><div className="flex justify-between"><span className="text-slate-500">Avg price/kg</span><b>{formatCurrency(summary.average_price_per_kg)}</b></div><div className="flex justify-between"><span className="text-slate-500">Avg price/m</span><b>{formatCurrency(summary.average_price_per_meter)}</b></div>{summary.low_margin_approval_required ? <div className="rounded-2xl border border-orange-200 bg-orange-50 p-3 text-xs font-bold text-orange-800">Approval required below minimum margin</div> : null}</div></CardContent></Card>
      </div>}
      {mode === "form" ? null : (
      <Card className="mt-6"><CardContent><div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><h2 className="section-title">Saved quotes</h2><input className="form-input max-w-md" placeholder="Search quote number, customer, status..." value={search} onChange={(event) => setSearch(event.target.value)} /></div>{loading ? <LoadingState title="Loading saved quotes" description="Fetching quotation history for this company." /> : filteredQuotes.length ? <div className="overflow-x-auto"><table className="industrial-table min-w-[980px]"><thead><tr><th>Quote</th><th>Customer</th><th>Date</th><th>Valid until</th><th>Status</th><th>Profit</th><th>Total</th><th>Actions</th></tr></thead><tbody>{filteredQuotes.map((quote) => <tr key={quote.id}><td className="font-black text-slate-950">{quote.quote_number}<span className="ml-2 text-xs font-bold text-slate-400">Rev {quote.revision_number ?? 1}</span></td><td>{quote.customers?.company_name || quote.customers?.customer_name}</td><td>{formatDate(quote.quote_date)}</td><td>{formatDate(quote.valid_until)}</td><td><Badge value={quote.status} /> {quote.low_margin_approval_required ? <Badge value="internal_review" className="ml-1" /> : null}</td><td className={Number(quote.estimated_profit_amount ?? 0) < 0 ? "font-black text-red-700" : "font-black text-slate-950"}>{formatCurrency(quote.estimated_profit_amount ?? quote.total_margin_amount)}</td><td className="font-black text-slate-950">{formatCurrency(quote.grand_total)}</td><td className="space-x-1 whitespace-nowrap"><Button variant="ghost" onClick={() => editQuote(quote)}>Edit</Button><Button variant="ghost" onClick={() => updateStatus(quote, "internal_review")}>Review</Button><Button variant="ghost" onClick={() => updateStatus(quote, "approved_for_sending")}>Approve</Button><Button variant="ghost" onClick={() => updateStatus(quote, "sent")}>Sent</Button><Button variant="ghost" onClick={() => updateStatus(quote, "customer_approved")}>Won</Button><Button variant="ghost" onClick={() => convertToOrder(quote)}>Convert</Button><Button variant="ghost" onClick={() => copyWhatsapp(quote)}><Copy className="h-4 w-4" /></Button><a className="inline-flex rounded-xl px-3 py-2 text-sm font-bold text-slate-700 hover:bg-orange/10 hover:text-orange" href={`/api/pdf/quote/${quote.id}`} target="_blank"><Download className="h-4 w-4" /></a></td></tr>)}</tbody></table></div> : <EmptyState title="No quotes yet" description="Create a quotation with at least one profile item to start tracking sales value." />}</CardContent></Card>
      )}
    </div>
  );
}

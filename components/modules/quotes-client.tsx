"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { addDays } from "date-fns";
import { toast } from "sonner";
import { Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ProfileSelector } from "@/components/ui/profile-selector";
import { CustomerProfileAliasPicker } from "@/components/modules/operations/operator-tools";
import { canUseOperatorCommand, type ProfileAliasOption } from "@/lib/operations/operator-workflows";
import { InTaskCustomer } from "@/components/modules/customers/in-task-customer";
import { TaskGuidance } from "@/components/forms/task-guidance";
import { repeatQuoteAction } from "@/lib/actions/repeat-quote";
import { PageHeader } from "@/components/layout/page-header";
import { calculateQuoteItem, calculateQuoteSummary, getQuoteItemWarnings, type QuoteItemInput } from "@/lib/calculations/quote";
import { quoteSchema } from "@/lib/validations/schemas";
import { createClient } from "@/lib/supabase/browser";
import { formatCurrency, formatDate, formatMeters, formatWeight, todayIso } from "@/lib/utils/format";
import { getErrorMessage } from "@/lib/utils/errors";
import { can } from "@/lib/auth/permissions";
import { rowMatchesSearch } from "@/lib/utils/search";
import { canSaveQuoteDraft, duplicateQuoteDraftLine, getQuoteFormShortcut, runWithInFlightGuard } from "@/lib/forms/keyboard-entry";
import { buildQuotePasteLine, getPieceCalculationState, getQuotePasteFinishOptions, getQuotePasteLengthUnit, parseQuotePaste, validateQuotePasteRows, type QuotePasteRow } from "@/lib/forms/quote-paste";
import { saveQuoteAction, updateQuoteStatusAction } from "@/lib/actions/quotes-orders";
import { dieAmortizationTypes, labelize, type DieAmortizationType, type FinishingChargeType, type FinishingType, type QuoteStatus, type SessionContext } from "@/types/app";

type Customer = { id: string; customer_name: string; company_name: string | null; gst_number: string | null; billing_address: string | null; shipping_address: string | null };
type Profile = {
  id: string;
  profile_code: string;
  profile_name: string;
  section_weight_kg_per_m: number;
  section_perimeter_mm?: number | null;
  section_number?: string | null;
  section_code?: string | null;
  section_name?: string | null;
  cross_section_image_url?: string | null;
  circumscribing_circle_diameter_mm?: number | null;
  nominal_wall_thickness_mm?: number | null;
  number_of_voids?: number | null;
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
type Die = { id: string; die_number: string; profile_id: string; die_status: string; rack_location?: string | null };
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
  return [customer.company_name, customer.customer_name, customer.gst_number].filter(Boolean).join(" · ");
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

function mergeLookupRows<T extends { id: string }>(incoming: T[], current: T[], preservedIds: string[], limit = 60) {
  const preserved = new Set(preservedIds.filter(Boolean));
  const rows: T[] = [];
  const seen = new Set<string>();
  for (const row of [...current.filter((candidate) => preserved.has(candidate.id)), ...incoming, ...current]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
    if (rows.length >= limit && preservedIds.every((id) => !id || seen.has(id))) break;
  }
  return rows;
}

type QuotesClientProps = { context: SessionContext; mode?: "full" | "form"; initialEditId?: string; repeatFromId?: string };

export function QuotesClient(props: QuotesClientProps) {
  return <QuoteWorkspace key={JSON.stringify([props.context.companyId, props.context.userId, props.context.role, props.mode ?? "full", props.initialEditId ?? null, props.repeatFromId ?? null])} {...props} />;
}

function QuoteWorkspace({ context, mode = "full", initialEditId, repeatFromId }: QuotesClientProps) {
  const supabase = useMemo(() => createClient(), []);
  const customerCreationScope = JSON.stringify([context.companyId, context.userId, context.role]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [dies, setDies] = useState<Die[]>([]);
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [settings, setSettings] = useState<CompanySettingsRow | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const [profileSearchLoading, setProfileSearchLoading] = useState(false);
  const [dieSearchLoading, setDieSearchLoading] = useState(false);
  const profileSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dieSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quotePasteLookupVersion = useRef(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [repeatActive, setRepeatActive] = useState(Boolean(repeatFromId));
  const [repeatResult, setRepeatResult] = useState<Awaited<ReturnType<typeof repeatQuoteAction>> | null>(null);
  const [reviewedCopy, setReviewedCopy] = useState("");
  const [form, setForm] = useState({ customer_id: "", quote_date: todayIso(), valid_until: "", status: "draft" as QuoteStatus, gst_percent: 18, terms_and_conditions: "", delivery_timeline: "", payment_terms: "", approval_notes: "", notes: "" });
  const [items, setItems] = useState<FormItem[]>([{ ...emptyItem }]);
  const aliasSelectionVersion = useRef(0);
  const aliasSelectionContext = useRef({ customerId: form.customer_id, items });
  useEffect(() => { aliasSelectionContext.current = { customerId: form.customer_id, items }; }, [form.customer_id, items]);
  useEffect(() => { aliasSelectionVersion.current += 1; return () => { aliasSelectionVersion.current += 1; }; }, [form.customer_id]);
  const [quotePasteText, setQuotePasteText] = useState("");
  const [quotePasteRows, setQuotePasteRows] = useState<QuotePasteRow[]>([]);
  const [quotePasteProfiles, setQuotePasteProfiles] = useState<Profile[]>([]);
  const [quotePasteError, setQuotePasteError] = useState<string | null>(null);
  const [quotePasteLoading, setQuotePasteLoading] = useState(false);
  const saveGuard = useRef({ current: false });
  const lineContainerRef = useRef<HTMLDivElement>(null);
  const [focusLineIndex, setFocusLineIndex] = useState<number | null>(null);

  useEffect(() => {
    quotePasteLookupVersion.current += 1;
    setQuotePasteText("");
    setQuotePasteRows([]);
    setQuotePasteProfiles([]);
    setQuotePasteError(null);
    setQuotePasteLoading(false);
  }, [context.companyId, context.role, context.userId]);

  useEffect(() => () => {
    quotePasteLookupVersion.current += 1;
  }, []);

  const calculatedItems = items.map((item) => calculateQuoteItem({ ...item, perimeter_mm: profiles.find((profile) => profile.id === item.profile_id)?.section_perimeter_mm ?? item.perimeter_mm }));
  const summary = calculateQuoteSummary(calculatedItems, Number(form.gst_percent));
  const selectedCustomer = customers.find((customer) => customer.id === form.customer_id);
  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    const uniqueCustomers = mergeCustomers(customers, []);
    const matches = term ? uniqueCustomers.filter((customer) => customerLabel(customer).toLowerCase().includes(term)) : uniqueCustomers;
    const limitedMatches = matches.slice(0, 40);
    return selectedCustomer && !limitedMatches.some((customer) => customer.id === selectedCustomer.id) ? [selectedCustomer, ...limitedMatches] : limitedMatches;
  }, [customerSearch, customers, selectedCustomer]);
  const canApproveLowMargin = ["owner", "admin"].includes(context.role);
  const canManageQuoteCosting = ["owner", "admin"].includes(context.role);
  const canReadQuoteCosting = ["owner", "admin", "accounts"].includes(context.role);
  const canUpdateQuoteWorkflow = can(context.role, "update", "quotes");

  async function loadAll() {
    setLoading(true);
    const [customerResult, profileResult, dieResult, quoteResult, settingsResult] = await Promise.all([
      supabase.from("customers").select("id, customer_name, company_name, gst_number, billing_address, shipping_address").eq("company_id", context.companyId).order("customer_name").limit(40),
      supabase.from("aluminium_profiles").select("id, profile_code, profile_name, section_weight_kg_per_m, section_perimeter_mm, section_number, section_code, section_name, cross_section_image_url, circumscribing_circle_diameter_mm, nominal_wall_thickness_mm, number_of_voids, drawing_document_id, drawing_revision, drawing_approval_status, alloy_standard_id, alloy_id, temper_id, min_weight, max_weight, weight_tolerance, actual_weight_kg_per_m, standard_length, bundle_quantity, pieces_per_bundle, meter_per_bundle, kg_per_bundle").eq("company_id", context.companyId).eq("is_active", true).order("profile_code").limit(40),
      supabase.from("dies").select("id, die_number, profile_id, die_status, rack_location").eq("company_id", context.companyId).order("die_number").limit(40),
      supabase.from("quotes_authorized").select("*").eq("company_id", context.companyId).order("created_at", { ascending: false }).limit(100),
      supabase.from("company_settings_authorized").select("*").eq("company_id", context.companyId).maybeSingle()
    ]);
    setLoading(false);
    if (customerResult.error) toast.error(getErrorMessage(customerResult.error));
    if (profileResult.error) toast.error(getErrorMessage(profileResult.error));
    if (dieResult.error) toast.error(getErrorMessage(dieResult.error));
    if (quoteResult.error) toast.error(getErrorMessage(quoteResult.error));
    setCustomers(customerResult.data ?? []);
    setProfiles(profileResult.data ?? []);
    setDies(dieResult.data ?? []);
    const quoteRows = quoteResult.data ?? [];
    const quoteCustomerIds = Array.from(new Set(quoteRows.map((quote: any) => quote.customer_id).filter(Boolean)));
    const quoteCustomersResult = quoteCustomerIds.length
      ? await supabase.from("customers").select("id, customer_name, company_name").eq("company_id", context.companyId).in("id", quoteCustomerIds)
      : { data: [], error: null };
    if (quoteCustomersResult.error) toast.error(getErrorMessage(quoteCustomersResult.error));
    const quoteCustomers = new Map((quoteCustomersResult.data ?? []).map((customer: any) => [customer.id, customer]));
    setQuotes(quoteRows.map((quote: any) => ({ ...quote, customers: quoteCustomers.get(quote.customer_id) ?? null })));
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

  useEffect(() => {
    let cancelled = false;
    void loadAll().then(async () => {
      if (!repeatFromId || cancelled) return;
      try {
        const result = await repeatQuoteAction(repeatFromId);
        if (cancelled) return;
        setRepeatResult(result);
        if (result.success) {
          setForm(result.draft.form);
          setItems(result.draft.items.map((item) => ({ ...emptyItem, ...item, die_id: item.die_id ?? "", item_description: item.item_description ?? "" })));
          setCustomers((current) => mergeCustomers(current, [result.customer]));
          setProfiles((current) => mergeLookupRows<Profile>(result.profiles, current, result.profiles.map((profile) => profile.id), 120));
          setCustomerSearch(customerLabel(result.customer));
        }
      } catch { if (!cancelled) setRepeatResult({ success: false, error: "Could not load the previous quotation. No new quotation was saved." }); }
    });
    return () => { cancelled = true; };
  }, []);

  const copyFingerprint = JSON.stringify({ form, items, specifications: items.map((item) => { const profile = profiles.find((candidate) => candidate.id === item.profile_id); return profile ? [profile.id, profile.section_weight_kg_per_m, profile.section_perimeter_mm, profile.drawing_revision] : null; }) });

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
      const incoming = [...(gstExactResult.data ?? []), ...(gstPartialResult.data ?? []), ...(broadResult.data ?? [])];
      setCustomers((current) => mergeLookupRows(incoming, current, [form.customer_id], 60));
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [customerSearch, context.companyId, form.customer_id, supabase]);

  function searchProfiles(query: string) {
    if (profileSearchTimer.current) clearTimeout(profileSearchTimer.current);
    const term = cleanCustomerSearch(query);
    if (!term) return setProfileSearchLoading(false);
    setProfileSearchLoading(true);
    profileSearchTimer.current = setTimeout(async () => {
      const { data, error } = await supabase
        .from("aluminium_profiles")
        .select("id, profile_code, profile_name, section_weight_kg_per_m, section_perimeter_mm, section_number, section_code, section_name, cross_section_image_url, circumscribing_circle_diameter_mm, nominal_wall_thickness_mm, number_of_voids, drawing_document_id, drawing_revision, drawing_approval_status, alloy_standard_id, alloy_id, temper_id, min_weight, max_weight, weight_tolerance, actual_weight_kg_per_m, standard_length, bundle_quantity, pieces_per_bundle, meter_per_bundle, kg_per_bundle")
        .eq("company_id", context.companyId)
        .eq("is_active", true)
        .or(`profile_code.ilike.*${term}*,profile_name.ilike.*${term}*,section_number.ilike.*${term}*,section_code.ilike.*${term}*`)
        .order("profile_code")
        .limit(30);
      setProfileSearchLoading(false);
      if (error) return toast.error(getErrorMessage(error, "Could not search profiles"));
      setProfiles((current) => mergeLookupRows<Profile>((data ?? []) as Profile[], current, items.map((item) => item.profile_id), 70));
    }, 250);
  }

  function searchDies(query: string, profileId: string) {
    if (dieSearchTimer.current) clearTimeout(dieSearchTimer.current);
    const term = cleanCustomerSearch(query);
    setDieSearchLoading(true);
    dieSearchTimer.current = setTimeout(async () => {
      let request = supabase
        .from("dies")
        .select("id, die_number, profile_id, die_status, rack_location")
        .eq("company_id", context.companyId);
      if (profileId) request = request.eq("profile_id", profileId);
      if (term) request = request.or(`die_number.ilike.*${term}*,rack_location.ilike.*${term}*`);
      const { data, error } = await request.order("die_number").limit(30);
      setDieSearchLoading(false);
      if (error) return toast.error(getErrorMessage(error, "Could not search dies"));
      setDies((current) => mergeLookupRows<Die>((data ?? []) as Die[], current, items.map((item) => item.die_id), 70));
    }, 250);
  }

  useEffect(() => () => {
    if (profileSearchTimer.current) clearTimeout(profileSearchTimer.current);
    if (dieSearchTimer.current) clearTimeout(dieSearchTimer.current);
  }, []);

  function updateItem(index: number, key: keyof FormItem, value: string | number, verifiedProfile?: Profile) {
    if (key === "profile_id") searchDies("", String(value));
    setItems((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const next = { ...item, [key]: value } as FormItem;
      if (key === "profile_id") {
        const profile = verifiedProfile ?? profiles.find((candidate) => candidate.id === value);
        next.section_weight_kg_per_m = profile?.section_weight_kg_per_m ?? 0;
        next.perimeter_mm = profile?.section_perimeter_mm ?? null;
        next.item_description = profile ? `${profile.profile_code} - ${profile.profile_name}` : "";
        next.die_id = "";
      }
      if (key === "die_id") {
        const die = dies.find((candidate) => candidate.id === value);
        if (die && ["inactive", "dead"].includes(die.die_status)) toast.warning(`Selected die is ${labelize(die.die_status)}. Confirm before quoting.`);
      }
      return next;
    }));
  }

  async function selectCustomerProfileAlias(index: number, option: ProfileAliasOption) {
    const request = ++aliasSelectionVersion.current;
    const target = items[index], customerId = form.customer_id;
    const { data, error } = await supabase.from("aluminium_profiles")
      .select("id, profile_code, profile_name, section_weight_kg_per_m, section_perimeter_mm, section_number, section_code, section_name, cross_section_image_url, circumscribing_circle_diameter_mm, nominal_wall_thickness_mm, number_of_voids, drawing_document_id, drawing_revision, drawing_approval_status, alloy_standard_id, alloy_id, temper_id, min_weight, max_weight, weight_tolerance, actual_weight_kg_per_m, standard_length, bundle_quantity, pieces_per_bundle, meter_per_bundle, kg_per_bundle")
      .eq("company_id", context.companyId).eq("is_active", true).eq("id", option.profile_id).maybeSingle();
    if (error || !data || request !== aliasSelectionVersion.current || customerId !== aliasSelectionContext.current.customerId || target !== aliasSelectionContext.current.items[index]) throw new Error("The profile or quotation line changed before selection");
    setProfiles(current => mergeLookupRows<Profile>([data as Profile], current, items.map(item => item.profile_id), 120));
    updateItem(index, "profile_id", data.id, data as Profile);
  }

  function parseQuotePasteInput(value: string) {
    quotePasteLookupVersion.current += 1;
    setQuotePasteLoading(false);
    setQuotePasteText(value);
    const result = parseQuotePaste(value);
    setQuotePasteRows(result.rows);
    setQuotePasteError(result.error);
    setQuotePasteProfiles([]);
  }

  async function resolveQuotePasteProfiles(rows: QuotePasteRow[] = quotePasteRows) {
    const codes = Array.from(new Set(rows.map((row) => row.profileCode.trim()).filter(Boolean)));
    if (!codes.length) return setQuotePasteError("Paste profile codes before looking them up.");
    const requestVersion = ++quotePasteLookupVersion.current;
    setQuotePasteLoading(true);
    setQuotePasteError(null);
    setQuotePasteProfiles([]);
    try {
      const { data, error } = await supabase
        .from("aluminium_profiles")
        .select("id, profile_code, profile_name, section_weight_kg_per_m, section_perimeter_mm, section_number, section_code, section_name, cross_section_image_url, circumscribing_circle_diameter_mm, nominal_wall_thickness_mm, number_of_voids, drawing_document_id, drawing_revision, drawing_approval_status, alloy_standard_id, alloy_id, temper_id, min_weight, max_weight, weight_tolerance, actual_weight_kg_per_m, standard_length, bundle_quantity, pieces_per_bundle, meter_per_bundle, kg_per_bundle")
        .eq("company_id", context.companyId)
        .eq("is_active", true)
        .in("profile_code", codes.slice(0, 100))
        .order("profile_code")
        .limit(100);
      if (requestVersion !== quotePasteLookupVersion.current) return;
      if (error) {
        setQuotePasteProfiles([]);
        setQuotePasteError(getErrorMessage(error, "Could not resolve pasted profile codes."));
        return;
      }
      setQuotePasteProfiles((data ?? []) as Profile[]);
      setProfiles((current) => mergeLookupRows<Profile>((data ?? []) as Profile[], current, items.map((item) => item.profile_id), 120));
      setQuotePasteError(codes.length > 100 ? "Only the first 100 distinct profile codes were checked. Split the paste into smaller batches." : null);
    } catch (error) {
      if (requestVersion === quotePasteLookupVersion.current) {
        setQuotePasteProfiles([]);
        setQuotePasteError(getErrorMessage(error, "Could not resolve pasted profile codes."));
      }
    } finally {
      if (requestVersion === quotePasteLookupVersion.current) setQuotePasteLoading(false);
    }
  }

  function updateQuotePasteRow(index: number, key: "profileCode" | "lengthValue" | "quantityValue" | "finish", value: string) {
    setQuotePasteRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  }

  function removeQuotePasteExtraCells(index: number) {
    setQuotePasteRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, extraValues: [] } : row));
  }

  function importQuotePasteRows() {
    const unit = getQuotePasteLengthUnit(quotePasteText);
    if (!unit || quotePasteError) return;
    const validated = validateQuotePasteRows(quotePasteRows, quotePasteProfiles, unit);
    if (!validated.length || validated.some((row) => row.errors.length)) return;
    const base: FormItem = {
      ...emptyItem,
      conversion_charge_per_kg: settings?.default_conversion_charge_per_kg ?? 0,
      packing_charge: settings?.default_packing_charge ?? 0,
      transport_charge: settings?.default_transport_charge ?? 0,
      margin_percent: settings?.default_margin_percent ?? 10,
      minimum_margin_percent: settings?.minimum_margin_percent ?? 8,
    };
    const lines = validated.map((row) => buildQuotePasteLine(base, row) as FormItem | null);
    if (lines.some((line) => !line)) return;
    setItems((current) => [...current, ...(lines as FormItem[])]);
    setFocusLineIndex(items.length);
    setQuotePasteText("");
    setQuotePasteRows([]);
    setQuotePasteProfiles([]);
    setQuotePasteError(null);
  }

  async function saveQuote() {
    return runWithInFlightGuard(saveGuard.current, async () => {
      try {
        if (repeatActive && reviewedCopy !== copyFingerprint) return toast.error("Review the copied rates, specifications, and commercial terms before saving this new quotation.");
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
        if (!result.success) return toast.error(result.error);
        toast.success("Quote saved");
        setRepeatActive(false);
        setEditingId(null);
        setItems([{ ...emptyItem }]);
        setCustomerSearch("");
        setForm((current) => ({ ...current, customer_id: "", status: "draft", approval_notes: "", notes: "" }));
        await loadAll();
      } finally {
        setSaving(false);
      }
    });
  }

  function addLine() {
    setItems((current) => {
      setFocusLineIndex(current.length);
      return [...current, { ...emptyItem }];
    });
  }

  function duplicateLine() {
    const active = document.activeElement;
    const lineElement = active instanceof HTMLElement ? active.closest<HTMLElement>("[data-quote-line]") : null;
    const index = lineElement ? Number(lineElement.dataset.quoteLine) : focusLineIndex ?? items.length - 1;
    const source = items[index];
    if (!source) return;
    setItems((current) => {
      const insertAt = index + 1;
      const next = [...current];
      next.splice(insertAt, 0, duplicateQuoteDraftLine(source) as FormItem);
      setFocusLineIndex(insertAt);
      return next;
    });
  }

  useEffect(() => {
    if (focusLineIndex == null) return;
    lineContainerRef.current?.querySelector<HTMLElement>(`[data-quote-line="${focusLineIndex}"] input`)?.focus();
    setFocusLineIndex(null);
  }, [focusLineIndex, items.length]);

  function handleQuoteEditorKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const shortcut = getQuoteFormShortcut({
      key: event.key,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      isComposing: event.nativeEvent.isComposing,
      repeat: event.repeat,
      defaultPrevented: event.defaultPrevented,
      targetIsContentEditable: event.target instanceof HTMLElement && event.target.isContentEditable,
    });
    if (!shortcut) return;
    event.preventDefault();
    if (shortcut === "add-line") addLine();
    if (shortcut === "duplicate-line") duplicateLine();
    if (shortcut === "save-draft") {
      if (!canSaveQuoteDraft(form.status, Boolean(editingId))) return toast.error("A draft cannot be saved from this quote workflow state.");
      void saveQuote();
    }
  }

  async function editQuote(quote: QuoteRow) {
    if (!canManageQuoteCosting) return toast.error("Only owners and admins can edit priced quote lines. Ask an owner or admin to revise this quote.");
    const { data, error } = await supabase.from("quote_items_authorized").select("*").eq("quote_id", quote.id).eq("company_id", context.companyId).order("created_at");
    if (error) return toast.error(getErrorMessage(error));
    const quoteItems = data ?? [];
    const profileIds = Array.from(new Set(quoteItems.map((item: any) => item.profile_id).filter(Boolean))) as string[];
    const dieIds = Array.from(new Set(quoteItems.map((item: any) => item.die_id).filter(Boolean))) as string[];
    const [customerResult, profileResult, dieResult] = await Promise.all([
      supabase.from("customers").select("id, customer_name, company_name, gst_number, billing_address, shipping_address").eq("company_id", context.companyId).eq("id", quote.customer_id).maybeSingle(),
      profileIds.length
        ? supabase.from("aluminium_profiles").select("id, profile_code, profile_name, section_weight_kg_per_m, section_perimeter_mm, section_number, section_code, section_name, cross_section_image_url, circumscribing_circle_diameter_mm, nominal_wall_thickness_mm, number_of_voids, drawing_document_id, drawing_revision, drawing_approval_status, alloy_standard_id, alloy_id, temper_id, min_weight, max_weight, weight_tolerance, actual_weight_kg_per_m, standard_length, bundle_quantity, pieces_per_bundle, meter_per_bundle, kg_per_bundle").eq("company_id", context.companyId).in("id", profileIds)
        : Promise.resolve({ data: [], error: null }),
      dieIds.length
        ? supabase.from("dies").select("id, die_number, profile_id, die_status, rack_location").eq("company_id", context.companyId).in("id", dieIds)
        : Promise.resolve({ data: [], error: null })
    ]);
    const selectedLookupError = customerResult.error ?? profileResult.error ?? dieResult.error;
    if (selectedLookupError) return toast.error(getErrorMessage(selectedLookupError, "Could not load the quote's selected records"));
    const selectedCustomerRow = customerResult.data as Customer | null;
    if (selectedCustomerRow) setCustomers((current) => mergeLookupRows<Customer>([selectedCustomerRow], current, [quote.customer_id], 60));
    setProfiles((current) => mergeLookupRows<Profile>((profileResult.data ?? []) as Profile[], current, profileIds, 70));
    setDies((current) => mergeLookupRows<Die>((dieResult.data ?? []) as Die[], current, dieIds, 70));
    setEditingId(quote.id);
    setForm({ customer_id: quote.customer_id, quote_date: quote.quote_date, valid_until: quote.valid_until ?? "", status: quote.status, gst_percent: quote.gst_percent, terms_and_conditions: quote.terms_and_conditions ?? "", delivery_timeline: quote.delivery_timeline ?? "", payment_terms: quote.payment_terms ?? "", approval_notes: quote.approval_notes ?? "", notes: quote.notes ?? "" });
    const customer = selectedCustomerRow ?? customers.find((candidate) => candidate.id === quote.customer_id);
    setCustomerSearch(customer ? customerLabel(customer) : "");
    setItems(quoteItems.map((item: any) => ({ ...emptyItem, ...item, die_id: item.die_id ?? "", item_description: item.item_description ?? "", sales_price_override: item.sales_price_override ?? null, die_amortization_type: item.die_amortization_type ?? "full_die_charge" })));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  useEffect(() => {
    if (!initialEditId || loading || editingId) return;
    async function loadInitialEdit() {
      const existing = quotes.find((quote) => quote.id === initialEditId);
      if (existing) return editQuote(existing);
      const { data, error } = await supabase.from("quotes_authorized").select("*").eq("id", initialEditId).eq("company_id", context.companyId).single();
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
      <PageHeader title={mode === "form" ? "Create Quote" : "Quotations"} description={canManageQuoteCosting ? "Prepare priced aluminium extrusion quotations with controlled costing, GST, and PDF output." : "Review company quotations, continue approved workflow steps, and share customer-ready PDFs."} />
      {loading || (repeatActive && !repeatResult) ? <LoadingState title="Loading quotations" description="Fetching customers, profiles, dies, defaults, and saved quotes." /> : repeatActive && repeatResult && !repeatResult.success ? <Card><CardContent><p role="alert" className="text-sm text-red-700">{repeatResult.error}</p><Link href="/quotes/new" className="mt-4 inline-block text-sm font-bold underline">Start a blank quotation</Link></CardContent></Card> : canManageQuoteCosting ? <div className="grid gap-6 2xl:grid-cols-[1fr_440px]" onKeyDown={handleQuoteEditorKeyDown}>
        <Card><CardContent>
          <div className="mb-5 flex flex-col gap-2 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="section-title">Quote creation</h2>
              <p className="mt-1 text-sm font-medium text-slate-500">Build aluminium extrusion pricing with live weight, meter, margin, and GST totals.</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">Keyboard: Ctrl+Alt+A add line · Ctrl+Alt+D duplicate current line · Ctrl+Alt+S {canSaveQuoteDraft(form.status, Boolean(editingId)) ? "save draft" : "draft save unavailable for this workflow state"}</p>
            </div>
            {editingId ? <Badge value="draft" className="w-fit" /> : null}
          </div>
          <div className="mb-5"><TaskGuidance task="quotation" /></div>
          {repeatActive && repeatResult?.success ? <section aria-label="Review repeated quotation" className="mb-5 space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><h3 className="font-black">New draft from {repeatResult.sourceNumber}</h3><p>Lines, quantities, finishes, terms, and price inputs were copied for review. Dates and profile section weights were refreshed; die assignments and die charges were cleared. The original quotation and its issued documents are unchanged.</p><p className="font-bold">{repeatResult.draft.expired ? "The source quotation has expired. Its copied rates require a fresh commercial review." : "Copied prices are unverified suggestions. Review current rates and availability before saving."}</p><label className="flex items-start gap-2"><input type="checkbox" className="mt-1 h-4 w-4" checked={reviewedCopy === copyFingerprint} onChange={(event) => setReviewedCopy(event.target.checked ? copyFingerprint : "")} /><span>I reviewed the copied rates, current specifications, and commercial terms. Any further edit requires another review.</span></label></section> : null}
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="sm:col-span-2"><label className="block space-y-1.5"><span className="form-label">Customer *</span><input className="form-input" placeholder="Search customer name, company, or GST..." value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} /><SearchableSelect value={form.customer_id} placeholder={filteredCustomers.length ? "Select customer" : customerSearchLoading ? "Searching customers..." : "No matching customers"} options={filteredCustomers.map((customer) => ({ value: customer.id, label: customerLabel(customer) }))} onChange={(nextValue) => { const customer = customers.find((candidate) => candidate.id === nextValue); setForm({ ...form, customer_id: nextValue }); setCustomerSearch(customer ? customerLabel(customer) : ""); }} />{selectedCustomer ? <p className="text-xs font-semibold text-slate-500">Selected: {customerLabel(selectedCustomer)}</p> : customerSearchLoading ? <p className="text-xs font-semibold text-slate-500">Searching customer database...</p> : null}</label><InTaskCustomer key={`${customerCreationScope}:${editingId ?? "new"}`} context={context} onSelected={(customer) => { setCustomers((current) => mergeCustomers(current, [customer])); setForm((current) => ({ ...current, customer_id: customer.id })); setCustomerSearch(customerLabel(customer)); }} /></div>
            <label className="block space-y-1.5"><span className="form-label">Quote date</span><input className="form-input" type="date" value={form.quote_date} onChange={(event) => setForm({ ...form, quote_date: event.target.value })} /></label>
            <label className="block space-y-1.5"><span className="form-label">Valid until</span><input className="form-input" type="date" value={form.valid_until} onChange={(event) => setForm({ ...form, valid_until: event.target.value })} /></label>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5"><span className="form-label">Delivery timeline</span><input className="form-input" placeholder="Example: 10-12 working days after approval" value={form.delivery_timeline} onChange={(event) => setForm({ ...form, delivery_timeline: event.target.value })} /></label>
            <label className="block space-y-1.5"><span className="form-label">Payment terms</span><input className="form-input" placeholder="Example: 50% advance, balance before dispatch" value={form.payment_terms} onChange={(event) => setForm({ ...form, payment_terms: event.target.value })} /></label>
          </div>
          <section aria-labelledby="quote-paste-title" className="mt-6 rounded-3xl border border-orange/30 bg-orange/5 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 id="quote-paste-title" className="font-black text-slate-950">Paste line items from Excel</h3>
                <p className="mt-1 max-w-3xl text-xs font-medium leading-5 text-slate-600">Include headers <b>Profile Code</b>, <b>Quantity (pcs)</b>, and exactly one of <b>Length (m)</b> or <b>Length (mm)</b>. Optional Finish accepts Mill finish, Powder coating, Anodizing, Wood finish, PVDF, or Other. Paste only previews; no draft changes occur until you import all valid rows.</p>
              </div>
              {quotePasteRows.length ? <Button type="button" variant="secondary" disabled={quotePasteLoading} onClick={() => void resolveQuotePasteProfiles()}>{quotePasteLoading ? "Checking profiles..." : "Check profile codes"}</Button> : null}
            </div>
            <label className="mt-3 block space-y-1.5"><span className="form-label">Excel rows</span><textarea aria-label="Paste quote lines from Excel" className="form-input min-h-24 font-mono text-xs" placeholder={'Profile Code\tQuantity (pcs)\tLength (m)\tFinish\nAL-101\t100\t6\tMill finish'} value={quotePasteText} onChange={(event) => parseQuotePasteInput(event.target.value)} /></label>
            {quotePasteError ? <p role="alert" className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{quotePasteError}</p> : null}
            {quotePasteRows.length ? (() => {
              const unit = getQuotePasteLengthUnit(quotePasteText);
              const results = unit ? validateQuotePasteRows(quotePasteRows, quotePasteProfiles, unit) : [];
              const validCount = results.filter((row) => row.errors.length === 0).length;
              const ready = results.length > 0 && validCount === results.length && !loading && !quotePasteLoading && !quotePasteError;
              return <>
                <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                  <table className="w-full min-w-[760px] text-left text-xs">
                    <caption className="sr-only">Editable quote line preview with row validation status</caption>
                    <thead className="bg-slate-100 text-slate-600"><tr><th className="p-2">Row</th><th className="p-2">Profile code</th><th className="p-2">Quantity (pcs)</th><th className="p-2">Length ({unit ?? "unit required"})</th><th className="p-2">Finish</th><th className="p-2">Check</th></tr></thead>
                    <tbody>{results.map((row, index) => <tr key={row.sourceRow} className="border-t border-slate-100 align-top">
                      <td className="p-2 font-bold text-slate-500">{row.sourceRow}</td>
                      <td className="p-2"><input aria-label={`Row ${row.sourceRow} profile code`} className="form-input min-w-32 py-2 text-xs" value={quotePasteRows[index].profileCode} onChange={(event) => { quotePasteLookupVersion.current += 1; setQuotePasteProfiles([]); setQuotePasteLoading(false); updateQuotePasteRow(index, "profileCode", event.target.value); }} /></td>
                      <td className="p-2"><input aria-label={`Row ${row.sourceRow} quantity in pieces`} className="form-input min-w-24 py-2 text-xs" inputMode="numeric" value={quotePasteRows[index].quantityValue} onChange={(event) => updateQuotePasteRow(index, "quantityValue", event.target.value)} /></td>
                      <td className="p-2"><input aria-label={`Row ${row.sourceRow} length in ${unit ?? "source unit"}`} className="form-input min-w-24 py-2 text-xs" inputMode="decimal" value={quotePasteRows[index].lengthValue} onChange={(event) => updateQuotePasteRow(index, "lengthValue", event.target.value)} /></td>
                      <td className="p-2"><select aria-label={`Row ${row.sourceRow} finish`} className="form-input min-w-32 py-2 text-xs" value={quotePasteRows[index].finish} onChange={(event) => updateQuotePasteRow(index, "finish", event.target.value)}>{getQuotePasteFinishOptions(quotePasteRows[index].finish).map((finish) => <option key={finish.value} value={finish.value}>{finish.label}</option>)}</select></td>
                      <td className="max-w-64 p-2">{row.errors.length ? <><ul role="alert" className="list-disc space-y-1 pl-4 text-red-700">{row.errors.map((error) => <li key={error}>{error}</li>)}</ul>{quotePasteRows[index].extraValues?.length ? <><p className="mt-1 break-all text-slate-600">Extra cells: {quotePasteRows[index].extraValues.join(" | ")}</p><button type="button" className="mt-1 font-bold text-orange underline" onClick={() => removeQuotePasteExtraCells(index)}>Remove extra cells</button></> : null}</> : <span className="font-bold text-emerald-700">{row.profile?.profile_code} · {row.profile?.section_weight_kg_per_m ? `${row.profile.section_weight_kg_per_m} kg/m` : "kg/m missing"}</span>}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p aria-live="polite" className="text-xs font-semibold text-slate-600">{loading ? "Loading company quote defaults; import will be enabled when ready. " : ""}{validCount} of {results.length} rows valid{unit === "mm" ? "; lengths convert from mm to m" : unit === "m" ? "; lengths are in metres" : "; declare length units in the header"}.</p>
                  <Button type="button" disabled={!ready} onClick={importQuotePasteRows}>Import {results.length} lines into draft</Button>
                </div>
              </>;
            })() : null}
          </section>
          <div ref={lineContainerRef} className="mt-6 space-y-5">
            {items.map((item, index) => {
              const calculated = calculatedItems[index];
              const profile = profiles.find((candidate) => candidate.id === item.profile_id);
              const pieceState = getPieceCalculationState({ quantityPieces: item.quantity_pieces, lengthPerPieceM: item.length_per_piece_m, sectionWeightKgPerM: item.section_weight_kg_per_m, hasSelectedProfile: Boolean(profile), profileMasterSectionWeightKgPerM: profile?.section_weight_kg_per_m });
              const compatibleDies = dies.filter((die) => !item.profile_id || die.profile_id === item.profile_id);
              const selectedDie = dies.find((die) => die.id === item.die_id);
              const warnings = getQuoteItemWarnings(calculated, { dieStatus: selectedDie?.die_status, customerGstNumber: selectedCustomer?.gst_number, defaultConversionChargePerKg: settings?.default_conversion_charge_per_kg, quoteValidUntil: form.valid_until });
              return <div key={index} data-quote-line={index} className="rounded-3xl border border-slate-200 bg-gradient-to-br from-aluminium/70 to-white p-4 shadow-sm">
                <div className="mb-4 flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-[0.14em] text-orange">Extrusion item</p><h3 className="mt-1 font-black text-slate-950">Item {index + 1}</h3></div>{items.length > 1 ? <Button variant="ghost" type="button" onClick={() => setItems(items.filter((_, itemIndex) => itemIndex !== index))}>Remove</Button> : null}</div>
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="space-y-1.5 md:col-span-2"><label className="block space-y-1.5"><span className="form-label">Profile *</span><ProfileSelector value={item.profile_id} profiles={profiles} companyId={context.companyId} onChange={(nextValue) => updateItem(index, "profile_id", nextValue)} onSearchChange={searchProfiles} searching={profileSearchLoading} /></label>{form.customer_id && !context.dealerId && canUseOperatorCommand(context.role, "aliases.search") ? <CustomerProfileAliasPicker key={`${context.companyId}:${context.userId}:${context.role}:${form.customer_id}:${index}`} customerId={form.customer_id} onSelect={option => selectCustomerProfileAlias(index, option)} /> : null}</div>
                  <label className="block space-y-1.5"><span className="form-label">Die</span><SearchableSelect value={item.die_id} placeholder={item.profile_id ? "Search compatible die" : "Select a profile first"} options={compatibleDies.map((die) => ({ value: die.id, label: `${die.die_number} · ${labelize(die.die_status)}` }))} onChange={(nextValue) => updateItem(index, "die_id", nextValue)} onSearchChange={(query) => searchDies(query, item.profile_id)} searching={dieSearchLoading} disabled={!item.profile_id} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Qty pcs</span><input className="form-input" type="number" inputMode="numeric" min="1" value={item.quantity_pieces} onChange={(event) => updateItem(index, "quantity_pieces", Number(event.target.value))} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Length m</span><input className="form-input" type="number" inputMode="decimal" min="0" step="0.001" value={item.length_per_piece_m} onChange={(event) => updateItem(index, "length_per_piece_m", Number(event.target.value))} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Kg/m</span><input className="form-input" type="number" inputMode="decimal" min="0" step="0.001" value={item.section_weight_kg_per_m} onChange={(event) => updateItem(index, "section_weight_kg_per_m", Number(event.target.value))} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Additional handling/offcut allowance %</span><input className="form-input" type="number" inputMode="decimal" min="0" step="0.01" value={item.scrap_allowance_percent ?? 0} onChange={(event) => updateItem(index, "scrap_allowance_percent", Number(event.target.value))} /></label>
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
                  <label className="block space-y-1.5"><span className="form-label">Margin on selling price %</span><input className="form-input" type="number" inputMode="decimal" min="0" max="99.99" step="0.01" value={item.margin_percent} onChange={(event) => updateItem(index, "margin_percent", Number(event.target.value))} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Line GST % (blank uses quote rate)</span><input className="form-input" type="number" min="0" max="100" step="0.01" value={item.gst_percent ?? ""} onChange={(event) => setItems((current) => current.map((line, i) => i === index ? { ...line, gst_percent: event.target.value === "" ? null : Number(event.target.value) } : line))} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Min margin %</span><input className="form-input" type="number" inputMode="decimal" min="0" value={item.minimum_margin_percent ?? 0} onChange={(event) => updateItem(index, "minimum_margin_percent", Number(event.target.value))} /></label>
                  <label className="block space-y-1.5"><span className="form-label">Sales override</span><input className="form-input" type="number" inputMode="decimal" min="0" value={item.sales_price_override ?? ""} onChange={(event) => updateItem(index, "sales_price_override", event.target.value === "" ? 0 : Number(event.target.value))} /></label>
                  <label className="block space-y-1.5 md:col-span-4"><span className="form-label">Description</span><input className="form-input" value={item.item_description} onChange={(event) => updateItem(index, "item_description", event.target.value)} /></label>
                </div>
                <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-sm shadow-sm sm:grid-cols-5"><p className="text-slate-500">Total metres<br /><b className="text-slate-950">{pieceState.source === "invalid" ? "Not calculated" : formatMeters(calculated.total_meters)}</b></p><p className="text-slate-500">Theoretical weight<br /><b className="text-slate-950">{pieceState.source === "missing" || pieceState.source === "invalid" ? "Not available" : formatWeight(calculated.total_weight_kg)}</b></p><p className="text-slate-500">Billing weight<br /><b className="text-slate-950">{formatWeight(calculated.billing_weight_kg)}</b></p><p className="text-slate-500">Profit<br /><b className={calculated.estimated_profit_amount < 0 ? "text-red-700" : "text-slate-950"}>{formatCurrency(calculated.estimated_profit_amount)} ({calculated.estimated_profit_percent.toFixed(2)}%)</b></p><p className="text-slate-500">Line total<br /><b className="text-slate-950">{formatCurrency(calculated.line_total_before_gst)}</b></p></div>
                <p aria-live="polite" className={pieceState.message ? "mt-2 rounded-xl border border-orange-200 bg-orange-50 p-3 text-xs font-semibold text-orange-900" : "mt-2 text-xs font-semibold text-slate-500"}>{pieceState.message ?? (pieceState.source === "profile-master" ? `Theoretical quantity: ${formatMeters(calculated.total_meters)} x ${item.section_weight_kg_per_m} kg/m from the company profile master = ${formatWeight(calculated.total_weight_kg)}. Measured weight is recorded separately and is not changed here.` : pieceState.source === "manual" ? `Theoretical quantity uses the manually entered ${item.section_weight_kg_per_m} kg/m. Measured weight is recorded separately and is not changed here.` : pieceState.source === "invalid" ? "Calculation unavailable until piece count and cut length are valid." : "Calculation unavailable until a valid section weight source is provided.")}</p>
                {warnings.length ? <div className="mt-3 grid gap-2 md:grid-cols-2">{warnings.map((warning) => <div key={`${index}-${warning.code}`} className={warning.severity === "critical" ? "rounded-2xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800" : warning.severity === "warning" ? "rounded-2xl border border-orange-200 bg-orange-50 p-3 text-xs font-semibold text-orange-800" : "rounded-2xl border border-slate-200 bg-white p-3 text-xs font-semibold text-slate-600"}>{warning.message}</div>)}</div> : null}
              </div>;
            })}
          </div>
          <Button type="button" variant="secondary" className="mt-4" onClick={addLine}>Add item</Button>
          <div className="mt-5 grid gap-4 sm:grid-cols-3"><label className="block space-y-1.5"><span className="form-label">GST %</span><input className="form-input" type="number" value={form.gst_percent} onChange={(event) => setForm({ ...form, gst_percent: Number(event.target.value) })} /></label><div className="space-y-1.5 sm:col-span-2"><span className="form-label">Workflow status</span><div className="flex min-h-12 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4"><Badge value={editingId ? form.status : "draft"} /><span className="text-xs font-semibold text-slate-600">Use the workflow actions after saving. Changing an approved or sent quote creates a new draft revision.</span></div></div></div>
          {summary.low_margin_approval_required ? <div className="mt-4 rounded-3xl border border-orange-200 bg-orange-50 p-4 text-sm font-semibold text-orange-900">This quotation is below the configured minimum margin. Sales users can save it as draft/internal review, but owner/admin approval is required before sending.</div> : null}
          <label className="mt-4 block space-y-1.5"><span className="form-label">Terms and conditions</span><textarea className="form-input min-h-24" value={form.terms_and_conditions} onChange={(event) => setForm({ ...form, terms_and_conditions: event.target.value })} /></label>
          <label className="mt-4 block space-y-1.5"><span className="form-label">Approval/revision notes</span><textarea className="form-input min-h-16" value={form.approval_notes} onChange={(event) => setForm({ ...form, approval_notes: event.target.value })} /></label>
          <label className="mt-4 block space-y-1.5"><span className="form-label">Notes</span><textarea className="form-input min-h-20" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
          <div className="mt-5 flex gap-2"><Button disabled={saving || loading} onClick={saveQuote}>{saving ? "Saving..." : editingId ? "Update quote" : "Save quote"}</Button>{editingId ? <Button variant="secondary" onClick={() => setEditingId(null)}>Cancel edit</Button> : null}</div>
        </CardContent></Card>
        <Card className="h-fit 2xl:sticky 2xl:top-24"><CardContent><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Commercial summary</p><h2 className="section-title mt-1">Quote Summary</h2><div className="mt-4 space-y-3 text-sm font-medium"><div className="flex justify-between"><span className="text-slate-500">Physical weight</span><b>{formatWeight(summary.total_weight_kg)}</b></div><div className="flex justify-between"><span className="text-slate-500">Billing weight</span><b>{formatWeight(summary.total_billing_weight_kg)}</b></div><div className="flex justify-between"><span className="text-slate-500">Total meters</span><b>{formatMeters(summary.total_meters)}</b></div><div className="flex justify-between"><span className="text-slate-500">Subtotal</span><b>{formatCurrency(summary.subtotal)}</b></div><div className="flex justify-between"><span className="text-slate-500">Est. profit</span><b className={summary.estimated_profit_amount < 0 ? "text-red-700" : "text-slate-950"}>{formatCurrency(summary.estimated_profit_amount)} ({summary.estimated_profit_percent.toFixed(2)}%)</b></div><div className="flex justify-between"><span className="text-slate-500">GST</span><b>{formatCurrency(summary.gst_amount)}</b></div><div className="rounded-2xl bg-charcoal p-4 text-white shadow-premium"><div className="flex justify-between text-xl"><span>Grand total</span><b>{formatCurrency(summary.grand_total)}</b></div></div><div className="flex justify-between"><span className="text-slate-500">Avg price/kg</span><b>{formatCurrency(summary.average_price_per_kg)}</b></div><div className="flex justify-between"><span className="text-slate-500">Avg price/m</span><b>{formatCurrency(summary.average_price_per_meter)}</b></div>{summary.low_margin_approval_required ? <div className="rounded-2xl border border-orange-200 bg-orange-50 p-3 text-xs font-bold text-orange-800">Approval required below minimum margin</div> : null}</div></CardContent></Card>
      </div> : <Card><CardContent><h2 className="section-title">Pricing access</h2><p className="mt-2 text-sm font-medium text-slate-600">Only owners and admins can create or reprice quotations because quote line inputs include confidential material, conversion, finishing, and margin data. You can review existing quotes and use the approved workflow actions below.</p></CardContent></Card>}
      {mode === "form" ? null : (
      <Card className="mt-6"><CardContent><div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><h2 className="section-title">Saved quotes</h2><input className="form-input max-w-md" placeholder="Search quote number, customer, status..." value={search} onChange={(event) => setSearch(event.target.value)} /></div>{loading ? <LoadingState title="Loading saved quotes" description="Fetching quotation history for this company." /> : filteredQuotes.length ? <div className="overflow-x-auto"><table className="industrial-table min-w-[980px]"><thead><tr><th>Quote</th><th>Customer</th><th>Date</th><th>Valid until</th><th>Status</th>{canReadQuoteCosting ? <th>Profit</th> : null}<th>Total</th><th>Actions</th></tr></thead><tbody>{filteredQuotes.map((quote) => <tr key={quote.id}><td className="font-black text-slate-950">{quote.quote_number}<span className="ml-2 text-xs font-bold text-slate-400">Rev {quote.revision_number ?? 1}</span></td><td>{quote.customers?.company_name || quote.customers?.customer_name}</td><td>{formatDate(quote.quote_date)}</td><td>{formatDate(quote.valid_until)}</td><td><Badge value={quote.status} /> {quote.low_margin_approval_required ? <Badge value="internal_review" className="ml-1" /> : null}</td>{canReadQuoteCosting ? <td className={Number(quote.estimated_profit_amount ?? 0) < 0 ? "font-black text-red-700" : "font-black text-slate-950"}>{formatCurrency(quote.estimated_profit_amount ?? quote.total_margin_amount)}</td> : null}<td className="font-black text-slate-950">{formatCurrency(quote.grand_total)}</td><td className="space-x-1 whitespace-nowrap">{canManageQuoteCosting ? <Button variant="ghost" onClick={() => editQuote(quote)}>Edit</Button> : null}{canUpdateQuoteWorkflow ? <><Button variant="ghost" onClick={() => updateStatus(quote, "internal_review")}>Review</Button><Button variant="ghost" onClick={() => updateStatus(quote, "approved_for_sending")}>Approve</Button><Button variant="ghost" onClick={() => updateStatus(quote, "sent")}>Sent</Button><Button variant="ghost" onClick={() => updateStatus(quote, "customer_approved")}>Won</Button></> : null}{can(context.role, "create", "orders") ? <Button variant="ghost" onClick={() => convertToOrder(quote)}>Convert</Button> : null}<Button variant="ghost" onClick={() => copyWhatsapp(quote)}><Copy className="h-4 w-4" /></Button><a className="inline-flex rounded-xl px-3 py-2 text-sm font-bold text-slate-700 hover:bg-orange/10 hover:text-orange" href={`/api/pdf/quote/${quote.id}`} target="_blank"><Download className="h-4 w-4" /></a></td></tr>)}</tbody></table></div> : <EmptyState title="No quotes yet" description="Create a quotation with at least one profile item to start tracking sales value." />}</CardContent></Card>
      )}
    </div>
  );
}

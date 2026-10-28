"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, AlertTriangle, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { createClient } from "@/lib/supabase/browser";
import { formatCurrency, formatWeight } from "@/lib/utils/format";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";
import { calculateBilletWeightKg, calculateRequiredBilletCount } from "@/lib/calculations/foundry";
import { canSubmitQuoteOrder, loadQuoteDealerAvailability } from "@/lib/orders/quote-fulfillment";
import type { SessionContext } from "@/types/app";

type QuoteOption = {
  id: string;
  dealer_id?: string | null;
  quote_number: string;
  quote_date: string;
  grand_total: number;
  customer_id: string;
  revision_number: number;
  updated_at: string;
  customers?: { customer_name?: string; company_name?: string } | null;
  quote_items?: { id: string; profile_id: string | null; finishing_type: string | null; billing_weight_kg: number | null; total_weight_kg: number | null; aluminium_profiles?: { alloy?: string | null; temper?: string | null; billet_diameter_required_inch?: number | null } | null }[];
};

const factoryMinimumKg = 700;

export function QuoteOrderFormClient({ context }: { context: SessionContext }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const [quotes, setQuotes] = useState<QuoteOption[]>([]);
  const [search, setSearch] = useState("");
  const [quoteId, setQuoteId] = useState("");
  const [orderDate, setOrderDate] = useState(() => getBusinessDateBoundaries().today);
  const [expectedDispatchDate, setExpectedDispatchDate] = useState("");
  const [priority, setPriority] = useState("normal");
  const [dealerFulfilledKg, setDealerFulfilledKg] = useState(0);
  const [availableUnreservedKg, setAvailableUnreservedKg] = useState(0);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [verifiedAvailabilityQuoteId, setVerifiedAvailabilityQuoteId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [minimumHandling, setMinimumHandling] = useState<"queue" | "override">("queue");
  const [overrideReason, setOverrideReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [quotesResult] = await Promise.all([
        supabase
          .from("quotes_authorized")
          .select("id, dealer_id, quote_number, quote_date, grand_total, customer_id, revision_number, updated_at")
          .eq("company_id", context.companyId)
          .eq("status", "customer_approved")
          .order("quote_date", { ascending: false })
          .limit(50),
      ]);
      if (quotesResult.error) throw quotesResult.error;
      const quoteIds = (quotesResult.data ?? []).map((quote: any) => quote.id);
      const [linesResult, customersResult] = await Promise.all([
        quoteIds.length ? supabase.from("quote_items_authorized").select("id, quote_id, profile_id, finishing_type, billing_weight_kg, total_weight_kg").eq("company_id", context.companyId).in("quote_id", quoteIds).order("created_at", { ascending: true }) : { data: [], error: null },
        quoteIds.length ? supabase.from("customers").select("id, customer_name, company_name").eq("company_id", context.companyId).in("id", [...new Set((quotesResult.data ?? []).map((quote: any) => quote.customer_id).filter(Boolean))]) : { data: [], error: null },
      ]);
      if (linesResult.error) throw linesResult.error;
      if (customersResult.error) throw customersResult.error;
      const profileIds = [...new Set((linesResult.data ?? []).map((line: any) => line.profile_id).filter(Boolean))];
      const profilesResult = profileIds.length
        ? await supabase.from("aluminium_profiles").select("id, alloy, temper, billet_diameter_required_inch").eq("company_id", context.companyId).in("id", profileIds)
        : { data: [], error: null };
      if (profilesResult.error) throw profilesResult.error;
      const customersById = new Map((customersResult.data ?? []).map((customer: any) => [customer.id, customer]));
      const profilesById = new Map((profilesResult.data ?? []).map((profile: any) => [profile.id, profile]));
      const linesByQuoteId = new Map<string, any[]>();
      for (const line of linesResult.data ?? []) {
        const lines = linesByQuoteId.get(line.quote_id) ?? [];
        lines.push({ ...line, aluminium_profiles: profilesById.get(line.profile_id) ?? null });
        linesByQuoteId.set(line.quote_id, lines);
      }
      const loadedQuotes = (quotesResult.data ?? []).map((quote: any) => ({
        ...quote,
        customers: customersById.get(quote.customer_id) ?? null,
        quote_items: linesByQuoteId.get(quote.id) ?? [],
      })) as QuoteOption[];
      setQuotes(loadedQuotes);
      const preselectedQuoteId = searchParams.get("quoteId");
      if (preselectedQuoteId && loadedQuotes.some((quote) => quote.id === preselectedQuoteId)) setQuoteId(preselectedQuoteId);
    };
    load().catch((error) => toast.error(error.message ?? "Could not load quotes")).finally(() => setLoading(false));
  }, [context.companyId, searchParams, supabase]);

  const selectedQuote = quotes.find((quote) => quote.id === quoteId) ?? null;
  const quoteWeightKg = useMemo(() => (selectedQuote?.quote_items ?? []).reduce((sum, item) => sum + Number(item.billing_weight_kg ?? item.total_weight_kg ?? 0), 0), [selectedQuote]);
  const manufacturingWeightKg = Math.max(quoteWeightKg - dealerFulfilledKg, 0);
  const billetsRequired = useMemo(() => {
    if (!selectedQuote || quoteWeightKg <= 0 || manufacturingWeightKg <= 0) return 0;
    return (selectedQuote.quote_items ?? []).reduce((sum, item) => {
      const itemWeight = Number(item.billing_weight_kg ?? item.total_weight_kg ?? 0);
      const manufacturingItemWeight = itemWeight * manufacturingWeightKg / quoteWeightKg;
      const diameterInch = Number(item.aluminium_profiles?.billet_diameter_required_inch ?? 6);
      const billetWeight = calculateBilletWeightKg(5800, diameterInch * 25.4, 2700);
      return sum + calculateRequiredBilletCount(manufacturingItemWeight, billetWeight, 75);
    }, 0);
  }, [manufacturingWeightKg, quoteWeightKg, selectedQuote]);
  const factoryBlocked = manufacturingWeightKg > 0 && manufacturingWeightKg < factoryMinimumKg;
  const filteredQuotes = quotes.filter((quote) => {
    const customer = quote.customers?.company_name || quote.customers?.customer_name || "";
    const haystack = `${quote.quote_number} ${customer}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  });

  useEffect(() => {
    let cancelled = false;
    setDealerFulfilledKg(0);
    setAvailableUnreservedKg(0);
    setAvailabilityError(null);
    setVerifiedAvailabilityQuoteId(null);
    setAvailabilityLoading(Boolean(selectedQuote));
    const loadAvailability = async () => {
      if (!selectedQuote) return;
      const compatibleStockKg = await loadQuoteDealerAvailability(supabase, selectedQuote.id);
      if (cancelled) return;
      setAvailableUnreservedKg(compatibleStockKg);
      setVerifiedAvailabilityQuoteId(selectedQuote.id);
      if (context.dealerId) setDealerFulfilledKg(Math.min(compatibleStockKg, quoteWeightKg));
    };
    void loadAvailability().catch((error) => {
      if (cancelled) return;
      const message = error.message ?? "Could not verify dealer stock availability";
      setAvailabilityError(message);
      toast.error(message);
    }).finally(() => {
      if (!cancelled) setAvailabilityLoading(false);
    });
    return () => { cancelled = true; };
  }, [context.dealerId, quoteWeightKg, selectedQuote, supabase]);

  const canSubmit = canSubmitQuoteOrder({ quoteSelected: Boolean(selectedQuote), saving,
    availabilityLoading: availabilityLoading || verifiedAvailabilityQuoteId !== selectedQuote?.id, availabilityError });

  async function submit() {
    if (!selectedQuote) return toast.error("Select a quote before creating an order.");
    if (!canSubmit) return toast.error(availabilityError ?? "Wait for stock availability to finish loading.");
    if (dealerFulfilledKg > availableUnreservedKg) return toast.error("Dealer fulfillment cannot use reserved or unavailable stock.");
    if (dealerFulfilledKg > quoteWeightKg) return toast.error("Dealer fulfillment cannot exceed the quote weight.");
    if (factoryBlocked && minimumHandling === "override" && overrideReason.trim().length < 8) {
      return toast.error("Enter a clear manager reason for the below-minimum factory release.");
    }

    setSaving(true);
    const { data, error } = await supabase.rpc("create_order_from_quote_with_dealer_workflow_atomic", {
      p_quote_id: selectedQuote.id,
      p_order_number: null,
      p_order_date: orderDate,
      p_expected_dispatch_date: expectedDispatchDate || null,
      p_priority: priority,
      p_dealer_fulfilled_weight_kg: dealerFulfilledKg,
      p_notes: notes,
      p_minimum_handling: factoryBlocked ? minimumHandling : "queue",
      p_override_reason: factoryBlocked && minimumHandling === "override" ? overrideReason : null,
      p_expected_revision: selectedQuote.revision_number,
      p_expected_updated_at: selectedQuote.updated_at,
    });
    if (error || !data) {
      setSaving(false);
      return toast.error(error?.message ?? "Could not create order");
    }
    toast.success("Order created from quote");
    router.push(context.dealerId ? `/dealer-orders/quote-orders/${data}` : `/orders/${data}`);
    router.refresh();
  }

  if (loading) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm font-bold text-slate-500">Loading approved quotes...</div>;

  return (
    <div className="space-y-6">
      <div>
        <Link href={context.dealerId ? "/dealer-orders" : "/orders"} className="mb-3 inline-flex items-center gap-2 text-sm font-black text-slate-500 transition hover:text-orange"><ArrowLeft className="h-4 w-4" /> Back to {context.dealerId ? "Dealer Orders" : "Orders"}</Link>
        <h1 className="text-3xl font-black tracking-tight text-slate-950">Create {context.dealerId ? "Dealer " : ""}Order From Quote</h1>
        <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-slate-500">Select the latest quote, fulfill any available dealer stock first, then send only the eligible remaining weight for factory manufacturing.</p>
      </div>

      <Card>
        <CardHeader><h2 className="section-title">Quote Selection</h2></CardHeader>
        <CardContent className="space-y-4">
          <label className="block space-y-1.5">
            <span className="form-label">Search Quote Number</span>
            <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input className="form-input pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search quote number or customer" /></div>
          </label>
          <label className="block space-y-1.5">
            <span className="form-label">Customer-approved quotes</span>
            <SearchableSelect value={quoteId} placeholder="Select quote" options={filteredQuotes.map((quote) => ({ value: quote.id, label: `${quote.quote_number} - ${quote.customers?.company_name || quote.customers?.customer_name || "Customer"} - ${quote.quote_date}` }))} onChange={setQuoteId} />
          </label>
          <div className="grid gap-4 md:grid-cols-3">
            <ReadOnly label="Customer" value={selectedQuote ? selectedQuote.customers?.company_name || selectedQuote.customers?.customer_name || "Customer" : "Select quote first"} />
            <ReadOnly label="Quote Value" value={selectedQuote ? formatCurrency(selectedQuote.grand_total) : "-"} />
            <ReadOnly label="Quote Weight" value={formatWeight(quoteWeightKg)} />
            <ReadOnly label="Billets Required" value={`${billetsRequired} billet${billetsRequired === 1 ? "" : "s"} @ 75% efficiency`} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2 className="section-title">Dealer Fulfillment + Factory Balance</h2></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <ReadOnly label="Unreserved Stock Available" value={formatWeight(availableUnreservedKg)} />
            <label className="block space-y-1.5"><span className="form-label">Dealer Stock Used (kg)</span><input className="form-input" type="number" step="0.001" min="0" max={Math.min(availableUnreservedKg, quoteWeightKg)} value={dealerFulfilledKg} onChange={(event) => setDealerFulfilledKg(Number(event.target.value))} disabled={Boolean(context.dealerId)} /></label>
            <ReadOnly label="Factory Manufacturing Weight" value={formatWeight(manufacturingWeightKg)} />
          </div>
          {availabilityLoading ? <p className="text-sm font-medium text-slate-500">Checking current unreserved dealer stock...</p> : null}
          {availabilityError ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{availabilityError}</p> : null}
          {factoryBlocked ? <div className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-4"><div className="flex gap-3 text-sm font-bold text-amber-900"><AlertTriangle className="h-5 w-5 shrink-0" /> The remaining factory quantity is below 700 kg. The order can be saved, but production cannot start until it is combined with other queued work or a manager approves an exception.</div><div className="grid gap-3 md:grid-cols-2"><label className="flex cursor-pointer gap-3 rounded-xl border border-amber-200 bg-white p-3"><input type="radio" checked={minimumHandling === "queue"} onChange={() => setMinimumHandling("queue")} /><span><strong className="block text-sm text-slate-950">Add to consolidation queue</strong><span className="text-xs font-medium text-slate-500">Recommended: combine compatible orders to reach the minimum.</span></span></label>{!context.dealerId && ["owner", "admin", "factory_manager", "production_manager"].includes(context.role) ? <label className="flex cursor-pointer gap-3 rounded-xl border border-amber-200 bg-white p-3"><input type="radio" checked={minimumHandling === "override"} onChange={() => setMinimumHandling("override")} /><span><strong className="block text-sm text-slate-950">Manager exception</strong><span className="text-xs font-medium text-slate-500">Release this order alone with an auditable reason.</span></span></label> : null}</div>{minimumHandling === "override" ? <label className="block space-y-1.5"><span className="form-label">Override reason *</span><textarea className="form-input min-h-20 bg-white" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} /></label> : null}</div> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2 className="section-title">Order Details</h2></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="block space-y-1.5"><span className="form-label">Order Date</span><input className="form-input" type="date" value={orderDate} onChange={(event) => setOrderDate(event.target.value)} /></label>
            <label className="block space-y-1.5"><span className="form-label">Expected Dispatch</span><input className="form-input" type="date" value={expectedDispatchDate} onChange={(event) => setExpectedDispatchDate(event.target.value)} /></label>
            <label className="block space-y-1.5"><span className="form-label">Priority</span><select className="form-input" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
          </div>
          <label className="block space-y-1.5"><span className="form-label">Notes</span><textarea className="form-input min-h-24" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Customer PO, dealer stock source, special dispatch notes" /></label>
          <div className="flex justify-end gap-3 border-t border-slate-200 pt-5"><Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button><Button type="button" disabled={!canSubmit} onClick={submit}>{saving ? "Creating..." : "Create Order"}</Button></div>
        </CardContent>
      </Card>
    </div>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p><p className="mt-1 text-sm font-black text-slate-950">{value}</p></div>;
}

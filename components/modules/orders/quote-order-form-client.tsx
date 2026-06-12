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
import { nextBusinessNumber } from "@/lib/utils/numbering";
import { calculateBilletWeightKg, calculateRequiredBilletCount } from "@/lib/calculations/foundry";
import type { SessionContext } from "@/types/app";

type QuoteOption = {
  id: string;
  dealer_id?: string | null;
  quote_number: string;
  quote_date: string;
  grand_total: number;
  customer_id: string;
  customers?: { customer_name?: string; company_name?: string } | null;
  quote_items?: { profile_id: string | null; billing_weight_kg: number | null; total_weight_kg: number | null; aluminium_profiles?: { alloy?: string | null; temper?: string | null; billet_diameter_required_inch?: number | null } | null }[];
};

const factoryMinimumKg = 700;

export function QuoteOrderFormClient({ context }: { context: SessionContext }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const [quotes, setQuotes] = useState<QuoteOption[]>([]);
  const [existingOrderNumbers, setExistingOrderNumbers] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [quoteId, setQuoteId] = useState("");
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expectedDispatchDate, setExpectedDispatchDate] = useState("");
  const [priority, setPriority] = useState("normal");
  const [dealerFulfilledKg, setDealerFulfilledKg] = useState(0);
  const [availableUnreservedKg, setAvailableUnreservedKg] = useState(0);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [quotesResult, ordersResult] = await Promise.all([
        supabase
          .from("quotes")
          .select("id, dealer_id, quote_number, quote_date, grand_total, customer_id, customers(customer_name, company_name), quote_items(profile_id, billing_weight_kg, total_weight_kg, aluminium_profiles(alloy, temper, billet_diameter_required_inch))")
          .eq("company_id", context.companyId)
          .in("status", ["customer_approved", "sent", "approved_for_sending", "converted_to_order"])
          .order("quote_date", { ascending: false })
          .limit(250),
        supabase.from("orders").select("order_number").eq("company_id", context.companyId),
      ]);
      if (quotesResult.error) throw quotesResult.error;
      if (ordersResult.error) throw ordersResult.error;
      setQuotes((quotesResult.data ?? []) as QuoteOption[]);
      const preselectedQuoteId = searchParams.get("quoteId");
      if (preselectedQuoteId && (quotesResult.data ?? []).some((quote: any) => quote.id === preselectedQuoteId)) setQuoteId(preselectedQuoteId);
      setExistingOrderNumbers((ordersResult.data ?? []).map((order: any) => order.order_number).filter(Boolean));
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
    const loadAvailability = async () => {
      setDealerFulfilledKg(0);
      setAvailableUnreservedKg(0);
      if (!selectedQuote) return;
      const profileIds = Array.from(new Set((selectedQuote.quote_items ?? []).map((item) => item.profile_id).filter(Boolean))) as string[];
      if (!profileIds.length) return;
      const stockQuery = supabase.from("profile_stock_batches").select("id, profile_id, total_weight_kg, status, dealer_id").eq("company_id", context.companyId).in("profile_id", profileIds).eq("status", "available");
      if (context.dealerId) stockQuery.eq("dealer_id", context.dealerId);
      const [stockResult, reservationResult] = await Promise.all([
        stockQuery,
        supabase.from("profile_stock_reservations").select("profile_id, reserved_weight_kg, status").eq("company_id", context.companyId).in("profile_id", profileIds).eq("status", "active"),
      ]);
      if (stockResult.error) return toast.error(stockResult.error.message);
      if (reservationResult.error) return toast.error(reservationResult.error.message);
      const stockKg = (stockResult.data ?? []).reduce((sum: number, row: any) => sum + Number(row.total_weight_kg ?? 0), 0);
      const reservedKg = (reservationResult.data ?? []).reduce((sum: number, row: any) => sum + Number(row.reserved_weight_kg ?? 0), 0);
      setAvailableUnreservedKg(Math.max(stockKg - reservedKg, 0));
      if (context.dealerId) setDealerFulfilledKg(Math.min(Math.max(stockKg - reservedKg, 0), quoteWeightKg));
    };
    loadAvailability();
  }, [context.companyId, context.dealerId, quoteWeightKg, selectedQuote, supabase]);

  async function submit() {
    if (!selectedQuote) return toast.error("Select a quote before creating an order.");
    if (dealerFulfilledKg > availableUnreservedKg) return toast.error("Dealer fulfillment cannot use reserved or unavailable stock.");
    if (dealerFulfilledKg > quoteWeightKg) return toast.error("Dealer fulfillment cannot exceed the quote weight.");
    if (factoryBlocked) return toast.error(`Urgent: ${formatWeight(manufacturingWeightKg)} is below the ${formatWeight(factoryMinimumKg)} factory minimum. Fulfill locally or arrange stock from another dealer/manufacturer.`);

    setSaving(true);
    const orderNumber = nextBusinessNumber("O", existingOrderNumbers);
    const { data, error } = await supabase.rpc("create_order_from_quote_with_dealer_stock", {
      p_quote_id: selectedQuote.id,
      p_order_number: orderNumber,
      p_order_date: orderDate,
      p_expected_dispatch_date: expectedDispatchDate || null,
      p_priority: priority,
      p_dealer_fulfilled_weight_kg: dealerFulfilledKg,
      p_notes: notes,
    });
    if (error || !data) {
      setSaving(false);
      return toast.error(error?.message ?? "Could not create order");
    }
    if (context.dealerId) {
      const dealerOrderResult = await fetch("/api/dealer-orders/from-quote-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: data })
      });
      const dealerOrderPayload = await dealerOrderResult.json().catch(() => ({}));
      if (!dealerOrderResult.ok) {
        setSaving(false);
        return toast.error(dealerOrderPayload.error ?? "Order created, but dealer order workflow record could not be created.");
      }
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
            <span className="form-label">Latest approved/sent quotes</span>
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
          {factoryBlocked ? <div className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800"><AlertTriangle className="h-5 w-5 shrink-0" /> Urgent: The remaining factory quantity is below 700 kg. This order cannot be sent for manufacturing. Fulfill it locally or arrange material from another dealer/manufacturer.</div> : null}
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
          <div className="flex justify-end gap-3 border-t border-slate-200 pt-5"><Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button><Button type="button" disabled={saving || !selectedQuote || factoryBlocked} onClick={submit}>{saving ? "Creating..." : "Create Order"}</Button></div>
        </CardContent>
      </Card>
    </div>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p><p className="mt-1 text-sm font-black text-slate-950">{value}</p></div>;
}

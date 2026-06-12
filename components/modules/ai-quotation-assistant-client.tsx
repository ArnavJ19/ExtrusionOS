"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Bot, CheckCircle2, Clipboard, MessageSquareText, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading";
import { PageHeader } from "@/components/layout/page-header";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { formatDate } from "@/lib/utils/format";
import { labelize, type SessionContext } from "@/types/app";

type Props = {
  context: SessionContext;
  initialSuggestions: Record<string, any>[];
  interactions: Record<string, any>[];
  settings: Record<string, any> | null;
  queryErrors: string[];
};

const example = "Need 500 kg black powder coated 2-track sliding window profiles for ABC Fabricators, same as last order, delivery next week.";

export function AiQuotationAssistantClient({ initialSuggestions, interactions, settings, queryErrors }: Props) {
  const [inputText, setInputText] = useState(example);
  const [sourceType, setSourceType] = useState("natural_language");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, any> | null>(null);
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const externalAiConfigured = settings?.allow_external_ai && settings?.ai_provider === "nvidia";

  async function runAssistant() {
    setLoading(true);
    const response = await fetch("/api/ai/quotation-assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input_text: inputText, source_type: sourceType })
    });
    const payload = await response.json();
    setLoading(false);
    if (!response.ok) return toast.error(payload.error ?? "Quotation assistant failed");
    setResult(payload.output);
    setSuggestions((current) => [payload.suggestion, ...current.filter((item) => item.id !== payload.suggestion.id)]);
    toast.success("Quote suggestion drafted");
  }

  async function copyWhatsapp() {
    if (!result?.whatsappSummary) return;
    await navigator.clipboard.writeText(result.whatsappSummary);
    toast.success("WhatsApp summary copied");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Quotation Assistant"
        description="Draft faster aluminium extrusion quotations from customer messages using deterministic local rules, with optional redacted NVIDIA review when configured."
        actions={<Button onClick={runAssistant} disabled={loading}>{loading ? "Analysing..." : "Generate Suggestion"}</Button>}
      />
      <QueryErrorNotice messages={queryErrors} />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="metric-card"><Bot className="relative z-[1] h-5 w-5 text-orange" /><p className="relative z-[1] mt-3 text-xs font-black uppercase tracking-[0.14em] text-slate-500">Mode</p><p className="relative z-[1] mt-2 text-2xl font-black text-slate-950">{externalAiConfigured ? "NVIDIA + Rules" : "Local Rules"}</p></div>
        <div className="metric-card"><ShieldCheck className="relative z-[1] h-5 w-5 text-orange" /><p className="relative z-[1] mt-3 text-xs font-black uppercase tracking-[0.14em] text-slate-500">Redaction</p><p className="relative z-[1] mt-2 text-2xl font-black text-slate-950">{settings?.redact_sensitive_data === false ? "Off" : "On"}</p></div>
        <div className="metric-card"><Sparkles className="relative z-[1] h-5 w-5 text-orange" /><p className="relative z-[1] mt-3 text-xs font-black uppercase tracking-[0.14em] text-slate-500">External AI</p><p className="relative z-[1] mt-2 text-2xl font-black text-slate-950">{settings?.allow_external_ai ? "Allowed" : "Blocked"}</p></div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[440px_1fr]">
        <Card>
          <CardHeader><h2 className="section-title flex items-center gap-2"><MessageSquareText className="h-5 w-5 text-orange" /> Customer message</h2></CardHeader>
          <CardContent className="space-y-4">
            <select className="form-input" value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
              <option value="natural_language">Natural language</option>
              <option value="whatsapp_message">WhatsApp message</option>
              <option value="drawing_note">Drawing/spec note</option>
              <option value="past_quote">Past quote reference</option>
              <option value="manual">Manual</option>
            </select>
            <textarea className="form-input min-h-64" value={inputText} onChange={(event) => setInputText(event.target.value)} />
            <div className="rounded-2xl border border-orange/20 bg-orange/5 p-4 text-sm font-medium leading-6 text-slate-700">
              {externalAiConfigured ? "The assistant sends only redacted request text and safe quote context to NVIDIA. Local deterministic rules remain the fallback if NVIDIA is unavailable." : "The assistant will not send data to external AI. It uses tenant-scoped customers, profiles, recent quotes, and company defaults to draft a suggestion."}
            </div>
            <Button className="w-full" onClick={runAssistant} disabled={loading}>{loading ? "Analysing requirement..." : "Generate quote suggestion"}</Button>
          </CardContent>
        </Card>

        {loading ? <LoadingState title="Analysing quotation request" description="Matching customers, profiles, previous quotes, and missing fields." /> : result ? (
          <div className="space-y-6">
            <Card><CardHeader><div className="flex items-center justify-between gap-3"><h2 className="section-title">Assistant result</h2><Badge value={`${result.confidenceScore}% confidence`} /></div></CardHeader><CardContent className="space-y-4"><p className="text-sm font-medium leading-6 text-slate-700">{result.quoteExplanation}</p><div className="grid gap-3 md:grid-cols-2"><InfoTile label="Customer" value={result.matchedCustomer?.company_name || result.matchedCustomer?.customer_name || "Not matched"} /><InfoTile label="Quantity" value={result.parsed.quantityKg ? `${result.parsed.quantityKg} kg` : result.parsed.quantityPieces ? `${result.parsed.quantityPieces} pieces` : "Missing"} /><InfoTile label="Finish" value={result.parsed.finish ? labelize(result.parsed.finish) : "Missing"} /><InfoTile label="Delivery" value={result.parsed.deliveryText || "Missing"} /></div></CardContent></Card>

            <div className="grid gap-6 xl:grid-cols-2">
              <Card><CardHeader><h2 className="section-title flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-orange" /> Suggested line items</h2></CardHeader><CardContent className="space-y-3">{result.suggestedItems.map((item: any, index: number) => <div key={`${item.description}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between gap-3"><p className="font-black text-slate-950">{item.description}</p><Badge value={`${item.confidence}%`} /></div><p className="mt-1 text-sm font-medium text-slate-500">{item.estimated_weight_kg ? `${item.estimated_weight_kg} kg` : "Quantity pending"} · {labelize(item.finishing_type)}</p></div>)}</CardContent></Card>
              <Card><CardHeader><h2 className="section-title flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-orange" /> Missing info and warnings</h2></CardHeader><CardContent className="space-y-3">{result.missingInformation.length ? result.missingInformation.map((item: string) => <div key={item} className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm font-bold text-slate-700">{item}</div>) : <div className="empty-mini">No major missing fields detected.</div>}{result.warnings.map((warning: any) => <div key={warning.message} className="rounded-2xl border border-orange/20 bg-orange/5 p-3"><Badge value={warning.severity} /><p className="mt-2 text-sm font-medium text-slate-700">{warning.message}</p></div>)}</CardContent></Card>
            </div>

            <Card><CardHeader><div className="flex items-center justify-between gap-3"><h2 className="section-title">WhatsApp-ready summary</h2><Button variant="secondary" onClick={copyWhatsapp}><Clipboard className="h-4 w-4" /> Copy</Button></div></CardHeader><CardContent><p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-medium leading-6 text-slate-700">{result.whatsappSummary}</p><p className="mt-4 text-sm font-bold text-slate-800">Owner summary</p><p className="mt-1 text-sm font-medium leading-6 text-slate-600">{result.ownerApprovalSummary}</p></CardContent></Card>

            {result.externalAi ? <Card><CardHeader><div className="flex items-center justify-between gap-3"><h2 className="section-title">External AI review</h2><Badge value={`${labelize(result.externalAi.provider)} · ${labelize(result.externalAi.status)}`} /></div></CardHeader><CardContent>{result.externalAi.content ? <div className="whitespace-pre-wrap rounded-2xl border border-slate-200 bg-white p-4 text-sm font-medium leading-6 text-slate-700">{result.externalAi.content}</div> : <div className="rounded-2xl border border-orange/20 bg-orange/5 p-4 text-sm font-medium leading-6 text-slate-700">{result.externalAi.error || "External AI did not return content. Local rules were used."}</div>}<p className="mt-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Model: {result.externalAi.model}</p></CardContent></Card> : null}

            <Card><CardHeader><h2 className="section-title">Similar recent quotes</h2></CardHeader><CardContent className="space-y-3">{result.similarQuotes.length ? result.similarQuotes.map((quote: any) => <div key={quote.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4"><div><p className="font-black text-slate-950">{quote.quote_number}</p><p className="text-sm font-medium text-slate-500">{quote.customer_name || "Customer"} · {formatDate(quote.quote_date)}</p></div><Badge value={quote.status || "draft"} /></div>) : <EmptyState title="No similar quote context" description="Create more quote history to improve deterministic suggestions." />}</CardContent></Card>
          </div>
        ) : <EmptyState title="No assistant result yet" description="Paste a customer message or drawing note and generate a quote suggestion." />}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card><CardHeader><h2 className="section-title">Draft suggestions</h2></CardHeader><CardContent className="space-y-3">{suggestions.length ? suggestions.map((suggestion) => <div key={suggestion.id} className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between gap-3"><p className="font-black text-slate-950">{suggestion.customers?.company_name || suggestion.customers?.customer_name || "Unmatched customer"}</p><Badge value={suggestion.status} /></div><p className="mt-1 text-sm font-medium text-slate-500">Confidence {suggestion.confidence_score}% · {formatDate(suggestion.created_at)}</p></div>) : <div className="empty-mini">No quote suggestions saved yet.</div>}</CardContent></Card>
        <Card><CardHeader><h2 className="section-title">AI interaction history</h2></CardHeader><CardContent className="space-y-3">{interactions.length ? interactions.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4"><div><p className="font-black text-slate-950">{labelize(item.interaction_type)}</p><p className="text-sm font-medium text-slate-500">{formatDate(item.created_at)}</p></div><Badge value={item.status} /></div>) : <div className="empty-mini">No assistant interactions yet.</div>}</CardContent></Card>
      </div>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-aluminium/50 p-4"><p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{label}</p><p className="mt-2 font-black text-slate-950">{value}</p></div>;
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { createClient } from "@/lib/supabase/browser";
import { formatCompactCurrency } from "@/lib/utils/format";

type AssistantOutput = {
  confidenceScore: number;
  customerSummary: string;
  ownerApprovalSummary: string;
  whatsappSummary: string;
  quoteExplanation: string;
  missingInformation: string[];
  warnings: Array<{ severity: "info" | "warning" | "critical"; message: string }>;
  priceSanity: Array<{ severity: "info" | "warning"; message: string }>;
  suggestedItems: Array<{
    profile_id: string | null;
    profile_code: string | null;
    description: string;
    estimated_weight_kg: number | null;
    finishing_type: string;
    confidence: number;
  }>;
  matchedCustomer: { id: string; customer_name: string; company_name?: string | null } | null;
  similarQuotes: Array<{ id: string; quote_number: string; grand_total?: number | null; quote_date?: string | null; customer_name?: string | null }>;
};

type AssistantResponse = {
  output: AssistantOutput;
  suggestion: { id: string; status: string };
  interaction: { id: string };
};

export default function QuotationAssistantPage() {
  const supabase = createClient();
  const [inputText, setInputText] = useState("");
  const [sourceType, setSourceType] = useState("natural_language");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState<AssistantResponse | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);

  async function analyze() {
    if (!inputText.trim()) return;
    setLoading(true);
    setError("");
    setResponse(null);
    try {
      const result = await fetch("/api/ai/quotation-assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input_text: inputText.trim(), source_type: sourceType })
      });
      const json = await result.json();
      if (!result.ok) {
        setError(json?.error || "Failed to analyze request");
        setLoading(false);
        return;
      }
      setResponse(json as AssistantResponse);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to analyze request");
    } finally {
      setLoading(false);
    }
  }

  async function markSuggestion(status: "accepted" | "rejected") {
    if (!response?.suggestion?.id) return;
    setSavingStatus(true);
    const { error: updateError } = await supabase.from("quote_suggestions").update({ status }).eq("id", response.suggestion.id);
    if (updateError) {
      setError(updateError.message);
      setSavingStatus(false);
      return;
    }
    setResponse({ ...response, suggestion: { ...response.suggestion, status } });
    setSavingStatus(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="AI Quotation Assistant" description="Convert real customer requests into structured quote suggestions saved to your company records." />
      <QueryErrorNotice messages={error ? [error] : []} />

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader><h2 className="section-title">Customer Request Input</h2></CardHeader>
          <CardContent className="space-y-4">
            <label className="block space-y-1.5">
              <span className="form-label">Source type</span>
              <select className="form-input" value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
                {["natural_language", "whatsapp_message", "drawing_note", "past_quote", "manual"].map((value) => <option key={value} value={value}>{value.replace(/_/g, " ")}</option>)}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="form-label">Message text</span>
              <textarea value={inputText} onChange={(event) => setInputText(event.target.value)} className="form-input min-h-48" placeholder="Need 500 kg black powder coated 2-track sliding profiles for ABC Fabricators, delivery next week." />
            </label>
            <Button onClick={analyze} disabled={loading || !inputText.trim()}>{loading ? "Analyzing..." : "Analyze and Save Suggestion"}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h2 className="section-title">Assistant Output</h2></CardHeader>
          <CardContent className="space-y-4">
            {!response ? (
              <p className="text-sm font-medium text-slate-500">No suggestion yet. Submit a request to generate a saved AI quotation suggestion.</p>
            ) : (
              <>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-2"><p className="font-black text-slate-950">Suggestion Confidence</p><Badge value={`${response.output.confidenceScore}%`} /></div>
                  <p className="mt-2 text-sm text-slate-700">{response.output.quoteExplanation}</p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Customer Summary</p>
                  <p className="mt-2 text-sm text-slate-700">{response.output.customerSummary}</p>
                  <p className="mt-3 text-xs font-black uppercase tracking-[0.12em] text-slate-500">Owner Review Summary</p>
                  <p className="mt-2 text-sm text-slate-700">{response.output.ownerApprovalSummary}</p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Suggested Items</p>
                  <div className="mt-3 space-y-2">
                    {response.output.suggestedItems.map((item, index) => (
                      <div key={`${item.profile_id || "na"}-${index}`} className="rounded-xl border border-slate-100 p-3">
                        <p className="font-bold text-slate-900">{item.description}</p>
                        <p className="text-xs text-slate-500">Profile: {item.profile_code || "To be confirmed"} · Finish: {item.finishing_type.replace(/_/g, " ")}</p>
                        <p className="text-xs text-slate-500">Estimated weight: {item.estimated_weight_kg ?? "-"} kg · Confidence: {item.confidence}%</p>
                      </div>
                    ))}
                  </div>
                </div>

                {response.output.similarQuotes.length ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Similar Quotes</p>
                    <div className="mt-2 space-y-2">
                      {response.output.similarQuotes.map((quote) => (
                        <div key={quote.id} className="rounded-lg border border-slate-100 p-2 text-xs text-slate-700">
                          {quote.quote_number} · {quote.customer_name || "Customer"} · {quote.grand_total ? formatCompactCurrency(Number(quote.grand_total)) : "-"}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {(response.output.missingInformation.length || response.output.warnings.length || response.output.priceSanity.length) ? (
                  <div className="rounded-2xl border border-orange/20 bg-orange/5 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-600">Validation Notes</p>
                    <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
                      {response.output.missingInformation.map((item) => <li key={item}>{item}</li>)}
                      {response.output.warnings.map((item) => <li key={`${item.severity}-${item.message}`}>{item.severity.toUpperCase()}: {item.message}</li>)}
                      {response.output.priceSanity.map((item) => <li key={`${item.severity}-${item.message}`}>{item.severity.toUpperCase()}: {item.message}</li>)}
                    </ul>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button disabled={savingStatus} onClick={() => markSuggestion("accepted")}>{savingStatus ? "Saving..." : "Mark Accepted"}</Button>
                  <Button disabled={savingStatus} variant="secondary" onClick={() => markSuggestion("rejected")}>Mark Rejected</Button>
                  <Link href="/quotes/new" className="inline-flex rounded-xl px-3 py-2 text-sm font-bold text-slate-700 hover:bg-orange/10 hover:text-orange">
                    Open Quotes Module
                  </Link>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

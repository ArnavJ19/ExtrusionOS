import type { QuotationAssistantOutput } from "@/lib/ai/quotation-assistant";

export type NvidiaQuotationInsight = {
  provider: "nvidia";
  model: string;
  status: "completed" | "skipped" | "failed";
  content: string | null;
  error?: string;
};

const endpoint = "https://integrate.api.nvidia.com/v1/chat/completions";
const defaultModel = "meta/llama-3.3-70b-instruct";

export async function getNvidiaQuotationInsight(input: {
  redactedInputText: string;
  localOutput: QuotationAssistantOutput;
  model?: string | null;
  apiKey?: string;
}): Promise<NvidiaQuotationInsight> {
  const apiKey = input.apiKey || process.env.NVIDIA_API_KEY;
  const model = input.model || defaultModel;
  if (!apiKey) {
    return { provider: "nvidia", model, status: "skipped", content: null, error: "NVIDIA_API_KEY is not configured on the server." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        top_p: 0.7,
        max_tokens: 900,
        stream: false,
        messages: [
          {
            role: "system",
            content: "You are an aluminium extrusion quotation copilot for Indian MSME manufacturers. Return practical, concise guidance. Do not invent exact prices. Do not expose or ask for internal margin, supplier rates, bank details, or private user data. Use only the redacted input and safe context."
          },
          {
            role: "user",
            content: JSON.stringify(buildSafePromptPayload(input.redactedInputText, input.localOutput))
          }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text();
      return { provider: "nvidia", model, status: "failed", content: null, error: `NVIDIA API error ${response.status}: ${text.slice(0, 240)}` };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    return { provider: "nvidia", model, status: "completed", content: typeof content === "string" ? content : null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown NVIDIA provider error";
    return { provider: "nvidia", model, status: "failed", content: null, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

function buildSafePromptPayload(redactedInputText: string, localOutput: QuotationAssistantOutput) {
  return {
    task: "Review this local quotation draft and improve the sales checklist, customer-facing explanation, and owner approval notes. Return plain Markdown with sections: Parsed Requirement, Missing Information, Quote Risk Warnings, Suggested Customer Reply, Owner Review Notes.",
    redacted_customer_request: redactedInputText,
    parsed: localOutput.parsed,
    matched_customer_name: localOutput.matchedCustomer?.company_name || localOutput.matchedCustomer?.customer_name || null,
    suggested_items: localOutput.suggestedItems.map((item) => ({
      profile_code: item.profile_code,
      description: item.description,
      estimated_weight_kg: item.estimated_weight_kg,
      finishing_type: item.finishing_type,
      confidence: item.confidence
    })),
    missing_information: localOutput.missingInformation,
    warnings: localOutput.warnings,
    price_sanity_checks: localOutput.priceSanity,
    similar_quote_context: localOutput.similarQuotes.map((quote) => ({ quote_number: quote.quote_number, status: quote.status, quote_date: quote.quote_date, customer_name: quote.customer_name }))
  };
}

import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { buildQuotationAssistantOutput } from "@/lib/ai/quotation-assistant";
import { getNvidiaQuotationInsight } from "@/lib/ai/providers/nvidia";
import { getFeatureFlagsForCompany, isFeatureEnabled } from "@/lib/enterprise/features";
import { createClient } from "@/lib/supabase/server";
import { quotationAssistantSchema } from "@/lib/validations/schemas";
import { getErrorMessage } from "@/lib/utils/errors";

export async function POST(request: Request) {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "create", "ai_assistant")) {
      return NextResponse.json({ error: "You do not have permission to use the quotation assistant." }, { status: 403 });
    }
    const supabase = await createClient();
    const flags = await getFeatureFlagsForCompany(supabase, context.companyId);
    if (!isFeatureEnabled(flags, "ai_assistant")) {
      return NextResponse.json({ error: "AI Assistant module is disabled for this company." }, { status: 403 });
    }

    const body = await request.json();
    const parsed = quotationAssistantSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid assistant request" }, { status: 400 });

    const settingsResult = await supabase
      .from("company_settings")
      .select("default_gst_percent, default_margin_percent, default_conversion_charge_per_kg, default_packing_charge, default_transport_charge, minimum_margin_percent, default_payment_terms, default_delivery_terms, ai_enabled, ai_provider, ai_model, allow_external_ai, redact_sensitive_data, max_context_records")
      .eq("company_id", context.companyId)
      .maybeSingle();
    if (settingsResult.error) throw settingsResult.error;
    const settings = (settingsResult.data ?? {}) as Record<string, any>;
    const maxRecords = Math.min(50, Math.max(5, Number(settings.max_context_records ?? 10)));

    const [customersResult, profilesResult, quotesResult] = await Promise.all([
      supabase.from("customers").select("id, customer_name, company_name, customer_type, phone, whatsapp_number, gst_number").eq("company_id", context.companyId).eq("is_active", true).limit(maxRecords),
      supabase.from("aluminium_profiles").select("id, profile_code, profile_name, application_category, section_weight_kg_per_m, finish_options").eq("company_id", context.companyId).eq("is_active", true).limit(maxRecords),
      supabase.from("quotes").select("id, quote_number, status, quote_date, grand_total, customers(customer_name, company_name)").eq("company_id", context.companyId).order("quote_date", { ascending: false }).limit(maxRecords)
    ]);

    if (customersResult.error) throw customersResult.error;
    if (profilesResult.error) throw profilesResult.error;
    if (quotesResult.error) throw quotesResult.error;

    const similarQuotes = (quotesResult.data ?? []).map((quote: any) => ({
      id: quote.id,
      quote_number: quote.quote_number,
      status: quote.status,
      quote_date: quote.quote_date,
      grand_total: quote.grand_total,
      customer_name: quote.customers?.company_name || quote.customers?.customer_name || null
    }));

    const output = buildQuotationAssistantOutput(parsed.data.input_text, {
      customers: customersResult.data ?? [],
      profiles: profilesResult.data ?? [],
      similarQuotes,
      settings
    });

    if (settings.ai_enabled && settings.allow_external_ai && settings.ai_provider === "nvidia") {
      const nvidiaResult = await getNvidiaQuotationInsight({
        redactedInputText: output.redactedInputText,
        localOutput: output,
        model: settings.ai_model && settings.ai_model !== "local-rules-v1" ? settings.ai_model : null
      });
      output.externalAi = nvidiaResult;
      output.externalAiBlocked = nvidiaResult.status !== "completed";
      if (nvidiaResult.status !== "completed") {
        output.warnings.push({ severity: "warning", message: nvidiaResult.error ?? "NVIDIA provider did not return an insight. Local rules were used." });
      }
    } else if (settings.allow_external_ai && settings.ai_provider && settings.ai_provider !== "local_rules") {
      output.externalAi = { provider: settings.ai_provider, model: settings.ai_model ?? "not_configured", status: "skipped", content: null, error: "Only NVIDIA provider is implemented in this release." };
      output.externalAiBlocked = true;
    }

    const interactionStatus = output.externalAi?.status === "failed"
      ? "failed"
      : output.externalAi?.status === "skipped"
        ? "external_blocked"
        : "completed";

    const interactionResult = await supabase.from("ai_interactions").insert({
      company_id: context.companyId,
      user_id: context.userId,
      interaction_type: "quotation_assist",
      input_text: output.redactedInputText,
      output_json: output,
      status: interactionStatus
    }).select().single();
    if (interactionResult.error) throw interactionResult.error;

    const suggestionResult = await supabase.from("quote_suggestions").insert({
      company_id: context.companyId,
      customer_id: output.matchedCustomer?.id ?? null,
      suggested_by: context.userId,
      source_type: parsed.data.source_type,
      source_text: output.redactedInputText,
      suggestion_json: output,
      confidence_score: output.confidenceScore,
      status: "draft"
    }).select().single();
    if (suggestionResult.error) throw suggestionResult.error;

    return NextResponse.json({ output, interaction: interactionResult.data, suggestion: suggestionResult.data });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Quotation assistant failed") }, { status: 500 });
  }
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { createClient } from "@/lib/supabase/browser";
import { getErrorMessage } from "@/lib/utils/errors";
import { companySettingsSchema } from "@/lib/validations/schemas";
import { aiProviders, labelize, type SessionContext } from "@/types/app";

export function SettingsClient({ context, company, settings }: { context: SessionContext; company: Record<string, any>; settings: Record<string, any> | null }) {
  const [companyForm, setCompanyForm] = useState({ ...company });
  const [settingsForm, setSettingsForm] = useState<Record<string, any>>({ default_gst_percent: 18, default_margin_percent: 10, default_conversion_charge_per_kg: 0, default_packing_charge: 0, default_transport_charge: 0, default_quote_validity_days: 15, minimum_margin_percent: 8, require_approval_below_margin: true, quote_prefix: "Q", order_prefix: "O", dispatch_prefix: "D", invoice_prefix: "INV", default_quote_terms: "", default_payment_terms: "", default_delivery_terms: "", default_bank_details: "", default_terms_and_conditions: "", bank_details: "", signature_url: "", enable_customer_portal: false, enable_inventory: false, enable_quality: false, enable_payments: false, ai_enabled: false, ai_provider: "local_rules", ai_model: "local-rules-v1", allow_external_ai: false, redact_sensitive_data: true, max_context_records: 10, ...(settings ?? {}) });
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  async function save() {
    const parsed = companySettingsSchema.safeParse({ company: companyForm, settings: settingsForm });
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Please check settings");
    setSaving(true);
    const companyResult = await supabase.from("companies").update({
      name: parsed.data.company.name,
      legal_name: parsed.data.company.legal_name,
      logo_url: parsed.data.company.logo_url,
      gst_number: parsed.data.company.gst_number,
      phone: parsed.data.company.phone,
      email: parsed.data.company.email,
      website: parsed.data.company.website,
      billing_address: parsed.data.company.billing_address,
      city: parsed.data.company.city,
      state: parsed.data.company.state,
      pincode: parsed.data.company.pincode
    }).eq("id", context.companyId);
    const settingsResult = await supabase.from("company_settings").upsert({
      id: parsed.data.settings.id,
      company_id: context.companyId,
      default_gst_percent: parsed.data.settings.default_gst_percent,
      default_margin_percent: parsed.data.settings.default_margin_percent,
      default_conversion_charge_per_kg: parsed.data.settings.default_conversion_charge_per_kg,
      default_packing_charge: parsed.data.settings.default_packing_charge,
      default_transport_charge: parsed.data.settings.default_transport_charge,
      default_quote_validity_days: parsed.data.settings.default_quote_validity_days,
      minimum_margin_percent: parsed.data.settings.minimum_margin_percent,
      require_approval_below_margin: parsed.data.settings.require_approval_below_margin,
      quote_prefix: parsed.data.settings.quote_prefix,
      order_prefix: parsed.data.settings.order_prefix,
      dispatch_prefix: parsed.data.settings.dispatch_prefix,
      invoice_prefix: parsed.data.settings.invoice_prefix,
      default_quote_terms: parsed.data.settings.default_quote_terms,
      default_payment_terms: parsed.data.settings.default_payment_terms,
      default_delivery_terms: parsed.data.settings.default_delivery_terms,
      default_bank_details: parsed.data.settings.default_bank_details,
      default_terms_and_conditions: parsed.data.settings.default_terms_and_conditions,
      enable_customer_portal: parsed.data.settings.enable_customer_portal,
      enable_inventory: parsed.data.settings.enable_inventory,
      enable_quality: parsed.data.settings.enable_quality,
      enable_payments: parsed.data.settings.enable_payments,
      ai_enabled: parsed.data.settings.ai_enabled,
      ai_provider: parsed.data.settings.ai_provider,
      ai_model: parsed.data.settings.ai_model,
      allow_external_ai: parsed.data.settings.allow_external_ai,
      redact_sensitive_data: parsed.data.settings.redact_sensitive_data,
      max_context_records: parsed.data.settings.max_context_records,
      bank_details: parsed.data.settings.bank_details,
      signature_url: parsed.data.settings.signature_url
    });
    setSaving(false);
    if (companyResult.error || settingsResult.error) return toast.error(getErrorMessage(companyResult.error ?? settingsResult.error, "Could not save settings"));
    toast.success("Settings saved");
  }

  const companyField = (name: string, label: string, textarea = false) => <label className="block space-y-1.5"><span className="form-label">{label}</span>{textarea ? <textarea className="form-input min-h-24" value={companyForm[name] ?? ""} onChange={(event) => setCompanyForm({ ...companyForm, [name]: event.target.value })} /> : <input className="form-input" value={companyForm[name] ?? ""} onChange={(event) => setCompanyForm({ ...companyForm, [name]: event.target.value })} />}</label>;
  const settingsField = (name: string, label: string, type = "number", textarea = false) => <label className="block space-y-1.5"><span className="form-label">{label}</span>{textarea ? <textarea className="form-input min-h-28" value={settingsForm[name] ?? ""} onChange={(event) => setSettingsForm({ ...settingsForm, [name]: event.target.value })} /> : <input className="form-input" type={type} inputMode={type === "number" ? "decimal" : undefined} min={type === "number" ? "0" : undefined} value={settingsForm[name] ?? ""} onChange={(event) => setSettingsForm({ ...settingsForm, [name]: event.target.value })} />}</label>;
  const settingsSelect = (name: string, label: string, options: string[]) => <label className="block space-y-1.5"><span className="form-label">{label}</span><select className="form-input" value={settingsForm[name] ?? ""} onChange={(event) => setSettingsForm({ ...settingsForm, [name]: event.target.value })}>{options.map((option) => <option key={option} value={option}>{labelize(option)}</option>)}</select></label>;
  const settingsToggle = (name: string, label: string) => <label className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm font-bold text-slate-800"><span>{label}</span><input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-orange" checked={Boolean(settingsForm[name])} onChange={(event) => setSettingsForm({ ...settingsForm, [name]: event.target.checked })} /></label>;

  return (
    <div>
      <PageHeader title="Settings" description="Configure company profile, quotation defaults, bank details, logo, signature, and V1 user-management roadmap." actions={<Button disabled={saving} onClick={save}>{saving ? "Saving..." : "Save settings"}</Button>} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card><CardHeader><h2 className="text-lg font-bold">Company Profile</h2></CardHeader><CardContent><div className="grid gap-4 sm:grid-cols-2">{companyField("name", "Company name")}{companyField("legal_name", "Legal name")}{companyField("gst_number", "GST number")}{companyField("phone", "Phone")}{companyField("email", "Email")}{companyField("website", "Website")}{companyField("city", "City")}{companyField("state", "State")}{companyField("pincode", "Pincode")}{companyField("logo_url", "Logo URL")}{companyField("billing_address", "Billing address", true)}</div></CardContent></Card>
        <Card><CardHeader><h2 className="text-lg font-bold">Quotation Defaults</h2></CardHeader><CardContent><div className="grid gap-4 sm:grid-cols-2">{settingsField("default_gst_percent", "Default GST %")}{settingsField("default_margin_percent", "Default margin %")}{settingsField("minimum_margin_percent", "Minimum margin %")}{settingsField("default_conversion_charge_per_kg", "Conversion charge/kg")}{settingsField("default_packing_charge", "Packing charge")}{settingsField("default_transport_charge", "Transport charge")}{settingsField("default_quote_validity_days", "Quote validity days")}{settingsToggle("require_approval_below_margin", "Require approval below minimum margin")}{settingsField("default_payment_terms", "Default payment terms", "text", true)}{settingsField("default_delivery_terms", "Default delivery terms", "text", true)}{settingsField("default_terms_and_conditions", "Default terms and conditions", "text", true)}</div></CardContent></Card>
        <Card><CardHeader><h2 className="text-lg font-bold">Numbering Settings</h2></CardHeader><CardContent><div className="grid gap-4 sm:grid-cols-2">{settingsField("quote_prefix", "Quote prefix", "text")}{settingsField("order_prefix", "Order prefix", "text")}{settingsField("dispatch_prefix", "Dispatch prefix", "text")}{settingsField("invoice_prefix", "Invoice prefix", "text")}</div></CardContent></Card>
        <Card><CardHeader><h2 className="text-lg font-bold">Bank and PDF Branding</h2></CardHeader><CardContent><div className="space-y-4">{settingsField("default_bank_details", "Bank name, account name, account number, IFSC, branch, UPI", "text", true)}{settingsField("signature_url", "Authorized signature URL", "text")}</div></CardContent></Card>
        <Card><CardHeader><h2 className="text-lg font-bold">AI Assistant Settings</h2></CardHeader><CardContent><div className="grid gap-4 sm:grid-cols-2">{settingsToggle("ai_enabled", "Enable AI assistant")}{settingsToggle("allow_external_ai", "Allow external AI providers")}{settingsToggle("redact_sensitive_data", "Redact sensitive data before AI")}{settingsSelect("ai_provider", "AI provider", aiProviders)}{settingsField("ai_model", "AI model", "text")}{settingsField("max_context_records", "Max context records")}</div><p className="mt-4 rounded-2xl border border-orange/20 bg-orange/5 p-4 text-sm font-medium text-slate-700">For NVIDIA, set provider to NVIDIA, model to meta/llama-3.3-70b-instruct, enable external AI, and configure NVIDIA_API_KEY on the server. Secrets are never stored in the browser or database.</p></CardContent></Card>
        <Card><CardHeader><h2 className="text-lg font-bold">Feature Controls and Users</h2></CardHeader><CardContent><div className="space-y-4">{settingsToggle("enable_customer_portal", "Enable customer portal")}{settingsToggle("enable_inventory", "Enable inventory")}{settingsToggle("enable_quality", "Enable quality")}{settingsToggle("enable_payments", "Enable payments")}<div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5"><p className="font-bold text-slate-900">Enterprise user controls</p><p className="mt-1 text-sm text-slate-600">Invite records, role changes, branch assignments, and deactivation are now managed from Enterprise Foundation.</p></div></div></CardContent></Card>
      </div>
    </div>
  );
}

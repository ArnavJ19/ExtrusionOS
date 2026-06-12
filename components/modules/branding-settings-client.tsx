"use client";

import { useMemo, useState, type ComponentType } from "react";
import { toast } from "sonner";
import { Paintbrush, Globe, FileText, MessageSquareText, Image as ImageIcon, Palette } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/browser";
import { getErrorMessage } from "@/lib/utils/errors";
import { brandingSettingsSchema } from "@/lib/validations/schemas";

type Props = {
  company: Record<string, any>;
  settings: Record<string, any> | null;
};

const themes = [
  { value: "industrial_classic", label: "Industrial Classic" },
  { value: "aluminium_modern", label: "Aluminium Modern" },
  { value: "minimal_mono", label: "Minimal Mono" },
  { value: "executive_blueprint", label: "Executive Blueprint" }
];

export function BrandingSettingsClient({ company, settings }: Props) {
  const [saving, setSaving] = useState(false);
  const [companyForm, setCompanyForm] = useState({ id: company.id, logo_url: company.logo_url ?? "" });
  const [form, setForm] = useState<Record<string, any>>({
    id: settings?.id ?? null,
    brand_primary_color: settings?.brand_primary_color ?? "#F97316",
    brand_secondary_color: settings?.brand_secondary_color ?? "#1E293B",
    pdf_theme: settings?.pdf_theme ?? "industrial_classic",
    portal_logo_url: settings?.portal_logo_url ?? "",
    portal_banner_url: settings?.portal_banner_url ?? "",
    custom_domain: settings?.custom_domain ?? "",
    default_email_signature: settings?.default_email_signature ?? "",
    default_whatsapp_signature: settings?.default_whatsapp_signature ?? "",
    footer_text: settings?.footer_text ?? ""
  });

  const supabase = createClient();

  const previewStyle = useMemo(() => ({
    background: `linear-gradient(135deg, ${form.brand_secondary_color ?? "#1E293B"} 0%, #0f172a 56%, ${form.brand_primary_color ?? "#F97316"} 100%)`
  }), [form.brand_primary_color, form.brand_secondary_color]);

  async function save() {
    const parsed = brandingSettingsSchema.safeParse({ company: companyForm, settings: form });
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Please check branding settings");

    setSaving(true);
    const [companyResult, settingsResult] = await Promise.all([
      supabase.from("companies").update({ logo_url: parsed.data.company.logo_url }).eq("id", company.id),
      supabase.from("company_settings").upsert({
        id: parsed.data.settings.id,
        company_id: company.id,
        brand_primary_color: parsed.data.settings.brand_primary_color,
        brand_secondary_color: parsed.data.settings.brand_secondary_color,
        pdf_theme: parsed.data.settings.pdf_theme,
        portal_logo_url: parsed.data.settings.portal_logo_url,
        portal_banner_url: parsed.data.settings.portal_banner_url,
        custom_domain: parsed.data.settings.custom_domain,
        default_email_signature: parsed.data.settings.default_email_signature,
        default_whatsapp_signature: parsed.data.settings.default_whatsapp_signature,
        footer_text: parsed.data.settings.footer_text
      })
    ]);
    setSaving(false);

    if (companyResult.error || settingsResult.error) return toast.error(getErrorMessage(companyResult.error ?? settingsResult.error, "Could not save branding settings"));
    toast.success("Branding settings saved");
  }

  const inputField = (name: string, label: string, Icon?: ComponentType<{ className?: string }>) => (
    <label className="block space-y-1.5">
      <span className="form-label inline-flex items-center gap-2">{Icon ? <Icon className="h-4 w-4 text-orange" /> : null}{label}</span>
      <input className="form-input" value={form[name] ?? ""} onChange={(event) => setForm({ ...form, [name]: event.target.value })} />
    </label>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Branding" description="Configure white-label identity for PDFs, portal pages, customer communication, and enterprise documents." actions={<Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save branding"}</Button>} />

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader><h2 className="section-title">White-Label Settings</h2></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5"><span className="form-label inline-flex items-center gap-2"><Palette className="h-4 w-4 text-orange" /> Brand primary color</span><input type="color" className="h-11 w-full rounded-xl border border-slate-200 bg-white p-1" value={form.brand_primary_color ?? "#F97316"} onChange={(event) => setForm({ ...form, brand_primary_color: event.target.value })} /></label>
            <label className="block space-y-1.5"><span className="form-label inline-flex items-center gap-2"><Paintbrush className="h-4 w-4 text-orange" /> Brand secondary color</span><input type="color" className="h-11 w-full rounded-xl border border-slate-200 bg-white p-1" value={form.brand_secondary_color ?? "#1E293B"} onChange={(event) => setForm({ ...form, brand_secondary_color: event.target.value })} /></label>

            <label className="block space-y-1.5 sm:col-span-2">
              <span className="form-label inline-flex items-center gap-2"><FileText className="h-4 w-4 text-orange" /> PDF theme</span>
              <select className="form-input" value={form.pdf_theme ?? "industrial_classic"} onChange={(event) => setForm({ ...form, pdf_theme: event.target.value })}>
                {themes.map((theme) => <option key={theme.value} value={theme.value}>{theme.label}</option>)}
              </select>
            </label>

            {inputField("portal_logo_url", "Portal logo URL", ImageIcon)}
            {inputField("portal_banner_url", "Portal banner URL", ImageIcon)}
            {inputField("custom_domain", "Custom domain (readiness)", Globe)}

            <label className="block space-y-1.5 sm:col-span-2"><span className="form-label">Company logo URL (global)</span><input className="form-input" value={companyForm.logo_url ?? ""} onChange={(event) => setCompanyForm({ ...companyForm, logo_url: event.target.value })} /></label>

            <label className="block space-y-1.5 sm:col-span-2"><span className="form-label inline-flex items-center gap-2"><MessageSquareText className="h-4 w-4 text-orange" /> Default email signature</span><textarea className="form-input min-h-24" value={form.default_email_signature ?? ""} onChange={(event) => setForm({ ...form, default_email_signature: event.target.value })} /></label>
            <label className="block space-y-1.5 sm:col-span-2"><span className="form-label inline-flex items-center gap-2"><MessageSquareText className="h-4 w-4 text-orange" /> Default WhatsApp signature</span><textarea className="form-input min-h-24" value={form.default_whatsapp_signature ?? ""} onChange={(event) => setForm({ ...form, default_whatsapp_signature: event.target.value })} /></label>
            <label className="block space-y-1.5 sm:col-span-2"><span className="form-label">Footer text</span><textarea className="form-input min-h-24" value={form.footer_text ?? ""} onChange={(event) => setForm({ ...form, footer_text: event.target.value })} /></label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h2 className="section-title">Live Brand Preview</h2></CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="p-5 text-white" style={previewStyle}>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-white/70">ExtrusionOS Enterprise</p>
                <p className="mt-2 text-xl font-black">{company.name || "Your Company"}</p>
                <p className="mt-1 text-sm font-medium text-white/80">{themes.find((item) => item.value === form.pdf_theme)?.label || "Industrial Classic"} PDF theme</p>
              </div>
              <div className="space-y-4 p-5">
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-sm font-black text-slate-950">Customer Email Signature</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm font-medium leading-6 text-slate-600">{form.default_email_signature || "Regards,\nSales Team\nExtrusionOS Enterprise"}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-sm font-black text-slate-950">WhatsApp Signature</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm font-medium leading-6 text-slate-600">{form.default_whatsapp_signature || "Thanks,\nTeam ExtrusionOS"}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Footer</p>
                  <p className="mt-2 text-sm font-medium text-slate-700">{form.footer_text || "This document is system generated by ExtrusionOS Enterprise."}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

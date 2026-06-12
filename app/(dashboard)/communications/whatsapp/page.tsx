"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { formatDate } from "@/lib/utils/format";

type TemplateRow = {
  id: string;
  template_name: string;
  template_category: string;
  approval_status: string;
  is_active: boolean;
  updated_at: string;
};

type CampaignRow = {
  id: string;
  campaign_name: string;
  trigger_event: string;
  delay_hours: number;
  is_active: boolean;
  whatsapp_templates: { template_name: string } | null;
};

type MessageRow = {
  id: string;
  recipient_phone: string;
  status: string;
  message_body: string;
  related_entity_type: string | null;
  created_at: string;
  sent_at: string | null;
  whatsapp_templates: { template_name: string } | null;
  customers: { customer_name: string; company_name: string | null } | null;
};

type CustomerRow = {
  id: string;
  customer_name: string;
  company_name: string | null;
  whatsapp_number: string | null;
  phone: string | null;
};

function firstRelation<Relation>(relation: Relation | Relation[] | null | undefined): Relation | null {
  if (Array.isArray(relation)) return relation[0] ?? null;
  return relation ?? null;
}

export default function WhatsAppAutomationPage() {
  const supabase = createClient();
  const [tab, setTab] = useState<"templates" | "campaigns" | "logs">("templates");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [logs, setLogs] = useState<MessageRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [templateForm, setTemplateForm] = useState({ template_name: "", template_category: "quote_followup", body: "" });
  const [campaignForm, setCampaignForm] = useState({ campaign_name: "", trigger_event: "quote_sent", delay_hours: "0", template_id: "" });
  const [logForm, setLogForm] = useState({ customer_id: "", template_id: "", related_entity_type: "quote", related_entity_id: "", message_body: "", recipient_phone: "" });

  async function loadData() {
    setLoading(true);
    setError("");
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser();
    if (authError || !user) {
      setError(authError?.message ?? "Unable to load WhatsApp workspace");
      setLoading(false);
      return;
    }

    const { data: appUser, error: appUserError } = await supabase.from("app_users").select("company_id").eq("id", user.id).single();
    if (appUserError || !appUser?.company_id) {
      setError(appUserError?.message ?? "Could not resolve company");
      setLoading(false);
      return;
    }
    setCompanyId(appUser.company_id);
    const scopedCompanyId = appUser.company_id;

    const [templateRes, campaignRes, logRes, customerRes] = await Promise.all([
      supabase.from("whatsapp_templates").select("id, template_name, template_category, approval_status, is_active, updated_at").eq("company_id", scopedCompanyId).order("updated_at", { ascending: false }).limit(100),
      supabase.from("message_campaigns").select("id, campaign_name, trigger_event, delay_hours, is_active, whatsapp_templates(template_name)").eq("company_id", scopedCompanyId).order("created_at", { ascending: false }).limit(100),
      supabase.from("outbound_messages").select("id, recipient_phone, status, message_body, related_entity_type, created_at, sent_at, whatsapp_templates(template_name), customers(customer_name, company_name)").eq("company_id", scopedCompanyId).eq("channel", "whatsapp").order("created_at", { ascending: false }).limit(100),
      supabase.from("customers").select("id, customer_name, company_name, whatsapp_number, phone").eq("company_id", scopedCompanyId).eq("is_active", true).order("customer_name", { ascending: true }).limit(300)
    ]);

    if (templateRes.error || campaignRes.error || logRes.error || customerRes.error) {
      setError(templateRes.error?.message || campaignRes.error?.message || logRes.error?.message || customerRes.error?.message || "Failed to load WhatsApp data");
    }

    setTemplates((templateRes.data ?? []) as TemplateRow[]);
    setCampaigns(
      (campaignRes.data ?? []).map((row) => ({
        ...row,
        whatsapp_templates: firstRelation(row.whatsapp_templates),
      })) as CampaignRow[]
    );
    setLogs(
      (logRes.data ?? []).map((row) => ({
        ...row,
        whatsapp_templates: firstRelation(row.whatsapp_templates),
        customers: firstRelation(row.customers),
      })) as MessageRow[]
    );
    setCustomers((customerRes.data ?? []) as CustomerRow[]);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  const customerOptions = useMemo(() => customers.map((c) => ({ id: c.id, label: c.company_name || c.customer_name, phone: c.whatsapp_number || c.phone || "" })), [customers]);

  async function createTemplate(event: React.FormEvent) {
    event.preventDefault();
    if (!companyId) return;
    setSaving(true);
    const { error: insertError } = await supabase.from("whatsapp_templates").insert({
      company_id: companyId,
      template_name: templateForm.template_name.trim(),
      template_category: templateForm.template_category.trim(),
      body: templateForm.body.trim(),
      approval_status: "draft",
      is_active: false
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setTemplateForm({ template_name: "", template_category: "quote_followup", body: "" });
    await loadData();
  }

  async function createCampaign(event: React.FormEvent) {
    event.preventDefault();
    if (!companyId) return;
    setSaving(true);
    const { error: insertError } = await supabase.from("message_campaigns").insert({
      company_id: companyId,
      campaign_name: campaignForm.campaign_name.trim(),
      trigger_event: campaignForm.trigger_event.trim(),
      delay_hours: Number(campaignForm.delay_hours || 0),
      template_id: campaignForm.template_id || null,
      is_active: true
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setCampaignForm({ campaign_name: "", trigger_event: "quote_sent", delay_hours: "0", template_id: "" });
    await loadData();
  }

  async function logMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!companyId) return;
    setSaving(true);
    const { error: insertError } = await supabase.from("outbound_messages").insert({
      company_id: companyId,
      customer_id: logForm.customer_id || null,
      related_entity_type: logForm.related_entity_type || null,
      related_entity_id: logForm.related_entity_id || null,
      channel: "whatsapp",
      template_id: logForm.template_id || null,
      message_body: logForm.message_body.trim(),
      recipient_phone: logForm.recipient_phone.trim(),
      status: "manually_logged",
      sent_at: new Date().toISOString()
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setLogForm({ customer_id: "", template_id: "", related_entity_type: "quote", related_entity_id: "", message_body: "", recipient_phone: "" });
    await loadData();
  }

  return (
    <div className="space-y-6">
      <PageHeader title="WhatsApp Communications" description="Manage real templates, paused campaign trigger drafts, and outbound communication logs linked to ERP entities." />
      <QueryErrorNotice messages={error ? [error] : []} />

      <div className="border-b border-slate-200">
        <nav className="-mb-px flex gap-6">
          {[
            { id: "templates", label: "Message Templates" },
            { id: "campaigns", label: "Campaign Registry" },
            { id: "logs", label: "Outbound Logs" }
          ].map((item) => (
            <button key={item.id} onClick={() => setTab(item.id as typeof tab)} className={`whitespace-nowrap border-b-2 py-4 px-1 text-sm font-bold transition-colors ${tab === item.id ? "border-orange text-orange" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"}`}>
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === "templates" ? (
        <Card>
          <CardHeader><h2 className="section-title">Template Registry</h2></CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={createTemplate} className="grid gap-3 md:grid-cols-2">
              <label className="block space-y-1.5"><span className="form-label">Template name</span><input className="form-input" value={templateForm.template_name} required onChange={(event) => setTemplateForm({ ...templateForm, template_name: event.target.value })} /></label>
              <label className="block space-y-1.5"><span className="form-label">Category</span><input className="form-input" value={templateForm.template_category} required onChange={(event) => setTemplateForm({ ...templateForm, template_category: event.target.value })} /></label>
              <label className="block space-y-1.5 md:col-span-2"><span className="form-label">Body</span><textarea className="form-input min-h-24" value={templateForm.body} required onChange={(event) => setTemplateForm({ ...templateForm, body: event.target.value })} /></label>
              <div className="md:col-span-2"><Button type="submit" disabled={saving}>{saving ? "Saving..." : "Create Template"}</Button></div>
            </form>
            {loading ? <LoadingState title="Loading templates" description="Fetching provider template registry." /> : templates.length ? (
              <div className="space-y-3">
                {templates.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                    <div><p className="font-black text-slate-900">{item.template_name}</p><p className="text-sm text-slate-500">Category: {item.template_category}</p></div>
                    <div className="flex items-center gap-2"><Badge value={item.approval_status} /><Badge value={item.is_active ? "active" : "inactive"} /></div>
                  </div>
                ))}
              </div>
            ) : <EmptyState title="No templates found" description="Create approved templates for quote, order, dispatch and payment communication flows." />}
          </CardContent>
        </Card>
      ) : null}

      {tab === "campaigns" ? (
        <Card>
          <CardHeader><h2 className="section-title">Campaign Trigger Registry</h2></CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-900">
              WhatsApp campaign execution is not enabled in this release. Saved trigger records stay paused until a provider-backed executor is configured and audited.
            </div>
            <form onSubmit={createCampaign} className="grid gap-3 md:grid-cols-2">
              <label className="block space-y-1.5"><span className="form-label">Campaign name</span><input className="form-input" value={campaignForm.campaign_name} required onChange={(event) => setCampaignForm({ ...campaignForm, campaign_name: event.target.value })} /></label>
              <label className="block space-y-1.5"><span className="form-label">Trigger event</span><input className="form-input" value={campaignForm.trigger_event} required onChange={(event) => setCampaignForm({ ...campaignForm, trigger_event: event.target.value })} /></label>
              <label className="block space-y-1.5"><span className="form-label">Delay (hours)</span><input className="form-input" type="number" min={0} value={campaignForm.delay_hours} onChange={(event) => setCampaignForm({ ...campaignForm, delay_hours: event.target.value })} /></label>
              <label className="block space-y-1.5"><span className="form-label">Template</span><select className="form-input" value={campaignForm.template_id} onChange={(event) => setCampaignForm({ ...campaignForm, template_id: event.target.value })}><option value="">No template</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.template_name}</option>)}</select></label>
              <div className="md:col-span-2"><Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save Paused Trigger"}</Button></div>
            </form>
            {loading ? <LoadingState title="Loading campaign registry" description="Fetching paused trigger records and template links." /> : campaigns.length ? (
              <div className="space-y-3">
                {campaigns.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3"><p className="font-black text-slate-900">{item.campaign_name}</p><Badge value={item.is_active ? "execution enabled" : "paused registry"} /></div>
                    <p className="mt-1 text-sm text-slate-600">Trigger: {item.trigger_event.replace(/_/g, " ")} · Delay: {item.delay_hours}h</p>
                    <p className="mt-1 text-xs font-bold text-slate-500">Template: {item.whatsapp_templates?.template_name || "Not linked"}</p>
                  </div>
                ))}
              </div>
            ) : <EmptyState title="No campaign trigger records found" description="Save paused trigger records for quote follow-up, dispatch updates and overdue reminders once execution is available." />}
          </CardContent>
        </Card>
      ) : null}

      {tab === "logs" ? (
        <Card>
          <CardHeader><h2 className="section-title">Outbound Log</h2></CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={logMessage} className="grid gap-3 md:grid-cols-2">
              <label className="block space-y-1.5"><span className="form-label">Customer</span><select className="form-input" value={logForm.customer_id} onChange={(event) => { const selected = customerOptions.find((item) => item.id === event.target.value); setLogForm({ ...logForm, customer_id: event.target.value, recipient_phone: selected?.phone || logForm.recipient_phone }); }}><option value="">No customer link</option>{customerOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
              <label className="block space-y-1.5"><span className="form-label">Template</span><select className="form-input" value={logForm.template_id} onChange={(event) => setLogForm({ ...logForm, template_id: event.target.value })}><option value="">No template</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.template_name}</option>)}</select></label>
              <label className="block space-y-1.5"><span className="form-label">Related entity type</span><select className="form-input" value={logForm.related_entity_type} onChange={(event) => setLogForm({ ...logForm, related_entity_type: event.target.value })}>{["quote", "order", "dispatch", "invoice", "payment", "task"].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
              <label className="block space-y-1.5"><span className="form-label">Related entity UUID</span><input className="form-input" value={logForm.related_entity_id} onChange={(event) => setLogForm({ ...logForm, related_entity_id: event.target.value })} /></label>
              <label className="block space-y-1.5"><span className="form-label">Recipient phone</span><input className="form-input" value={logForm.recipient_phone} required onChange={(event) => setLogForm({ ...logForm, recipient_phone: event.target.value })} /></label>
              <label className="block space-y-1.5 md:col-span-2"><span className="form-label">Message body</span><textarea className="form-input min-h-24" value={logForm.message_body} required onChange={(event) => setLogForm({ ...logForm, message_body: event.target.value })} /></label>
              <div className="md:col-span-2"><Button type="submit" disabled={saving}>{saving ? "Saving..." : "Log Outbound Message"}</Button></div>
            </form>
            {loading ? <LoadingState title="Loading logs" description="Fetching outbound delivery history." /> : logs.length ? (
              <div className="overflow-x-auto">
                <table className="industrial-table min-w-[980px]">
                  <thead><tr><th>Recipient</th><th>Customer</th><th>Template</th><th>Status</th><th>Entity</th><th>Sent</th></tr></thead>
                  <tbody>
                    {logs.map((item) => (
                      <tr key={item.id}>
                        <td className="font-black text-slate-950">{item.recipient_phone}</td>
                        <td>{item.customers?.company_name || item.customers?.customer_name || "-"}</td>
                        <td>{item.whatsapp_templates?.template_name || "-"}</td>
                        <td><Badge value={item.status} /></td>
                        <td>{item.related_entity_type || "-"}</td>
                        <td>{item.sent_at ? formatDate(item.sent_at) : formatDate(item.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState title="No outbound logs found" description="Logged and provider-synced WhatsApp records will appear here." />}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

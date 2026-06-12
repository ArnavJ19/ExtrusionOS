"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Target, TrendingUp, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { formatCompactCurrency, formatDate } from "@/lib/utils/format";

type Lead = {
  id: string;
  lead_name: string;
  company_name: string | null;
  contact_person: string | null;
  city: string | null;
  lead_source: string;
  customer_type: string;
  estimated_value: number;
  status: string;
};

type Opportunity = {
  id: string;
  opportunity_name: string;
  company_name: string | null;
  estimated_value: number;
  expected_close_date: string | null;
  probability_percent: number;
  stage: string;
};

type Activity = {
  id: string;
  activity_type: string;
  activity_date: string;
  next_followup_date: string | null;
  notes: string | null;
  leads: { company_name: string | null; lead_name: string } | null;
  customers: { customer_name: string; company_name: string | null } | null;
};

type SalesTarget = {
  id: string;
  salesperson_name: string;
  target_value: number;
  achieved_value: number;
  target_leads: number;
  achieved_leads: number;
  target_visits: number;
  achieved_visits: number;
};

const opportunityStages = ["all", "enquiry", "requirement_collected", "quote_preparation", "quote_sent", "negotiation", "sampling", "approved", "won", "lost"];

function firstRelation<Relation>(relation: Relation | Relation[] | null | undefined): Relation | null {
  if (Array.isArray(relation)) return relation[0] ?? null;
  return relation ?? null;
}

export default function CrmPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [savingLead, setSavingLead] = useState(false);
  const [error, setError] = useState("");
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [stage, setStage] = useState("all");
  const [followupCutoffTime, setFollowupCutoffTime] = useState<number | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [targets, setTargets] = useState<SalesTarget[]>([]);
  const [leadForm, setLeadForm] = useState({
    lead_name: "",
    company_name: "",
    contact_person: "",
    city: "",
    lead_source: "other",
    customer_type: "fabricator",
    estimated_value: ""
  });

  async function loadCrmData() {
    setLoading(true);
    setError("");
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser();
    if (authError || !user) {
      setError(authError?.message ?? "Could not load CRM session");
      setLoading(false);
      return;
    }

    const { data: appUser, error: appUserError } = await supabase.from("app_users").select("company_id").eq("id", user.id).single();
    if (appUserError || !appUser?.company_id) {
      setError(appUserError?.message ?? "Could not resolve company for CRM");
      setLoading(false);
      return;
    }
    setCompanyId(appUser.company_id);
    const scopedCompanyId = appUser.company_id;
    setFollowupCutoffTime(Date.now() + 3 * 24 * 60 * 60 * 1000);

    const [leadRes, oppRes, activityRes, targetRes] = await Promise.all([
      supabase.from("leads").select("id, lead_name, company_name, contact_person, city, lead_source, customer_type, estimated_value, status").eq("company_id", scopedCompanyId).order("created_at", { ascending: false }).limit(100),
      supabase.from("opportunities").select("id, opportunity_name, company_name, estimated_value, expected_close_date, probability_percent, stage").eq("company_id", scopedCompanyId).order("created_at", { ascending: false }).limit(100),
      supabase.from("sales_activities").select("id, activity_type, activity_date, next_followup_date, notes, leads(lead_name, company_name), customers(customer_name, company_name)").eq("company_id", scopedCompanyId).order("activity_date", { ascending: false }).limit(100),
      supabase.from("sales_targets").select("id, salesperson_name, target_value, achieved_value, target_leads, achieved_leads, target_visits, achieved_visits").eq("company_id", scopedCompanyId).order("updated_at", { ascending: false }).limit(50)
    ]);

    if (leadRes.error || oppRes.error || activityRes.error || targetRes.error) {
      setError(leadRes.error?.message || oppRes.error?.message || activityRes.error?.message || targetRes.error?.message || "Failed to load CRM records");
    }

    setLeads((leadRes.data ?? []) as Lead[]);
    setOpportunities((oppRes.data ?? []) as Opportunity[]);
    setActivities(
      (activityRes.data ?? []).map((row) => ({
        ...row,
        leads: firstRelation(row.leads),
        customers: firstRelation(row.customers),
      })) as Activity[]
    );
    setTargets((targetRes.data ?? []) as SalesTarget[]);
    setLoading(false);
  }

  useEffect(() => {
    loadCrmData();
  }, []);

  const filteredOpportunities = useMemo(() => stage === "all" ? opportunities : opportunities.filter((item) => item.stage === stage), [opportunities, stage]);
  const pipelineValue = useMemo(() => opportunities.filter((item) => item.stage !== "lost").reduce((sum, item) => sum + Number(item.estimated_value ?? 0), 0), [opportunities]);
  const weightedPipeline = useMemo(() => opportunities.filter((item) => item.stage !== "lost").reduce((sum, item) => sum + Number(item.estimated_value ?? 0) * (Number(item.probability_percent ?? 0) / 100), 0), [opportunities]);
  const followupsDue = useMemo(() => {
    if (!followupCutoffTime) return [];
    return activities.filter((item) => item.next_followup_date && new Date(item.next_followup_date).getTime() <= followupCutoffTime);
  }, [activities, followupCutoffTime]);
  const quoteConversionRate = useMemo(() => opportunities.length ? Math.round((opportunities.filter((item) => ["won", "approved", "sampling"].includes(item.stage)).length / opportunities.length) * 100) : 0, [opportunities]);

  async function createLead(event: React.FormEvent) {
    event.preventDefault();
    if (!companyId) return;
    setSavingLead(true);
    const response = await fetch("/api/crm/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lead_name: leadForm.lead_name.trim(),
        company_name: leadForm.company_name.trim() || null,
        contact_person: leadForm.contact_person.trim() || null,
        city: leadForm.city.trim() || null,
        lead_source: leadForm.lead_source,
        customer_type: leadForm.customer_type,
        estimated_value: Number(leadForm.estimated_value || 0),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setSavingLead(false);
    if (!response.ok) {
      setError(payload.error ?? "Could not create lead");
      return;
    }
    setLeadForm({ lead_name: "", company_name: "", contact_person: "", city: "", lead_source: "other", customer_type: "fabricator", estimated_value: "" });
    await loadCrmData();
  }

  return (
    <div className="space-y-6">
      <PageHeader title="CRM and Sales Pipeline" description="Real lead, opportunity, activity, and sales target tracking for quote and order conversion." />
      <QueryErrorNotice messages={error ? [error] : []} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Metric icon={Target} label="Pipeline" value={formatCompactCurrency(pipelineValue)} />
        <Metric icon={TrendingUp} label="Weighted" value={formatCompactCurrency(weightedPipeline)} />
        <Metric icon={CalendarClock} label="Follow-ups" value={String(followupsDue.length)} />
        <Metric icon={Users} label="Active Leads" value={String(leads.filter((item) => !["lost", "dormant"].includes(item.status)).length)} />
        <Metric icon={CheckCircle2} label="Quote Conv." value={`${quoteConversionRate}%`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader><h2 className="section-title">Create Lead</h2></CardHeader>
          <CardContent>
            <form onSubmit={createLead} className="grid gap-3 md:grid-cols-2">
              <label className="block space-y-1.5 md:col-span-2"><span className="form-label">Lead title</span><input className="form-input" value={leadForm.lead_name} required onChange={(event) => setLeadForm({ ...leadForm, lead_name: event.target.value })} /></label>
              <label className="block space-y-1.5"><span className="form-label">Company</span><input className="form-input" value={leadForm.company_name} onChange={(event) => setLeadForm({ ...leadForm, company_name: event.target.value })} /></label>
              <label className="block space-y-1.5"><span className="form-label">Contact person</span><input className="form-input" value={leadForm.contact_person} onChange={(event) => setLeadForm({ ...leadForm, contact_person: event.target.value })} /></label>
              <label className="block space-y-1.5"><span className="form-label">City</span><input className="form-input" value={leadForm.city} onChange={(event) => setLeadForm({ ...leadForm, city: event.target.value })} /></label>
              <label className="block space-y-1.5"><span className="form-label">Estimated value (INR)</span><input className="form-input" type="number" min={0} value={leadForm.estimated_value} onChange={(event) => setLeadForm({ ...leadForm, estimated_value: event.target.value })} /></label>
              <label className="block space-y-1.5"><span className="form-label">Lead source</span><select className="form-input" value={leadForm.lead_source} onChange={(event) => setLeadForm({ ...leadForm, lead_source: event.target.value })}>{["other", "referral", "website", "indiaMart", "tradeIndia", "exhibition", "field_sales", "architect", "contractor", "government_tender", "repeat_customer"].map((item) => <option key={item} value={item}>{item.replace(/_/g, " ")}</option>)}</select></label>
              <label className="block space-y-1.5"><span className="form-label">Customer type</span><select className="form-input" value={leadForm.customer_type} onChange={(event) => setLeadForm({ ...leadForm, customer_type: event.target.value })}>{["fabricator", "dealer", "architect", "industrial", "solar", "government", "export", "contractor", "other"].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
              <div className="md:col-span-2"><Button type="submit" disabled={savingLead}>{savingLead ? "Saving..." : "Create Lead"}</Button></div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h2 className="section-title">Follow-ups Due</h2></CardHeader>
          <CardContent className="space-y-3">
            {loading ? <LoadingState title="Loading follow-ups" description="Fetching sales activities." /> : followupsDue.length ? followupsDue.map((item) => (
              <div key={item.id} className="rounded-2xl border border-orange/20 bg-orange/5 p-4">
                <div className="flex items-center justify-between gap-3"><p className="font-black text-slate-950">{item.customers?.company_name || item.customers?.customer_name || item.leads?.company_name || item.leads?.lead_name || "Lead"}</p><Badge value={item.activity_type} /></div>
                <p className="mt-1 text-xs font-bold text-slate-500">Next {item.next_followup_date ? formatDate(item.next_followup_date) : "-"}</p>
                <p className="mt-1 text-sm text-slate-700">{item.notes || "No follow-up notes"}</p>
              </div>
            )) : <EmptyState title="No follow-ups due" description="Upcoming activities and reminders will appear here." />}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="section-title">Opportunities</h2>
            <div className="flex flex-wrap gap-2">
              {opportunityStages.map((item) => <button key={item} onClick={() => setStage(item)} className={`rounded-full px-3 py-1.5 text-xs font-black capitalize transition ${stage === item ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{item.replace(/_/g, " ")}</button>)}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <LoadingState title="Loading opportunities" description="Fetching pipeline stages." /> : filteredOpportunities.length ? (
            <div className="overflow-x-auto">
              <table className="industrial-table min-w-[980px]">
                <thead><tr><th>Opportunity</th><th>Company</th><th>Stage</th><th>Probability</th><th>Expected Close</th><th>Value</th></tr></thead>
                <tbody>
                  {filteredOpportunities.map((item) => (
                    <tr key={item.id}>
                      <td className="font-black text-slate-950">{item.opportunity_name}</td>
                      <td>{item.company_name || "-"}</td>
                      <td><Badge value={item.stage} /></td>
                      <td>{Number(item.probability_percent || 0)}%</td>
                      <td>{item.expected_close_date ? formatDate(item.expected_close_date) : "-"}</td>
                      <td>{formatCompactCurrency(Number(item.estimated_value || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="No opportunities yet" description="Convert qualified leads into opportunities to track deal movement." />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2 className="section-title">Sales Targets</h2></CardHeader>
        <CardContent>
          {loading ? <LoadingState title="Loading targets" description="Fetching salesperson targets." /> : targets.length ? (
            <div className="overflow-x-auto">
              <table className="industrial-table min-w-[960px]">
                <thead><tr><th>Salesperson</th><th>Value Target</th><th>Value Achieved</th><th>Leads</th><th>Visits</th></tr></thead>
                <tbody>
                  {targets.map((item) => (
                    <tr key={item.id}>
                      <td className="font-black text-slate-950">{item.salesperson_name}</td>
                      <td>{formatCompactCurrency(Number(item.target_value || 0))}</td>
                      <td>{formatCompactCurrency(Number(item.achieved_value || 0))}</td>
                      <td>{item.achieved_leads}/{item.target_leads}</td>
                      <td>{item.achieved_visits}/{item.target_visits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="No sales targets yet" description="Create monthly targets to measure field execution and conversion quality." />}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Target; label: string; value: string }) {
  return <div className="metric-card"><Icon className="relative z-[1] h-5 w-5 text-orange" /><p className="relative z-[1] mt-3 text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</p><p className="relative z-[1] mt-2 text-2xl font-black text-slate-950">{value}</p></div>;
}

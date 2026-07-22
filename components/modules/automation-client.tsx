"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Plus, Rocket, Sparkles, WandSparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/browser";
import { automationRuleSchema } from "@/lib/validations/schemas";
import { formatDate } from "@/lib/utils/format";

type RuleRow = {
  id: string;
  rule_name: string;
  trigger_type: string;
  conditions_json: Record<string, any>;
  actions_json: Array<{ type: string; config: Record<string, any> }>;
  is_active: boolean;
  created_at: string;
};

type RunRow = {
  id: string;
  rule_id: string | null;
  trigger_entity_type: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
};

const triggers = ["quote_created", "quote_sent", "quote_expiring", "quote_approved", "order_created", "order_delayed", "dispatch_created", "invoice_overdue", "inventory_low", "quality_failed", "die_high_rejection", "complaint_created"];
const actions = ["create_task", "create_alert", "generate_message", "assign_user", "change_status"];

type Props = {
  companyId: string;
  initialRules: RuleRow[];
  initialRuns: RunRow[];
};

export function AutomationClient({ companyId, initialRules, initialRuns }: Props) {
  const [rules, setRules] = useState(initialRules);
  const [runs, setRuns] = useState(initialRuns);
  const [ruleName, setRuleName] = useState("Quote follow-up in 3 days");
  const [triggerType, setTriggerType] = useState("quote_sent");
  const [conditionField, setConditionField] = useState("status");
  const [conditionOperator, setConditionOperator] = useState("equals");
  const [conditionValue, setConditionValue] = useState("sent");
  const [actionType, setActionType] = useState("create_task");
  const [actionConfig, setActionConfig] = useState("{\"title\":\"Follow up with customer\",\"due_in_days\":3}");
  const [activeOnly, setActiveOnly] = useState(true);
  const [saving, setSaving] = useState(false);

  const supabase = createClient();

  const filteredRules = useMemo(() => activeOnly ? rules.filter((item) => item.is_active) : rules, [rules, activeOnly]);

  async function createRule() {
    let configParsed: Record<string, any> = {};
    try {
      configParsed = actionConfig.trim() ? JSON.parse(actionConfig) : {};
    } catch {
      return toast.error("Action config should be valid JSON");
    }

    const parsed = automationRuleSchema.safeParse({
      rule_name: ruleName,
      trigger_type: triggerType,
      conditions_json: {
        field: conditionField,
        operator: conditionOperator,
        value: conditionValue
      },
      actions_json: [{ type: actionType, config: configParsed }],
      is_active: true
    });
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Invalid automation rule");

    setSaving(true);
    const insertResult = await supabase.from("automation_rules").insert({
      company_id: companyId,
      created_by: (await supabase.auth.getUser()).data.user?.id,
      rule_name: parsed.data.rule_name,
      trigger_type: parsed.data.trigger_type,
      conditions_json: parsed.data.conditions_json,
      actions_json: parsed.data.actions_json,
      is_active: parsed.data.is_active
    }).select("id, rule_name, trigger_type, conditions_json, actions_json, is_active, created_at").single();
    setSaving(false);

    if (insertResult.error) return toast.error(insertResult.error.message || "Could not save rule");
    setRules((current) => [insertResult.data as RuleRow, ...current]);
    toast.success("Automation rule saved");
  }

  async function runRuleNow(rule: RuleRow) {
    const runResult = await supabase.from("automation_runs").insert({
      company_id: companyId,
      rule_id: rule.id,
      trigger_entity_type: rule.trigger_type,
      status: "completed",
      result_json: {
        simulated: true,
        actions_executed: rule.actions_json.map((item) => item.type),
        note: "Safe simulation run from automation builder"
      }
    }).select("id, rule_id, trigger_entity_type, status, error_message, created_at").single();

    if (runResult.error) return toast.error(runResult.error.message || "Could not run automation");
    setRuns((current) => [runResult.data as RunRow, ...current]);
    toast.success("Automation run logged");
  }

  async function toggleRule(rule: RuleRow) {
    const result = await supabase
      .from("automation_rules")
      .update({ is_active: !rule.is_active })
      .eq("id", rule.id)
      .eq("company_id", companyId)
      .select("id, rule_name, trigger_type, conditions_json, actions_json, is_active, created_at")
      .single();
    if (result.error) return toast.error(result.error.message || "Could not update rule");
    setRules((current) => current.map((item) => item.id === rule.id ? result.data as RuleRow : item));
    toast.success(`Rule ${result.data?.is_active ? "activated" : "paused"}`);
  }

  const completedRuns = runs.filter((item) => item.status === "completed").length;
  const failedRuns = runs.filter((item) => item.status === "failed").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Automation Workflow Builder"
        description="Create safe trigger-condition-action automations for quote follow-up, order delays, inventory alerts, and payment reminders."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/automation/first-automation" className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-slate-700 shadow-sm transition hover:border-orange hover:text-orange">
              <Sparkles className="h-4 w-4" /> See How to Make your first automation.
            </Link>
            <Button onClick={createRule} disabled={saving}><Plus className="h-4 w-4" /> {saving ? "Saving..." : "Create rule"}</Button>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Metric icon={WandSparkles} label="Rules" value={rules.length.toString()} />
        <Metric icon={CheckCircle2} label="Active" value={rules.filter((item) => item.is_active).length.toString()} />
        <Metric icon={Rocket} label="Runs" value={runs.length.toString()} />
        <Metric icon={AlertTriangle} label="Failed" value={failedRuns.toString()} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader><h2 className="section-title">Rule Builder</h2></CardHeader>
          <CardContent className="space-y-4">
            <label className="block space-y-1.5"><span className="form-label">Rule name</span><input className="form-input" value={ruleName} onChange={(event) => setRuleName(event.target.value)} /></label>

            <label className="block space-y-1.5"><span className="form-label">Trigger type</span><select className="form-input" value={triggerType} onChange={(event) => setTriggerType(event.target.value)}>{triggers.map((trigger) => <option key={trigger} value={trigger}>{trigger}</option>)}</select></label>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="form-label">Condition</p>
              <div className="mt-2 grid gap-2 md:grid-cols-3">
                <input className="form-input" value={conditionField} onChange={(event) => setConditionField(event.target.value)} placeholder="field" />
                <select className="form-input" value={conditionOperator} onChange={(event) => setConditionOperator(event.target.value)}>{["equals", "contains", "gt", "lt", "between"].map((operator) => <option key={operator} value={operator}>{operator}</option>)}</select>
                <input className="form-input" value={conditionValue} onChange={(event) => setConditionValue(event.target.value)} placeholder="value" />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="form-label">Action</p>
              <div className="mt-2 space-y-2">
                <select className="form-input" value={actionType} onChange={(event) => setActionType(event.target.value)}>{actions.map((action) => <option key={action} value={action}>{action}</option>)}</select>
                <textarea className="form-input min-h-24 font-mono text-xs" value={actionConfig} onChange={(event) => setActionConfig(event.target.value)} />
              </div>
            </div>

            <div className="rounded-2xl border border-orange/20 bg-orange/5 p-4 text-sm font-medium leading-6 text-slate-700">
              <p className="font-black text-slate-900">Safety mode</p>
              <p className="mt-1">This release stores rules and logs deterministic runs. Direct WhatsApp or email sending is intentionally unavailable until a provider is configured and audited.</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm font-medium leading-6 text-slate-700">
              <p className="font-black text-slate-900">Need help?</p>
              <p className="mt-1">If this is your first time, use the step-by-step guide to create a safe starter rule.</p>
              <Link href="/automation/first-automation" className="mt-3 inline-flex items-center gap-2 text-sm font-black text-orange hover:underline">
                <Sparkles className="h-4 w-4" /> See How to Make your first automation.
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><div className="flex items-center justify-between"><h2 className="section-title">Saved Rules</h2><label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600"><input type="checkbox" checked={activeOnly} onChange={(event) => setActiveOnly(event.target.checked)} /> Active only</label></div></CardHeader>
          <CardContent className="space-y-3">
            {filteredRules.length ? filteredRules.map((rule) => (
              <div key={rule.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3"><p className="font-black text-slate-950">{rule.rule_name}</p><div className="flex gap-2"><Badge value={rule.trigger_type} /><Badge value={rule.is_active ? "active" : "paused"} /></div></div>
                <p className="mt-2 text-sm font-medium text-slate-600">If {rule.conditions_json?.field || "field"} {rule.conditions_json?.operator || "equals"} {String(rule.conditions_json?.value || "value")}, then {rule.actions_json?.[0]?.type || "action"}.</p>
                <div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" onClick={() => runRuleNow(rule)}><Sparkles className="h-4 w-4" /> Run now</Button><Button variant="ghost" onClick={() => toggleRule(rule)}>{rule.is_active ? "Pause" : "Activate"}</Button><span className="text-xs font-bold text-slate-500">Created {formatDate(rule.created_at)}</span></div>
              </div>
            )) : <div className="empty-mini">No rules yet.</div>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><h2 className="section-title">Automation Runs</h2></CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-aluminium/40 p-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-600">{completedRuns} completed · {failedRuns} failed</div>
          {runs.length ? runs.map((run) => (
            <div key={run.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3"><p className="font-black text-slate-950">{run.trigger_entity_type || "automation"}</p><Badge value={run.status} /></div>
              <p className="mt-1 text-sm font-medium text-slate-500">{formatDate(run.created_at)}</p>
              {run.error_message ? <p className="mt-2 rounded-xl bg-red-50 p-2 text-xs font-bold text-red-700">{run.error_message}</p> : null}
            </div>
          )) : <div className="empty-mini">No automation runs logged yet.</div>}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof WandSparkles; label: string; value: string }) {
  return <div className="metric-card"><Icon className="relative z-[1] h-5 w-5 text-orange" /><p className="relative z-[1] mt-3 text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</p><p className="relative z-[1] mt-2 text-2xl font-black text-slate-950">{value}</p></div>;
}

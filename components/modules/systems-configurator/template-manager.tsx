import Link from "next/link";
import { FileCode2, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { createSystemTemplate, updateSystemTemplateJson } from "@/lib/systems-configurator/actions";
import { knownFormulaVariables, validateTemplateFormulaJson, type TemplateFormulaValidationSummary } from "@/lib/systems-configurator/template-formula-validation";
import { labelize, systemConfiguratorSystemTypes } from "@/types/app";

function inputClass() {
  return "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-none transition focus:border-orange focus:ring-2 focus:ring-orange/10";
}

function prettyJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function SystemTypeOptions() {
  return systemConfiguratorSystemTypes.map((value) => <option key={value} value={value}>{labelize(value)}</option>);
}

export function SystemTemplateManager({ canManage, templates, series }: { canManage: boolean; templates: any[]; series: any[] }) {
  return (
    <div className="space-y-6">
      {canManage ? (
        <Card>
          <CardHeader>
            <h3 className="font-black tracking-tight text-slate-950">Create Template</h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">Create a formula template shell for a system type. Detailed formulas are edited from the template detail page.</p>
          </CardHeader>
          <CardContent>
            <form action={createSystemTemplate} className="grid gap-3 md:grid-cols-3">
              <input name="template_code" className={inputClass()} placeholder="Template code, e.g. SL2T-STD" required />
              <input name="template_name" className={inputClass()} placeholder="Template name" required />
              <select name="system_type" className={inputClass()} required><SystemTypeOptions /></select>
              <select name="series_id" className={inputClass()}><option value="">No fixed series</option>{series.map((item) => <option key={item.id} value={item.id}>{item.series_code} - {item.series_name}</option>)}</select>
              <input name="formula_version" type="number" className={inputClass()} defaultValue="1" min="1" />
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700"><input name="is_default" type="checkbox" value="true" className="rounded border-slate-300 text-orange" /> Default template</label>
              <div className="md:col-span-3"><Button type="submit" className="w-full"><Plus className="h-4 w-4" /> Add Template</Button></div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        {templates.length ? templates.map((template) => (
          <Link key={template.id} href={`/systems-configurator/templates/${template.id}`} className="group block">
            <Card className="h-full transition group-hover:-translate-y-0.5 group-hover:border-orange/50 group-hover:shadow-lg">
              <CardContent>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-charcoal text-orange"><FileCode2 className="h-5 w-5" /></span>
                    <div>
                      <p className="font-black text-slate-950">{template.template_code} - {template.template_name}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-500">{labelize(template.system_type)} · v{template.formula_version} · {template.system_series?.series_code ?? "Any series"}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {template.is_default ? <Badge value="active" className="bg-orange-50 text-orange-700 ring-orange-200" /> : null}
                    <Badge value={template.is_active ? "active" : "inactive"} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        )) : (
          <Card className="lg:col-span-2"><CardContent><p className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-sm font-semibold text-slate-500">No templates yet. Create a template to start defining formula rules.</p></CardContent></Card>
        )}
      </section>
    </div>
  );
}

export function SystemTemplateDetail({ template, canManage }: { template: any; canManage: boolean }) {
  const summary = validateTemplateFormulaJson(template.formula_json);
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Template</p><p className="mt-2 font-black text-slate-950">{template.template_code}</p></div>
          <div><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">System</p><p className="mt-2 font-black text-slate-950">{labelize(template.system_type)}</p></div>
          <div><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Version</p><p className="mt-2 font-black text-slate-950">v{template.formula_version}</p></div>
          <div><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Status</p><div className="mt-2"><Badge value={template.is_active ? "active" : "inactive"} /></div></div>
        </CardContent>
      </Card>

      <FormulaValidationPanel summary={summary} />

      <div className="grid gap-4 xl:grid-cols-3">
        <JsonCard title="Formula JSON" value={template.formula_json} />
        <JsonCard title="Validation Rules" value={template.validation_rules_json} />
        <JsonCard title="Preview Config" value={template.preview_config_json} />
      </div>

      {canManage ? <Link href={`/systems-configurator/templates/${template.id}/formula`} className="inline-flex items-center gap-2 rounded-xl bg-orange px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange/20 transition hover:bg-orange/90">Edit Formula JSON</Link> : null}
    </div>
  );
}

function JsonCard({ title, value }: { title: string; value: unknown }) {
  return (
    <Card>
      <CardHeader><h3 className="font-black text-slate-950">{title}</h3></CardHeader>
      <CardContent><pre className="max-h-80 overflow-auto rounded-2xl bg-slate-950 p-4 text-xs font-semibold leading-6 text-slate-100">{prettyJson(value)}</pre></CardContent>
    </Card>
  );
}

export function SystemFormulaEditor({ template }: { template: any }) {
  const action = updateSystemTemplateJson.bind(null, template.id);
  const summary = validateTemplateFormulaJson(template.formula_json);
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader>
          <h3 className="font-black tracking-tight text-slate-950">Safe Formula JSON</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">Store formula rules as JSON. Formula strings are evaluated later by the safe parser, not JavaScript eval.</p>
        </CardHeader>
        <CardContent>
          <form action={action} className="space-y-4">
            <label className="block space-y-2"><span className="text-sm font-black text-slate-700">Formula JSON</span><textarea name="formula_json" className={`${inputClass()} min-h-72 font-mono text-xs`} defaultValue={prettyJson(template.formula_json)} /></label>
            <label className="block space-y-2"><span className="text-sm font-black text-slate-700">Validation Rules JSON</span><textarea name="validation_rules_json" className={`${inputClass()} min-h-40 font-mono text-xs`} defaultValue={prettyJson(template.validation_rules_json)} /></label>
            <label className="block space-y-2"><span className="text-sm font-black text-slate-700">Preview Config JSON</span><textarea name="preview_config_json" className={`${inputClass()} min-h-40 font-mono text-xs`} defaultValue={prettyJson(template.preview_config_json)} /></label>
            <Button type="submit">Save Formula Template</Button>
          </form>
        </CardContent>
      </Card>
      <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
        <FormulaValidationPanel summary={summary} compact />
        <Card>
          <CardHeader><h3 className="font-black text-slate-950">Allowed Variables</h3></CardHeader>
          <CardContent><div className="flex max-h-72 flex-wrap gap-2 overflow-auto">{knownFormulaVariables.map((variable) => <span key={variable} className="rounded-lg bg-slate-100 px-2 py-1 font-mono text-xs font-black text-slate-700">{variable}</span>)}</div><p className="mt-3 text-xs font-semibold leading-5 text-slate-500">Custom option names are allowed, but they appear as warnings until supplied by configuration options.</p></CardContent>
        </Card>
        <Card>
          <CardHeader><h3 className="font-black text-slate-950">Supported Functions</h3></CardHeader>
          <CardContent><p className="font-mono text-xs font-black text-slate-700">min, max, round, ceil, floor</p><p className="mt-3 text-xs font-semibold leading-5 text-slate-500">Use arithmetic only: +, -, *, /, parentheses, numbers, variables, and supported functions.</p></CardContent>
        </Card>
      </aside>
    </div>
  );
}

function FormulaValidationPanel({ summary, compact }: { summary: TemplateFormulaValidationSummary; compact?: boolean }) {
  const statusClass = summary.errors.length ? "border-red-200 bg-red-50" : summary.warnings.length ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50";
  const statusText = summary.errors.length ? "Formula JSON has blocking errors." : summary.warnings.length ? "Formula JSON is safe, with authoring warnings." : "Formula JSON is valid.";
  return (
    <Card className={statusClass}>
      <CardHeader><h3 className="font-black text-slate-950">Formula Safety Check</h3><p className="text-sm font-bold text-slate-600">{statusText}</p></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-4">
          <MiniMetric label="Formulas" value={String(summary.formulaCount)} />
          <MiniMetric label="Profiles" value={String(summary.profileRuleCount)} />
          <MiniMetric label="Glass" value={String(summary.glassRuleCount)} />
          <MiniMetric label="Hardware" value={String(summary.hardwareRuleCount)} />
        </div>
        {summary.variables.length ? <div><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Variables Used</p><p className="mt-2 font-mono text-xs font-bold leading-5 text-slate-700">{summary.variables.join(", ")}</p></div> : null}
        {summary.errors.length ? <IssueList title="Errors" issues={summary.errors} /> : null}
        {!compact && summary.warnings.length ? <IssueList title="Warnings" issues={summary.warnings.slice(0, 8)} /> : null}
        {compact && summary.warnings.length ? <p className="text-xs font-bold leading-5 text-amber-900">{summary.warnings.length} warning{summary.warnings.length === 1 ? "" : "s"}. Most warnings are custom variables that must be supplied by configuration options.</p> : null}
      </CardContent>
    </Card>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-white/70 bg-white/70 px-3 py-2"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</p><p className="mt-1 text-lg font-black text-slate-950">{value}</p></div>;
}

function IssueList({ title, issues }: { title: string; issues: TemplateFormulaValidationSummary["errors"] }) {
  return <div><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{title}</p><div className="mt-2 space-y-2">{issues.map((issue) => <p key={`${issue.path}-${issue.message}`} className="rounded-xl bg-white/80 px-3 py-2 text-xs font-bold leading-5 text-slate-700"><span className="font-mono text-slate-950">{issue.path}</span>: {issue.message}</p>)}</div></div>;
}

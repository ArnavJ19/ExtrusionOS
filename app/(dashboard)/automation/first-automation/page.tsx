import Link from "next/link";
import { ArrowLeft, CheckCircle2, PlayCircle, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function FirstAutomationGuidePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="How to Make Your First Automation"
        description="A simple step-by-step guide for owners and admins to create practical, safe automations."
        actions={
          <Link href="/automation" className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-slate-700 shadow-sm transition hover:border-orange hover:text-orange">
            <ArrowLeft className="h-4 w-4" /> Back to Automation
          </Link>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader><h2 className="section-title">Before You Start</h2></CardHeader>
          <CardContent className="space-y-3 text-sm font-medium leading-6 text-slate-700">
            <p>Use automation only for repeatable actions like reminders, alerts, and internal task creation.</p>
            <p>Start with one rule, test it with <span className="font-black">Run now</span>, then activate it.</p>
            <p>Avoid risky actions at first; use internal tasks, alerts, and generated messages until an external send provider is configured and audited.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h2 className="section-title">Example First Rule</h2></CardHeader>
          <CardContent className="space-y-3 text-sm font-medium leading-6 text-slate-700">
            <p><span className="font-black">Goal:</span> After a quote is sent, create a follow-up task in 3 days.</p>
            <p><span className="font-black">Trigger:</span> <code>quote_sent</code></p>
            <p><span className="font-black">Condition:</span> <code>status equals sent</code></p>
            <p><span className="font-black">Action:</span> <code>create_task</code> with title and due-in-days config.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><h2 className="section-title">Step-by-Step</h2></CardHeader>
        <CardContent className="space-y-4">
          {[
            "Open Automation and click Create rule.",
            "Enter a clear rule name (example: Quote follow-up in 3 days).",
            "Select trigger type (example: quote_sent).",
            "Set condition field/operator/value (example: status / equals / sent).",
            "Select an action (example: create_task).",
            "Set action config JSON (example below).",
            "Save the rule.",
            "Click Run now to simulate safely.",
            "If output is correct, keep rule active."
          ].map((step, index) => (
            <div key={step} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4">
              <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-black text-white">{index + 1}</span>
              <p className="text-sm font-medium leading-6 text-slate-700">{step}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2 className="section-title">Starter Action Config</h2></CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-2xl border border-slate-200 bg-slate-950 p-4 text-xs font-semibold text-slate-100">
{`{
  "title": "Follow up with customer",
  "due_in_days": 3,
  "priority": "high",
  "notes": "Call customer and confirm decision status"
}`}
          </pre>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Tip icon={CheckCircle2} title="Do" text="Use simple, predictable conditions." />
            <Tip icon={PlayCircle} title="Test" text="Use Run now before enabling for everyone." />
            <Tip icon={Sparkles} title="Iterate" text="Improve one rule at a time after observing logs." />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Tip({ icon: Icon, title, text }: { icon: typeof CheckCircle2; title: string; text: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-aluminium/50 p-4"><Icon className="h-5 w-5 text-orange" /><p className="mt-2 font-black text-slate-950">{title}</p><p className="mt-1 text-sm font-medium text-slate-600">{text}</p></div>;
}

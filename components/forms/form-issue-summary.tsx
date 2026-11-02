"use client";

import { focusFormField, formFieldId, type FormIssue } from "@/lib/ui/form-workflow";

export function FormIssueSummary({ issues, scope, container }: { issues: FormIssue[]; scope: string; container: React.RefObject<HTMLElement | null> }) {
  if (!issues.length) return null;
  return <div role="alert" className="mb-4 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-950">
    <p className="font-bold">Check {issues.length} {issues.length === 1 ? "entry" : "entries"} before saving</p>
    <ul className="mt-2 space-y-1">{issues.map((issue) => {
      const id = formFieldId(scope, issue.path.split(".")[0]);
      return <li key={issue.path}><a href={`#${id}`} className="inline-flex min-h-11 items-center rounded-lg px-2 underline underline-offset-2 focus-visible:outline focus-visible:outline-2" onClick={(event) => { event.preventDefault(); focusFormField(container.current, id); }}>{issue.label}: {issue.message}</a></li>;
    })}</ul>
  </div>;
}

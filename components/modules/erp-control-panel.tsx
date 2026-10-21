"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { runErpControlAction } from "@/lib/actions/erp-controls";
import type { ErpControlKey } from "@/lib/workflow/erp-control-roles";

export type ErpControlField = {
  name: string;
  label: string;
  type?: "text" | "number" | "textarea" | "date" | "select" | "checklist";
  options?: { value: string; label: string }[];
  required?: boolean;
  step?: string;
  placeholder?: string;
  defaultValue?: string;
};

export type ErpControlAction = {
  key: ErpControlKey;
  title: string;
  description?: string;
  submitLabel: string;
  fields: ErpControlField[];
  /** Server-known values sent with the form (record ids). */
  fixed: Record<string, unknown>;
  /** Adds a fresh idempotency_key per attempt (credit notes). */
  idempotent?: boolean;
  disabledReason?: string | null;
};

function initialValues(action: ErpControlAction) {
  return Object.fromEntries(action.fields.map((field) => [field.name, field.type === "checklist" ? [] : field.defaultValue ?? ""])) as Record<string, string | string[]>;
}

function ActionForm({ action }: { action: ErpControlAction }) {
  const router = useRouter();
  const [values, setValues] = useState(() => initialValues(action));
  const [pending, startTransition] = useTransition();
  const [attemptKey, setAttemptKey] = useState<string | null>(null);

  function submit() {
    if (pending || action.disabledReason) return;
    const key = action.idempotent ? attemptKey ?? crypto.randomUUID() : null;
    if (action.idempotent) setAttemptKey(key);
    startTransition(async () => {
      const result = await runErpControlAction(action.key, { ...values, ...action.fixed, ...(key ? { idempotency_key: key } : {}) });
      if (!result.success) { toast.error(result.error); return; }
      toast.success(`${action.title} recorded`);
      setValues(initialValues(action));
      setAttemptKey(null);
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <p className="font-black text-slate-950">{action.title}</p>
      {action.description ? <p className="mt-1 text-xs font-semibold text-slate-500">{action.description}</p> : null}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {action.fields.map((field) => {
          const value = values[field.name];
          const label = `${field.label}${field.required ? " *" : ""}`;
          if (field.type === "checklist") {
            const selected = Array.isArray(value) ? value : [];
            return (
              <fieldset key={field.name} className="space-y-1.5 md:col-span-2">
                <legend className="form-label">{label}</legend>
                {(field.options ?? []).length === 0 ? <p className="text-xs font-semibold text-slate-500">Nothing available.</p> : null}
                {(field.options ?? []).map((option) => (
                  <label key={option.value} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <input type="checkbox" checked={selected.includes(option.value)} onChange={(event) => setValues({ ...values, [field.name]: event.target.checked ? [...selected, option.value] : selected.filter((item) => item !== option.value) })} />
                    {option.label}
                  </label>
                ))}
              </fieldset>
            );
          }
          if (field.type === "select") {
            return (
              <label key={field.name} className="block space-y-1.5">
                <span className="form-label">{label}</span>
                <select className="form-input" value={String(value ?? "")} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}>
                  <option value="">Select</option>
                  {(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            );
          }
          if (field.type === "textarea") {
            return (
              <label key={field.name} className="block space-y-1.5 md:col-span-2">
                <span className="form-label">{label}</span>
                <textarea className="form-input min-h-20" value={String(value ?? "")} placeholder={field.placeholder} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })} />
              </label>
            );
          }
          return (
            <label key={field.name} className="block space-y-1.5">
              <span className="form-label">{label}</span>
              <input className="form-input" type={field.type ?? "text"} step={field.step} value={String(value ?? "")} placeholder={field.placeholder} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })} />
            </label>
          );
        })}
      </div>
      {action.disabledReason ? <p className="mt-3 text-xs font-bold text-amber-700">{action.disabledReason}</p> : null}
      <div className="mt-3 flex justify-end">
        <Button type="button" disabled={pending || Boolean(action.disabledReason)} onClick={submit}>{pending ? "Saving..." : action.submitLabel}</Button>
      </div>
    </div>
  );
}

export function ErpControlPanel({ title, description, actions }: { title: string; description?: string; actions: ErpControlAction[] }) {
  if (!actions.length) return null;
  return (
    <Card>
      <CardHeader>
        <h2 className="section-title">{title}</h2>
        {description ? <p className="text-sm font-semibold text-slate-500">{description}</p> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {actions.map((action) => <ActionForm key={`${action.key}-${JSON.stringify(action.fixed)}`} action={action} />)}
      </CardContent>
    </Card>
  );
}

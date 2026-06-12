"use client";

import { ChangeEvent, FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { ZodSchema } from "zod";
import { createClient } from "@/lib/supabase/browser";
import { useDebounce } from "@/lib/hooks/use-debounce";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading";
import { PageHeader } from "@/components/layout/page-header";
import { getErrorMessage } from "@/lib/utils/errors";
import { rowMatchesSearch } from "@/lib/utils/search";
import type { SessionContext } from "@/types/app";

export type Field = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "textarea" | "select" | "checkbox";
  required?: boolean;
  options?: { label: string; value: string }[];
  step?: string;
};

type Column = {
  label: string;
  value: (row: Record<string, any>) => ReactNode;
};

type Props = {
  title: string;
  description: string;
  table: string;
  select: string;
  context: SessionContext;
  schema: ZodSchema<any>;
  fields: Field[];
  columns: Column[];
  searchPlaceholder: string;
  defaultValues: Record<string, any>;
  canEdit?: boolean;
  canDelete?: boolean;
};

export function MasterDataManager({ title, description, table, select, context, schema, fields, columns, searchPlaceholder, defaultValues, canEdit = true, canDelete = false }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [form, setForm] = useState<Record<string, any>>(defaultValues);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadRows() {
    setLoading(true);
    const { data, error } = await supabase.from(table as any).select(select).eq("company_id", context.companyId).order("created_at", { ascending: false });
    setLoading(false);
    if (error) return toast.error(getErrorMessage(error));
    setRows((data ?? []) as Record<string, any>[]);
  }

  useEffect(() => {
    void loadRows();
  }, []);

  function update(name: string, value: string | boolean) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check the form");
      return;
    }

    setSaving(true);
    // Sanitize: convert empty strings to null (prevents UUID parse errors for optional FK fields)
    const sanitized = Object.fromEntries(
      Object.entries(parsed.data as Record<string, unknown>).map(([key, val]) => [key, val === "" ? null : val])
    );
    const payload = { ...sanitized, company_id: context.companyId, created_by: context.userId };
    const result = editingId
      ? await supabase.from(table as any).update(payload).eq("id", editingId).eq("company_id", context.companyId)
      : await supabase.from(table as any).insert(payload);
    setSaving(false);
    if (result.error) return toast.error(getErrorMessage(result.error));
    toast.success(editingId ? `${title} updated` : `${title} saved`);
    setForm(defaultValues);
    setEditingId(null);
    await loadRows();
  }

  async function remove(id: string) {
    if (!confirm("Delete this record? This cannot be undone.")) return;
    const { error } = await supabase.from(table as any).delete().eq("id", id).eq("company_id", context.companyId);
    if (error) return toast.error(getErrorMessage(error));
    toast.success("Record deleted");
    await loadRows();
  }

  const debouncedSearch = useDebounce(search, 300);
  const filtered = rows.filter((row) => rowMatchesSearch(row, debouncedSearch));

  return (
    <div>
      <PageHeader title={title} description={description} />
      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <Card>
          <CardContent>
            <h2 className="section-title mb-1">{editingId ? "Edit record" : "Add new"}</h2>
            <p className="mb-5 text-sm font-medium text-slate-500">Keep master data clean so quotes, dies, and dispatches stay accurate.</p>
            <form onSubmit={submit} className="grid gap-4">
              {fields.map((field) => (
                <label key={field.name} className="block space-y-1.5">
                  <span className="form-label">{field.label}{field.required ? " *" : ""}</span>
                  {field.type === "textarea" ? (
                    <textarea className="form-input min-h-24" value={form[field.name] ?? ""} onChange={(event) => update(field.name, event.target.value)} />
                  ) : field.type === "select" ? (
                    <select className="form-input" value={form[field.name] ?? ""} onChange={(event) => update(field.name, event.target.value)} required={field.required}>
                      <option value="">Select</option>
                      {(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  ) : field.type === "checkbox" ? (
                    <input type="checkbox" checked={Boolean(form[field.name])} onChange={(event: ChangeEvent<HTMLInputElement>) => update(field.name, event.target.checked)} />
                  ) : (
                    <input className="form-input" type={field.type ?? "text"} step={field.step} value={form[field.name] ?? ""} onChange={(event) => update(field.name, event.target.value)} required={field.required} />
                  )}
                </label>
              ))}
              <div className="flex gap-2">
                <Button type="submit" disabled={saving || !canEdit}>{saving ? "Saving..." : editingId ? "Update" : "Save"}</Button>
                {editingId ? <Button type="button" variant="secondary" onClick={() => { setEditingId(null); setForm(defaultValues); }}>Cancel</Button> : null}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <input className="form-input max-w-md" placeholder={searchPlaceholder} value={search} onChange={(event) => setSearch(event.target.value)} />
              <p className="rounded-full bg-aluminium px-3 py-1.5 text-xs font-black uppercase tracking-[0.1em] text-slate-600">{filtered.length} records</p>
            </div>
            {loading ? <LoadingState title={`Loading ${title.toLowerCase()}`} description="Fetching tenant-scoped records for this company." /> : filtered.length === 0 ? <EmptyState title={`No ${title.toLowerCase()} found`} description={search ? "No records match this search. Clear the filter or try another keyword." : "Create your first record to make this workspace usable for production."} /> : (
              <div className="overflow-x-auto">
                <table className="industrial-table min-w-[760px]">
                  <thead>
                    <tr>{columns.map((column) => <th key={column.label}>{column.label}</th>)}<th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => (
                      <tr key={row.id}>
                        {columns.map((column) => <td key={column.label}>{column.value(row)}</td>)}
                        <td className="whitespace-nowrap">
                          <Button type="button" variant="ghost" disabled={!canEdit} onClick={() => { setEditingId(row.id); setForm({ ...defaultValues, ...row, finish_options: Array.isArray(row.finish_options) ? row.finish_options.join(", ") : row.finish_options }); }}>Edit</Button>
                          {canDelete ? <Button type="button" variant="ghost" onClick={() => remove(row.id)}>Delete</Button> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export { Badge };

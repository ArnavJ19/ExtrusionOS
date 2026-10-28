"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { customerProjectAction } from "@/lib/actions/customer-projects";
import { formatDate } from "@/lib/utils/format";
import {
  ENTITY_LABELS, PROJECT_STATUSES, describeLinkResults, projectFieldsSchema,
  type LinkResult, type Project, type ProjectEntity, type ProjectStatus
} from "@/lib/workflow/customer-projects";

type Option = { value: string; label: string };
const fieldKeys = ["name", "site_name", "site_address", "city", "state", "pincode", "contact_name", "contact_phone", "notes"] as const;
type Fields = Record<(typeof fieldKeys)[number], string>;
const fieldLabels: Record<(typeof fieldKeys)[number], string> = {
  name: "Project name", site_name: "Delivery site", site_address: "Site address", city: "City", state: "State", pincode: "PIN code",
  contact_name: "Site contact", contact_phone: "Site contact mobile", notes: "Notes"
};

// UPGRADE_EOS feature 43: create or edit a customer project and its delivery site.
export function ProjectForm({ customers, project }: { customers?: Option[]; project?: Project }) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(project?.customer_id ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "active");
  const [fields, setFields] = useState<Fields>(() => Object.fromEntries(fieldKeys.map((key) => [key, (project?.[key] as string | null) ?? ""])) as Fields);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const requestId = useRef<string | null>(null);

  async function submit() {
    const check = projectFieldsSchema.safeParse(fields);
    if (!check.success) { setError(check.error.issues[0]?.message ?? "Check the project details"); return; }
    if (!project && !customerId) { setError("Choose the customer this project belongs to"); return; }
    setBusy(true); setError("");
    let result;
    if (project) {
      result = await customerProjectAction({ command: "project.update", project_id: project.id, expected_version: project.version, status, ...fields });
    } else {
      requestId.current ??= crypto.randomUUID();
      result = await customerProjectAction({ command: "project.create", request_id: requestId.current, customer_id: customerId, ...fields });
    }
    setBusy(false);
    if (!result.success) {
      setError(result.error); setUncertain(!project && result.uncertain === true);
      if (!result.uncertain) requestId.current = null;
      return;
    }
    const id = project?.id ?? (result.data as { id: string }).id;
    router.push(`/customers/projects/${id}`);
    router.refresh();
  }

  const locked = busy || uncertain;
  return (
    <form className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {project ? (
        <p className="text-sm font-semibold text-slate-600">Customer: {project.customer_name ?? "-"} · {project.project_code}. The customer of a project cannot change, because its links depend on it.</p>
      ) : (
        <label className="block space-y-1"><span className="form-label">Customer</span>
          <SearchableSelect value={customerId} options={customers ?? []} onChange={setCustomerId} placeholder="Choose a customer" disabled={locked} ariaLabel="Customer" />
        </label>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {fieldKeys.map((key) => (
          <label key={key} className={`space-y-1 ${key === "site_address" || key === "notes" ? "md:col-span-2" : ""}`}>
            <span className="form-label">{fieldLabels[key]}{key === "name" ? "" : " (optional)"}</span>
            {key === "site_address" || key === "notes" ? (
              <textarea className="form-input" rows={2} maxLength={key === "notes" ? 2000 : 500} value={fields[key]} disabled={locked} onChange={(event) => setFields({ ...fields, [key]: event.target.value })} />
            ) : (
              <input className="form-input" required={key === "name"} inputMode={key === "pincode" || key === "contact_phone" ? "numeric" : undefined}
                maxLength={key === "pincode" ? 6 : key === "contact_phone" ? 16 : 120} value={fields[key]} disabled={locked}
                placeholder={key === "contact_phone" ? "+91 98200 12345" : undefined} onChange={(event) => setFields({ ...fields, [key]: event.target.value })} />
            )}
          </label>
        ))}
        {project ? (
          <label className="space-y-1"><span className="form-label">Status</span>
            <select className="form-input" value={status} disabled={locked} onChange={(event) => setStatus(event.target.value as ProjectStatus)}>
              {Object.entries(PROJECT_STATUSES).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </label>
        ) : null}
      </div>
      <Button type="submit" disabled={busy || !fields.name.trim()}>{busy ? "Saving…" : uncertain ? "Retry the same project" : project ? "Save project" : "Create project"}</Button>
      {error ? <p role="alert" className="text-sm font-semibold text-red-700">{error}</p> : null}
    </form>
  );
}

/** Link picker and unlink control for one project. Candidates are always the project's customer only. */
export function ProjectLinkManager({ projectId, linkable, linked }: { projectId: string; linkable: boolean; linked: { entity_type: ProjectEntity; entity_id: string; label: string }[] }) {
  const router = useRouter();
  const [type, setType] = useState<ProjectEntity>("order");
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<Option[]>([]);
  const [selected, setSelected] = useState("");
  const [related, setRelated] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [outcomes, setOutcomes] = useState<string[]>([]);
  const [unlink, setUnlink] = useState({ key: "", reason: "" });

  async function loadCandidates(nextType = type, nextSearch = search) {
    const result = await customerProjectAction({ command: "project.candidates", project_id: projectId, entity_type: nextType, search: nextSearch });
    if (!result.success) { setError(result.error); return; }
    setCandidates((result.data as { rows: { id: string; number: string; date: string | null; status: string }[] }).rows
      .map((row) => ({ value: row.id, label: `${row.number} · ${row.date ? formatDate(row.date) : "no date"} · ${row.status.replace(/_/g, " ")}` })));
    setError("");
  }

  async function link() {
    if (!selected) return;
    setBusy(true); setError(""); setOutcomes([]);
    const result = await customerProjectAction({ command: "project.link", project_id: projectId, entity_type: type, entity_id: selected, include_related: type === "order" && related });
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    setOutcomes(describeLinkResults(result.data as LinkResult));
    setSelected("");
    await loadCandidates();
    router.refresh();
  }

  async function remove(entity_type: ProjectEntity, entity_id: string) {
    setBusy(true); setError("");
    const result = await customerProjectAction({ command: "project.unlink", project_id: projectId, entity_type, entity_id, reason: unlink.reason });
    setBusy(false);
    if (!result.success) { setError(result.error); return; }
    setUnlink({ key: "", reason: "" });
    router.refresh();
  }

  return (
    <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-bold text-slate-900">Link transactions</h2>
      {linkable ? (
        <div className="grid gap-3 md:grid-cols-[160px_1fr_auto] md:items-end">
          <label className="space-y-1"><span className="form-label">Type</span>
            <select className="form-input" value={type} disabled={busy} onChange={(event) => { const next = event.target.value as ProjectEntity; setType(next); setSelected(""); void loadCandidates(next); }}>
              {Object.entries(ENTITY_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </label>
          <label className="space-y-1"><span className="form-label">Unlinked {ENTITY_LABELS[type].toLowerCase()}s of this customer</span>
            <SearchableSelect value={selected} options={candidates} onChange={setSelected} placeholder={`Search by ${ENTITY_LABELS[type].toLowerCase()} number`} disabled={busy}
              onSearchChange={(query) => { setSearch(query); void loadCandidates(type, query); }} ariaLabel={`${ENTITY_LABELS[type]} to link`} />
          </label>
          <Button type="button" disabled={busy || !selected} onClick={() => void link()}>{busy ? "Linking…" : "Link"}</Button>
          {type === "order" ? (
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 md:col-span-3">
              <input type="checkbox" checked={related} disabled={busy} onChange={(event) => setRelated(event.target.checked)} /> Also link the order&apos;s source quotation and its dispatches
            </label>
          ) : null}
          {!candidates.length ? <button type="button" className="text-left text-xs font-bold text-slate-600 underline md:col-span-3" onClick={() => void loadCandidates()}>Load candidates</button> : null}
        </div>
      ) : <p className="text-sm font-semibold text-slate-600">Reopen the project (status Active or On hold) to link more transactions.</p>}
      {outcomes.length ? <ul role="status" className="space-y-0.5 text-sm font-semibold text-slate-700">{outcomes.map((line, index) => <li key={index}>{line}</li>)}</ul> : null}
      {linked.length ? (
        <details>
          <summary className="cursor-pointer text-sm font-bold text-slate-700">Remove a record from this project</summary>
          <ul className="mt-2 space-y-2">
            {linked.map((row) => {
              const key = `${row.entity_type}:${row.entity_id}`;
              return (
                <li key={key} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">{ENTITY_LABELS[row.entity_type]} {row.label}</span>
                  {unlink.key === key ? (
                    <>
                      <input className="form-input max-w-xs" placeholder="Reason (recorded)" maxLength={500} value={unlink.reason} onChange={(event) => setUnlink({ key, reason: event.target.value })} />
                      <Button type="button" variant="danger" disabled={busy || !unlink.reason.trim()} onClick={() => void remove(row.entity_type, row.entity_id)}>Remove</Button>
                    </>
                  ) : <button type="button" className="text-xs font-bold text-red-700 underline" onClick={() => setUnlink({ key, reason: "" })}>Remove…</button>}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
      {error ? <p role="alert" className="text-sm font-semibold text-red-700">{error}</p> : null}
    </section>
  );
}

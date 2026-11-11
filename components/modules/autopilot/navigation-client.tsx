"use client";

// AP-042: role navigation from real usage. Visits are counted per role and destination (no user, no record). After two
// weeks the nightly job proposes the most used destinations; an admin approves them or sets the list by hand.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { autopilotAction } from "@/lib/actions/autopilot";
import { MAX_PRIMARY_ITEMS, navigationSaveSchema, type NavigationUsage } from "@/lib/navigation/role-navigation";

export function NavigationClient({ initial, destinations }: { initial: NavigationUsage; destinations: Record<string, Array<{ href: string; label: string }>> }) {
  const router = useRouter();
  const [usage, setUsage] = useState(initial);
  const [role, setRole] = useState(initial.roles[0]?.role ?? "owner");
  const current = usage.roles.find(entry => entry.role === role);
  const allowed = destinations[role] ?? [];
  const [selected, setSelected] = useState<string[]>(current?.layout?.items ?? []);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [busy, setBusy] = useState(false);
  const label = (href: string) => allowed.find(item => item.href === href)?.label ?? href;

  function switchRole(next: string) {
    setRole(next); setMessage(null);
    setSelected(usage.roles.find(entry => entry.role === next)?.layout?.items ?? []);
  }
  async function refresh() {
    const result = await autopilotAction("ap_navigation", "usage", {});
    if (result.success) setUsage(result.data as NavigationUsage);
    router.refresh();
  }
  async function save() {
    const parsed = navigationSaveSchema.safeParse({ role, items: selected });
    if (!parsed.success) return setMessage({ text: parsed.error.issues[0]?.message ?? "Check the list", tone: "error" });
    setBusy(true);
    const result = await autopilotAction("ap_navigation", "save", parsed.data);
    setBusy(false);
    setMessage(result.success ? { text: "Navigation saved for this role. People see it on their next page load.", tone: "ok" } : { text: result.error, tone: "error" });
    if (result.success) await refresh();
  }
  async function reset() {
    setBusy(true);
    const result = await autopilotAction("ap_navigation", "reset", { role });
    setBusy(false);
    setMessage(result.success ? { text: "This role is back to the standard navigation.", tone: "ok" } : { text: result.error, tone: "error" });
    if (result.success) { setSelected([]); await refresh(); }
  }
  const move = (index: number, delta: number) => setSelected(list => { const next = [...list]; const target = index + delta; if (target < 0 || target >= next.length) return list; [next[index], next[target]] = [next[target], next[index]]; return next; });

  return <section className="min-w-0 space-y-4 rounded-2xl border border-neutral-200 bg-white p-4 sm:p-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-lg font-bold">Navigation by role</h2><p className="text-sm text-neutral-600">At most {MAX_PRIMARY_ITEMS} destinations in the main navigation; everything else stays under More and in search. Hiding a link does not change what the role may open.</p></div>
      <label className="text-sm font-semibold">Role<select className="ml-2 h-11 rounded-xl border border-neutral-300 bg-white px-3" value={role} onChange={event => switchRole(event.target.value)}>
        {usage.roles.map(entry => <option key={entry.role} value={entry.role}>{entry.role.replaceAll("_", " ")}</option>)}</select></label>
    </div>
    {message ? <p role={message.tone === "error" ? "alert" : "status"} className={`rounded-xl p-3 text-sm font-semibold ${message.tone === "error" ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>{message.text}</p> : null}
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="min-w-0 space-y-2">
        <h3 className="font-bold">Most used in the last 28 days</h3>
        <p className="text-xs text-neutral-600">{current?.days_observed ?? 0} day(s) with visits. A proposal is prepared after 14.</p>
        {!current?.top.length ? <p className="rounded-xl border border-dashed border-neutral-300 p-3 text-sm text-neutral-600">No visits counted for this role yet.</p>
          : <ol className="space-y-1 text-sm">{current.top.map(item => <li key={item.route} className="flex items-center justify-between gap-2 rounded-lg bg-neutral-50 px-3 py-2">
            <span className="min-w-0 [overflow-wrap:anywhere]">{label(item.route)} <span className="text-xs text-neutral-500">{item.route}</span></span><span className="shrink-0 font-semibold">{item.visits}</span></li>)}</ol>}
      </div>
      <div className="min-w-0 space-y-2">
        <h3 className="font-bold">Main navigation for this role</h3>
        <p className="text-xs text-neutral-600">{current?.layout ? `Version ${current.layout.version}, ${current.layout.source === "proposal" ? "from an accepted proposal" : "set by hand"}.` : "Using the standard list for this role."}</p>
        <ol className="space-y-1">{selected.map((href, index) => <li key={href} className="flex items-center gap-2 rounded-lg border border-neutral-200 px-2 py-1 text-sm">
          <span className="w-5 text-right text-xs text-neutral-500">{index + 1}</span><span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{label(href)}</span>
          <button type="button" aria-label={`Move ${label(href)} up`} className="min-h-9 min-w-9 rounded border" onClick={() => move(index, -1)}>↑</button>
          <button type="button" aria-label={`Move ${label(href)} down`} className="min-h-9 min-w-9 rounded border" onClick={() => move(index, 1)}>↓</button>
          <button type="button" aria-label={`Remove ${label(href)}`} className="min-h-9 min-w-9 rounded border" onClick={() => setSelected(selected.filter(item => item !== href))}>×</button></li>)}</ol>
        <label className="block text-sm font-semibold">Add a destination<select className="mt-1 block h-11 w-full rounded-xl border border-neutral-300 bg-white px-3" value="" disabled={selected.length >= MAX_PRIMARY_ITEMS}
          onChange={event => { if (event.target.value) setSelected([...selected, event.target.value]); }}>
          <option value="">{selected.length >= MAX_PRIMARY_ITEMS ? `Nine chosen (the most allowed)` : "Choose…"}</option>
          {allowed.filter(item => !selected.includes(item.href)).map(item => <option key={item.href} value={item.href}>{item.label}</option>)}</select></label>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !selected.length} onClick={save} className="min-h-11 rounded-xl bg-neutral-950 px-4 text-sm font-bold text-white disabled:opacity-50">Save for {role.replaceAll("_", " ")}</button>
          {current?.layout ? <button type="button" disabled={busy} onClick={reset} className="min-h-11 rounded-xl border border-neutral-300 px-4 text-sm font-bold">Use the standard list</button> : null}</div>
      </div>
    </div>
  </section>;
}

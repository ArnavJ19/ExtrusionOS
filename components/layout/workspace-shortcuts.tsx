"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bookmark, ChevronDown, Clock3, Star, X } from "lucide-react";
import { getModuleConfig, moduleConfigs, type ModuleKey } from "@/components/modules/operations/module-config";
import { moveWorkspaceLink, roleWorkspaceLinks } from "@/lib/preferences/role-workspace";
import { createClient } from "@/lib/supabase/browser";
import { can } from "@/lib/auth/permissions";
import { getWorkspaceStorage, isRouteAllowedByNavigation, readWorkspacePreferences, upsertWorkspaceLink, workspacePreferenceKey, writeWorkspacePreferences, type WorkspaceLink, type WorkspacePreferences } from "@/lib/preferences/workspace-preferences";
import type { SessionContext } from "@/types/app";

export function WorkspaceShortcuts({ context, allowedRoutes, placement = "full" }: { context: SessionContext; allowedRoutes: readonly string[]; placement?: "compact" | "full" }) {
  const storageKey = workspacePreferenceKey(context);
  const scopeSignature = JSON.stringify([context.companyId, context.userId, context.role, [...allowedRoutes].sort()]);
  const supabase = useMemo(() => createClient(), []);
  const [loaded, setLoaded] = useState<{ signature: string; preferences: WorkspacePreferences } | null>(null);
  const [notice, setNotice] = useState("");
  const destinations = roleWorkspaceLinks(context.role, Object.values(moduleConfigs).map((config) => ({ href: config.basePath, label: config.title, resource: config.resource, moduleKey: config.key })), allowedRoutes);

  useEffect(() => {
    let active = true;
    let generation = 0;
    const refresh = () => { void loadAndFilter(); };
    window.addEventListener("extrusionos:workspace-preferences", refresh);
    const isAllowed = (link: WorkspaceLink) => {
      try {
        const config = getModuleConfig(link.moduleKey as ModuleKey);
        const path = new URL(link.href, window.location.origin).pathname;
        const hasRoute = path === config.basePath || path.startsWith(`${config.basePath}/`);
        const enabledForCompany = isRouteAllowedByNavigation(path, allowedRoutes);
        return can(context.role, "read", config.resource) && hasRoute && enabledForCompany;
      } catch {
        return false;
      }
    };
    async function loadAndFilter() {
      const currentGeneration = ++generation;
      const storage = getWorkspaceStorage();
      const latest = readWorkspacePreferences(storage, storageKey);
      const candidateLinks = [...latest.pinned, ...latest.recent].filter((link, index, values) => values.findIndex((item) => item.href === link.href) === index);
      const available = await Promise.all(candidateLinks.map(async (link) => {
        if (!isAllowed(link)) return null;
        if (!link.recordId) return link.href;
        try {
          const config = getModuleConfig(link.moduleKey as ModuleKey);
          const { data, error } = await supabase.from((config.readTable ?? config.table) as any).select("id").eq("id", link.recordId).eq("company_id", context.companyId).maybeSingle();
          return error || !data ? null : link.href;
        } catch {
          return null;
        }
      }));
      if (!active || currentGeneration !== generation) return;
      const keep = new Set(available.filter((href): href is string => Boolean(href)));
      setLoaded({
        signature: scopeSignature,
        preferences: {
          ...latest,
          pinned: latest.pinned.filter((link) => keep.has(link.href)),
          recent: latest.recent.filter((link) => keep.has(link.href)),
          views: latest.views.filter(isAllowed)
        }
      });
    }
    void loadAndFilter();
    return () => { active = false; window.removeEventListener("extrusionos:workspace-preferences", refresh); };
  }, [allowedRoutes, context.companyId, context.role, context.userId, scopeSignature, storageKey, supabase]);

  const preferences = loaded?.signature === scopeSignature ? loaded.preferences : null;
  if (!preferences) return null;
  const currentPreferences = preferences;

  function remove(kind: "pinned" | "recent" | "views", href: string) {
    const storage = getWorkspaceStorage();
    const latest = readWorkspacePreferences(storage, storageKey);
    const next = { ...latest, [kind]: latest[kind].filter((item) => item.href !== href) } as WorkspacePreferences;
    if (!writeWorkspacePreferences(storage, storageKey, next)) { setNotice("Workspace storage is unavailable. This shortcut could not be removed from device storage."); return; }
    setLoaded({ signature: scopeSignature, preferences: { ...currentPreferences, [kind]: currentPreferences[kind].filter((item) => item.href !== href) } as WorkspacePreferences });
  }

  function pinDestination(link: typeof destinations[number], updatedAt: number) {
    const storage = getWorkspaceStorage();
    const latest = readWorkspacePreferences(storage, storageKey);
    const next = togglePinnedWorkspaceLink(latest, { ...link, updatedAt });
    if (!writeWorkspacePreferences(storage, storageKey, next)) { setNotice("Workspace storage is unavailable. This pin could not be saved. Check your browser's storage settings."); return; }
    setLoaded({ signature: scopeSignature, preferences: { ...currentPreferences, pinned: next.pinned } });
  }

  function move(href: string, direction: -1 | 1) {
    const storage = getWorkspaceStorage();
    const latest = readWorkspacePreferences(storage, storageKey);
    const pinned = moveWorkspaceLink(latest.pinned, href, direction, currentPreferences.pinned.map((item) => item.href));
    if (!writeWorkspacePreferences(storage, storageKey, { ...latest, pinned })) { setNotice("Workspace storage is unavailable. Your saved order could not be updated."); return; }
    const allowed = new Set(currentPreferences.pinned.map((item) => item.href));
    setLoaded({ signature: scopeSignature, preferences: { ...currentPreferences, pinned: pinned.filter((item) => allowed.has(item.href)) } });
  }

  const compact = placement === "compact";
  const content = <div className="space-y-6">
        <section aria-label="Role workspace" className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-600">Your role workspace</h3>
          <a href="/dashboard" className="inline-flex min-h-11 items-center rounded-lg text-sm font-semibold text-neutral-700 hover:text-neutral-950">← Back to My Work Today</a>
          <ul className="space-y-1">{destinations.map((link) => <li key={link.href} className="flex min-w-0 items-center gap-2">
            <a href={link.href} className="flex min-h-11 min-w-0 flex-1 items-center break-words rounded-lg px-2 text-sm font-semibold">{link.label}</a>
            <button type="button" className="min-h-11 rounded-lg px-2 text-xs font-bold" aria-label={`${preferences.pinned.some((item) => item.href === link.href) ? "Unpin" : "Pin"} ${link.label}`} onClick={() => pinDestination(link, Date.now())}>{preferences.pinned.some((item) => item.href === link.href) ? "Unpin" : "Pin"}</button>
          </li>)}</ul>
        </section>
        {notice ? <p role="status" className="text-xs text-amber-900">{notice}</p> : null}
        <ShortcutGroup title="Pinned" icon={<Star className="h-3.5 w-3.5" />} links={preferences.pinned} onRemove={(href) => remove("pinned", href)} onMove={move} />
        <ShortcutGroup title="Recent records" icon={<Clock3 className="h-3.5 w-3.5" />} links={preferences.recent} onRemove={(href) => remove("recent", href)} />
        <ShortcutGroup title="Saved views" icon={<Bookmark className="h-3.5 w-3.5" />} links={preferences.views} onRemove={(href) => remove("views", href)} />
      </div>;
  if (compact) return <details className="w-full">
    <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"><Bookmark className="h-4 w-4" /> Workspace</summary>
    <div className="mt-2 w-full rounded-xl border border-neutral-200 bg-white p-3">{content}</div>
  </details>;
  return <details className="group mt-4 rounded-3xl border border-neutral-200 bg-white shadow-sm">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-3xl px-5 py-4 text-sm font-bold text-neutral-800 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange [&::-webkit-details-marker]:hidden">
      <span className="flex items-center gap-3"><Bookmark className="h-4 w-4" /> Pinned and recent work</span>
      <ChevronDown className="h-4 w-4 text-neutral-400 transition-transform group-open:rotate-180" />
    </summary>
    <div className="border-t border-neutral-100 px-5 pb-5 pt-4">{content}</div>
  </details>;
}

function ShortcutGroup({ title, icon, links, onRemove, onMove }: { title: string; icon: ReactNode; links: WorkspaceLink[]; onRemove: (href: string) => void; onMove?: (href: string, direction: -1 | 1) => void }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-neutral-500">{icon}{title}</h3>
      {links.length ? <ul className="space-y-1">
        {links.map((link, index) => <li key={link.href} className="flex flex-wrap items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-neutral-50">
          <a className="flex min-h-11 min-w-0 flex-1 items-center break-words text-sm font-semibold text-neutral-800" href={link.href}>{link.label}</a>
          {onMove ? <button type="button" disabled={index === 0} aria-label={`Move ${link.label} earlier`} onClick={() => onMove(link.href, -1)} className="min-h-11 rounded px-2 text-xs font-semibold disabled:opacity-40">Up</button> : null}
          {onMove ? <button type="button" disabled={index === links.length - 1} aria-label={`Move ${link.label} later`} onClick={() => onMove(link.href, 1)} className="min-h-11 rounded px-2 text-xs font-semibold disabled:opacity-40">Down</button> : null}
          <button type="button" aria-label={`Remove ${link.label} from ${title.toLowerCase()}`} onClick={() => onRemove(link.href)} className="flex min-h-11 min-w-11 items-center justify-center rounded text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800"><X className="h-3.5 w-3.5" /></button>
        </li>)}
      </ul> : <p className="px-2 py-1 text-xs text-neutral-400">Nothing saved yet.</p>}
    </section>
  );
}

export function togglePinnedWorkspaceLink(preferences: WorkspacePreferences, link: WorkspaceLink): WorkspacePreferences {
  const pinned = preferences.pinned.some((item) => item.href === link.href)
    ? preferences.pinned.filter((item) => item.href !== link.href)
    : upsertWorkspaceLink(preferences.pinned, link, 24);
  return { ...preferences, pinned };
}

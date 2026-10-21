"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bookmark, Clock3, Star, X } from "lucide-react";
import { getModuleConfig, type ModuleKey } from "@/components/modules/operations/module-config";
import { createClient } from "@/lib/supabase/browser";
import { can } from "@/lib/auth/permissions";
import { getWorkspaceStorage, isRouteAllowedByNavigation, readWorkspacePreferences, upsertWorkspaceLink, workspacePreferenceKey, writeWorkspacePreferences, type WorkspaceLink, type WorkspacePreferences } from "@/lib/preferences/workspace-preferences";
import type { SessionContext } from "@/types/app";

export function WorkspaceShortcuts({ context, allowedRoutes, placement = "full" }: { context: SessionContext; allowedRoutes: readonly string[]; placement?: "compact" | "full" }) {
  const storageKey = workspacePreferenceKey(context);
  const scopeSignature = JSON.stringify([context.companyId, context.userId, context.role, [...allowedRoutes].sort()]);
  const supabase = useMemo(() => createClient(), []);
  const [loaded, setLoaded] = useState<{ signature: string; preferences: WorkspacePreferences } | null>(null);

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
    writeWorkspacePreferences(storage, storageKey, next);
    setLoaded({ signature: scopeSignature, preferences: { ...currentPreferences, [kind]: currentPreferences[kind].filter((item) => item.href !== href) } as WorkspacePreferences });
  }

  const compact = placement === "compact";
  const content = <div className="space-y-4">
        <ShortcutGroup title="Pinned" icon={<Star className="h-3.5 w-3.5" />} links={preferences.pinned} onRemove={(href) => remove("pinned", href)} />
        <ShortcutGroup title="Recent records" icon={<Clock3 className="h-3.5 w-3.5" />} links={preferences.recent} onRemove={(href) => remove("recent", href)} />
        <ShortcutGroup title="Saved views" icon={<Bookmark className="h-3.5 w-3.5" />} links={preferences.views} onRemove={(href) => remove("views", href)} />
      </div>;
  if (compact) return <details className="w-full">
    <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"><Bookmark className="h-4 w-4" /> Workspace</summary>
    <div className="mt-2 w-full rounded-xl border border-neutral-200 bg-white p-3">{content}</div>
  </details>;
  return <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
    <div className="mb-3 flex items-center gap-2 text-sm font-bold text-neutral-800"><Bookmark className="h-4 w-4" /> Pinned and recent work</div>
    {content}
  </section>;
}

function ShortcutGroup({ title, icon, links, onRemove }: { title: string; icon: ReactNode; links: WorkspaceLink[]; onRemove: (href: string) => void }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-neutral-500">{icon}{title}</h3>
      {links.length ? <ul className="space-y-1">
        {links.map((link) => <li key={link.href} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-neutral-50">
          <a className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-800" href={link.href}>{link.label}</a>
          <button type="button" aria-label={`Remove ${link.label} from ${title.toLowerCase()}`} onClick={() => onRemove(link.href)} className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-800"><X className="h-3.5 w-3.5" /></button>
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

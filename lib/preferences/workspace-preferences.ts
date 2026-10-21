export type WorkspaceScope = { companyId: string; userId: string };

export type WorkspaceViewState = {
  search: string;
  status: string;
  secondary: string;
  dateFrom: string;
  dateTo: string;
  page: number;
  sort: string;
  direction: "asc" | "desc";
  relationFilters: Record<string, string>;
};

export type WorkspaceLink = { href: string; label: string; moduleKey: string; recordId?: string; updatedAt: number };
export type SavedWorkspaceView = WorkspaceLink & { state: WorkspaceViewState };
export type WorkspacePreferences = {
  pinned: WorkspaceLink[];
  recent: WorkspaceLink[];
  views: SavedWorkspaceView[];
  columns: Record<string, { order: string[]; hidden: string[]; widths: Record<string, number> }>;
};

export const emptyWorkspacePreferences = (): WorkspacePreferences => ({ pinned: [], recent: [], views: [], columns: {} });
export const MAX_PINS = 24;
export const MAX_RECENTS = 20;
export const MAX_SAVED_VIEWS = 20;
const MAX_LABEL_LENGTH = 100;
const MAX_HREF_LENGTH = 800;

export function getWorkspaceStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function workspacePreferenceKey(scope: WorkspaceScope): string {
  return `extrusionos:workspace:v1:${scope.companyId}:${scope.userId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSafeWorkspaceHref(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_HREF_LENGTH || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const parsed = new URL(value, "https://extrusionos.invalid");
    return parsed.origin === "https://extrusionos.invalid" && !parsed.pathname.startsWith("/api/") && !parsed.pathname.startsWith("/auth/") && !parsed.pathname.startsWith("/login");
  } catch {
    return false;
  }
}

export function isRouteAllowedByNavigation(path: string, allowedRoutes: readonly string[]): boolean {
  return allowedRoutes.some((route) => typeof route === "string" && route.startsWith("/") && !route.startsWith("//") && (path === route || path.startsWith(`${route.replace(/\/$/, "")}/`)));
}

function cleanLink(value: unknown): WorkspaceLink | null {
  if (!isRecord(value) || !isSafeWorkspaceHref(value.href) || typeof value.moduleKey !== "string" || !/^[a-z_]{1,48}$/.test(value.moduleKey)) return null;
  const label = typeof value.label === "string" ? value.label.trim().slice(0, MAX_LABEL_LENGTH) : "";
  if (!label) return null;
  const updatedAt = typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now();
  const recordId = typeof value.recordId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value.recordId) ? value.recordId : undefined;
  return { href: value.href, moduleKey: value.moduleKey, label, updatedAt, ...(recordId ? { recordId } : {}) };
}

function cleanState(value: unknown): WorkspaceViewState | null {
  if (!isRecord(value)) return null;
  const page = Number(value.page);
  const direction = value.direction === "desc" ? "desc" : value.direction === "asc" ? "asc" : null;
  if (!direction || !Number.isSafeInteger(page) || page < 1 || page > 100000) return null;
  const stringValue = (key: string, max = 100) => typeof value[key] === "string" ? String(value[key]).slice(0, max) : "";
  return {
    search: stringValue("search"), status: stringValue("status", 80), secondary: stringValue("secondary", 80),
    dateFrom: stringValue("dateFrom", 10), dateTo: stringValue("dateTo", 10),
    page, sort: stringValue("sort", 80), direction,
    relationFilters: isRecord(value.relationFilters) ? Object.fromEntries(Object.entries(value.relationFilters).filter(([key, item]) => /^[a-z_]{1,48}$/.test(key) && typeof item === "string").slice(0, 10).map(([key, item]) => [key, String(item).slice(0, 80)])) : {}
  };
}

function cleanLinks(value: unknown, limit: number): WorkspaceLink[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit * 2).map(cleanLink).filter((link): link is WorkspaceLink => link !== null).slice(0, limit);
}

export function sanitizeWorkspacePreferences(value: unknown): WorkspacePreferences {
  if (!isRecord(value)) return emptyWorkspacePreferences();
  const pinned = cleanLinks(value.pinned, MAX_PINS);
  const recent = cleanLinks(value.recent, MAX_RECENTS);
  const views = Array.isArray(value.views) ? value.views.slice(0, MAX_SAVED_VIEWS).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const link = cleanLink(entry);
    const state = cleanState(entry.state);
    return link && state ? [{ ...link, state }] : [];
  }) : [];
  const columns: WorkspacePreferences["columns"] = {};
  if (isRecord(value.columns)) {
    for (const [moduleKey, raw] of Object.entries(value.columns).slice(0, 30)) {
      if (!/^[a-z_]{1,48}$/.test(moduleKey) || !isRecord(raw)) continue;
      const order = Array.isArray(raw.order) ? raw.order.filter((item): item is string => typeof item === "string" && /^[a-z_]{1,64}$/.test(item)).slice(0, 40) : [];
      const hidden = Array.isArray(raw.hidden) ? raw.hidden.filter((item): item is string => typeof item === "string" && /^[a-z_]{1,64}$/.test(item)).slice(0, 40) : [];
      const widths: Record<string, number> = {};
      if (isRecord(raw.widths)) for (const [id, width] of Object.entries(raw.widths).slice(0, 40)) {
        if (/^[a-z_]{1,64}$/.test(id) && typeof width === "number" && Number.isFinite(width)) widths[id] = Math.max(80, Math.min(480, Math.round(width)));
      }
      columns[moduleKey] = { order, hidden, widths };
    }
  }
  return { pinned, recent, views, columns };
}

export function mergeWorkspacePreferenceChanges(previous: WorkspacePreferences, next: WorkspacePreferences, latest: WorkspacePreferences): WorkspacePreferences {
  const merged = { ...latest };
  if (JSON.stringify(previous.pinned) !== JSON.stringify(next.pinned)) merged.pinned = next.pinned;
  if (JSON.stringify(previous.recent) !== JSON.stringify(next.recent)) merged.recent = next.recent;
  if (JSON.stringify(previous.views) !== JSON.stringify(next.views)) merged.views = next.views;
  if (JSON.stringify(previous.columns) !== JSON.stringify(next.columns)) merged.columns = next.columns;
  return sanitizeWorkspacePreferences(merged);
}

export function readWorkspacePreferences(storage: Pick<Storage, "getItem"> | null | undefined, key: string): WorkspacePreferences {
  try {
    const raw = storage?.getItem(key);
    return raw ? sanitizeWorkspacePreferences(JSON.parse(raw)) : emptyWorkspacePreferences();
  } catch {
    return emptyWorkspacePreferences();
  }
}

export function writeWorkspacePreferences(storage: Pick<Storage, "setItem"> | null | undefined, key: string, value: WorkspacePreferences): boolean {
  try {
    storage?.setItem(key, JSON.stringify(sanitizeWorkspacePreferences(value)));
    if (typeof window !== "undefined") window.dispatchEvent(new Event("extrusionos:workspace-preferences"));
    return Boolean(storage);
  } catch {
    return false;
  }
}

export function makeViewState(params: URLSearchParams): WorkspaceViewState {
  const page = Number(params.get("page") ?? "1");
  return {
    search: (params.get("search") ?? "").slice(0, 100), status: (params.get("status") ?? "").slice(0, 80),
    secondary: (params.get("secondary") ?? "").slice(0, 80), dateFrom: (params.get("dateFrom") ?? "").slice(0, 10),
    dateTo: (params.get("dateTo") ?? "").slice(0, 10), page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100000) : 1,
    sort: (params.get("sort") ?? "").slice(0, 80), direction: params.get("direction") === "desc" ? "desc" : "asc",
    relationFilters: Object.fromEntries(["customer_id", "profile_id", "order_id", "quote_id", "production_job_id", "inventory_item_id", "expense_ledger_id", "source_record_id", "material_id", "job_id"].flatMap((key) => {
      const value = params.get(key);
      return value ? [[key, value.slice(0, 80)]] : [];
    }))
  };
}

export function viewStateParams(state: WorkspaceViewState): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ search: state.search, status: state.status, secondary: state.secondary, dateFrom: state.dateFrom, dateTo: state.dateTo })) {
    if (value) params.set(key, value);
  }
  if (state.page > 1) params.set("page", String(state.page));
  if (state.sort) params.set("sort", state.sort);
  if (state.direction !== "asc") params.set("direction", state.direction);
  for (const [key, value] of Object.entries(state.relationFilters)) if (value) params.set(key, value);
  return params;
}

export function workspaceListUrl(pathname: string, currentSearch: string, state: WorkspaceViewState, relationFilterFields: readonly string[]): string {
  const params = new URLSearchParams(currentSearch);
  for (const key of ["search", "status", "secondary", "dateFrom", "dateTo", "page", "sort", "direction", ...relationFilterFields]) params.delete(key);
  for (const [key, value] of viewStateParams(state)) params.set(key, value);
  return `${pathname}${params.size ? `?${params.toString()}` : ""}`;
}

export function upsertWorkspaceLink(items: WorkspaceLink[], link: WorkspaceLink, limit: number): WorkspaceLink[] {
  return [link, ...items.filter((item) => item.href !== link.href)].slice(0, limit);
}

export function upsertNamedWorkspaceView(items: SavedWorkspaceView[], view: SavedWorkspaceView): SavedWorkspaceView[] {
  return [view, ...items.filter((item) => item.label !== view.label && item.href !== view.href)].slice(0, MAX_SAVED_VIEWS);
}

export function toggleWorkspacePin(preferences: WorkspacePreferences, link: WorkspaceLink): WorkspacePreferences {
  const pinned = preferences.pinned.some((item) => item.href === link.href)
    ? preferences.pinned.filter((item) => item.href !== link.href)
    : upsertWorkspaceLink(preferences.pinned, link, MAX_PINS);
  return { ...preferences, pinned };
}

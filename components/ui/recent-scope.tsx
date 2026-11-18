"use client";

import { createContext, useContext, type ReactNode } from "react";

// AP-090: the signed-in user's scope for recently used selector values (this browser only). Without a provider
// (public pages, tests) no recent values are stored or shown.
const RecentScope = createContext<string>("");

export function RecentScopeProvider({ scope, children }: { scope: string; children: ReactNode }) {
  return <RecentScope.Provider value={scope}>{children}</RecentScope.Provider>;
}

export const useRecentScope = () => useContext(RecentScope);

/** AP-025: what the app-wide scanner listener hands to a field that accepts a scanned label. */
export type ScanFieldEvent = { ok: true; entityType: string; entityId: string; label: string } | { ok: false; error: string };
export const SCAN_FIELD_EVENT = "exos:scan-field";

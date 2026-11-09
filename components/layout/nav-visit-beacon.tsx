"use client";

// AP-042: counts which navigation destination a page belongs to, per role and day. Only the destination path is sent
// (for example /orders), never record ids, query strings or who visited. Failures are ignored.
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { autopilotAction } from "@/lib/actions/autopilot";
import { normalizeVisitRoute } from "@/lib/navigation/role-navigation";

export function NavVisitBeacon({ destinations }: { destinations: Array<{ href: string; aliases?: string[] }> }) {
  const pathname = usePathname();
  const last = useRef<string | null>(null);
  useEffect(() => {
    const route = normalizeVisitRoute(pathname ?? "/", destinations);
    if (!route || route === last.current) return;
    last.current = route;
    const timer = window.setTimeout(() => { void autopilotAction("ap_navigation", "visit", { route }).catch(() => undefined); }, 1500);
    return () => window.clearTimeout(timer);
  }, [pathname, destinations]);
  return null;
}

// AP-042: route visit counting (counts only) and approved role navigation. Hiding a link never changes permissions:
// buildTaskNavigation still filters every item by role, route access and feature flag, and search finds everything.
import { z } from "zod";

export const MAX_PRIMARY_ITEMS = 9;
export const NAV_ROLES = ["owner", "admin", "sales_manager", "sales", "production_manager", "production", "factory_manager", "dispatch_manager", "dispatch",
  "inventory_manager", "accounts", "quality", "viewer"] as const;
const routePattern = /^\/[a-z0-9-]+(\/[a-z0-9-]+){0,2}$/;

/** The navigation destination a pathname belongs to (longest matching href or alias), or null. No ids, no query. */
export function normalizeVisitRoute(pathname: string, destinations: Array<{ href: string; aliases?: string[] }>) {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  let best: string | null = null, bestLength = -1;
  for (const destination of destinations) {
    for (const candidate of [destination.href, ...(destination.aliases ?? [])]) {
      if ((path === candidate || path.startsWith(`${candidate}/`)) && candidate.length > bestLength) { best = destination.href; bestLength = candidate.length; }
    }
  }
  return best && routePattern.test(best) ? best : null;
}

export const roleNavigationItemsSchema = z.array(z.string().regex(routePattern, "Unknown destination")).min(1, "Choose at least one destination")
  .max(MAX_PRIMARY_ITEMS, `Choose at most ${MAX_PRIMARY_ITEMS} destinations`).refine(items => new Set(items).size === items.length, "Each destination may appear once");
export const navigationSaveSchema = z.object({ role: z.enum(NAV_ROLES), items: roleNavigationItemsSchema }).strict();

export const navigationLayoutSchema = z.object({ items: z.array(z.string()).nullable(), version: z.number().optional(), approved_at: z.string().optional() });
export const navigationUsageSchema = z.object({
  roles: z.array(z.object({
    role: z.string(), days_observed: z.number(), top: z.array(z.object({ route: z.string(), visits: z.number() })),
    layout: z.object({ items: z.array(z.string()), version: z.number(), source: z.enum(["proposal", "manual"]), approved_at: z.string() }).nullable()
  }))
});
export type NavigationUsage = z.infer<typeof navigationUsageSchema>;

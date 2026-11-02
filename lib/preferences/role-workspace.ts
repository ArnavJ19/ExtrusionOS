import type { UserRole } from "../../types/app.ts";
import { can, type Resource } from "../auth/permissions.ts";
import { hasRouteAccess } from "../auth/route-permissions.ts";
import { buildTaskNavigation } from "../navigation/task-navigation.ts";
import { isRouteAllowedByNavigation, type WorkspaceLink } from "./workspace-preferences.ts";

export function roleWorkspaceLinks(role: UserRole, candidates: { href: string; label: string; resource: Resource; moduleKey: string }[], allowedRoutes: readonly string[]) {
  if (role.startsWith("dealer")) return [];
  const permitted = candidates.filter((item) => can(role, "read", item.resource) && isRouteAllowedByNavigation(item.href, allowedRoutes));
  const navigation = buildTaskNavigation({ role, items: permitted.map((item) => ({ ...item, icon: "", roles: [role] })),
    featureFlags: {}, hasRouteAccess, isFeatureEnabled: () => true, primaryLimit: 4 });
  return navigation.primary.map((item) => permitted.find((candidate) => candidate.href === item.href)!);
}

export function moveWorkspaceLink(links: WorkspaceLink[], href: string, direction: -1 | 1, visibleHrefs?: readonly string[]) {
  const visible = visibleHrefs ? new Set(visibleHrefs) : null;
  const positions = links.flatMap((item, index) => !visible || visible.has(item.href) ? [index] : []);
  const position = positions.findIndex((index) => links[index].href === href);
  const nextPosition = position + direction;
  if (position < 0 || nextPosition < 0 || nextPosition >= positions.length) return links;
  const index = positions[position], next = positions[nextPosition];
  const result = [...links];
  [result[index], result[next]] = [result[next], result[index]];
  return result;
}

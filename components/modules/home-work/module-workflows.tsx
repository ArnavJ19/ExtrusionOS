import Link from "next/link";
import { canUseHubAction } from "@/lib/navigation/hub-permissions";
import { MODULE_STARTS, moduleWorkHref, type ModuleKey } from "@/lib/navigation/home-work";

// Autopilot pages that belong to a module (AP-004 calendar, AP-005 numbering, AP-059 month close; batch 2 press floor,
// scrap standards and in-process samples).
const FLOOR = ["owner", "admin", "production_manager", "production", "factory_manager"];
const MODULE_LINKS: Partial<Record<ModuleKey, Array<{ href: string; label: string; roles: string[] }>>> = {
  production: [
    { href: "/production/floor", label: "Press floor", roles: FLOOR },
    { href: "/production/workstation", label: "Press workstation", roles: FLOOR },
    { href: "/production/scrap-standards", label: "Scrap standards", roles: FLOOR },
    { href: "/production/calendar", label: "Factory calendar", roles: ["owner", "admin", "production_manager", "production", "factory_manager", "viewer"] }],
  quality: [{ href: "/quality/samples", label: "In-process samples", roles: ["owner", "admin", "quality", "factory_manager", "production_manager"] }],
  invoices: [{ href: "/invoices/periods", label: "Month close", roles: ["owner", "admin", "accounts", "viewer"] }, { href: "/invoices/numbering", label: "Document numbering", roles: ["owner", "admin", "accounts", "viewer"] }]
};

// AP-041: module-level work (not about one record) starts from the module overview instead of a /tasks hub.
export function ModuleWorkflows({ module, role }: { module: ModuleKey; role: string }) {
  const starts = MODULE_STARTS[module].filter(start => canUseHubAction(start.hub, role, start.action));
  const links = (MODULE_LINKS[module] ?? []).filter(link => link.roles.includes(role));
  if (!starts.length && !links.length) return null;
  return <section aria-label="More workflows" className="min-w-0 rounded-2xl border border-neutral-200 bg-white p-4">
    <h2 className="text-sm font-bold">More workflows</h2>
    <ul className="mt-2 flex flex-wrap gap-2">
      {links.map(link => <li key={link.href}><Link href={link.href} className="inline-flex min-h-10 items-center rounded-xl bg-neutral-950 px-3 text-sm font-semibold text-white">{link.label}</Link></li>)}
      {starts.map(start => <li key={`${start.hub}:${start.action}`}>
        <Link href={moduleWorkHref(module, start.hub, start.action)} className="inline-flex min-h-10 items-center rounded-xl border border-neutral-300 px-3 text-sm font-semibold hover:bg-neutral-50">{start.label}</Link></li>)}</ul>
  </section>;
}

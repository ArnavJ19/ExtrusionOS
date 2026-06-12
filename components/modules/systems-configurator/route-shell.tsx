import Link from "next/link";
import { ArrowRight, Calculator, FileText, FolderKanban, Library, Ruler, Settings2, TableProperties } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { labelize } from "@/types/app";

export const systemsConfiguratorRoutes = [
  { href: "/systems-configurator/new", label: "New Configuration", description: "Create a door/window design with dimensions, layout, series, glass, finish, hardware, and costing.", icon: Ruler },
  { href: "/systems-configurator/projects", label: "Projects", description: "Browse saved configurations, statuses, customer links, and production outputs.", icon: FolderKanban },
  { href: "/systems-configurator/templates", label: "Templates", description: "Manage system templates, deductions, rules, and formula versions.", icon: Settings2 },
  { href: "/systems-configurator/libraries", label: "Libraries", description: "Maintain profile roles, hardware, glass, finishes, accessories, and rates.", icon: Library },
  { href: "/systems-configurator/reports", label: "Reports", description: "Generate customer quotes, cutting lists, glass lists, BOMs, and production sheets.", icon: FileText }
];

const phaseOneCapabilities = [
  "Tenant-safe database foundation",
  "Central formula and costing engine contracts",
  "Formula safety without JavaScript eval",
  "Production route structure",
  "RLS-ready project output tables"
];

export function SystemsConfiguratorOverview() {
  return (
    <div className="space-y-6">
      <PageHeader title="Aluminium Systems Configurator" description="SystemBuilder Pro foundation for designing, quoting, and preparing production-ready aluminium doors and windows." />
      <section className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="grid min-h-[320px] lg:grid-cols-[0.9fr_1.1fr]">
              <div className="bg-charcoal p-8 text-white">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-orange">SystemBuilder Pro</p>
                <h2 className="mt-4 max-w-sm text-3xl font-black tracking-tight">Configure aluminium systems from sales quote to shop-floor output.</h2>
                <p className="mt-4 max-w-md text-sm leading-6 text-slate-300">Phase 1 establishes the architecture for profile cuts, glass sizing, beading, hardware BOM, costing, optimization, and reports without copying any proprietary software workflow.</p>
                <Link href="/systems-configurator/new" className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-orange px-4 py-3 text-sm font-black text-white shadow-lg shadow-orange/20 transition hover:bg-orange/90">
                  Start Configuration <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
              <div className="relative bg-[linear-gradient(135deg,#f8fafc_0%,#ffffff_48%,#e5e7eb_100%)] p-8">
                <div className="rounded-[2rem] border-8 border-slate-800 bg-white p-4 shadow-2xl">
                  <svg viewBox="0 0 520 300" className="h-full w-full" role="img" aria-label="Aluminium sliding window elevation preview">
                    <rect x="25" y="25" width="470" height="230" fill="#f8fafc" stroke="#111827" strokeWidth="10" />
                    <line x1="260" y1="30" x2="260" y2="250" stroke="#334155" strokeWidth="8" />
                    <rect x="50" y="52" width="190" height="176" fill="#dbeafe" stroke="#64748b" strokeWidth="4" />
                    <rect x="280" y="52" width="190" height="176" fill="#e0f2fe" stroke="#64748b" strokeWidth="4" />
                    <path d="M115 170 L210 170 L182 142" fill="none" stroke="#f97316" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M405 110 L310 110 L338 138" fill="none" stroke="#f97316" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
                    <line x1="25" y1="278" x2="495" y2="278" stroke="#0f172a" strokeWidth="2" />
                    <text x="232" y="296" fill="#0f172a" fontSize="18" fontWeight="700">W</text>
                    <line x1="510" y1="25" x2="510" y2="255" stroke="#0f172a" strokeWidth="2" />
                    <text x="500" y="148" fill="#0f172a" fontSize="18" fontWeight="700">H</text>
                  </svg>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><h3 className="font-black tracking-tight text-slate-950">Phase 1 Scope</h3></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {phaseOneCapabilities.map((capability) => (
                <div key={capability} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-sm font-bold text-slate-700">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange/10 text-orange"><Calculator className="h-4 w-4" /></span>
                  {capability}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {systemsConfiguratorRoutes.map((route) => {
          const Icon = route.icon;
          return (
            <Link key={route.href} href={route.href} className="group block">
              <Card className="h-full transition group-hover:-translate-y-0.5 group-hover:border-orange/50 group-hover:shadow-lg">
                <CardContent>
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-charcoal text-orange"><Icon className="h-5 w-5" /></div>
                  <h3 className="mt-4 font-black tracking-tight text-slate-950">{route.label}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{route.description}</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </section>
    </div>
  );
}

type PreparedShellProps = {
  title: string;
  description: string;
  mode?: "workspace" | "table" | "report" | "formula";
  projectId?: string;
};

export function SystemsConfiguratorPreparedShell({ title, description, mode = "workspace", projectId }: PreparedShellProps) {
  const Icon = mode === "table" ? TableProperties : mode === "report" ? FileText : mode === "formula" ? Settings2 : Calculator;
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <Card>
        <CardContent className="grid gap-6 p-6 lg:grid-cols-[0.75fr_1.25fr]">
          <div className="rounded-3xl bg-charcoal p-6 text-white">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange text-white"><Icon className="h-5 w-5" /></div>
            <h2 className="mt-5 text-2xl font-black tracking-tight">Prepared Route</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">This page is not an operational screen yet. It is routed now so the reviewed database-backed workspace can be attached without changing navigation later.</p>
            {projectId ? <p className="mt-4 rounded-2xl bg-white/10 px-3 py-2 text-xs font-bold text-slate-200">Project ID: {projectId}</p> : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {["data model", "RLS isolation", "engine contracts", "UI shell"].map((item) => (
              <div key={item} className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-orange">Ready</p>
                <p className="mt-2 font-black text-slate-950">{labelize(item)}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">Prepared for the next implementation phase; no calculations, exports, or customer-facing outputs run from this shell.</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

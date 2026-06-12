import Link from "next/link";

type OutputNavProps = {
  projectId: string;
  active: "overview" | "cutting" | "glass" | "bom" | "costing" | "optimization";
};

const outputLinks = [
  { key: "overview", label: "Overview", href: "" },
  { key: "cutting", label: "Cutting List", href: "cutting-list" },
  { key: "glass", label: "Glass & Beading", href: "glass-list" },
  { key: "bom", label: "Hardware BOM", href: "bom" },
  { key: "costing", label: "Costing", href: "quote" },
  { key: "optimization", label: "Optimization", href: "optimization" }
] as const;

export function ConfiguratorOutputNav({ projectId, active }: OutputNavProps) {
  return (
    <nav className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-sm" aria-label="Configurator output tabs">
      <div className="flex min-w-max gap-1">
        {outputLinks.map((link) => {
          const isActive = link.key === active;
          return <Link key={link.key} href={`/systems-configurator/projects/${projectId}${link.href ? `/${link.href}` : ""}`} className={`rounded-xl px-4 py-2.5 text-sm font-black transition ${isActive ? "bg-charcoal text-white shadow-sm" : "text-slate-600 hover:bg-slate-50 hover:text-orange"}`}>{link.label}</Link>;
        })}
      </div>
    </nav>
  );
}

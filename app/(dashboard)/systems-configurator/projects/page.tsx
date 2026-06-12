import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getSystemsConfiguratorContext } from "@/lib/systems-configurator/access";
import { labelize } from "@/types/app";

export default async function SystemProjectsPage() {
  const context = await getSystemsConfiguratorContext("read");
  const supabase = await createClient();
  const { data: configurations } = await supabase
    .from("system_configurations")
    .select("id, configuration_number, project_name, design_reference, location_label, width_mm, height_mm, quantity, system_type, status, grand_total, created_at, system_series(series_code, series_name), customers(customer_name, company_name)")
    .eq("company_id", context.companyId)
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader title="System Projects" description="Saved aluminium door/window configurations, draft designs, and future production outputs." />
        <Link href="/systems-configurator/new" className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange/20 transition hover:bg-orange/90"><Plus className="h-4 w-4" /> New Configuration</Link>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                <tr><th className="px-5 py-3">Configuration</th><th className="px-5 py-3">System</th><th className="px-5 py-3">Size</th><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Value</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(configurations ?? []).map((item: any) => (
                  <tr key={item.id} className="transition hover:bg-orange/5">
                    <td className="px-5 py-4"><Link href={`/systems-configurator/projects/${item.id}`} className="font-black text-slate-950 transition hover:text-orange">{item.configuration_number ?? "Draft"} · {item.design_reference}</Link><p className="mt-1 text-xs font-semibold text-slate-500">{item.project_name}{item.location_label ? ` · ${item.location_label}` : ""}</p></td>
                    <td className="px-5 py-4 font-semibold text-slate-700">{labelize(item.system_type ?? "custom")}<p className="mt-1 text-xs text-slate-500">{item.system_series?.series_code ?? "No series"}</p></td>
                    <td className="px-5 py-4 font-semibold text-slate-700">{item.width_mm} x {item.height_mm} mm<p className="mt-1 text-xs text-slate-500">Qty {item.quantity}</p></td>
                    <td className="px-5 py-4 font-semibold text-slate-700">{item.customers?.customer_name ?? "Walk-in"}</td>
                    <td className="px-5 py-4"><Badge value={item.status ?? "draft"} /></td>
                    <td className="px-5 py-4 text-right font-black text-slate-950">Rs. {Number(item.grand_total ?? 0).toLocaleString("en-IN")}</td>
                  </tr>
                ))}
                {!(configurations ?? []).length ? <tr><td colSpan={6} className="px-5 py-10 text-center text-sm font-semibold text-slate-500">No configurations yet. Create the first draft from the configurator.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { KpiValues } from "@/components/modules/fs-batch4/kpi-values";
import { getSessionContext } from "@/lib/auth";
import { KPI_READERS } from "@/lib/fs-batch4/commands";

// FS-77: the KPI dictionary with this period's values, from the one SQL definition (public.fs_kpi).
export default async function KpiPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(KPI_READERS as readonly string[]).includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5">
    <PageHeader title="KPI dictionary" description="Each number defined once. Tap the i beside a figure for how it is calculated." actions={<Link href="/insights" className="text-sm font-bold underline">Insights</Link>} />
    <KpiValues />
  </div>;
}

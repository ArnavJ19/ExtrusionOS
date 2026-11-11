import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { ImportClient } from "@/components/modules/autopilot/import-client";
import { getSessionContext } from "@/lib/auth";

export default async function MasterImportPage() {
  const context = await getSessionContext();
  if (!["owner", "admin"].includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5">
    <PageHeader title="Import masters" description="Bring customers, vendors, transporters, profiles, dies and machines in from Excel at go-live."
      actions={<><Link href="/settings/data/cutover" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Opening balances</Link><Link href="/settings/data" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Back to data</Link></>} />
    <ImportClient />
  </div>;
}

import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { MsmePayments } from "@/components/modules/autopilot-operations/operations";
import { getSessionContext } from "@/lib/auth";
import { FINANCE } from "@/lib/autopilot-batch5/operations";

export default async function MsmePaymentsPage() {
  const context = await getSessionContext();
  if (context.dealerId || !FINANCE.includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5"><PageHeader title="MSME payment tracking" description="Accounts confirms supplier terms and acceptance evidence, then pays through the existing payables workflow." /><MsmePayments /></div>;
}

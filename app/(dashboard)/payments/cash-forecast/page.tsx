import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { CashForecastClient } from "@/components/modules/autopilot-batch9/cash-forecast";
import { getSessionContext } from "@/lib/auth";
import { CASH_ROLES } from "@/lib/autopilot-batch9/commands";

// AP-076: four-week cash forecast (owner and accounts only).
export default async function CashForecastPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(CASH_ROLES as readonly string[]).includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5">
    <PageHeader title="Cash forecast" description="Expected receipts and payments for the next four weeks, built from invoices, bills, purchase orders and the fixed expenses you enter." actions={<Link href="/payments" className="text-sm font-bold underline">Back to payments</Link>} />
    <CashForecastClient />
  </div>;
}

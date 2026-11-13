import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { getSessionContext } from "@/lib/auth";
import { TdsClient } from "@/components/modules/autopilot-batch6/tds";
import { FINANCE_ROLES } from "@/lib/autopilot-batch6/commands";
import { createClient } from "@/lib/supabase/server";
import { getBusinessDateBoundaries } from "@/lib/utils/business-date";

export default async function TdsPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(FINANCE_ROLES as readonly string[]).includes(context.role)) redirect("/dashboard");
  const supabase = await createClient();
  const { data } = await supabase.from("customers").select("id,customer_name,company_name").eq("company_id", context.companyId).is("deleted_at", null).order("customer_name").limit(1000);
  const customers = (data ?? []).map(c => ({ id: String(c.id), name: String(c.company_name || c.customer_name) }));
  return <div className="space-y-5"><PageHeader title="Customer TDS" description="TDS customers deducted, by invoice and quarter, reconciled with the tax credit statement." actions={<Link href="/payments" className="text-sm font-bold underline">Back to payments</Link>} />
    <TdsClient today={getBusinessDateBoundaries().today} customers={customers} /></div>;
}

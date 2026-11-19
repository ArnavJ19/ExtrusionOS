import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { WeightBasisSettings } from "@/components/modules/fs-batch4/weight-basis";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// FS-65: one unit-of-measure and weight-basis policy. The owner decides the invoice basis; owner and admin open it here.
export default async function WeightBasisPage() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin"].includes(context.role)) redirect("/dashboard");
  const supabase = await createClient();
  const { data } = await supabase.from("customers").select("id, customer_name, company_name").eq("company_id", context.companyId).is("deleted_at", null).order("customer_name").limit(500);
  const customers = (data ?? []).map((c: { id: string; customer_name: string | null; company_name: string | null }) => ({ id: c.id, name: c.company_name || c.customer_name || "Customer" }));
  return <div className="space-y-5">
    <PageHeader title="Weight basis" description="Stock in actual kg, orders in pieces and length, invoices on the basis Omalco decides." actions={<Link href="/settings" className="text-sm font-bold underline">Settings</Link>} />
    <WeightBasisSettings customers={customers} />
  </div>;
}

import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { GstRulesClient } from "@/components/modules/order-to-cash/billing";

// AP-037: place of supply from the customer's GSTIN, HSN defaults, and the invoice audit sample.
export default async function TaxRulesPage() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin", "accounts"].includes(context.role)) redirect("/invoices");
  return <div className="mx-auto max-w-5xl space-y-5">
    <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange">Invoices</p><h1 className="text-2xl font-black">GST place of supply</h1>
      <p className="mt-1 max-w-3xl text-sm text-neutral-600">CGST + SGST or IGST follows from the customer&apos;s GSTIN and the company&apos;s state, not from a person choosing the state.</p></div>
    <GstRulesClient />
  </div>;
}

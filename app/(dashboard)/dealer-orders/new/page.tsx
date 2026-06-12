import { redirect } from "next/navigation";
import { QuoteOrderFormClient } from "@/components/modules/orders/quote-order-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";

export default async function NewDealerOrderPage() {
  const context = await getSessionContext();
  if (!can(context.role, "create", "dealer_orders")) redirect("/dealer-orders");
  return <QuoteOrderFormClient context={context} />;
}

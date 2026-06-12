import { QuoteOrderFormClient } from "@/components/modules/orders/quote-order-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function NewOrderPage() {
  const context = await getSessionContext();
  if (!can(context.role, "create", "orders")) redirect("/orders");
  return <QuoteOrderFormClient context={context} />;
}

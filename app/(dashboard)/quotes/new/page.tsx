import { QuotesClient } from "@/components/modules/quotes-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function NewQuotePage() {
  const context = await getSessionContext();
  if (!can(context.role, "create", "quotes")) redirect("/quotes");
  return <QuotesClient context={context} mode="form" />;
}

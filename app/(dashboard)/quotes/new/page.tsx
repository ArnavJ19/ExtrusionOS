import { QuotesClient } from "@/components/modules/quotes-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ repeat_from?: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "create", "quotes")) redirect("/quotes");
  const query = await searchParams;
  return <QuotesClient context={context} mode="form" repeatFromId={typeof query.repeat_from === "string" ? query.repeat_from : undefined} />;
}

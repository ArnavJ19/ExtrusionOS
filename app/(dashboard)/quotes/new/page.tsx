import { QuotesClient } from "@/components/modules/quotes-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ repeat_from?: string; enquiry?: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "create", "quotes")) redirect("/quotes");
  const query = await searchParams;
  return <QuotesClient context={context} mode="form" repeatFromId={typeof query.repeat_from === "string" ? query.repeat_from : undefined} enquiryId={typeof query.enquiry === "string" && /^[0-9a-f-]{36}$/i.test(query.enquiry) ? query.enquiry : undefined} />;
}

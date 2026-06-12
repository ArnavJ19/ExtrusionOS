import { QuotesClient } from "@/components/modules/quotes-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "update", "quotes")) redirect(`/quotes/${id}`);
  return <QuotesClient context={context} mode="form" initialEditId={id} />;
}

import { DispatchFormClient } from "@/components/modules/dispatch-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function NewDispatchPage({ searchParams }: { searchParams: Promise<{ order_id?: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "create", "dispatches")) redirect("/dispatches");
  const query = await searchParams;
  return <DispatchFormClient context={context} initialOrderId={typeof query.order_id === "string" ? query.order_id : undefined} />;
}

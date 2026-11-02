import { RecordFormClient } from "@/components/modules/operations/record-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function NewProductionJobPage({ searchParams }: { searchParams: Promise<{ order_id?: string | string[] }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "create", "production")) redirect("/production");
  const orderId = (await searchParams).order_id;
  return <RecordFormClient moduleKey="production" context={context} sourceOrderId={typeof orderId === "string" ? orderId : null} />;
}

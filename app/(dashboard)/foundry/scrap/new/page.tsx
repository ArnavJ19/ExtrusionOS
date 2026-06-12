import { RecordFormClient } from "@/components/modules/operations/record-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function NewAluminiumScrapPage() {
  const context = await getSessionContext();
  if (!can(context.role, "create", "foundry")) redirect("/foundry/scrap");
  return <RecordFormClient moduleKey="foundry_scrap" context={context} />;
}

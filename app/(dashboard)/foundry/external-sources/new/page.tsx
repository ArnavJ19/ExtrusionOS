import { RecordFormClient } from "@/components/modules/operations/record-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function NewExternalSourcePage() {
  const context = await getSessionContext();
  if (!can(context.role, "create", "foundry")) redirect("/foundry/external-sources");
  return <RecordFormClient moduleKey="foundry_external_sources" context={context} />;
}

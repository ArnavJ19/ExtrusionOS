import { RecordFormClient } from "@/components/modules/operations/record-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function EditExternalSourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "update", "foundry")) redirect(`/foundry/external-sources/${id}`);
  return <RecordFormClient moduleKey="foundry_external_sources" context={context} recordId={id} />;
}

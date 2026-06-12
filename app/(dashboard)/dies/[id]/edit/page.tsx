import { DieFormClient } from "@/components/modules/dies/die-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function EditDiePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "update", "dies")) redirect(`/dies/${id}`);
  return <DieFormClient context={context} dieId={id} />;
}

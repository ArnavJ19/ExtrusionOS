import { DieFormClient } from "@/components/modules/dies/die-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function NewDiePage() {
  const context = await getSessionContext();
  if (!can(context.role, "create", "dies")) redirect("/dies");
  return <DieFormClient context={context} />;
}

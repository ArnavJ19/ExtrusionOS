import { ProfileFormClient } from "@/components/modules/profiles/profile-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function NewProfilePage() {
  const context = await getSessionContext();
  if (!can(context.role, "create", "profiles")) redirect("/profiles");
  return <ProfileFormClient context={context} />;
}

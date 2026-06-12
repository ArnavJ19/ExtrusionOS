import { ProfileFormClient } from "@/components/modules/profiles/profile-form-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export default async function EditProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getSessionContext();
  if (!can(context.role, "update", "profiles")) redirect(`/profiles/${id}`);
  return <ProfileFormClient context={context} profileId={id} />;
}

import { AcceptInviteForm } from "@/components/modules/accept-invite-form";

export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <AcceptInviteForm token={token ?? ""} />;
}

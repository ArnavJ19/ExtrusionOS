import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { AuthorityMatrix } from "@/components/modules/fs-batch4/authority";
import { getSessionContext } from "@/lib/auth";

// FS-75: the delegation-of-authority matrix. The owner sets the rules; owner and admin record leave delegations.
export default async function AuthorityPage() {
  const context = await getSessionContext();
  if (context.dealerId || !["owner", "admin"].includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5">
    <PageHeader title="Approval authority" description="Who approves what, by amount, with a second approver above a threshold and stand-ins during leave." actions={<Link href="/settings" className="text-sm font-bold underline">Settings</Link>} />
    <AuthorityMatrix />
  </div>;
}

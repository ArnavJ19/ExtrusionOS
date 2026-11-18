import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { DevelopmentDatabase } from "@/components/modules/intelligence/development";
import { getSessionContext } from "@/lib/auth";
import { DEVELOPMENT_ROLES } from "@/lib/intelligence/commands";

// FS-54: every development, paginated on the server (10 per page).
export default async function DevelopmentDatabasePage({ searchParams }: { searchParams: Promise<{ stage?: string }> }) {
  const context = await getSessionContext();
  if (context.dealerId || !(DEVELOPMENT_ROLES as readonly string[]).includes(context.role)) redirect("/dashboard");
  const { stage } = await searchParams;
  return <div className="space-y-5">
    <PageHeader title="Developments database" description="Search and filter every development." actions={<Link href="/profiles/development" className="text-sm font-bold underline">Board</Link>} />
    <DevelopmentDatabase initialStage={stage} />
  </div>;
}

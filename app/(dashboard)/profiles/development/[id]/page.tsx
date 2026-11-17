import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { DevelopmentDetail } from "@/components/modules/intelligence/development";
import { EditingPresence } from "@/components/modules/intelligence/live";
import { getSessionContext } from "@/lib/auth";
import { DEVELOPMENT_EDITORS, DEVELOPMENT_ROLES } from "@/lib/intelligence/commands";
import { loadOptions } from "@/lib/intelligence/options";

// FS-54: one development with its stage facts, trials and history.
export default async function DevelopmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const context = await getSessionContext();
  if (context.dealerId || !(DEVELOPMENT_ROLES as readonly string[]).includes(context.role)) redirect("/dashboard");
  const lists = await loadOptions(["customers", "users", "dies", "profiles", "vendors", "presses"]);
  return <div className="space-y-5">
    <PageHeader title="Development" description="Each stage needs its evidence before the next one." actions={<Link href="/profiles/development" className="text-sm font-bold underline">All developments</Link>} />
    <EditingPresence recordKey={`development:${id}`} me={{ id: context.userId, name: context.fullName ?? "Employee" }} />
    <DevelopmentDetail id={id} canEdit={(DEVELOPMENT_EDITORS as readonly string[]).includes(context.role)} lists={lists} />
  </div>;
}

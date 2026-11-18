import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { DevelopmentBoard } from "@/components/modules/intelligence/development";
import { getSessionContext } from "@/lib/auth";
import { DEVELOPMENT_EDITORS, DEVELOPMENT_ROLES } from "@/lib/intelligence/commands";
import { loadOptions } from "@/lib/intelligence/options";

// FS-54: new-profile and new-die development pipeline (overview board).
export default async function DevelopmentPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(DEVELOPMENT_ROLES as readonly string[]).includes(context.role)) redirect("/dashboard");
  const lists = await loadOptions(["customers", "users"]);
  return <div className="space-y-5">
    <PageHeader title="New developments" description="From a customer drawing to first approved production: each stage with its owner and age." actions={<Link href="/profiles/development/database" className="text-sm font-bold underline">View database</Link>} />
    <DevelopmentBoard canEdit={(DEVELOPMENT_EDITORS as readonly string[]).includes(context.role)} lists={{ ...lists, dies: [], profiles: [], vendors: [], presses: [] }} />
  </div>;
}

import { ModuleOverviewClient } from "@/components/modules/operations/module-overview-client";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function VendorsPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "vendors")) redirect("/dashboard");
  return <>{!context.dealerId && ["owner","admin","accounts"].includes(context.role) ? <Link className="mb-5 inline-block font-bold underline" href="/vendors/comparisons">Compare supplier offers for a purchase</Link> : null}<ModuleOverviewClient moduleKey="vendors" context={context} canCreate={can(context.role, "create", "vendors")} /></>;
}

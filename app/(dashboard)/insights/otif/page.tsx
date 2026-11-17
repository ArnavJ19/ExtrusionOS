import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { OtifClient } from "@/components/modules/intelligence/otif";
import { getSessionContext } from "@/lib/auth";
import { OTIF_EDITORS, OTIF_READERS } from "@/lib/intelligence/commands";

// FS-68: on-time-in-full against the first promise of every order line.
export default async function OtifPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(OTIF_READERS as readonly string[]).includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5">
    <PageHeader title="On time in full" description="Lines delivered complete on or before the date first promised, with every later change and its cause." actions={<Link href="/insights" className="text-sm font-bold underline">Insights</Link>} />
    <OtifClient canEdit={(OTIF_EDITORS as readonly string[]).includes(context.role)} canSetTolerance={["owner", "admin"].includes(context.role)} />
  </div>;
}

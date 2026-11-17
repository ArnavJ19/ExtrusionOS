import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { CutCombineClient } from "@/components/modules/autopilot-batch10/cut-combine";
import { getSessionContext } from "@/lib/auth";
import { CUT_ROLES } from "@/lib/autopilot-batch10/commands";

// AP-067: one push pattern for several orders' cut lengths on the same die.
export default async function CombineCutLengthsPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(CUT_ROLES as readonly string[]).includes(context.role)) redirect("/production/cutting");
  return <div className="space-y-5">
    <PageHeader title="Combine cut lengths" description="Jobs of the same die share pushes so less of each push is scrap. Order quantities and cut lengths stay as ordered." actions={<Link href="/production/cutting" className="text-sm font-bold underline">Back to cutting</Link>} />
    <CutCombineClient />
  </div>;
}

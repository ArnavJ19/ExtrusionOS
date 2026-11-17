import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { DieLabels } from "@/components/modules/intelligence/die-labels";
import { getSessionContext } from "@/lib/auth";
import { DIE_LIFE_ROLES } from "@/lib/intelligence/commands";

// FS-16: printable die-rack QR labels.
export default async function DieLabelsPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(DIE_LIFE_ROLES as readonly string[]).includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5">
    <div className="print:hidden"><PageHeader title="Die rack labels" description="Print a QR label for each die and its rack; scanning it opens the die." actions={<Link href="/dies/life" className="text-sm font-bold underline">Die life</Link>} /></div>
    <DieLabels />
  </div>;
}

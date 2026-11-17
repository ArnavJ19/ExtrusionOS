import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { DieLifeClient } from "@/components/modules/intelligence/die-life";
import { getSessionContext } from "@/lib/auth";
import { DIE_CORRECTORS, DIE_DECIDERS, DIE_LIFE_EDITORS, DIE_LIFE_ROLES, DIE_MAKER_ROLES, DIE_REPORTERS } from "@/lib/intelligence/commands";

// FS-16: die life prediction and replacement warnings.
export default async function DieLifePage() {
  const context = await getSessionContext();
  if (context.dealerId || !(DIE_LIFE_ROLES as readonly string[]).includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5">
    <PageHeader title="Die life" description="Remaining life from each die's own record and its retired peers, against open orders and the replacement lead time." actions={<div className="flex gap-3"><Link href="/dies/life/labels" className="text-sm font-bold underline">Rack labels</Link><Link href="/dies" className="text-sm font-bold underline">Dies</Link></div>} />
    <DieLifeClient canSetLead={(DIE_LIFE_EDITORS as readonly string[]).includes(context.role)} canSeeMakers={(DIE_MAKER_ROLES as readonly string[]).includes(context.role)}
      loop={{ companyId: context.companyId, canReport: (DIE_REPORTERS as readonly string[]).includes(context.role), canCorrect: (DIE_CORRECTORS as readonly string[]).includes(context.role), canDecide: (DIE_DECIDERS as readonly string[]).includes(context.role) }} />
  </div>;
}

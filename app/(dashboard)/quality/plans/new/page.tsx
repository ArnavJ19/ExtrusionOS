import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PlanEditor } from "@/components/modules/quality/inspection-plans";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canEditPlans } from "@/lib/workflow/inspection-plans";

export default async function NewInspectionPlanPage() {
  const context = await getSessionContext();
  if (context.dealerId || !canEditPlans(context.role)) redirect("/quality/plans");
  const supabase = await createClient();
  const profiles = await supabase.from("aluminium_profiles").select("id, profile_code, profile_name").eq("company_id", context.companyId).order("profile_code").limit(2000);
  if (profiles.error) throw new Error("Profiles could not be loaded. Refresh to retry.");
  return (
    <div className="space-y-5">
      <PageHeader title="New Inspection Plan" description="Saved as a draft. Another quality employee (or an owner or admin) approves it before inspections use it."
        actions={<Link href="/quality/plans" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">All plans</Link>} />
      <PlanEditor planId={randomUUID()} profiles={(profiles.data ?? []).map((row) => ({ value: row.id, label: [row.profile_code, row.profile_name].filter(Boolean).join(" · ") }))} />
    </div>
  );
}

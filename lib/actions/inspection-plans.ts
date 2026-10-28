"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canEditPlans, canReadPlans, evaluationSchema, planCommandSchema, planDetailSchema, planListSchema } from "@/lib/workflow/inspection-plans";

export type PlanActionResult = { success: true; data: unknown } | { success: false; error: string; unavailable?: boolean };

const businessErrors = [
  "Profile is unavailable", "Describe the sampling instruction (3 to 500 characters)", "A plan needs between 1 and 50 characteristics",
  "Another draft exists for this profile. Open it instead", "Inspection plan is unavailable", "Only a draft plan can be approved",
  "Another person must approve the plan you drafted", "Only a draft plan can be discarded", "Inspection is unavailable",
  "Results can be recorded only while the inspection is pending", "No approved inspection plan applies to this profile",
  "The applicable inspection plan changed. Reload it before recording results", "Record between 1 and 50 results",
  "A result refers to a characteristic outside the applicable plan", "Invalid page"
];

// UPGRADE_EOS feature 54. Results are judged and approvals guarded by the database.
export async function inspectionPlanAction(input: unknown): Promise<PlanActionResult> {
  try {
    const context = await getSessionContext();
    const parsed = planCommandSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid inspection plan request" };
    const { command, ...payload } = parsed.data;
    const writes = ["plan.save_draft", "plan.approve", "plan.discard_draft", "results.record"].includes(command);
    if (context.dealerId || !(writes ? canEditPlans(context.role) : canReadPlans(context.role))) return { success: false, error: "You do not have permission to use this action." };
    const supabase = await createClient();
    const result = await supabase.rpc("inspection_plan_command", { p_command: command, p_payload: payload });
    if (result.error) {
      const code = result.error.code ?? "";
      const message = result.error.message ?? "";
      if (["PGRST202", "42883", "42P01"].includes(code)) return { success: false, unavailable: true, error: "Inspection plans are not available on this database yet. The database upgrade must be applied first." };
      // Per-characteristic messages name the characteristic; show them as written.
      if (businessErrors.includes(message) || /^(Characteristic \d+ needs|Enter the measured value for |Record pass or fail for )/.test(message)) return { success: false, error: message };
      if (code === "42501") return { success: false, error: "This action is not permitted for your current session." };
      return { success: false, error: "The inspection plan request could not be completed. Refresh and retry." };
    }
    const data = command === "plan.list" ? planListSchema.parse(result.data)
      : command === "plan.load" ? planDetailSchema.parse(result.data)
      : command === "inspection.plan" || command === "results.record" ? evaluationSchema.parse(result.data)
      : result.data;
    if (writes) {
      const paths = command === "results.record" && "inspection_id" in payload ? [`/quality/${payload.inspection_id}`] : ["/quality/plans", ...("plan_id" in payload ? [`/quality/plans/${payload.plan_id}`] : [])];
      for (const path of paths) {
        try { revalidatePath(path); } catch { /* A confirmed write remains confirmed if cache refresh fails. */ }
      }
    }
    return { success: true, data };
  } catch {
    return { success: false, error: "The inspection plan request could not be completed. Check your session and retry." };
  }
}

"use server";

import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getFeatureFlagsForCompany } from "@/lib/enterprise/features";
import { loadMyWork } from "@/lib/dashboard/my-work";

export async function refreshMyWorkAction() {
  try {
    const context = await getSessionContext();
    if (context.dealerId || context.role.startsWith("dealer")) return { success: false as const };
    const supabase = await createClient();
    const flags = await getFeatureFlagsForCompany(supabase, context.companyId);
    return { success: true as const, scope: `${context.companyId}:${context.userId}:${context.role}`, work: await loadMyWork(supabase, context, flags) };
  } catch {
    return { success: false as const };
  }
}

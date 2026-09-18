"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

const routingStepSchema = z.object({
  stage_name: z.string().trim().min(1).max(120),
  is_required: z.boolean(),
  department: z.string().trim().max(120).nullable().optional(),
  estimated_duration_hours: z.number().nonnegative().max(10000).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional()
});

const qualityPlanItemSchema = z.object({
  inspection_stage: z.string().trim().min(1).max(120),
  parameter_name: z.string().trim().min(1).max(160),
  acceptance_criteria: z.string().trim().max(2000).nullable().optional(),
  rejection_criteria: z.string().trim().max(2000).nullable().optional(),
  inspection_frequency: z.string().trim().max(240).nullable().optional(),
  is_mandatory: z.boolean()
});

type ProfileConfigurationResult = { success: true } | { success: false; error: string };

async function getAuthorizedProfileWriter(profileId: string) {
  const context = await getSessionContext();
  if (!can(context.role, "update", "profiles")) {
    return { error: "You do not have permission to change profile manufacturing configuration." } as const;
  }
  const supabase = await createClient();
  const profile = await supabase
    .from("aluminium_profiles")
    .select("id")
    .eq("company_id", context.companyId)
    .eq("id", profileId)
    .maybeSingle();
  if (profile.error) throw profile.error;
  if (!profile.data) return { error: "Profile not found for this company." } as const;
  return { supabase } as const;
}

export async function replaceProfileRoutingAction(profileId: string, steps: unknown): Promise<ProfileConfigurationResult> {
  try {
    const parsedProfileId = z.string().uuid().safeParse(profileId);
    const parsedSteps = z.array(routingStepSchema).min(1).max(50).safeParse(steps);
    if (!parsedProfileId.success || !parsedSteps.success) {
      return { success: false, error: "Add between 1 and 50 complete routing steps." };
    }
    const authorization = await getAuthorizedProfileWriter(parsedProfileId.data);
    if ("error" in authorization) return { success: false, error: authorization.error ?? "Profile configuration is not available." };
    const result = await authorization.supabase.rpc("replace_profile_routing_atomic", {
      p_profile_id: parsedProfileId.data,
      p_steps: parsedSteps.data
    });
    if (result.error) throw result.error;
    revalidatePath(`/profiles/${parsedProfileId.data}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not save profile routing") };
  }
}

export async function replaceProfileQualityPlanAction(profileId: string, items: unknown): Promise<ProfileConfigurationResult> {
  try {
    const parsedProfileId = z.string().uuid().safeParse(profileId);
    const parsedItems = z.array(qualityPlanItemSchema).min(1).max(100).safeParse(items);
    if (!parsedProfileId.success || !parsedItems.success) {
      return { success: false, error: "Add between 1 and 100 complete quality parameters." };
    }
    const authorization = await getAuthorizedProfileWriter(parsedProfileId.data);
    if ("error" in authorization) return { success: false, error: authorization.error ?? "Profile configuration is not available." };
    const result = await authorization.supabase.rpc("replace_profile_quality_plan_atomic", {
      p_profile_id: parsedProfileId.data,
      p_items: parsedItems.data
    });
    if (result.error) throw result.error;
    revalidatePath(`/profiles/${parsedProfileId.data}`);
    return { success: true };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not save profile quality plan") };
  }
}

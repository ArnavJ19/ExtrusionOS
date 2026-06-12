"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { recordRevision } from "@/lib/pcda/version";

/**
 * Server action to update a die with revision tracking.
 * Records the prior state before applying the update.
 */
export async function updateDieWithVersioning(
  dieId: string,
  payload: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  const context = await getSessionContext();
  const supabase = await createClient();

  // Fetch current state for revision
  const { data: currentDie, error: fetchError } = await supabase
    .from("dies")
    .select("*")
    .eq("id", dieId)
    .eq("company_id", context.companyId)
    .single();

  if (fetchError || !currentDie) {
    return { success: false, error: "Die not found or access denied" };
  }

  // Record revision with prior state
  await recordRevision(context.companyId, "die", dieId, currentDie, context.userId);

  // Apply update
  const { error: updateError } = await supabase
    .from("dies")
    .update({ ...payload, company_id: context.companyId })
    .eq("id", dieId)
    .eq("company_id", context.companyId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  revalidatePath(`/dies/${dieId}`);
  revalidatePath("/dies");
  revalidatePath("/die-intelligence");
  return { success: true };
}

/**
 * Server action to update a profile with revision tracking.
 */
export async function updateProfileWithVersioning(
  profileId: string,
  payload: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  const context = await getSessionContext();
  const supabase = await createClient();

  // Fetch current state for revision
  const { data: currentProfile, error: fetchError } = await supabase
    .from("aluminium_profiles")
    .select("*")
    .eq("id", profileId)
    .eq("company_id", context.companyId)
    .single();

  if (fetchError || !currentProfile) {
    return { success: false, error: "Profile not found or access denied" };
  }

  // Record revision with prior state
  await recordRevision(context.companyId, "profile", profileId, currentProfile, context.userId);

  // Apply update
  const { error: updateError } = await supabase
    .from("aluminium_profiles")
    .update({ ...payload, company_id: context.companyId })
    .eq("id", profileId)
    .eq("company_id", context.companyId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  revalidatePath(`/profiles/${profileId}`);
  revalidatePath("/profiles");
  return { success: true };
}

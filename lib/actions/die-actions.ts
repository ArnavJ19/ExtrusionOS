"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";
import { dieSchema, profileSchema } from "@/lib/validations/schemas";

const entityIdSchema = z.string().uuid();

/**
 * Server action to update a die with revision tracking.
 * Records the prior state before applying the update.
 */
export async function updateDieWithVersioning(
  dieId: string,
  payload: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "update", "dies")) return { success: false, error: "You do not have permission to update dies." };
    const parsedId = entityIdSchema.safeParse(dieId);
    if (!parsedId.success) return { success: false, error: "Invalid die identifier." };
    const parsedPayload = dieSchema.safeParse(payload);
    if (!parsedPayload.success) return { success: false, error: parsedPayload.error.issues[0]?.message ?? "Please check die details." };

    const supabase = await createClient();
    const result = await supabase.rpc("update_versioned_entity_atomic", {
      p_entity_type: "die",
      p_entity_id: parsedId.data,
      p_payload: {
        ...parsedPayload.data,
        customer_id: parsedPayload.data.customer_id || null,
        die_vendor_id: parsedPayload.data.die_vendor_id || null
      }
    });
    if (result.error) throw result.error;

    revalidatePath(`/dies/${parsedId.data}`);
    revalidatePath("/dies");
    revalidatePath("/die-intelligence");
    return { success: true };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not update die") };
  }
}

/**
 * Server action to update a profile with revision tracking.
 */
export async function updateProfileWithVersioning(
  profileId: string,
  payload: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "update", "profiles")) return { success: false, error: "You do not have permission to update profiles." };
    const parsedId = entityIdSchema.safeParse(profileId);
    if (!parsedId.success) return { success: false, error: "Invalid profile identifier." };
    const parsedPayload = profileSchema.safeParse(payload);
    if (!parsedPayload.success) return { success: false, error: parsedPayload.error.issues[0]?.message ?? "Please check profile details." };

    const supabase = await createClient();
    const result = await supabase.rpc("update_versioned_entity_atomic", {
      p_entity_type: "profile",
      p_entity_id: parsedId.data,
      p_payload: {
        ...parsedPayload.data,
        primary_die_id: parsedPayload.data.primary_die_id || null,
        backup_die_id: parsedPayload.data.backup_die_id || null
      }
    });
    if (result.error) throw result.error;

    revalidatePath(`/profiles/${parsedId.data}`);
    revalidatePath("/profiles");
    return { success: true };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not update profile") };
  }
}

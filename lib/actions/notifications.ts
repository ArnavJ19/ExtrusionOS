"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

const notificationIdSchema = z.string().uuid("Select a valid notification.");

export async function markNotificationReadAction(notificationId: string) {
  try {
    const parsed = notificationIdSchema.safeParse(notificationId);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? "Select a valid notification." };
    }

    await getSessionContext();
    const supabase = await createClient();
    const result = await supabase.rpc("mark_notification_read", {
      p_notification_id: parsed.data
    });
    if (result.error) throw result.error;

    revalidatePath("/notifications");
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not mark notification as read.") };
  }
}

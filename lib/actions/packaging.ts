"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";
import { packagingJobSchema } from "@/lib/validations/schemas";

const packagingMaterialInputSchema = z.object({
  material_id: z.string().uuid("Select a packaging material"),
  quantity_required: z.coerce.number().positive("Packaging material quantity must be greater than zero")
});

type SavePackagingInput = z.input<typeof packagingJobSchema> & {
  editing_id?: string | null;
  materials: z.input<typeof packagingMaterialInputSchema>[];
};

type PackagingActionResult =
  | { success: true; jobId: string }
  | { success: false; error: string };

function revalidatePackagingPaths(jobId?: string, orderId?: string) {
  revalidatePath("/packaging");
  revalidatePath("/packaging/database");
  revalidatePath("/production");
  revalidatePath("/orders");
  if (jobId) revalidatePath(`/packaging/${jobId}`);
  if (orderId) revalidatePath(`/orders/${orderId}`);
}

export async function savePackagingJobAction(input: SavePackagingInput): Promise<PackagingActionResult> {
  try {
    const context = await getSessionContext();
    const editingId = input.editing_id || null;
    if (!can(context.role, editingId ? "update" : "create", "packaging")) {
      return { success: false, error: "You do not have permission to save packaging jobs." };
    }

    const parsedJob = packagingJobSchema.safeParse(input);
    if (!parsedJob.success) {
      return { success: false, error: parsedJob.error.issues[0]?.message ?? "Please check packaging details." };
    }
    const parsedMaterials = z.array(packagingMaterialInputSchema).safeParse(input.materials ?? []);
    if (!parsedMaterials.success) {
      return { success: false, error: parsedMaterials.error.issues[0]?.message ?? "Please check packaging materials." };
    }
    if (parsedJob.data.status === "completed" && parsedMaterials.data.length === 0) {
      return { success: false, error: "Select at least one material before completing packaging." };
    }

    const supabase = await createClient();
    const result = await supabase.rpc("save_packaging_job_atomic", {
      p_job_id: editingId,
      p_job: {
        ...parsedJob.data,
        production_job_id: parsedJob.data.production_job_id || null,
        scheduled_date: parsedJob.data.scheduled_date || null,
        notes: parsedJob.data.notes || null
      },
      p_materials: parsedMaterials.data
    });
    if (result.error || !result.data) {
      throw result.error ?? new Error("Could not save packaging job.");
    }

    const jobId = String(result.data);
    revalidatePackagingPaths(jobId, parsedJob.data.order_id);
    return { success: true, jobId };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not save packaging job") };
  }
}

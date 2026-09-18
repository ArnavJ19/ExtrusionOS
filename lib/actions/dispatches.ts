"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { buildVerifiedPackingListItems, type VerifiedDispatchBundleInput } from "@/lib/pcda/dispatch";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";
import { dispatchSchema } from "@/lib/validations/schemas";

const deliveryStatusSchema = dispatchSchema.shape.delivery_status;

type SaveDispatchInput = Omit<z.input<typeof dispatchSchema>, "number_of_bundles" | "total_weight_kg" | "bundle_tare_weights_kg"> & {
  editing_id?: string | null;
  bundles?: VerifiedDispatchBundleInput[];
};
type DispatchActionResult = { success: true; dispatchId?: string } | { success: false; error: string };

function revalidateDispatchPaths(dispatchId?: string, orderId?: string) {
  revalidatePath("/dispatches");
  revalidatePath("/dispatches/database");
  revalidatePath("/orders");
  revalidatePath("/orders/database");
  if (dispatchId) revalidatePath(`/dispatches/${dispatchId}`);
  if (orderId) revalidatePath(`/orders/${orderId}`);
}

function usedWeightBySource(rows: Record<string, any>[]) {
  return rows.reduce<Record<string, number>>((totals, row) => {
    if (!row.source_line_id) return totals;
    totals[row.source_line_id] = (totals[row.source_line_id] ?? 0) + Number(row.net_weight_kg ?? 0);
    return totals;
  }, {});
}

async function loadDispatchSourceLines(
  supabase: any,
  companyId: string,
  orderId: string,
  editingId: string | null,
  requestedWeightKg = 0
) {
  const [productionResult, fulfillmentResult, reservationResult, featureResult, dispatchResult] = await Promise.all([
    supabase
      .from("production_jobs")
      .select("*")
      .eq("company_id", companyId)
      .eq("order_id", orderId)
      .eq("status", "completed")
      .order("updated_at", { ascending: true }),
    supabase
      .from("order_dealer_stock_fulfillments")
      .select("id, order_id, profile_id, profile_stock_batch_id, quote_item_id, order_item_id, finishing_type, unit_rate, fulfilled_weight_kg, fulfilled_pieces, fulfilled_length_m, credited_at, created_at")
      .eq("company_id", companyId)
      .eq("order_id", orderId)
      .is("credited_at", null)
      .order("created_at", { ascending: true }),
    supabase
      .from("profile_stock_reservations")
      .select("id, order_id, profile_id, profile_stock_batch_id, reserved_weight_kg, reserved_length_m, status, created_at, profile_stock_consumptions(consumed_weight_kg)")
      .eq("company_id", companyId)
      .eq("order_id", orderId)
      .eq("status", "active")
      .order("created_at", { ascending: true }),
    supabase
      .from("feature_flags")
      .select("is_enabled")
      .eq("company_id", companyId)
      .eq("module_name", "quality_compliance")
      .maybeSingle(),
    supabase
      .from("dispatches")
      .select("id")
      .eq("company_id", companyId)
      .eq("order_id", orderId)
  ]);
  for (const result of [productionResult, fulfillmentResult, reservationResult, featureResult, dispatchResult]) {
    if (result.error) throw result.error;
  }

  const jobs = productionResult.data ?? [];
  const jobIds = jobs.map((job: any) => job.id);
  const dispatchIds = (dispatchResult.data ?? [])
    .map((dispatch: any) => dispatch.id)
    .filter((id: string) => id !== editingId);

  const [qualityResult, finishingResult, packagingResult, usedPackingResult] = await Promise.all([
    jobIds.length
      ? supabase.from("quality_inspections").select("production_job_id, finishing_job_id, quantity_checked_kg, status").eq("company_id", companyId).in("production_job_id", jobIds)
      : Promise.resolve({ data: [], error: null }),
    jobIds.length
      ? supabase.from("finishing_jobs").select("id, production_job_id, output_weight_kg, status").eq("company_id", companyId).in("production_job_id", jobIds)
      : Promise.resolve({ data: [], error: null }),
    jobIds.length
      ? supabase.from("packaging_jobs").select("id, production_job_id, status").eq("company_id", companyId).eq("order_id", orderId).in("production_job_id", jobIds)
      : Promise.resolve({ data: [], error: null }),
    dispatchIds.length
      ? supabase.from("packing_list_items").select("source_line_id, net_weight_kg").eq("company_id", companyId).in("dispatch_id", dispatchIds)
      : Promise.resolve({ data: [], error: null })
  ]);
  for (const result of [qualityResult, finishingResult, packagingResult, usedPackingResult]) {
    if (result.error) throw result.error;
  }

  const packagingJobs = packagingResult.data ?? [];
  const packagingIds = packagingJobs.map((job: any) => job.id);
  const materialsResult = packagingIds.length
    ? await supabase
      .from("packaging_job_materials")
      .select("job_id, quantity_required")
      .eq("company_id", companyId)
      .in("job_id", packagingIds)
    : { data: [], error: null };
  if (materialsResult.error) throw materialsResult.error;

  const usedBySource = usedWeightBySource(usedPackingResult.data ?? []);
  const qualityRequired = featureResult.data?.is_enabled ?? true;
  const blockers: string[] = [];
  const reservationSources = (reservationResult.data ?? []).flatMap((reservation: any) => {
    const consumedWeight = (reservation.profile_stock_consumptions ?? []).reduce(
      (sum: number, row: any) => sum + Number(row.consumed_weight_kg ?? 0),
      0
    );
    const availableWeight = Math.max(Number(reservation.reserved_weight_kg ?? 0) - consumedWeight, 0);
    return availableWeight > 0 && reservation.profile_id && reservation.profile_stock_batch_id
      ? [{
        ...reservation,
        reservation_id: reservation.id,
        source_kind: "reservation",
        available_weight_kg: availableWeight,
        actual_quantity_kg: Number(reservation.reserved_weight_kg ?? 0)
      }]
      : [];
  });
  const stockSources = (fulfillmentResult.data ?? []).flatMap((fulfillment: any) => {
    const availableWeight = Math.max(
      Number(fulfillment.fulfilled_weight_kg ?? 0) - Number(usedBySource[fulfillment.id] ?? 0),
      0
    );
    return availableWeight > 0 && fulfillment.profile_id
      ? [{ ...fulfillment, source_kind: "dealer_stock", available_weight_kg: availableWeight }]
      : [];
  });
  const productionSources = jobs.flatMap((job: any) => {
    const actualWeight = Number(job.actual_quantity_kg ?? 0);
    if (!job.profile_id || actualWeight <= 0) {
      blockers.push(`${job.job_number ?? "Production job"} has no actual output.`);
      return [];
    }

    const finishType = String(job.finishing_type ?? "mill_finish");
    const completedFinishing = (finishingResult.data ?? []).find(
      (finish: any) => finish.production_job_id === job.id && finish.status === "completed"
    );
    if (finishType !== "mill_finish" && !completedFinishing) {
      blockers.push(`${job.job_number ?? "Production job"} is waiting for ${finishType.replace(/_/g, " ")} completion.`);
      return [];
    }
    const acceptedOutput = finishType === "mill_finish"
      ? actualWeight
      : Number(completedFinishing?.output_weight_kg ?? 0);

    const approvedWeight = qualityRequired
      ? (qualityResult.data ?? [])
        .filter((inspection: any) => (
          inspection.production_job_id === job.id
          && inspection.status === "approved"
          && (finishType === "mill_finish"
            ? !inspection.finishing_job_id
            : inspection.finishing_job_id === completedFinishing?.id)
        ))
        .reduce((sum: number, inspection: any) => sum + Number(inspection.quantity_checked_kg ?? 0), 0)
      : acceptedOutput;
    if (approvedWeight <= 0) {
      blockers.push(`${job.job_number ?? "Production job"} has no QC-released quantity.`);
      return [];
    }

    const packagingJob = packagingJobs.find(
      (packaging: any) => packaging.production_job_id === job.id && packaging.status === "completed"
    );
    const hasMaterial = packagingJob && (materialsResult.data ?? []).some(
      (material: any) => material.job_id === packagingJob.id && Number(material.quantity_required ?? 0) > 0
    );
    if (!hasMaterial) {
      blockers.push(`${job.job_number ?? "Production job"} is waiting for completed packaging with issued material.`);
      return [];
    }

    const availableWeight = Math.max(
      Math.min(actualWeight, acceptedOutput, approvedWeight) - Number(usedBySource[job.id] ?? 0),
      0
    );
    return availableWeight > 0
      ? [{ ...job, source_kind: "production", available_weight_kg: availableWeight }]
      : [];
  });

  const readySources = [...reservationSources, ...stockSources, ...productionSources];
  const readyWeight = readySources.reduce((sum, source) => sum + Number(source.available_weight_kg ?? 0), 0);
  if (requestedWeightKg > 0 && readyWeight + 0.01 < requestedWeightKg) {
    const reason = blockers.slice(0, 3).join(" ");
    throw new Error(
      `Only ${readyWeight.toFixed(3)} kg is ready and unshipped for this order.${reason ? ` ${reason}` : ""}`
    );
  }
  return readySources;
}

export async function getDispatchSourcesAction(orderId: string, editingId?: string | null) {
  try {
    const parsedOrderId = z.string().uuid().safeParse(orderId);
    if (!parsedOrderId.success) return { success: false as const, error: "Select an order to load physical stock sources." };
    const context = await getSessionContext();
    if (!can(context.role, "create", "dispatches") && !can(context.role, "update", "dispatches")) {
      return { success: false as const, error: "You do not have permission to prepare dispatch bundles." };
    }
    const supabase = await createClient();
    const sourceLines = await loadDispatchSourceLines(supabase, context.companyId, parsedOrderId.data, editingId ?? null);
    const profileIds = Array.from(new Set(sourceLines.map((line: any) => line.profile_id).filter(Boolean)));
    const batchIds = Array.from(new Set(sourceLines.map((line: any) => line.profile_stock_batch_id).filter(Boolean)));
    const [profilesResult, batchesResult] = await Promise.all([
      profileIds.length
        ? supabase.from("aluminium_profiles").select("id, profile_code, profile_name").eq("company_id", context.companyId).in("id", profileIds)
        : Promise.resolve({ data: [], error: null }),
      batchIds.length
        ? supabase.from("profile_stock_batches").select("id, bundle_number, location, quantity_pieces, total_weight_kg").eq("company_id", context.companyId).in("id", batchIds)
        : Promise.resolve({ data: [], error: null })
    ]);
    if (profilesResult.error) throw profilesResult.error;
    if (batchesResult.error) throw batchesResult.error;
    const profiles = new Map((profilesResult.data ?? []).map((row: any) => [row.id, row]));
    const batches = new Map((batchesResult.data ?? []).map((row: any) => [row.id, row]));
    return {
      success: true as const,
      sources: sourceLines.map((line: any) => {
        const profile = profiles.get(line.profile_id) as any;
        const batch = batches.get(line.profile_stock_batch_id) as any;
        const availableWeightKg = Number(line.available_weight_kg ?? 0);
        const sourcePieces = Number(line.actual_pieces ?? line.fulfilled_pieces ?? batch?.quantity_pieces ?? 0);
        const sourceTotalWeight = Number(line.actual_quantity_kg ?? line.fulfilled_weight_kg ?? batch?.total_weight_kg ?? availableWeightKg);
        const availablePieces = sourcePieces > 0 && sourceTotalWeight > 0
          ? Math.max(1, Math.floor(sourcePieces * availableWeightKg / sourceTotalWeight))
          : 0;
        return {
          id: String(line.id),
          sourceKind: String(line.source_kind ?? "production"),
          sourceLabel: String(line.job_number ?? line.bundle_number ?? line.id),
          profileId: String(line.profile_id),
          profileLabel: [profile?.profile_code, profile?.profile_name].filter(Boolean).join(" - ") || String(line.profile_id),
          stockBatchId: line.profile_stock_batch_id ? String(line.profile_stock_batch_id) : null,
          stockBatchLabel: batch?.bundle_number ? `${batch.bundle_number}${batch.location ? ` - ${batch.location}` : ""}` : null,
          availableWeightKg,
          availablePieces
        };
      })
    };
  } catch (error) {
    return { success: false as const, error: getErrorMessage(error, "Could not load dispatch-ready sources") };
  }
}

export async function saveDispatchAction(input: SaveDispatchInput): Promise<DispatchActionResult> {
  try {
    const context = await getSessionContext();
    const editingId = input.editing_id || null;
    if (!can(context.role, editingId ? "update" : "create", "dispatches")) return { success: false, error: "You do not have permission to save dispatches." };

    if (!input.bundles?.length) {
      return { success: false, error: "Scan or enter every physical bundle before recording the dispatch." };
    }
    const measured = input.bundles.reduce((totals, bundle) => {
      const gross = Number(bundle.gross_weight_kg ?? 0);
      const tare = Number(bundle.tare_weight_kg ?? 0);
      return { net: totals.net + gross - tare, tare: totals.tare + tare };
    }, { net: 0, tare: 0 });
    const parsed = dispatchSchema.safeParse({
      ...input,
      number_of_bundles: input.bundles.length,
      total_weight_kg: Number(measured.net.toFixed(3)),
      bundle_tare_weights_kg: input.bundles.map((bundle) => bundle.tare_weight_kg).join("\n")
    });
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Please check dispatch details." };

    const supabase = await createClient();
    const [orderResult, currentDispatchResult] = await Promise.all([
      supabase.from("orders").select("id").eq("company_id", context.companyId).eq("id", parsed.data.order_id).maybeSingle(),
      editingId ? supabase.from("dispatches").select("*").eq("company_id", context.companyId).eq("id", editingId).maybeSingle() : Promise.resolve({ data: null, error: null })
    ]);
    if (orderResult.error) throw orderResult.error;
    if (currentDispatchResult.error) throw currentDispatchResult.error;
    if (!orderResult.data) return { success: false, error: "Selected order is not available for this company." };
    if (editingId && !currentDispatchResult.data) return { success: false, error: "Dispatch not found for this company." };

    const currentDispatch = currentDispatchResult.data;
    const totalTareWeightKg = Number(measured.tare.toFixed(3));
    const payload = {
      ...parsed.data,
      total_tare_weight_kg: totalTareWeightKg,
      transporter_name: parsed.data.transporter_name || null,
      vehicle_number: parsed.data.vehicle_number || null,
      driver_name: parsed.data.driver_name || null,
      driver_phone: parsed.data.driver_phone || null,
      eway_bill_number: parsed.data.eway_bill_number || null,
      lr_number: parsed.data.lr_number || null,
      proof_of_delivery_url: parsed.data.proof_of_delivery_url || null,
      packing_list_url: parsed.data.packing_list_url || null,
      remarks: parsed.data.remarks || null,
      ...(editingId ? { dispatch_number: currentDispatch?.dispatch_number } : {})
    };
    const sourceLines = await loadDispatchSourceLines(
      supabase,
      context.companyId,
      parsed.data.order_id,
      editingId,
      parsed.data.total_weight_kg
    );
    const verifiedManifest = buildVerifiedPackingListItems(sourceLines, context.companyId, input.bundles);
    if (Math.abs(verifiedManifest.totalNetWeightKg - parsed.data.total_weight_kg) > 0.001) {
      return { success: false, error: "Bundle gross and tare measurements do not match the dispatch net weight." };
    }
    const result = await supabase.rpc("save_ready_dispatch_atomic", {
      p_dispatch_id: editingId,
      p_dispatch: {
        ...payload,
        delivery_status: editingId ? currentDispatch?.delivery_status : "dispatched"
      },
      p_items: verifiedManifest.items
    });
    if (result.error || !result.data) throw result.error ?? new Error("Could not save dispatch");
    const dispatchId = String(result.data);

    revalidateDispatchPaths(dispatchId, parsed.data.order_id);
    return { success: true, dispatchId };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not save dispatch") };
  }
}

export async function updateDeliveryStatusAction(
  dispatchId: string,
  status: string,
  proofOfDeliveryUrl?: string,
  remarks?: string
): Promise<DispatchActionResult> {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "update", "dispatches")) return { success: false, error: "You do not have permission to update dispatches." };
    const parsedDispatchId = z.string().uuid().safeParse(dispatchId);
    if (!parsedDispatchId.success) return { success: false, error: "Invalid dispatch." };
    const parsedStatus = deliveryStatusSchema.safeParse(status);
    if (!parsedStatus.success) return { success: false, error: "Invalid delivery status." };
    const proofPath = proofOfDeliveryUrl?.trim() || "";
    const expectedProofPrefix = `${context.companyId}/dispatches/${parsedDispatchId.data}/proof-of-delivery/`;
    if (proofPath && !proofPath.startsWith(expectedProofPrefix)) {
      return { success: false, error: "Proof of delivery must be the private file stored for this company and dispatch." };
    }

    const supabase = await createClient();
    const transitionResult = await supabase.rpc("transition_dispatch_delivery_atomic", {
      p_dispatch_id: parsedDispatchId.data,
      p_status: parsedStatus.data,
      p_proof_of_delivery_url: proofPath || null,
      p_remarks: remarks?.trim() || null
    });
    if (transitionResult.error || !transitionResult.data) {
      throw transitionResult.error ?? new Error("Dispatch not found for this company.");
    }

    revalidateDispatchPaths(parsedDispatchId.data, String(transitionResult.data));
    return { success: true, dispatchId: parsedDispatchId.data };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not update delivery status") };
  }
}

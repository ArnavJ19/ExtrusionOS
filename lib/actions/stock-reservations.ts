"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";

export async function consumeDispatchReservations(dispatchId: string) {
  const context = await getSessionContext();
  if (!can(context.role, "update", "dispatches") || !can(context.role, "update", "inventory")) redirect(`/dispatches/${dispatchId}`);
  const supabase = await createClient();
  const dispatchResult = await supabase
    .from("dispatches")
    .select("id, order_id, total_weight_kg, delivery_status")
    .eq("id", dispatchId)
    .eq("company_id", context.companyId)
    .single();
  if (dispatchResult.error || !dispatchResult.data) throw dispatchResult.error ?? new Error("Dispatch not found");
  const dispatch = dispatchResult.data;
  if (!["dispatched", "in_transit", "delivered"].includes(dispatch.delivery_status)) throw new Error("Only dispatched, in-transit, or delivered shipments can consume reserved stock.");

  const existingConsumption = await supabase
    .from("profile_stock_consumptions")
    .select("id", { count: "exact", head: true })
    .eq("company_id", context.companyId)
    .eq("dispatch_id", dispatchId);
  if (existingConsumption.error) throw existingConsumption.error;
  if ((existingConsumption.count ?? 0) > 0) throw new Error("Reserved stock has already been consumed for this dispatch.");

  const reservationsResult = await supabase
    .from("profile_stock_reservations")
    .select("id, profile_stock_batch_id, profile_id, order_id, reserved_weight_kg, reserved_length_m, status, profile_stock_consumptions(consumed_weight_kg)")
    .eq("company_id", context.companyId)
    .eq("order_id", dispatch.order_id)
    .in("status", ["active", "consumed"])
    .order("created_at", { ascending: true });
  if (reservationsResult.error) throw reservationsResult.error;
  const reservations = (reservationsResult.data ?? []).map((reservation: any) => {
    const consumed = (reservation.profile_stock_consumptions ?? []).reduce((sum: number, row: any) => sum + Number(row.consumed_weight_kg ?? 0), 0);
    const remaining = Math.max(Number(reservation.reserved_weight_kg ?? 0) - consumed, 0);
    return { ...reservation, consumed_weight_kg: consumed, remaining_weight_kg: remaining };
  }).filter((reservation: any) => reservation.remaining_weight_kg > 0);
  if (!reservations.length) throw new Error("No unconsumed stock reservations found for this dispatch order.");

  const dispatchWeight = Number(dispatch.total_weight_kg ?? 0);
  if (dispatchWeight <= 0) throw new Error("Dispatch weight must be greater than zero before consuming reserved stock.");

  let remainingDispatchWeight = dispatchWeight;
  const consumptionRows: Record<string, any>[] = [];
  const fullyConsumedReservationIds: string[] = [];
  for (const reservation of reservations) {
    if (remainingDispatchWeight <= 0) break;
    const consumeWeight = Math.min(remainingDispatchWeight, Number(reservation.remaining_weight_kg ?? 0));
    const reservedWeight = Number(reservation.reserved_weight_kg ?? 0);
    const reservedLength = Number(reservation.reserved_length_m ?? 0);
    consumptionRows.push({
      company_id: context.companyId,
      reservation_id: reservation.id,
      profile_stock_batch_id: reservation.profile_stock_batch_id,
      profile_id: reservation.profile_id,
      order_id: dispatch.order_id,
      dispatch_id: dispatchId,
      consumed_weight_kg: consumeWeight,
      consumed_length_m: reservedWeight > 0 ? (reservedLength * consumeWeight) / reservedWeight : 0,
      notes: "Consumed against dispatch reserved stock",
      created_by: context.userId
    });
    const totalAfterConsume = Number(reservation.consumed_weight_kg ?? 0) + consumeWeight;
    if (totalAfterConsume >= reservedWeight * 0.999) fullyConsumedReservationIds.push(reservation.id);
    remainingDispatchWeight = Math.round((remainingDispatchWeight - consumeWeight + Number.EPSILON) * 1000) / 1000;
  }

  if (!consumptionRows.length) throw new Error("No reservation quantity could be consumed for this dispatch.");
  const consumeResult = await supabase.from("profile_stock_consumptions").insert(consumptionRows);
  if (consumeResult.error) throw consumeResult.error;
  if (fullyConsumedReservationIds.length) {
    const updateResult = await supabase
      .from("profile_stock_reservations")
      .update({ status: "consumed", released_at: new Date().toISOString() })
      .eq("company_id", context.companyId)
      .in("id", fullyConsumedReservationIds);
    if (updateResult.error) throw updateResult.error;
  }

  revalidatePath(`/dispatches/${dispatchId}`);
  revalidatePath(`/orders/${dispatch.order_id}`);
  revalidatePath("/inventory");
  revalidatePath("/inventory/database");
  revalidatePath("/inventory/reservations");
}

"use server";

import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";

export async function consumeDispatchReservations(dispatchId: string) {
  const context = await getSessionContext();
  if (!can(context.role, "update", "dispatches") || !can(context.role, "update", "inventory")) redirect(`/dispatches/${dispatchId}`);
  redirect(`/dispatches/${dispatchId}`);
}

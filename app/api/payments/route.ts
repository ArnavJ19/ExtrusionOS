import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { logEnterpriseAuditEvent } from "@/lib/enterprise/audit";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";
import { canManageDealerPayments } from "@/lib/auth/dealer-guards";

const paymentSchema = z.object({
  amount: z.number().positive(),
  payment_date: z.string(),
  payment_method: z.string(),
  reference_number: z.string().optional(),
  notes: z.string().optional(),
  order_id: z.string().uuid().optional(),
  invoice_id: z.string().uuid().optional(),
  dealership_id: z.string().uuid().optional(),
  payment_type: z.enum(['CUSTOMER_TO_DEALER', 'DEALER_TO_FACTORY', 'ADVANCE_PAYMENT', 'PARTIAL_PAYMENT', 'FINAL_PAYMENT', 'REFUND', 'ADJUSTMENT']).default('CUSTOMER_TO_DEALER'),
});

export async function POST(request: Request) {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "create", "payments")) return NextResponse.json({ error: "You do not have permission to record payments." }, { status: 403 });
    
    const parsed = paymentSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payment data" }, { status: 400 });

    const dealershipId = parsed.data.dealership_id ?? context.dealerId;
    if (context.dealerId && dealershipId !== context.dealerId) {
      return NextResponse.json({ error: "You can only record payments for your own dealership." }, { status: 403 });
    }

    if (!canManageDealerPayments(context, dealershipId)) {
      return NextResponse.json({ error: "You do not have permission to manage these payments." }, { status: 403 });
    }

    const supabase = await createClient();
    
    const paymentResult = await supabase.from("payments").insert({
      company_id: context.companyId,
      amount: parsed.data.amount,
      payment_date: parsed.data.payment_date,
      payment_method: parsed.data.payment_method,
      reference_number: parsed.data.reference_number ?? null,
      notes: parsed.data.notes ?? null,
      order_id: parsed.data.order_id ?? null,
      invoice_id: parsed.data.invoice_id ?? null,
      dealership_id: dealershipId ?? null,
      payment_type: parsed.data.payment_type,
      payment_status: "PAID",
      recorded_by_user_id: context.userId
    }).select("*").single();

    if (paymentResult.error || !paymentResult.data) {
      return NextResponse.json({ error: getErrorMessage(paymentResult.error, "Could not record payment") }, { status: 500 });
    }

    await logEnterpriseAuditEvent(supabase, {
      companyId: context.companyId,
      actorUserId: context.userId,
      actorName: context.fullName ?? context.email,
      actorRole: context.role,
      actorDealerId: context.dealerId,
      actionType: "payment_recorded",
      moduleName: "payments",
      entityType: "payment",
      entityId: paymentResult.data.id,
      newValue: parsed.data,
      changeSummary: `Payment of ${parsed.data.amount} recorded`
    });

    return NextResponse.json({ payment: paymentResult.data });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Payment recording failed") }, { status: 500 });
  }
}

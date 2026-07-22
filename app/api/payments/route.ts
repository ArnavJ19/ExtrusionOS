import { NextResponse } from "next/server";
import { recordPaymentAction } from "@/lib/actions/payments";
import { getErrorMessage } from "@/lib/utils/errors";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = {
      ...body,
      idempotency_key: body.idempotency_key ?? request.headers.get("idempotency-key")
    };

    const result = await recordPaymentAction(input);
    if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ payment: result.data });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Payment recording failed") },
      { status: 500 }
    );
  }
}

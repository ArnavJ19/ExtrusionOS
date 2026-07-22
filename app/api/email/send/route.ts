import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { sendEmailWithResend } from "@/lib/communications/email";
import { getErrorMessage } from "@/lib/utils/errors";

const emailSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  text: z.string().min(1),
  html: z.string().optional()
});

export async function POST(request: Request) {
  try {
    const webhookSecret = process.env.EMAIL_WEBHOOK_SECRET;
    const suppliedSecret = request.headers.get("x-email-webhook-secret");
    const isWebhookCall = Boolean(suppliedSecret && webhookSecret && suppliedSecret === webhookSecret);

    if (suppliedSecret && (!webhookSecret || suppliedSecret !== webhookSecret)) {
      return NextResponse.json({ error: "Unauthorized email webhook request" }, { status: 401 });
    }

    if (!isWebhookCall) {
      const context = await getSessionContext();
      const allowedRoles = new Set(["owner", "admin", "sales_manager", "sales"]);
      if (!allowedRoles.has(context.role)) {
        return NextResponse.json({ error: "You do not have permission to send outbound email." }, { status: 403 });
      }
    }

    const parsed = emailSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid email payload" }, { status: 400 });

    const result = await sendEmailWithResend(parsed.data);
    if (!result.success) return NextResponse.json({ error: result.error }, { status: 502 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Email send failed") }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
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
    const isWebhookCall = Boolean(webhookSecret && suppliedSecret && suppliedSecret === webhookSecret);

    if (webhookSecret && suppliedSecret && suppliedSecret !== webhookSecret) {
      return NextResponse.json({ error: "Unauthorized email webhook request" }, { status: 401 });
    }

    if (!isWebhookCall) {
      const context = await getSessionContext();
      const allowedRoles = new Set(["owner", "admin", "sales_manager", "sales"]);
      if (!allowedRoles.has(context.role)) {
        return NextResponse.json({ error: "You do not have permission to send outbound email." }, { status: 403 });
      }
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!resendApiKey) return NextResponse.json({ error: "Missing RESEND_API_KEY" }, { status: 500 });
    if (!from) return NextResponse.json({ error: "Missing EMAIL_FROM" }, { status: 500 });

    const parsed = emailSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid email payload" }, { status: 400 });

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${resendApiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: parsed.data.to,
        subject: parsed.data.subject,
        text: parsed.data.text,
        html: parsed.data.html
      })
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ error: result.message ?? "Email provider failed" }, { status: response.status });
    }

    return NextResponse.json({ success: true, provider: "resend", id: result.id ?? null });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Email send failed") }, { status: 500 });
  }
}

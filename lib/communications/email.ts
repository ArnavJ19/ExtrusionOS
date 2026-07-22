export type EmailPayload = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailResult =
  | { success: true; provider: "webhook" | "resend"; id?: string | null }
  | { success: false; error: string };

export async function sendEmail(payload: EmailPayload): Promise<EmailResult> {
  const webhookUrl = process.env.EMAIL_WEBHOOK_URL;
  const webhookSecret = process.env.EMAIL_WEBHOOK_SECRET;

  if (webhookUrl && webhookSecret) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-email-webhook-secret": webhookSecret
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) return { success: false, error: result.error ?? `Email webhook returned ${response.status}` };
      return { success: true, provider: "webhook", id: result.id ?? null };
    } catch (error) {
      return { success: false, error: getEmailError(error, "Email webhook request failed") };
    }
  }

  return sendEmailWithResend(payload);
}

export async function sendEmailWithResend(payload: EmailPayload): Promise<EmailResult> {
  const resendApiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!resendApiKey) return { success: false, error: "RESEND_API_KEY is not configured" };
  if (!from) return { success: false, error: "EMAIL_FROM is not configured" };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${resendApiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ from, ...payload })
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) return { success: false, error: result.message ?? `Resend returned ${response.status}` };
    return { success: true, provider: "resend", id: result.id ?? null };
  } catch (error) {
    return { success: false, error: getEmailError(error, "Resend request failed") };
  }
}

export async function sendInviteEmail(input: { to: string; fullName: string; companyName: string; inviteLink: string; expiresAt: string }) {
  return sendEmail({
    to: input.to,
    subject: `You're invited to ${input.companyName} on ExtrusionOS`,
    text: `Hello ${input.fullName},\n\nYou have been invited to ${input.companyName} on ExtrusionOS. Accept your invite before ${input.expiresAt}:\n${input.inviteLink}\n\nIf you were not expecting this invite, ignore this email.`,
    html: `<p>Hello ${escapeHtml(input.fullName)},</p><p>You have been invited to <strong>${escapeHtml(input.companyName)}</strong> on ExtrusionOS.</p><p><a href="${escapeHtml(input.inviteLink)}">Accept invite</a></p><p>This invite expires at ${escapeHtml(input.expiresAt)}.</p>`
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
}

function getEmailError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export type EmailPayload = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export async function sendEmail(payload: EmailPayload) {
  const webhookUrl = process.env.EMAIL_WEBHOOK_URL;
  if (!webhookUrl) {
    return { success: false, error: "EMAIL_WEBHOOK_URL is not configured" };
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.EMAIL_WEBHOOK_SECRET ? { "x-email-webhook-secret": process.env.EMAIL_WEBHOOK_SECRET } : {})
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) return { success: false, error: `Email provider returned ${response.status}` };
  return { success: true };
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

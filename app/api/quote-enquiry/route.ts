import { NextResponse } from "next/server";
import { z } from "zod";
import { enquiryQuoteDraftAction, linkEnquiryQuoteAction } from "@/lib/actions/autopilot-batch9";

// AP-008: the quotation form reads an enquiry's draft lines and marks the enquiry quoted through fetch, so the form never
// bundles server code. Both commands are re-checked by public.ap_enquiry, which takes the person from the session.
const bodySchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("draft"), id: z.string().uuid() }).strict(),
  z.object({ command: z.literal("link"), id: z.string().uuid(), quote_id: z.string().uuid() }).strict()
]);

export async function POST(request: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
    body = parsed.data;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
  }
  const result = body.command === "draft" ? await enquiryQuoteDraftAction(body.id) : await linkEnquiryQuoteAction(body.id, body.quote_id);
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}

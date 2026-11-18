import { NextResponse } from "next/server";
import { z } from "zod";
import { autopilotAction } from "@/lib/actions/autopilot";

// AP-095: the browser saves the person's floor language here with fetch, so floor screens never bundle server code.
// public.ap_language takes the person from the session.
const bodySchema = z.object({ language: z.enum(["en", "hi"]) }).strict();

export async function POST(request: Request) {
  let language: "en" | "hi";
  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ success: false, error: "Choose English or Hindi." }, { status: 400 });
    language = parsed.data.language;
  } catch {
    return NextResponse.json({ success: false, error: "Choose English or Hindi." }, { status: 400 });
  }
  const result = await autopilotAction("ap_language", "set", { language });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}

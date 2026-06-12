import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { can } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

const leadSchema = z.object({
  lead_name: z.string().trim().min(2),
  company_name: z.string().trim().optional().nullable(),
  contact_person: z.string().trim().optional().nullable(),
  city: z.string().trim().optional().nullable(),
  lead_source: z.string().trim().min(1),
  customer_type: z.string().trim().min(1),
  estimated_value: z.coerce.number().finite().min(0).default(0),
});

export async function POST(request: Request) {
  try {
    const context = await getSessionContext();
    if (!can(context.role, "create", "customers")) return NextResponse.json({ error: "You do not have permission to create CRM leads." }, { status: 403 });

    const parsed = leadSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid lead" }, { status: 400 });

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("leads")
      .insert({
        company_id: context.companyId,
        lead_name: parsed.data.lead_name,
        company_name: parsed.data.company_name || null,
        contact_person: parsed.data.contact_person || null,
        city: parsed.data.city || null,
        lead_source: parsed.data.lead_source,
        customer_type: parsed.data.customer_type,
        estimated_value: parsed.data.estimated_value,
        status: "new",
      })
      .select("id")
      .single();

    if (error || !data) return NextResponse.json({ error: getErrorMessage(error, "Could not create lead") }, { status: 500 });
    return NextResponse.json({ lead: data });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, "Could not create lead") }, { status: 500 });
  }
}

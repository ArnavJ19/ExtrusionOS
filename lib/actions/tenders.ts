"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

const tenderSchema = z.object({
  tender_number: z.string().trim().min(1, "Tender number is required").max(120),
  tender_title: z.string().trim().min(1, "Tender title is required").max(300),
  issuing_authority: z.string().trim().min(1, "Issuing authority is required").max(200),
  sector: z.enum(["railways", "airport", "solar", "power", "defence", "metro", "government_building", "infrastructure", "industrial", "other"]),
  tender_url: z.string().trim().url("Enter a valid tender URL").optional().nullable().or(z.literal("")),
  publish_date: z.string().optional().nullable(),
  submission_deadline: z.string().min(1, "Submission deadline is required"),
  estimated_value: z.coerce.number().nonnegative().max(10000000000, "Estimated value looks too high").default(0),
  emd_amount: z.coerce.number().nonnegative().max(1000000000, "EMD amount looks too high").default(0),
  emd_status: z.enum(["not_paid", "paid", "refunded", "forfeited"]).default("not_paid"),
  document_fee: z.coerce.number().nonnegative().max(100000000, "Document fee looks too high").default(0),
  bid_value: z.coerce.number().nonnegative().max(10000000000, "Bid value looks too high").default(0),
  status: z.enum(["identified", "under_review", "eligible", "not_eligible", "documents_pending", "submitted", "technically_qualified", "commercially_opened", "won", "lost", "cancelled"]).default("identified"),
  technical_status: z.enum(["pending", "qualified", "disqualified"]).default("pending"),
  commercial_status: z.enum(["pending", "l1", "l2", "l3", "above_l3"]).default("pending"),
  competitor_notes: z.string().trim().max(1000).optional().nullable(),
  assigned_to: z.string().trim().max(120).optional().nullable(),
  result_date: z.string().optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable()
});

export type TenderFormInput = z.input<typeof tenderSchema>;

function canManageTenders(role: string) {
  return ["owner", "admin", "sales_manager"].includes(role);
}

export async function createTenderAction(input: TenderFormInput) {
  try {
    const context = await getSessionContext();
    if (!canManageTenders(context.role)) return { success: false, error: "You do not have permission to create tenders." };

    const parsed = tenderSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Please check tender details." };

    const supabase = await createClient();
    const duplicate = await supabase
      .from("tenders")
      .select("id", { count: "exact", head: true })
      .eq("company_id", context.companyId)
      .eq("tender_number", parsed.data.tender_number);
    if (duplicate.error) throw duplicate.error;
    if ((duplicate.count ?? 0) > 0) return { success: false, error: "Tender number already exists for this company." };

    const result = await supabase.from("tenders").insert({
      ...parsed.data,
      tender_url: parsed.data.tender_url || null,
      publish_date: parsed.data.publish_date || null,
      result_date: parsed.data.result_date || null,
      competitor_notes: parsed.data.competitor_notes || null,
      assigned_to: parsed.data.assigned_to || null,
      notes: parsed.data.notes || null,
      company_id: context.companyId
    }).select("id").single();
    if (result.error || !result.data) throw result.error ?? new Error("Could not create tender");

    revalidatePath("/tenders");
    return { success: true, tenderId: result.data.id };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not create tender") };
  }
}

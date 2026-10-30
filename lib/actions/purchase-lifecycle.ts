"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";
import {
  parseSupplierInvoiceText,
  purchaseLifecycleInputSchema,
  purchaseLifecycleResultSchema,
  supplierDocumentProposalSchema,
  type PurchaseLifecycleInput,
  type PurchaseLifecycleResult,
} from "@/lib/workflow/purchase-lifecycle";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string; uncertain?: boolean };

const extractedDocumentInputSchema = z.object({
  fileName: z.string().trim().min(1).max(240),
  text: z.string().min(1).max(750_000)
}).strict();

async function runPurchaseLifecycleCommand(input: PurchaseLifecycleInput): Promise<ActionResult<PurchaseLifecycleResult>> {
  let mutationSubmitted = false;
  try {
    const parsed = purchaseLifecycleInputSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the purchasing details." };
    const context = await getSessionContext();
    if (!context.companyId || !context.userId || context.dealerId) return { success: false, error: "Purchasing requires an authenticated company employee." };
    const role = context.role;
    const readCommands = ["dashboard.load", "orders.list", "bills.list", "order.load", "bill.load", "document.load"];
    const receiptCommands = ["receipt.record"];
    if (readCommands.includes(parsed.data.command) && !["owner", "admin", "accounts", "inventory_manager", "viewer"].includes(role)) {
      return { success: false, error: "Your role cannot view purchasing records." };
    }
    if (receiptCommands.includes(parsed.data.command) && !["owner", "admin", "inventory_manager"].includes(role)) {
      return { success: false, error: "Your role cannot record purchase receipts." };
    }
    if (!readCommands.includes(parsed.data.command) && !receiptCommands.includes(parsed.data.command) && !["owner", "admin", "accounts"].includes(role)) {
      return { success: false, error: "Your role cannot manage purchase orders or supplier bills." };
    }
    const supabase = await createClient();
    mutationSubmitted = !readCommands.includes(parsed.data.command);
    const result = await supabase.rpc("purchase_lifecycle_command", {
      p_command: parsed.data.command,
      p_payload: parsed.data.payload
    });
    if (result.error || !result.data) throw result.error ?? new Error("Purchasing action returned no result");
    const data = purchaseLifecycleResultSchema.parse(result.data);
    revalidatePath("/vendors/purchasing");
    if (data.kind === "bill_posted") {
      revalidatePath("/expenses");
      revalidatePath("/expenses/database");
      revalidatePath("/expenses/pending-approvals");
      revalidatePath("/expenses/payments");
      revalidatePath("/analytics");
    }
    return { success: true, data };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const confirmedRejection = /^(22|23|40|42)/.test(code) || code === "P0001";
    return { success: false, error: getErrorMessage(error, "Could not complete the purchasing action"), uncertain: mutationSubmitted && !confirmedRejection };
  }
}

export async function purchaseLifecycleAction(input: PurchaseLifecycleInput): Promise<ActionResult<PurchaseLifecycleResult>> {
  return runPurchaseLifecycleCommand(input);
}

export async function extractSupplierDocumentAction(input: { fileName: string; text: string }): Promise<ActionResult<{
  source_id: string;
  source_hash: string;
  source_name: string;
  proposal: ReturnType<typeof supplierDocumentProposalSchema.parse>;
  uncertain_fields: string[];
  review_revision: number;
  review_hash: string | null;
  reviewed_payload: Record<string, unknown> | null;
}>> {
  try {
    const context = await getSessionContext();
    if (!context.companyId || !context.userId || context.dealerId || !["owner", "admin", "accounts"].includes(context.role)) {
      return { success: false, error: "Your role cannot review supplier documents." };
    }
    const parsed = extractedDocumentInputSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Select a supported supplier invoice file." };
    const sourceName = parsed.data.fileName.replace(/[\\/]/g, "_").trim().slice(0, 180);
    const extension = sourceName.toLowerCase().split(".").pop();
    if (extension !== "txt" && extension !== "csv") return { success: false, error: "Upload a text or CSV invoice. PDF and image OCR are not configured." };
    if (Buffer.byteLength(parsed.data.text, "utf8") > 750_000 || parsed.data.text.includes("\0")) {
      return { success: false, error: "Supplier text files must be under 750 KB and contain readable text." };
    }
    const { proposal: proposed, uncertainFields } = parseSupplierInvoiceText(parsed.data.text);
    const proposal = supplierDocumentProposalSchema.parse(proposed);
    const sourceHash = createHash("sha256").update(parsed.data.text, "utf8").digest("hex");
    const created = await runPurchaseLifecycleCommand({
      command: "document.create",
      payload: { source_hash: sourceHash, source_name: sourceName, proposal, uncertain_fields: uncertainFields }
    });
    if (!created.success) return created;
    if (created.data.kind !== "document") return { success: false, error: "Supplier source document was not saved." };
    return {
      success: true,
      data: {
        source_id: created.data.id,
        source_hash: created.data.source_hash,
        source_name: created.data.source_name,
        proposal: created.data.proposal,
        uncertain_fields: created.data.uncertain_fields,
        review_revision: created.data.review_revision,
        review_hash: created.data.review_hash,
        reviewed_payload: created.data.reviewed_payload
      }
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error, "Could not extract supplier text") };
  }
}

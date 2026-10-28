// UPGRADE_EOS feature 44 (dedicated approval inbox). The database lists the requests the
// signed-in employee may decide and applies decisions through each record's existing workflow;
// this module validates commands and responses.
import { z } from "zod";

export const APPROVERS = ["owner", "admin", "sales_manager", "accounts"] as const;
export const canUseApprovalInbox = (role: string) => (APPROVERS as readonly string[]).includes(role);
export const DECISIONS = { approve: "Approve", reject: "Reject", clarify: "Request clarification" } as const;
export type Decision = keyof typeof DECISIONS;

const noControl = (value: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const uuid = z.string().uuid();
const version = z.string().regex(/^[0-9a-f]{32}$/, "Refresh the inbox before deciding");

export const approvalCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("inbox.list"), type: z.enum(["quote", "expense"]).optional(), page: z.number().int().min(1).max(100000).default(1) }).strict(),
  z.object({ command: z.literal("inbox.history"), page: z.number().int().min(1).max(100000).default(1) }).strict(),
  z.object({
    command: z.literal("inbox.decide"), source_type: z.enum(["quote", "expense"]), source_id: uuid, version, decision: z.enum(["approve", "reject", "clarify"]),
    note: z.string().trim().max(1000, "Keep the note under 1,000 characters").refine(noControl, "Remove control characters").default(""), request_id: uuid
  }).strict()
]).superRefine((value, ctx) => {
  if (value.command === "inbox.decide" && value.decision !== "approve" && value.note.length < 5) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Explain the rejection or the question for the requester", path: ["note"] });
  }
});
export type ApprovalCommand = z.input<typeof approvalCommandSchema>;

const num = z.union([z.number(), z.string()]).nullable().transform((value) => (value === null ? null : Number(value)));
export const approvalInboxSchema = z.object({
  rows: z.array(z.object({
    source_type: z.enum(["quote", "expense"]), source_id: uuid, reference: z.string().nullable(), requested_at: z.string(), requester_name: z.string().nullable(),
    counterparty: z.string().nullable(), amount: num, low_margin: z.boolean().nullable(), profit_percent: num, revision: z.number().int().nullable(),
    category: z.string().nullable(), detail: z.string().nullable(), version, can_decide: z.boolean(), blocked_reason: z.string().nullable(),
    clarifications: z.number().int().nonnegative(), last_clarification: z.object({ note: z.string().nullable(), by: z.string(), at: z.string() }).strict().nullable()
  }).strict()).max(10),
  total_count: z.number().int().nonnegative()
}).strict();
export type ApprovalInbox = z.infer<typeof approvalInboxSchema>;
export type ApprovalItem = ApprovalInbox["rows"][number];

export const approvalHistorySchema = z.object({
  rows: z.array(z.object({
    id: uuid, source_type: z.enum(["quote", "expense"]), source_id: uuid, source_reference: z.string().nullable(), decision: z.enum(["approve", "reject", "clarify"]),
    note: z.string().nullable(), actor_name: z.string(), actor_role: z.string(), decided_at: z.string()
  }).strict()).max(10),
  total_count: z.number().int().nonnegative()
}).strict();

export const sourceHref = (item: Pick<ApprovalItem, "source_type" | "source_id">) => (item.source_type === "quote" ? `/quotes/${item.source_id}` : `/expenses/${item.source_id}`);

/** What a decision will do, stated before the approver confirms it. */
export function decisionEffect(item: Pick<ApprovalItem, "source_type">, decision: Decision) {
  if (decision === "clarify") return "The request stays pending and the requester is notified with your question.";
  if (item.source_type === "quote") return decision === "approve" ? "The quotation moves to approved for sending." : "The quotation returns to draft with your reason.";
  return decision === "approve" ? "The expense is approved for payment." : "The expense is rejected with your reason; it can be corrected and resubmitted.";
}

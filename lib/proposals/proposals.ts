// AP-002: shared proposal model (Detect -> Propose -> Confirm -> Learn). The database prepares proposals and re-runs
// the domain action with its own checks when a person accepts; this module validates responses and describes them.
import { z } from "zod";
import { DOCUMENT_SERIES, type DocumentSeriesKey } from "../numbering/financial-year.ts";

export const PROPOSAL_TYPES = {
  "navigation.role_layout": { label: "Role navigation", home: "/settings/navigation", noun: "navigation" },
  "period.close_month": { label: "Month close", home: "/invoices/periods", noun: "month close" },
  "series.adopt": { label: "Financial-year numbering", home: "/settings/numbering", noun: "number series" }
} as const;
export type ProposalType = keyof typeof PROPOSAL_TYPES;
export const PROPOSAL_TYPE_KEYS = Object.keys(PROPOSAL_TYPES) as [ProposalType, ...ProposalType[]];

export const proposalStatusLabels = { open: "Waiting for you", accepted: "Accepted", edited: "Accepted with changes", rejected: "Rejected", stale: "Stale: facts changed", expired: "Expired" } as const;

export const proposalRowSchema = z.object({
  id: z.string().uuid(), proposal_type: z.enum(PROPOSAL_TYPE_KEYS), target_key: z.string(), title: z.string(), payload: z.record(z.unknown()),
  evidence: z.record(z.unknown()).nullable(), versions: z.record(z.unknown()).nullable(), rule_key: z.string(), reason: z.string(), confidence: z.number().nullable(),
  status: z.enum(["open", "accepted", "edited", "rejected", "stale", "expired"]), created_at: z.string(), expires_at: z.string(), decided_at: z.string().nullable(),
  decided_by: z.string().nullable(), edited_fields: z.array(z.string()), decision_note: z.string().nullable(), outcome: z.record(z.unknown()).nullable(),
  editable: z.array(z.string()), can_decide: z.boolean(), stale_now: z.boolean(), job_run_id: z.string().uuid().nullable()
});
export type ProposalRow = z.infer<typeof proposalRowSchema>;
export const proposalListSchema = z.object({ total_count: z.number(), page: z.number(), rows: z.array(proposalRowSchema) });
export type ProposalList = z.infer<typeof proposalListSchema>;
export const proposalDecisionSchema = z.object({
  id: z.string().uuid(), state: z.enum(["accepted", "edited", "rejected", "stale", "expired", "failed"]), message: z.string().optional(),
  edited_fields: z.array(z.string()).optional(), outcome: z.unknown().optional(), repeated: z.boolean().optional()
});
export type ProposalDecision = z.infer<typeof proposalDecisionSchema>;

const note = z.string().trim().min(3, "Write at least 3 characters").max(300, "Keep the note within 300 characters").refine(value => !/[\u0000-\u001f\u007f]/.test(value), "Remove control characters");
export const decideInputSchema = z.discriminatedUnion("decision", [
  z.object({ id: z.string().uuid(), decision: z.literal("accept"), note: note.optional() }).strict(),
  z.object({ id: z.string().uuid(), decision: z.literal("reject"), note }).strict(),
  z.object({ id: z.string().uuid(), decision: z.literal("edit"), payload: z.record(z.unknown()), note: note.optional() }).strict()
]);
export const decideBatchInputSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(50), decision: z.enum(["accept", "reject"]), note: note.optional() }).strict()
  .refine(value => value.decision === "accept" || value.note, { message: "Give a reason for rejecting", path: ["note"] });

/** One line per fact the card shows under "Why". */
export function proposalWhy(row: ProposalRow): string[] {
  const evidence = (row.evidence ?? {}) as Record<string, unknown>;
  const lines = [row.reason];
  if (row.proposal_type === "navigation.role_layout") {
    lines.push(`${evidence.total_visits ?? 0} page visits by this role over ${evidence.window_days ?? 28} days (${evidence.days_observed ?? 0} days with visits).`);
  } else if (row.proposal_type === "period.close_month") {
    lines.push(`${evidence.invoices ?? 0} invoice(s) and ${evidence.payments ?? 0} receipt(s) are dated in the month. Books are closed through ${evidence.locked_through ?? "no date yet"}.`);
    if (Number(evidence.open_backdate_flags ?? 0) > 0) lines.push(`${evidence.open_backdate_flags} back-dated entr${Number(evidence.open_backdate_flags) === 1 ? "y is" : "ies are"} not yet reviewed.`);
  } else if (row.proposal_type === "series.adopt") {
    lines.push(`Next number would be ${evidence.example ?? "-"} in financial year ${evidence.fy ?? "-"}.`);
    if (evidence.gst_limit) lines.push(`GST allows at most ${evidence.gst_limit} characters in a tax document number.`);
  }
  lines.push(`Rule ${row.rule_key}, prepared ${new Date(row.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}${row.job_run_id ? " by a scheduled job" : ""}.`);
  if (row.confidence !== null) lines.push(`Confidence ${Math.round(row.confidence * 100)}% (share of visits these destinations cover).`);
  return lines;
}

export function proposalSummary(row: ProposalRow): string {
  if (row.proposal_type === "navigation.role_layout") return `Main navigation for ${row.target_key.replaceAll("_", " ")}: ${((row.payload.items as string[]) ?? []).join(", ")}`;
  if (row.proposal_type === "period.close_month") return `Close ${row.payload.month as string} so entries dated in it need an approved reopen.`;
  const doc = row.target_key as DocumentSeriesKey;
  return `${DOCUMENT_SERIES[doc]?.label ?? row.target_key}: ${row.payload.prefix_template as string} with ${row.payload.pad_width as number}-digit running number`;
}

// AP-059: month close, approved reopen windows and back-dating flags (database: public.ap_period).
import { z } from "zod";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month");
const text = (min: number, max: number, label: string) => z.string().trim().min(min, `${label}: at least ${min} characters`).max(max, `${label}: at most ${max} characters`)
  .refine(value => !/[\u0000-\u001f\u007f]/.test(value), "Remove control characters");

export const periodCommandSchemas = {
  overview: z.object({}).strict(),
  flags: z.object({ page: z.number().int().min(1).max(100000).optional(), state: z.enum(["open", "all"]).optional() }).strict(),
  close_month: z.object({ month, reason: text(10, 300, "Reason") }).strict(),
  request_reopen: z.object({ month, reason: text(10, 500, "Reason") }).strict(),
  approve_reopen: z.object({ id: z.string().uuid(), note: text(5, 300, "Decision note") }).strict(),
  reject_reopen: z.object({ id: z.string().uuid(), note: text(5, 300, "Decision note") }).strict(),
  reclose: z.object({ id: z.string().uuid() }).strict(),
  withdraw_reopen: z.object({ id: z.string().uuid() }).strict(),
  review_flag: z.object({ id: z.string().uuid(), note: text(5, 300, "Review note") }).strict(),
  save_policy: z.object({ backdate_flag_days: z.number().int().min(1).max(60), close_proposal_day: z.number().int().min(1).max(28), reopen_window_hours: z.number().int().min(1).max(168) }).strict()
} as const;

export const periodOverviewSchema = z.object({
  locked_through: z.string().nullable(), today: z.string(), can_close: z.boolean(), can_close_month: z.boolean().optional(),
  policy: z.object({ backdate_flag_days: z.number(), close_proposal_day: z.number(), reopen_window_hours: z.number() }),
  months: z.array(z.object({
    month: month, label: z.string(), state: z.enum(["closed", "reopened", "open_ended", "current"]),
    reopen: z.object({ id: z.string().uuid(), status: z.enum(["requested", "approved", "rejected", "closed", "withdrawn"]), reason: z.string(), requested_by: z.string().nullable(),
      requested_by_id: z.string().uuid(), requested_at: z.string(), decided_by: z.string().nullable(), window_ends_at: z.string().nullable(), postings: z.number() }).nullable()
  })),
  open_flags: z.number().nullable()
});
export type PeriodOverview = z.infer<typeof periodOverviewSchema>;
export const periodFlagsSchema = z.object({
  total_count: z.number(),
  rows: z.array(z.object({ id: z.string().uuid(), table_name: z.string(), record_id: z.string().uuid(), entry_date: z.string(), recorded_on: z.string(), days_back: z.number(),
    actor: z.string().nullable(), created_at: z.string(), reviewed_at: z.string().nullable(), reviewed_by: z.string().nullable(), review_note: z.string().nullable() }))
});
export type PeriodFlags = z.infer<typeof periodFlagsSchema>;

export const PERIOD_STATE_LABELS = { closed: "Closed", reopened: "Open for an approved exception", open_ended: "Ended, not closed", current: "Current month" } as const;
export const FLAG_TABLE_LABELS: Record<string, { label: string; href?: (id: string) => string }> = {
  invoices: { label: "Invoice", href: id => `/invoices/${id}` }, payments: { label: "Receipt", href: () => "/payments" }, credit_notes: { label: "Credit note", href: () => "/invoices" },
  expense_ledger: { label: "Expense", href: () => "/expenses" }, expense_payments: { label: "Expense payment", href: () => "/expenses" },
  expense_supplier_credits: { label: "Supplier credit", href: () => "/expenses" }, supplier_purchase_bills: { label: "Supplier bill", href: () => "/vendors/purchasing" },
  purchase_receipts: { label: "Purchase receipt", href: () => "/vendors/purchasing" }
};

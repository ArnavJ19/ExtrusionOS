// Quoted vs invoiced value per order line (EXOS-AUD-026). Invoices bill actual net kg at
// the line's invoice rate (quoted amount / physical kg), so a partly shipped or short line
// leaves part of the quoted value uninvoiced; this shows how much.
import type { SessionContext } from "@/types/app";

// Same roles as public.get_order_billing_reconciliation and invoices_authorized.
export const BILLING_RECONCILIATION_ROLES = ["owner", "admin", "accounts"] as const;

export type OrderBillingLine = {
  orderItemId: string;
  profileId: string | null;
  quotedKg: number;
  quotedValue: number;
  invoiceRatePerKg: number;
  invoicedKg: number;
  invoicedValue: number;
  uninvoicedValue: number;
};

type Db = any;
const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);

export function parseOrderBillingLines(raw: unknown): OrderBillingLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row: Record<string, unknown>) => ({
    orderItemId: String(row.orderItemId ?? ""),
    profileId: row.profileId ? String(row.profileId) : null,
    quotedKg: num(row.quotedKg),
    quotedValue: num(row.quotedValue),
    invoiceRatePerKg: num(row.invoiceRatePerKg),
    invoicedKg: num(row.invoicedKg),
    invoicedValue: num(row.invoicedValue),
    uninvoicedValue: num(row.uninvoicedValue)
  }));
}

export async function loadOrderBillingReconciliation(db: Db, context: SessionContext, orderId: string): Promise<OrderBillingLine[] | null> {
  if (!(BILLING_RECONCILIATION_ROLES as readonly string[]).includes(context.role)) return null;
  const { data, error } = await db.rpc("get_order_billing_reconciliation", { p_order_id: orderId });
  if (error) return null;
  return parseOrderBillingLines(data);
}

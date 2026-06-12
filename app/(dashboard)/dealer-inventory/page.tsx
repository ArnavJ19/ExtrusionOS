import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { can } from "@/lib/auth/permissions";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

export default async function DealerInventoryPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "dealer_inventory")) redirect("/dashboard");
  const supabase = await createClient();
  const transactionQuery = supabase.from("inventory_transactions").select("id, inventory_state, quantity, unit, created_at, inventory_items(item_name, item_code)").eq("company_id", context.companyId).order("created_at", { ascending: false }).limit(50);
  if (context.dealerId) transactionQuery.or(`to_owner_id.eq.${context.dealerId},from_owner_id.eq.${context.dealerId}`);
  const shipmentQuery = supabase.from("shipments").select("id, shipment_number, status, dispatched_at, dealers(dealer_name)").eq("company_id", context.companyId).order("created_at", { ascending: false }).limit(25);
  if (context.dealerId) shipmentQuery.eq("dealer_id", context.dealerId);
  const discrepancyQuery = supabase.from("inventory_discrepancies").select("id, status, expected_quantity, reported_quantity, difference_quantity, created_at, dealers(dealer_name)").eq("company_id", context.companyId).order("created_at", { ascending: false }).limit(25);
  if (context.dealerId) discrepancyQuery.eq("dealer_id", context.dealerId);
  const [transactions, shipments, discrepancies] = await Promise.all([
    transactionQuery,
    shipmentQuery,
    discrepancyQuery
  ]);
  const errors = [transactions, shipments, discrepancies].map((result) => result.error ? getErrorMessage(result.error) : "").filter(Boolean);

  return (
    <div>
      <PageHeader title="Dealer Inventory" description="Factory owner view of dealer stock, in-transit material, pending receipt confirmations, and discrepancy alerts. Dealer users only see their own dealership via RLS." />
      <QueryErrorNotice messages={errors} />
      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="Transactions" value={String(transactions.data?.length ?? 0)} />
        <Metric label="Incoming shipments" value={String(shipments.data?.filter((row) => row.status !== "received_confirmed").length ?? 0)} />
        <Metric label="Open discrepancies" value={String(discrepancies.data?.filter((row) => row.status !== "resolved").length ?? 0)} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Table title="Incoming Shipments" columns={["Shipment", "Dealer", "Status", "Dispatched"]} rows={shipments.data ?? []} render={(row) => [row.shipment_number, row.dealers?.dealer_name ?? "Dealer", <Badge key="status" value={row.status} />, row.dispatched_at ?? "Pending"]} />
        <Table title="Discrepancy Alerts" columns={["Dealer", "Expected", "Reported", "Status"]} rows={discrepancies.data ?? []} render={(row) => [row.dealers?.dealer_name ?? "Dealer", `${row.expected_quantity}`, `${row.reported_quantity} (${row.difference_quantity})`, <Badge key="status" value={row.status} />]} />
      </div>
      <div className="mt-6"><Table title="Inventory Ledger" columns={["Item", "State", "Quantity", "Created"]} rows={transactions.data ?? []} render={(row) => [row.inventory_items?.item_name ?? row.inventory_items?.item_code ?? "Item", <Badge key="state" value={row.inventory_state} />, `${row.quantity} ${row.unit}`, row.created_at]} /></div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <Card><CardContent><p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-400">{label}</p><p className="mt-2 text-2xl font-black text-neutral-950">{value}</p></CardContent></Card>;
}

function Table({ title, columns, rows, render }: { title: string; columns: string[]; rows: Record<string, any>[]; render: (row: Record<string, any>) => React.ReactNode[] }) {
  return <Card><CardContent><h2 className="mb-4 text-lg font-bold text-neutral-950">{title}</h2><div className="overflow-x-auto"><table className="industrial-table min-w-[680px]"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id ?? index}>{render(row).map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}{!rows.length ? <tr><td colSpan={columns.length} className="px-4 py-10 text-center font-semibold text-neutral-500">No records found.</td></tr> : null}</tbody></table></div></CardContent></Card>;
}

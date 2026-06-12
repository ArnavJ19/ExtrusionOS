import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { can } from "@/lib/auth/permissions";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

export default async function DiscrepanciesPage() {
  const context = await getSessionContext();
  if (!can(context.role, "read", "dealer_inventory")) redirect("/dashboard");
  const supabase = await createClient();
  const query = supabase.from("inventory_discrepancies").select("*, dealers(dealer_name), shipments(shipment_number)").eq("company_id", context.companyId).order("created_at", { ascending: false }).limit(100);
  if (context.dealerId) query.eq("dealer_id", context.dealerId);
  const result = await query;
  return (
    <div>
      <PageHeader title="Discrepancy Resolution" description="Review expected vs reported vs recount quantities, responsible users, timelines, notes, and authorized final resolution." />
      <QueryErrorNotice messages={result.error ? [getErrorMessage(result.error)] : []} />
      <Card><CardContent><div className="overflow-x-auto"><table className="industrial-table min-w-[980px]"><thead><tr>{["Shipment", "Dealer", "Expected", "Reported", "Recount", "Difference", "User", "Status"].map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{(result.data ?? []).map((row) => <tr key={row.id}><td>{row.shipments?.shipment_number ?? row.shipment_id}</td><td>{row.dealers?.dealer_name ?? "Dealer"}</td><td>{row.expected_quantity}</td><td>{row.reported_quantity}</td><td>{row.recount_quantity ?? "-"}</td><td>{row.difference_quantity}</td><td>{row.reported_by_name ?? row.reported_by_user_id ?? "-"}</td><td><Badge value={row.status} /></td></tr>)}{!result.data?.length ? <tr><td colSpan={8} className="px-4 py-12 text-center font-semibold text-neutral-500">No discrepancies found.</td></tr> : null}</tbody></table></div></CardContent></Card>
    </div>
  );
}

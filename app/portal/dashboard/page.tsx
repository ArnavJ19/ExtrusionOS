import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { QueryErrorNotice } from "@/components/ui/query-error-notice";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getErrorMessage } from "@/lib/utils/errors";

export default async function PortalDashboardPage() {
  const context = await getSessionContext();
  if (context.role !== "dealer_admin" && context.role !== "dealer_staff") {
    redirect("/dashboard");
  }
  if (!context.dealerId) {
    redirect("/dashboard?denied=1");
  }

  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [dealerOrders, openTasks, discrepancies, lowStock, recentOrders] = await Promise.all([
    supabase
      .from("dealer_orders")
      .select("id", { count: "exact", head: true })
      .eq("company_id", context.companyId)
      .eq("dealer_id", context.dealerId)
      .not("status", "in", "(received_confirmed,closed,cancelled)"),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("company_id", context.companyId)
      .eq("dealership_id", context.dealerId)
      .in("status", ["open", "in_progress"]),
    supabase
      .from("inventory_discrepancies")
      .select("id", { count: "exact", head: true })
      .eq("company_id", context.companyId)
      .eq("dealer_id", context.dealerId)
      .in("status", ["open", "recount_requested", "recount_completed"]),
    supabase
      .from("profile_stock_batches")
      .select("id, profile_id, quantity_pieces, length_m, total_weight_kg, aluminium_profiles(profile_code, profile_name)")
      .eq("company_id", context.companyId)
      .eq("dealer_id", context.dealerId)
      .eq("status", "available")
      .lte("quantity_pieces", 10)
      .order("quantity_pieces", { ascending: true })
      .limit(5),
    supabase
      .from("dealer_orders")
      .select("id, order_number, status, expected_delivery_date, created_at")
      .eq("company_id", context.companyId)
      .eq("dealer_id", context.dealerId)
      .order("created_at", { ascending: false })
      .limit(8)
  ]);

  const queryErrors = [dealerOrders, openTasks, discrepancies, lowStock, recentOrders]
    .map((result) => (result.error ? getErrorMessage(result.error) : ""))
    .filter(Boolean);

  const overdueCount =
    (recentOrders.data ?? []).filter(
      (order) =>
        order.expected_delivery_date &&
        order.expected_delivery_date < today &&
        !["received_confirmed", "closed", "cancelled"].includes(order.status)
    ).length;

  return (
    <div>
      <PageHeader
        title="Dealer Dashboard"
        description="Track dealer order progress, receiving discrepancies, task workload, and low available stock."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/dealer-orders/new" className="rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold shadow-sm">
              New Dealer Order
            </Link>
            <Link href="/inventory" className="rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold shadow-sm">
              Dealer Inventory
            </Link>
          </div>
        }
      />
      <QueryErrorNotice messages={queryErrors} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">Active Dealer Orders</p>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tracking-tight text-neutral-900">{dealerOrders.count ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">Open Tasks</p>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tracking-tight text-neutral-900">{openTasks.count ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">Discrepancies</p>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tracking-tight text-neutral-900">{discrepancies.count ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">Overdue Receipts</p>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tracking-tight text-neutral-900">{overdueCount}</p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-lg font-bold">Recent Dealer Orders</h2>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="industrial-table min-w-[620px]">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Status</th>
                    <th>Expected Delivery</th>
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {(recentOrders.data ?? []).map((order) => (
                    <tr key={order.id}>
                      <td>{order.order_number}</td>
                      <td>
                        <Badge value={order.status} />
                      </td>
                      <td>{order.expected_delivery_date ?? "-"}</td>
                      <td>
                        <Link href={`/dealer-orders/${order.id}`} className="font-semibold text-neutral-700 underline-offset-4 hover:underline">
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {!recentOrders.data?.length ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center font-semibold text-neutral-500">
                        No dealer orders yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-lg font-bold">Low Available Stock Batches</h2>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="industrial-table min-w-[620px]">
                <thead>
                  <tr>
                    <th>Profile</th>
                    <th>Pieces</th>
                    <th>Length (m)</th>
                    <th>Weight (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {(lowStock.data ?? []).map((row) => (
                    <tr key={row.id}>
                      <td>{((Array.isArray(row.aluminium_profiles) ? row.aluminium_profiles[0] : row.aluminium_profiles) as { profile_code?: string } | null)?.profile_code ?? row.profile_id}</td>
                      <td>{Number(row.quantity_pieces ?? 0)}</td>
                      <td>{Number(row.length_m ?? 0)}</td>
                      <td>{Number(row.total_weight_kg ?? 0)}</td>
                    </tr>
                  ))}
                  {!lowStock.data?.length ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center font-semibold text-neutral-500">
                        No low-stock alerts.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ShipmentReceiptForm } from "@/components/modules/shipment-receipt-form";
import { can } from "@/lib/auth/permissions";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function ShipmentReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getSessionContext();
  if (!can(context.role, "approve", "dealer_inventory")) redirect("/dashboard");
  const { id } = await params;
  const supabase = await createClient();
  const { data: shipment } = await supabase.from("shipments").select("*, dealers(dealer_name)").eq("id", id).eq("company_id", context.companyId).single();
  if (!shipment || (context.dealerId && shipment.dealer_id !== context.dealerId)) notFound();
  const { data: items } = await supabase.from("shipment_items").select("*, inventory_items(item_name, item_code)").eq("shipment_id", id).eq("company_id", context.companyId);

  return (
    <div>
      <PageHeader title={`Receipt ${shipment.shipment_number}`} description="Count actual received quantity item-by-item. Matching lines move to dealer stock; mismatches create discrepancy records and recount workflow." />
      <Card>
        <CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">Expected Items</h2><Badge value={shipment.status} /></div></CardHeader>
        <CardContent>
          <ShipmentReceiptForm dealerId={shipment.dealer_id} shipmentId={shipment.id} dealerOrderId={shipment.dealer_order_id} items={(items ?? []).map((item) => ({ ...item, expected_quantity: Number(item.expected_quantity) }))} />
        </CardContent>
      </Card>
    </div>
  );
}

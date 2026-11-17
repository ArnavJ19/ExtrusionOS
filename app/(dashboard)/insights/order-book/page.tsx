import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { OrderBookClient } from "@/components/modules/intelligence/order-book";
import { getSessionContext } from "@/lib/auth";
import { ORDER_BOOK_ROLES } from "@/lib/intelligence/commands";

// FS-71: sales forecast and order-book analytics.
export default async function OrderBookPage() {
  const context = await getSessionContext();
  if (context.dealerId || !(ORDER_BOOK_ROLES as readonly string[]).includes(context.role)) redirect("/dashboard");
  return <div className="space-y-5">
    <PageHeader title="Order book and forecast" description="Tonnes on order and weeks of press load, the weighted quotation pipeline, customer concentration and a simple projection." actions={<Link href="/insights" className="text-sm font-bold underline">Insights</Link>} />
    <OrderBookClient canSet={["owner", "admin", "sales_manager"].includes(context.role)} />
  </div>;
}

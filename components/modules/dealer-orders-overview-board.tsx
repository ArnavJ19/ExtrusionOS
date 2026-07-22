"use client";

import { Badge } from "@/components/ui/badge";
import { StatusBoard, StatusCard } from "@/components/status-board";

export type DealerOrderOverviewRow = {
  id: string;
  href: string;
  order_number: string;
  priority: string;
  status: string;
  dealer: string;
  source: string;
  created_at: string | null;
};

export function DealerOrdersOverviewBoard({
  statuses,
  records,
}: {
  statuses: string[];
  records: DealerOrderOverviewRow[];
}) {
  return (
    <StatusBoard
      statuses={statuses}
      records={records}
      getStatus={(order) => order.status}
      getCount={(status) => records.filter((order) => order.status === status).length}
      sortRecords={(a, b) => String(b.created_at).localeCompare(String(a.created_at))}
      emptyText="No dealer orders in this status."
      getViewMoreHref={() => "/dealer-orders/database"}
      renderCard={(order) => (
        <StatusCard
          href={order.href}
          title={order.order_number}
          subtitle={order.dealer}
          badges={<Badge value={order.priority} />}
          meta={<div className="flex justify-between gap-3"><span>Source</span><b className="text-neutral-950">{order.source}</b></div>}
        />
      )}
    />
  );
}

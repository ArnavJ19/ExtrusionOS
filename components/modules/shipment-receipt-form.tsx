"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ShipmentReceiptItem = {
  id: string;
  inventory_item_id: string;
  item_description: string | null;
  expected_quantity: number;
  unit: string;
  status: string;
  inventory_items?: { item_name?: string | null; item_code?: string | null } | null;
};

export function ShipmentReceiptForm({ dealerId, shipmentId, dealerOrderId, items }: { dealerId: string; shipmentId: string; dealerOrderId?: string | null; items: ShipmentReceiptItem[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const lines = items.map((item) => ({
      shipmentItemId: item.id,
      expectedQuantity: Number(item.expected_quantity),
      reportedReceivedQuantity: Number(form.get(`received_${item.id}`) || 0),
      inventoryItemId: item.inventory_item_id,
      unit: item.unit,
      notes: String(form.get(`notes_${item.id}`) || "") || null
    }));
    setLoading(true);
    const response = await fetch("/api/shipments/receipt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dealer_id: dealerId, shipment_id: shipmentId, dealer_order_id: dealerOrderId, lines, notes: String(form.get("notes") || "") || null })
    });
    const payload = await response.json();
    setLoading(false);
    if (!response.ok) return toast.error(payload.error ?? "Could not submit receipt");
    toast.success(payload.status === "discrepancy_reported" ? "Receipt submitted with discrepancy" : "Receipt confirmed");
    router.refresh();
  }

  return (
    <form onSubmit={submit}>
      <div className="overflow-x-auto"><table className="industrial-table min-w-[980px]"><thead><tr><th>Item</th><th>Expected</th><th>Actual Received</th><th>Difference</th><th>Notes</th><th>Status</th></tr></thead><tbody>{items.map((item) => <ReceiptRow key={item.id} item={item} />)}</tbody></table></div>
      <label className="mt-5 block space-y-1.5"><span className="form-label">Receipt notes</span><textarea className="form-input min-h-24" name="notes" placeholder="Mention bundle condition, missing labels, damage, or counting notes." /></label>
      <div className="mt-5 flex flex-wrap gap-3"><Button disabled={loading} type="submit">{loading ? "Submitting..." : "Confirm counted receipt"}</Button><p className="max-w-xl text-sm font-medium text-neutral-500">Matching lines move to dealer on-hand stock. Mismatched lines create discrepancy and recount workflow automatically.</p></div>
    </form>
  );
}

function ReceiptRow({ item }: { item: ShipmentReceiptItem }) {
  const [received, setReceived] = useState(Number(item.expected_quantity));
  const expected = Number(item.expected_quantity);
  const difference = received - expected;
  return (
    <tr>
      <td>{item.item_description ?? item.inventory_items?.item_name ?? item.inventory_items?.item_code ?? "Item"}</td>
      <td>{expected} {item.unit}</td>
      <td><input className="w-32 rounded-xl border border-neutral-200 px-3 py-2 text-sm font-semibold" name={`received_${item.id}`} type="number" min="0" step="0.001" value={received} onChange={(event) => setReceived(Number(event.target.value))} /></td>
      <td className={difference === 0 ? "text-emerald-600" : "font-bold text-rose-600"}>{difference}</td>
      <td><input className="w-56 rounded-xl border border-neutral-200 px-3 py-2 text-sm" name={`notes_${item.id}`} placeholder="Optional" /></td>
      <td><Badge value={difference === 0 ? "will_confirm" : "will_dispute"} /></td>
    </tr>
  );
}
